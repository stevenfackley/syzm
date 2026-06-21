from __future__ import annotations

import logging
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

logger = logging.getLogger(__name__)


@dataclass
class BrainModel:
    model_path: str = settings.model_uri
    loaded: bool = False
    booster: object | None = None

    def __post_init__(self) -> None:
        if xgb is None or np is None:
            logger.warning(
                '{"event":"model_load_skipped","reason":"xgboost_or_numpy_unavailable"}'
            )
            return
        if not os.path.exists(self.model_path):
            logger.warning(
                '{"event":"model_load_skipped","reason":"model_file_not_found","path":"%s"}',
                self.model_path,
            )
            return
        booster = xgb.Booster()
        booster.load_model(self.model_path)
        self.booster = booster
        self.loaded = True
        logger.info(
            '{"event":"model_loaded","path":"%s"}',
            self.model_path,
        )

    def score_delay_minutes(
        self,
        payload: ScheduleRequest,
        request_id: str = "-",
    ) -> int:
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
            result = max(5, int(prediction))
            logger.info(
                '{"event":"score","mode":"xgboost","request_id":"%s",'
                '"decline_code":"%s","result_minutes":%d}',
                request_id,
                payload.decline_code or "",
                result,
            )
            return result

        # Heuristic fallback for scaffold mode
        base = settings.default_retry_delay_minutes
        region_factor = 0 if payload.region.upper() == "US" else 25
        decline_factor = 20 if (payload.decline_code or "").lower() in {"insufficient_funds", "51"} else 0
        retry_penalty = payload.retry_count * 15
        result = max(5, base + region_factor + decline_factor + retry_penalty)
        logger.info(
            '{"event":"score","mode":"heuristic","request_id":"%s",'
            '"decline_code":"%s","result_minutes":%d}',
            request_id,
            payload.decline_code or "",
            result,
        )
        return result

