"""
Python port of 3_0_yield_response_to_N.R.

Goal: reproduce the same statistical conclusions (strictness B) using
scikit-learn instead of R's ranger. OOB R^2 and importances will differ
by a few percent because the implementations differ; conclusions hold.

Outputs are written to data/results_py/ so the R outputs are not touched.

Run from the project root:
    python 3_0_yield_response_to_N.py
"""

from __future__ import annotations

import json
import os
import warnings
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # headless backend; required when joblib spawns workers
import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
import rioxarray as rxr
import shap
import xarray as xr
import yaml
from rasterio.features import geometry_mask

from sklearn.ensemble import GradientBoostingRegressor
from sklearn.experimental import enable_halving_search_cv  # noqa: F401
from sklearn.inspection import PartialDependenceDisplay
from sklearn.model_selection import (
    HalvingRandomSearchCV,
    KFold,
    cross_val_predict,
    cross_val_score,
)

warnings.filterwarnings("ignore", category=UserWarning)

# ---------------------------------------------------------------------------
# Paths and config
# ---------------------------------------------------------------------------
try:
    PROJ = Path(__file__).resolve().parent
except NameError:
    PROJ = Path.cwd()
CFG  = yaml.safe_load((PROJ / "config" / "config.yml").read_text())
SEED = int(CFG["seed"])
np.random.seed(SEED)

EXT_ROOT = Path(CFG["paths"]["external_data_root"])
if not EXT_ROOT.exists():
    raise FileNotFoundError(
        f"external_data_root not found: {EXT_ROOT} (set in config/config.yml)"
    )

def ext(*parts: str) -> Path:
    """Resolve a path under paths.external_data_root (mirror of R external_path())."""
    return EXT_ROOT.joinpath(*parts)

OUT_ROOT   = PROJ / "data" / "results_py"
OUT_MODEL  = OUT_ROOT / "model"
OUT_FIG    = OUT_ROOT / "figures"
OUT_RAST   = OUT_ROOT / "rasters"
for p in (OUT_MODEL, OUT_FIG, OUT_RAST):
    p.mkdir(parents=True, exist_ok=True)

PREDICTORS = ["N_fertilizer", "P_fertilizer", "K_fertilizer",
              "oc", "pH", "sand", "clay", "ecec", "rain", "raincv"]


# ---------------------------------------------------------------------------
# Raster helpers
# ---------------------------------------------------------------------------
def load_raster(path: Path) -> xr.DataArray:
    da = rxr.open_rasterio(path, masked=True)
    return da

def resample_to(src: xr.DataArray, template: xr.DataArray,
                method: str = "bilinear") -> xr.DataArray:
    return src.rio.reproject_match(template, resampling=getattr(
        rasterio.enums.Resampling, method))

def mask_to_vector(da: xr.DataArray, gdf: gpd.GeoDataFrame) -> xr.DataArray:
    return da.rio.clip(gdf.geometry.tolist(), gdf.crs, drop=False)

def write_raster(da: xr.DataArray, path: Path) -> None:
    da.rio.to_raster(path, compress="DEFLATE", BIGTIFF="YES")


def write_stack(da: xr.DataArray, path: Path, band_names: list[str]) -> None:
    """Write a (band, y, x) DataArray to a multi-band GeoTIFF with band descriptions."""
    arr = da.to_numpy()
    if arr.ndim != 3:
        raise ValueError(f"write_stack expects 3-D (band,y,x), got shape {arr.shape}")
    if arr.shape[0] != len(band_names):
        raise ValueError(f"band count {arr.shape[0]} != names {len(band_names)}")
    profile = {
        "driver": "GTiff",
        "height": arr.shape[1],
        "width":  arr.shape[2],
        "count":  arr.shape[0],
        "dtype":  arr.dtype,
        "crs":    da.rio.crs,
        "transform": da.rio.transform(),
        "compress": "DEFLATE",
        "BIGTIFF": "YES",
        "nodata":  float("nan") if np.issubdtype(arr.dtype, np.floating) else None,
    }
    with rasterio.open(path, "w", **profile) as dst:
        for i, name in enumerate(band_names):
            dst.write(arr[i], i + 1)
            dst.set_band_description(i + 1, name)

def years_from_layer_names(names, prefix) -> list[int]:
    return [int(n.replace(prefix, "")) for n in names]


# ---------------------------------------------------------------------------
# Step 1: load inputs
# ---------------------------------------------------------------------------
print("[step 1] loading rasters and SSA boundary")
ssa = gpd.read_file(ext("gadm_ssa.gpkg"))

maize_area = load_raster(ext("maize_production_area.tif"))
npkg = load_raster(ext("nitrogen_price_pred.tif"))
mpkg = load_raster(ext("maize_price_pred.tif"))
rel_price = npkg / mpkg

rain_sum = load_raster(ext("rainfall", "sum_rain_growing_season_processed.tif"))
rain_cv  = load_raster(ext("rainfall", "cv_rain_growing_season_processed.tif"))

soil_isda = load_raster(ext("soil", "soil_af_isda_3m.tif"))
soil_sg   = load_raster(ext("soil", "soilgrids_properties_all.tif"))

# Layer names: terra encodes them in 'long_name' / 'descriptions'.
def layer_names(da: xr.DataArray) -> list[str]:
    if "long_name" in da.attrs:
        ln = da.attrs["long_name"]
        if isinstance(ln, (list, tuple)):
            return list(ln)
    if "descriptions" in da.attrs:
        return list(da.attrs["descriptions"])
    return [f"band_{i}" for i in range(da.sizes.get("band", 1))]

soil_isda_names = layer_names(soil_isda)
soil_sg_names   = layer_names(soil_sg)
rain_sum_names  = layer_names(rain_sum)
rain_cv_names   = layer_names(rain_cv)

ecec_idx = soil_sg_names.index("ecec")
ecec = soil_sg.isel(band=ecec_idx).expand_dims(band=[ecec_idx + 1])
ecec = resample_to(ecec, soil_isda)
soil = xr.concat([soil_isda, ecec], dim="band")
soil_names = soil_isda_names + ["ecec"]
soil = soil.assign_attrs(long_name=soil_names)


# ---------------------------------------------------------------------------
# Step 2: load and prepare carob agronomy data
# ---------------------------------------------------------------------------
print("[step 2] loading carob agronomy CSV")
response = pd.read_csv(ext("carob_agronomy.csv"))
maize = (
    response[response["crop"] == "maize"][[
        "dataset_id", "trial_id", "country", "site",
        "latitude", "longitude", "on_farm", "variety",
        "N_fertilizer", "yield", "P_fertilizer", "K_fertilizer",
        "planting_date",
    ]]
    .dropna(subset=["latitude", "longitude", "planting_date"])
    .copy()
)
maize["pyear"] = maize["planting_date"].astype(str).str.extract(r"(\d{4})")[0]
maize = maize.dropna(subset=["pyear"])
maize["pyear"] = maize["pyear"].astype(int)
maize = maize[maize["pyear"] >= 1981].drop_duplicates()

pts = gpd.GeoDataFrame(
    maize,
    geometry=gpd.points_from_xy(maize["longitude"], maize["latitude"]),
    crs="EPSG:4326",
)
pts = gpd.sjoin(pts, ssa[["geometry"]], predicate="within").drop(columns="index_right")


# ---------------------------------------------------------------------------
# Step 3: per-point environmental feature extraction (batched)
# ---------------------------------------------------------------------------
def sample_stack(da: xr.DataArray, gdf: gpd.GeoDataFrame) -> np.ndarray:
    """Sample every band of `da` at point geometries. Returns (N, B) array."""
    xs = gdf.geometry.x.to_numpy()
    ys = gdf.geometry.y.to_numpy()
    # rasterio sample wants (x, y) tuples; rioxarray's sel-by-coord is faster.
    x_da = xr.DataArray(xs, dims="pt")
    y_da = xr.DataArray(ys, dims="pt")
    sampled = da.sel(x=x_da, y=y_da, method="nearest")
    arr = sampled.transpose("pt", "band").to_numpy()
    return arr  # (N, B)

def extract_rain_features_batch(years, gdf, rain_sum, rain_cv,
                                rain_sum_names, rain_cv_names):
    """Mirror of R extract_rain_features_batch in utils.R."""
    years = np.asarray(years, dtype=int)
    n = len(years)
    yrs_sum = np.array(years_from_layer_names(rain_sum_names, "rain_"))
    yrs_cv  = np.array(years_from_layer_names(rain_cv_names,  "raincv_"))

    Vs = sample_stack(rain_sum, gdf)  # (n, len(yrs_sum))
    Vc = sample_stack(rain_cv,  gdf)

    col_sum = {y: i for i, y in enumerate(yrs_sum.tolist())}
    col_cv  = {y: i for i, y in enumerate(yrs_cv.tolist())}

    def pick(M, col_map, target_years, fallback=None):
        cols = np.array([col_map.get(int(y), -1) for y in target_years])
        out = np.full(n, np.nan)
        ok = cols >= 0
        if ok.any():
            out[ok] = M[np.where(ok)[0], cols[ok]]
        if fallback is not None:
            mask = np.isnan(out)
            out[mask] = fallback[mask]
        return out

    r_now  = pick(Vs, col_sum, years)
    cv_now = pick(Vc, col_cv,  years)
    r_lag  = pick(Vs, col_sum, years - 1, r_now)
    cv_lag = pick(Vc, col_cv,  years - 1, cv_now)

    def rolling_mean(M, col_map, target_years, fallback):
        out = np.full(n, np.nan)
        for i, y in enumerate(target_years):
            cols = [col_map[w] for w in range(int(y) - 5, int(y))
                    if w in col_map]
            if cols:
                v = M[i, cols]
                v = v[np.isfinite(v)]
                if v.size:
                    out[i] = v.mean()
        mask = np.isnan(out)
        out[mask] = fallback[mask]
        return out

    r_avg  = rolling_mean(Vs, col_sum, years, r_now)
    cv_avg = rolling_mean(Vc, col_cv,  years, cv_now)

    return pd.DataFrame({
        "rain": r_now, "raincv": cv_now,
        "rain_lag1": r_lag, "raincv_lag1": cv_lag,
        "rain_avg5yr": r_avg, "raincv_avg5yr": cv_avg,
    }, index=gdf.index)


CACHE = ext("maize_agronomy_with_env_py.csv")
if CACHE.exists():
    print(f"[step 3] loading cached features: {CACHE}")
    s_df = pd.read_csv(CACHE)
else:
    print("[step 3] extracting rain + soil features (batched)")
    rain_feats = extract_rain_features_batch(
        pts["pyear"].to_numpy(), pts, rain_sum, rain_cv,
        rain_sum_names, rain_cv_names,
    )
    soil_arr = sample_stack(soil, pts)
    soil_df = pd.DataFrame(soil_arr, columns=soil_names, index=pts.index)
    s_df = pd.concat([pts.drop(columns="geometry"), rain_feats, soil_df], axis=1)
    s_df.to_csv(CACHE, index=False)


# ---------------------------------------------------------------------------
# Step 4: clean training table
# ---------------------------------------------------------------------------
d = s_df[["yield"] + PREDICTORS].dropna()
d = d[(d["yield"] <= CFG["yield"]["yield_max_kgha"]) & (d["yield"] > 0)].copy()
d["yield"] = d["yield"] / 1000.0  # t/ha
d = d[d["N_fertilizer"] <= CFG["yield"]["n_max_kgha"]].copy()
print(f"[step 4] training rows: {len(d):,}")


# ---------------------------------------------------------------------------
# Step 5: train GradientBoostingRegressor, report CV R²
# ---------------------------------------------------------------------------
X = d[PREDICTORS].to_numpy()
y = d["yield"].to_numpy()

gbm_cfg = CFG.get("gbm", {})
NFOLDS = int(gbm_cfg.get("nfolds", 5))
N_CANDIDATES = int(gbm_cfg.get("n_candidates", 30))
kf = KFold(n_splits=NFOLDS, shuffle=True, random_state=SEED)

params_cache = OUT_MODEL / "gbm_best_params.json"
force_retune = os.environ.get("FORCE_RETUNE", "0") == "1"

if params_cache.exists() and not force_retune:
    best_params = json.loads(params_cache.read_text())
    print(f"[step 5] using cached hyperparameters (set FORCE_RETUNE=1 to re-search)")
    print(f"  params: {best_params}")
    rf = GradientBoostingRegressor(random_state=SEED, **best_params)
    rf.fit(X, y)
else:
    print("[step 5] tuning GradientBoostingRegressor via HalvingRandomSearchCV")
    param_dist = {
        "n_estimators":     [200, 300, 500, 800, 1200],
        "learning_rate":    [0.02, 0.03, 0.05, 0.08, 0.1],
        "max_depth":        [3, 4, 5, 6, 8],
        "min_samples_leaf": [3, 5, 10, 20, 50],
        "subsample":        [0.6, 0.7, 0.8, 0.9, 1.0],
        "max_features":     ["sqrt", 0.5, 0.7, 1.0],
    }
    search = HalvingRandomSearchCV(
        GradientBoostingRegressor(random_state=SEED),
        param_distributions=param_dist,
        n_candidates=N_CANDIDATES,
        factor=3,
        resource="n_samples",
        min_resources=3000,
        cv=kf,
        scoring="r2",
        random_state=SEED,
        n_jobs=-1,
        verbose=1,
        refit=True,
    )
    search.fit(X, y)
    rf = search.best_estimator_
    best_params = search.best_params_

    print(f"  best params: {best_params}")
    print(f"  halving best R²: {search.best_score_:.4f}")
    pd.DataFrame(search.cv_results_).to_csv(OUT_ROOT / "gbm_tuning_results.csv", index=False)
    params_cache.write_text(json.dumps(best_params))

cv_r2 = cross_val_score(rf, X, y, cv=kf, scoring="r2", n_jobs=-1)
cv_pred = cross_val_predict(rf, X, y, cv=kf, n_jobs=-1)
best_r2 = float(cv_r2.mean())
print(f"  CV R² (tuned model) = {best_r2:.4f} ± {cv_r2.std():.4f}  (folds: {np.round(cv_r2, 4)})")

import joblib
joblib.dump(rf, OUT_MODEL / "gbm_yield_model.joblib")


# ---------------------------------------------------------------------------
# Step 6: variable importance + CV observed-vs-predicted
# ---------------------------------------------------------------------------
print("[step 6] variable importance + CV scatter")
imp = pd.Series(rf.feature_importances_, index=PREDICTORS).sort_values()
fig, ax = plt.subplots(figsize=(7, 5))
imp.plot.barh(ax=ax, color="#FFBE00", edgecolor="black")
ax.set_xlabel("Impurity-based importance")
ax.set_title("Variable Importance — maize yield GBM")
fig.tight_layout()
fig.savefig(OUT_FIG / "yield_variable_importance.png", dpi=300)
plt.close(fig)

fig, ax = plt.subplots(figsize=(6, 6))
ax.scatter(y, cv_pred, s=8, alpha=0.25, color="#1D84FF")
lim = [0, max(y.max(), cv_pred.max())]
ax.plot(lim, lim, color="red", lw=1.5)
ax.set_xlabel("Observed yield (t/ha)")
ax.set_ylabel("CV predicted yield (t/ha)")
ax.set_title(f"Observed vs {NFOLDS}-fold CV predicted (R² = {best_r2:.3f})")
fig.tight_layout()
fig.savefig(OUT_FIG / "yield_observed_vs_predicted.png", dpi=300)
plt.close(fig)


# ---------------------------------------------------------------------------
# Step 7: PDP / ICE / SHAP
# ---------------------------------------------------------------------------
print("[step 7] partial dependence + SHAP")
fig, ax = plt.subplots(figsize=(7, 5))
PartialDependenceDisplay.from_estimator(
    rf, X, features=[PREDICTORS.index("N_fertilizer")],
    feature_names=PREDICTORS, kind="both", ax=ax, n_jobs=-1,
    grid_resolution=40, ice_lines_kw={"alpha": 0.05},
    pd_line_kw={"color": "red", "lw": 2},
)
ax.set_title("PDP + ICE: N_fertilizer -> yield (t/ha)")
fig.tight_layout()
fig.savefig(OUT_FIG / "pdp_ice_N_fertilizer.png", dpi=300)
plt.close(fig)

fig, ax = plt.subplots(figsize=(7, 5))
PartialDependenceDisplay.from_estimator(
    rf, X, features=[PREDICTORS.index("rain")],
    feature_names=PREDICTORS, ax=ax, n_jobs=-1, grid_resolution=40,
)
ax.set_title("PDP: rainfall -> yield (t/ha)")
fig.tight_layout()
fig.savefig(OUT_FIG / "pdp_rain.png", dpi=300)
plt.close(fig)

sample_n = min(2000, len(d))
rng = np.random.default_rng(SEED)
sample_idx = rng.choice(len(d), sample_n, replace=False)
X_sample = X[sample_idx]
explainer = shap.TreeExplainer(rf)
shap_values = explainer.shap_values(X_sample)

fig = plt.figure(figsize=(8, 6))
shap.summary_plot(shap_values, X_sample, feature_names=PREDICTORS, show=False)
plt.tight_layout()
plt.savefig(OUT_FIG / "shap_summary.png", dpi=300)
plt.close(fig)

all_pred = rf.predict(X)
id_high  = int(np.argmax(all_pred))
shap_high = explainer.shap_values(X[id_high:id_high + 1])[0]
fig, ax = plt.subplots(figsize=(7, 5))
order = np.argsort(np.abs(shap_high))
ax.barh(np.array(PREDICTORS)[order], shap_high[order], color="#0E3065")
ax.set_title(f"SHAP — high-yield obs (pred={all_pred[id_high]:.2f} t/ha)")
ax.set_xlabel("SHAP value (impact on predicted yield)")
fig.tight_layout()
fig.savefig(OUT_FIG / "breakdown_high_yield.png", dpi=300)
plt.close(fig)


# ---------------------------------------------------------------------------
# Step 8: spatial prediction — yield map for 2024 with N=100, P=50, K=15
# ---------------------------------------------------------------------------
print("[step 8] predicting 2024 yield map")

def build_yield_covars(soil, soil_names, rain_var_da, raincv_var_da,
                       N=100.0, P=50.0, K=15.0, ssa_gdf=None):
    """Stack covariates needed by the model in predictor order."""
    needed = ["oc", "pH", "sand", "clay", "ecec"]
    layer_idx = {nm: soil_names.index(nm) for nm in needed}
    soil_sel = xr.concat(
        [soil.isel(band=layer_idx[nm]).expand_dims(band=[i + 1])
         for i, nm in enumerate(needed)],
        dim="band",
    )
    soil_sel = soil_sel.assign_attrs(long_name=needed)
    if ssa_gdf is not None:
        soil_sel = soil_sel.rio.clip(ssa_gdf.geometry.tolist(), ssa_gdf.crs, drop=False)

    base = soil_sel.isel(band=0)
    def const_layer(value, name):
        a = xr.full_like(base, fill_value=value)
        a = a.expand_dims(band=[1])
        a = a.assign_attrs(long_name=[name])
        return a

    def rain_layer(src, name):
        r = resample_to(src, base)
        if r.ndim == 3:
            r = r.isel(band=0)
        return r.expand_dims(band=[1]).assign_attrs(long_name=[name])

    layers = {
        "N_fertilizer": const_layer(N, "N_fertilizer"),
        "P_fertilizer": const_layer(P, "P_fertilizer"),
        "K_fertilizer": const_layer(K, "K_fertilizer"),
        **{nm: soil_sel.isel(band=i).expand_dims(band=[i + 1])
                .assign_attrs(long_name=[nm]) for i, nm in enumerate(needed)},
        "rain":   rain_layer(rain_var_da,   "rain"),
        "raincv": rain_layer(raincv_var_da, "raincv"),
    }
    # Order to match PREDICTORS exactly.
    ordered = [layers[nm] for nm in PREDICTORS]
    stack = xr.concat(ordered, dim="band").assign_attrs(long_name=PREDICTORS)
    return stack

def predict_raster(model, stack: xr.DataArray) -> xr.DataArray:
    """Apply sklearn model across a (band, y, x) DataArray."""
    arr = stack.to_numpy()                             # (B, Y, X)
    B, Y, X = arr.shape
    flat = arr.reshape(B, -1).T                        # (Y*X, B)
    finite = np.isfinite(flat).all(axis=1)
    out = np.full(flat.shape[0], np.nan)
    if finite.any():
        out[finite] = model.predict(flat[finite])
    out_arr = out.reshape(Y, X)
    template = stack.isel(band=0).copy(data=out_arr)
    # Drop the multi-band long_name list we inherited from the predictor stack
    # so write_raster() doesn't complain about a name/band count mismatch.
    template.attrs.pop("long_name", None)
    return template

idx_2024 = rain_sum_names.index("rain_2024")
rain_2024 = rain_sum.isel(band=idx_2024)
idx_2024_cv = rain_cv_names.index("raincv_2024")
raincv_2024 = rain_cv.isel(band=idx_2024_cv)
covars_2024 = build_yield_covars(soil, soil_names, rain_2024, raincv_2024,
                                 N=100, P=50, K=15, ssa_gdf=ssa)
yield_2024 = predict_raster(rf, covars_2024)

# Save one 10-band predictor stack per year (rain_y + raincv_y, soil + fert constant)
years_rain = years_from_layer_names(rain_sum_names, "rain_")
years_cv   = years_from_layer_names(rain_cv_names,  "raincv_")
common_years = sorted(set(years_rain) & set(years_cv))
stack_dir = OUT_RAST / "predictor_stacks"
stack_dir.mkdir(parents=True, exist_ok=True)
for yr in common_years:
    rain_yr   = rain_sum.isel(band=years_rain.index(yr))
    raincv_yr = rain_cv.isel(band=years_cv.index(yr))
    covars_yr = build_yield_covars(soil, soil_names, rain_yr, raincv_yr,
                                   N=100, P=50, K=15, ssa_gdf=ssa)
    write_stack(covars_yr, stack_dir / f"predictor_stack_{yr}.tif", PREDICTORS)
print(f"  saved {len(common_years)} yearly predictor stacks under {stack_dir}"
      f"  (years {common_years[0]}..{common_years[-1]})")

# Mask to maize area
maize_mask = resample_to(maize_area, yield_2024).isel(band=0)
yield_2024 = yield_2024.where(np.isfinite(maize_mask))
write_raster(yield_2024.expand_dims(band=[1]), OUT_RAST / "predicted_yield_2024.tif")

fig, ax = plt.subplots(figsize=(7, 9))
yield_2024.plot(ax=ax, cmap="YlGn", cbar_kwargs={"label": "Yield (t/ha)"})
ssa.boundary.plot(ax=ax, color="grey", lw=0.5)
ax.set_title("Predicted maize yield 2024 (N=100, P=50, K=15 kg/ha)")
fig.tight_layout()
fig.savefig(OUT_FIG / "predicted_yield_2024.png", dpi=300)
plt.close(fig)


# ---------------------------------------------------------------------------
# Step 9: yield gain across N rates (mean rainfall)
# ---------------------------------------------------------------------------
print("[step 9] yield gain by N rate")
mean_rain   = rain_sum.mean(dim="band", skipna=True)
mean_raincv = rain_cv.mean(dim="band",  skipna=True)

n_rates = list(CFG["fertilizer"]["N_rates"])
gain_stack = []
gain_records = []

baseline_covars = build_yield_covars(soil, soil_names, mean_rain, mean_raincv,
                                     N=0, P=0, K=0, ssa_gdf=ssa)
yield_baseline = predict_raster(rf, baseline_covars)

for N in n_rates:
    covars = build_yield_covars(soil, soil_names, mean_rain, mean_raincv,
                                N=N, P=50, K=15, ssa_gdf=ssa)
    y_n = predict_raster(rf, covars)
    gain = (y_n - yield_baseline).where(np.isfinite(maize_mask))
    gain.attrs["long_name"] = f"N_{N}"
    gain_stack.append(gain)
    vals = gain.to_numpy()
    vals = vals[np.isfinite(vals)]
    gain_records.append({"N": N, "mean_gain": float(vals.mean()),
                         "sd_gain": float(vals.std())})

gain_da = xr.concat([g.expand_dims(band=[i + 1]) for i, g in enumerate(gain_stack)],
                    dim="band").assign_attrs(long_name=[f"N_{N}" for N in n_rates])
write_raster(gain_da, OUT_RAST / "predicted_yield_gains_by_N_rates.tif")

gain_df = pd.DataFrame(gain_records)
gain_df.to_csv(OUT_ROOT / "yield_gain_by_N.csv", index=False)

fig, ax = plt.subplots(figsize=(7, 5))
ax.errorbar(gain_df["N"], gain_df["mean_gain"], yerr=gain_df["sd_gain"],
            fmt="o-", color="#1D84FF", ecolor="#1D84FF", capsize=3)
ax.set_xlabel("Nitrogen rate (kg/ha)")
ax.set_ylabel("Yield gain over zero-input baseline (t/ha)")
ax.set_title("Yield gain response to nitrogen")
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(OUT_FIG / "yield_gain_response_to_N.png", dpi=300)
plt.close(fig)

# NUE at 60 kg N/ha
i60 = n_rates.index(60) if 60 in n_rates else None
if i60 is not None:
    nue_60 = (gain_stack[i60] / 60.0) * 1000.0  # kg grain per kg N
    nue_60.attrs["long_name"] = "NUE_60"
    write_raster(nue_60.expand_dims(band=[1]),
                 OUT_RAST / "nitrogen_use_efficiency_60N.tif")
    fig, ax = plt.subplots(figsize=(7, 9))
    nue_60.plot(ax=ax, cmap="YlOrRd", cbar_kwargs={"label": "kg grain / kg N"})
    ssa.boundary.plot(ax=ax, color="grey", lw=0.5)
    ax.set_title("Nitrogen use efficiency at 60 kg N/ha")
    fig.tight_layout()
    fig.savefig(OUT_FIG / "nue_60N.png", dpi=300)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Step 10: country summaries (ETH, KEN, NGA, TZA, ZMB) + SSA total
# ---------------------------------------------------------------------------
print("[step 10] country summaries")
target_iso = ["ETH", "KEN", "NGA", "TZA", "ZMB"]
ssa_sub = ssa[ssa["GID_0"].isin(target_iso)].copy()
ssa_union = ssa.dissolve().assign(GID_0="SSA")

def zonal_mean_sd(da, polys, label_col="GID_0"):
    rows = []
    for _, row in polys.iterrows():
        clipped = da.rio.clip([row.geometry], polys.crs, drop=True)
        v = clipped.to_numpy()
        v = v[np.isfinite(v)]
        rows.append({label_col: row[label_col],
                     "mean": float(v.mean()) if v.size else np.nan,
                     "sd":   float(v.std())  if v.size else np.nan})
    return pd.DataFrame(rows)

country_records = []
for i, N in enumerate(n_rates):
    g = gain_stack[i]
    df = pd.concat([
        zonal_mean_sd(g, ssa_sub),
        zonal_mean_sd(g, ssa_union),
    ], ignore_index=True)
    df["N_rate"] = N
    country_records.append(df)
country_df = pd.concat(country_records, ignore_index=True)
country_df.to_csv(OUT_ROOT / "yield_gain_by_country_N.csv", index=False)

fig, ax = plt.subplots(figsize=(8, 5))
for iso, sub in country_df.groupby("GID_0"):
    sub = sub.sort_values("N_rate")
    ax.plot(sub["N_rate"], sub["mean"], marker="o", label=iso)
ax.set_xlabel("Nitrogen rate (kg/ha)")
ax.set_ylabel("Mean yield gain (t/ha)")
ax.set_title("Yield gain response to N — by country + SSA")
ax.legend(frameon=False)
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(OUT_FIG / "yield_gain_by_country.png", dpi=300)
plt.close(fig)

print(f"[done] outputs under {OUT_ROOT}")
