from __future__ import annotations

import os
from dataclasses import dataclass

try:
    import numpy as np
except ImportError:  # pragma: no cover - optional for early scaffold
    np = None

try:
    import xgboost as xgb
except ImportError:  # pragma: no cover - optional for early scaffold
    xgb = None

from app.config import settings
from app.schemas import ScheduleRequest


@dataclass
class BrainModel:
    model_path: str = settings.model_uri
    loaded: bool = False
    booster: object | None = None

    def __post_init__(self) -> None:
        if xgb is None or np is None:
            return
        if not os.path.exists(self.model_path):
            return
        booster = xgb.Booster()
        booster.load_model(self.model_path)
        self.booster = booster
        self.loaded = True

    def score_delay_minutes(self, payload: ScheduleRequest) -> int:
        if self.loaded and self.booster is not None and np is not None and xgb is not None:
            features = np.array(
                [
                    payload.retry_count,
                    payload.original_amount_cents / 100.0,
                    len(payload.processor_history),
                    1 if payload.region.upper() == "US" else 0,
                ],
                dtype=float,
            ).reshape(1, -1)
            prediction = self.booster.predict(xgb.DMatrix(features))[0]
            return max(5, int(prediction))

        # Heuristic fallback for scaffold mode
        base = settings.default_retry_delay_minutes
        region_factor = 0 if payload.region.upper() == "US" else 25
        decline_factor = 20 if (payload.decline_code or "").lower() in {"insufficient_funds", "51"} else 0
        retry_penalty = payload.retry_count * 15
        return max(5, base + region_factor + decline_factor + retry_penalty)

