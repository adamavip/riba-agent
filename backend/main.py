from __future__ import annotations

from flask import Flask, jsonify, request

from model import PredictionError, predict_yield


app = Flask(__name__)


@app.get("/health")
def healthcheck():
    return jsonify({"status": "ok"})


@app.post("/predict")
def predict():
    payload = request.get_json(silent=True) or {}

    try:
        latitude = payload["latitude"]
        longitude = payload["longitude"]
    except KeyError as exc:
        return (
            jsonify(
                {
                    "error": f"Missing required field: {exc.args[0]}",
                }
            ),
            400,
        )

    try:
        result = predict_yield(
            latitude=latitude,
            longitude=longitude,
            n_fertilizer=payload.get("N_fertilizer", 100.0),
            p_fertilizer=payload.get("P_fertilizer", 50.0),
            k_fertilizer=payload.get("K_fertilizer", 15.0),
        )
    except PredictionError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Prediction failed: {exc}"}), 500

    return jsonify(
        {
            "latitude": result.latitude,
            "longitude": result.longitude,
            "predictors": result.predictors,
            "predicted_yield_t_ha": result.yield_t_ha,
            "message": f"Predicted maize yield is {result.yield_t_ha:.2f} t/ha.",
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
