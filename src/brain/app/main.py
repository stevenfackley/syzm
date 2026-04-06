from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException

from app.config import settings
from app.schemas import (
    AuditEstimateRequest,
    AuditEstimateResponse,
    ScheduleRequest,
    ScheduleResponse,
)
from app.services.model_registry import BrainModel
from app.services.scheduler import RetryExhaustedError, RetryScheduler

app = FastAPI(title="Syzm Brain", version="0.1.0")
model = BrainModel()
scheduler = RetryScheduler(model)


@app.get("/healthz")
def healthz() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "model_loaded": model.loaded,
        "strategy_version": settings.strategy_version,
    }


@app.post("/v1/schedule", response_model=ScheduleResponse)
def schedule_retry(payload: ScheduleRequest) -> ScheduleResponse:
    try:
        result = scheduler.compute_optimal_retry(payload)
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
def estimate_audit(payload: AuditEstimateRequest) -> AuditEstimateResponse:
    # Conservative launch assumption: 0.5% recoverable revenue for qualified soft declines.
    recoverable = int(payload.failed_amount_cents * 0.005)
    churn_reduction = 1.7 if payload.region.upper() == "US" else 1.3
    confidence = "medium" if payload.failed_transactions >= 500 else "low"

    return AuditEstimateResponse(
        recoverable_monthly_cents=recoverable,
        churn_reduction_percent=churn_reduction,
        confidence_band=confidence,
    )


@app.get("/v1/compliance")
def compliance_rules() -> dict[str, str | int | datetime]:
    return {
        "max_retry_count_exclusive": settings.max_retries,
        "maintenance_blackout_timezone": settings.timezone,
        "maintenance_blackout_start_hour": settings.maintenance_start_hour,
        "maintenance_blackout_end_hour": settings.maintenance_end_hour,
        "generated_at_utc": datetime.now(UTC),
    }

