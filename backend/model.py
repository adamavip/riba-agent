from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import rasterio
from rasterio.transform import rowcol
from rasterio.warp import transform


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "SSA_maize_yield_response"
MODEL_PATH = DATA_DIR / "gbm_yield_model.joblib"
PREDICTOR_STACK_PATH = DATA_DIR / "predictor_stack_all_years_sel.tif"

MODEL_FEATURES = [
    "N_fertilizer",
    "P_fertilizer",
    "K_fertilizer",
    "oc",
    "pH",
    "sand",
    "clay",
    "ecec",
    "rain",
    "raincv",
]

STACK_FEATURES = {
    "oc": "oc",
    "pH": "pH",
    "sand": "sand",
    "clay": "clay",
    "ecec": "ecec",
    "rain": "rain_2024",
    "raincv": "raincv_2024",
}

DEFAULT_FERTILIZER_RATES = {
    "N_fertilizer": 100.0,
    "P_fertilizer": 50.0,
    "K_fertilizer": 15.0,
}


class PredictionError(ValueError):
    pass


@dataclass(frozen=True)
class PredictionResult:
    latitude: float
    longitude: float
    predictors: dict[str, float]
    yield_t_ha: float


_MODEL = None
_STACK_INDEX: dict[str, int] | None = None


def load_model():
    global _MODEL
    if _MODEL is None:
        _MODEL = joblib.load(MODEL_PATH)
    return _MODEL


def load_stack_index() -> dict[str, int]:
    global _STACK_INDEX
    if _STACK_INDEX is None:
        with rasterio.open(PREDICTOR_STACK_PATH) as src:
            descriptions = list(src.descriptions)
        _STACK_INDEX = {
            name: idx
            for idx, name in enumerate(descriptions, start=1)
            if name
        }
    return _STACK_INDEX


def _validate_lat_lon(latitude: float, longitude: float) -> tuple[float, float]:
    latitude = float(latitude)
    longitude = float(longitude)

    if not -90.0 <= latitude <= 90.0:
        raise PredictionError("latitude must be between -90 and 90.")
    if not -180.0 <= longitude <= 180.0:
        raise PredictionError("longitude must be between -180 and 180.")

    return latitude, longitude


def _coordinate_to_dataset_crs(
    src: rasterio.io.DatasetReader, latitude: float, longitude: float
) -> tuple[float, float]:
    if src.crs is None:
        return longitude, latitude

    xs, ys = transform("EPSG:4326", src.crs, [longitude], [latitude])
    return xs[0], ys[0]


def _sample_stack(latitude: float, longitude: float) -> dict[str, float]:
    stack_index = load_stack_index()

    missing_features = [
        stack_name
        for stack_name in STACK_FEATURES.values()
        if stack_name not in stack_index
    ]
    if missing_features:
        raise PredictionError(
            f"Missing raster bands in predictor stack: {', '.join(missing_features)}"
        )

    with rasterio.open(PREDICTOR_STACK_PATH) as src:
        x, y = _coordinate_to_dataset_crs(src, latitude, longitude)
        bounds = src.bounds
        if not (bounds.left <= x <= bounds.right and bounds.bottom <= y <= bounds.top):
            raise PredictionError("Point is outside the raster extent.")

        row, col = rowcol(src.transform, x, y)
        if row < 0 or col < 0 or row >= src.height or col >= src.width:
            raise PredictionError("Point is outside the raster grid.")

        values = {}
        for feature_name, stack_name in STACK_FEATURES.items():
            band = stack_index[stack_name]
            sample = src.read(band, window=((row, row + 1), (col, col + 1)))
            value = float(sample[0, 0])
            if not np.isfinite(value):
                raise PredictionError(
                    f"No raster value found for '{stack_name}' at this location."
                )
            values[feature_name] = value

    return values


def build_predictor_vector(
    latitude: float,
    longitude: float,
    n_fertilizer: float = DEFAULT_FERTILIZER_RATES["N_fertilizer"],
    p_fertilizer: float = DEFAULT_FERTILIZER_RATES["P_fertilizer"],
    k_fertilizer: float = DEFAULT_FERTILIZER_RATES["K_fertilizer"],
) -> dict[str, float]:
    latitude, longitude = _validate_lat_lon(latitude, longitude)
    predictors = _sample_stack(latitude, longitude)
    predictors.update(
        {
            "N_fertilizer": float(n_fertilizer),
            "P_fertilizer": float(p_fertilizer),
            "K_fertilizer": float(k_fertilizer),
        }
    )
    return {feature: predictors[feature] for feature in MODEL_FEATURES}


def predict_yield(
    latitude: float,
    longitude: float,
    n_fertilizer: float = DEFAULT_FERTILIZER_RATES["N_fertilizer"],
    p_fertilizer: float = DEFAULT_FERTILIZER_RATES["P_fertilizer"],
    k_fertilizer: float = DEFAULT_FERTILIZER_RATES["K_fertilizer"],
) -> PredictionResult:
    latitude, longitude = _validate_lat_lon(latitude, longitude)
    predictors = build_predictor_vector(
        latitude=latitude,
        longitude=longitude,
        n_fertilizer=n_fertilizer,
        p_fertilizer=p_fertilizer,
        k_fertilizer=k_fertilizer,
    )
    model = load_model()
    ordered = np.array([[predictors[feature] for feature in MODEL_FEATURES]], dtype=float)
    predicted_yield = float(model.predict(ordered)[0])
    return PredictionResult(
        latitude=latitude,
        longitude=longitude,
        predictors=predictors,
        yield_t_ha=predicted_yield,
    )
