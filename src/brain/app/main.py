"""Syzm Brain FastAPI application.

Auth: protected endpoints require ``X-Syzm-Key`` header (see app/auth.py).
Correlation: every request gets an ``X-Request-Id`` echoed in the response.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, HTTPException, Request, Response

from app.auth import require_api_key
from app.config import settings
from app.schemas import (
    AuditEstimateRequest,
    AuditEstimateResponse,
    ScheduleRequest,
    ScheduleResponse,
    SegmentBreakdownItem,
)
from app.services.model_registry import BrainModel
from app.services.recovery_model import estimate_recovery
from app.services.scheduler import RetryExhaustedError, RetryScheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",  # messages are already JSON blobs
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Syzm Brain", version="0.1.0")
model = BrainModel()
scheduler = RetryScheduler(model)


# ---------------------------------------------------------------------------
# Correlation-id middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next: object) -> Response:
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    request.state.request_id = request_id
    start = time.monotonic()
    response: Response = await call_next(request)  # type: ignore[operator]
    latency_ms = round((time.monotonic() - start) * 1000, 1)
    response.headers["X-Request-Id"] = request_id
    logger.info(
        '{"event":"request","request_id":"%s","method":"%s","path":"%s",'
        '"status":%d,"latency_ms":%s}',
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        latency_ms,
    )
    return response


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/healthz")
def healthz() -> dict[str, str | bool]:
    """Health check — intentionally unauthenticated."""
    return {
        "status": "ok",
        "model_loaded": model.loaded,
        "strategy_version": settings.strategy_version,
    }


@app.post("/v1/schedule", response_model=ScheduleResponse)
def schedule_retry(
    payload: ScheduleRequest,
    request: Request,
    _key: str = Depends(require_api_key),
) -> ScheduleResponse:
    request_id: str = getattr(request.state, "request_id", "-")
    try:
        result = scheduler.compute_optimal_retry(payload, request_id=request_id)
    except RetryExhaustedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return ScheduleResponse(
        invoice_id=payload.invoice_id,
        scheduled_at_utc=result.scheduled_at_utc,
        reason=result.reason,
        strategy_version=settings.strategy_version,
        eligible_processors=result.eligible_processors,
    )


@app.post("/v1/audit/estimate", response_model=AuditEstimateResponse)
def estimate_audit(
    payload: AuditEstimateRequest,
    _key: str = Depends(require_api_key),
) -> AuditEstimateResponse:
    """Return a segmented recoverable-revenue estimate.

    If ``breakdown_by_category`` is provided in the request body, the engine
    uses the caller-supplied segment amounts.  Otherwise it applies the
    documented DEFAULT_DECLINE_MIX to ``failed_amount_cents``.

    ALL RATES ARE ESTIMATES — see recovery_model.py disclaimer.
    """
    recovery = estimate_recovery(
        breakdown=payload.breakdown_by_category,
        total_amount_cents=payload.failed_amount_cents,
    )

    churn_reduction = 1.7 if payload.region.upper() == "US" else 1.3
    # Legacy confidence_band kept for portal backward-compat.
    confidence = "medium" if payload.failed_transactions >= 500 else "low"

    return AuditEstimateResponse(
        # --- backward-compatible fields ---
        recoverable_monthly_cents=recovery.recoverable_amount_cents,
        churn_reduction_percent=churn_reduction,
        confidence_band=confidence,
        # --- new segmented fields ---
        recoverable_amount_cents=recovery.recoverable_amount_cents,
        blended_recovery_rate=recovery.blended_recovery_rate,
        confidence_low_cents=recovery.confidence_low_cents,
        confidence_high_cents=recovery.confidence_high_cents,
        segments=[
            SegmentBreakdownItem(
                category=s.category,
                amount_cents=s.amount_cents,
                recovery_rate=s.recovery_rate,
                recoverable_cents=s.recoverable_cents,
                do_not_retry=s.do_not_retry,
                description=s.description,
            )
            for s in recovery.segments
        ],
        used_default_mix=recovery.used_default_mix,
        disclaimer=recovery.disclaimer,
    )


@app.get("/v1/compliance")
def compliance_rules() -> dict[str, str | int | datetime]:
    """Compliance configuration — unauthenticated (read-only, no secrets)."""
    return {
        "max_retry_count_exclusive": settings.max_retries,
        "maintenance_blackout_timezone": settings.timezone,
        "maintenance_blackout_start_hour": settings.maintenance_start_hour,
        "maintenance_blackout_end_hour": settings.maintenance_end_hour,
        "generated_at_utc": datetime.now(UTC),
    }
