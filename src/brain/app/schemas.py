from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator


ProcessorName = Literal["stripe", "adyen", "braintree"]

# Canonical decline categories — shared vocabulary across Brain, Portal, and
# any downstream agents.  Map raw processor decline codes to these before
# calling /v1/audit/estimate.
DeclineCategory = Literal[
    "insufficient_funds",
    "do_not_honor",
    "transient",
    "velocity",
    "expired_card",
    "invalid_data",
    "fraud",
    "authentication",
    "unknown",
]


class ScheduleRequest(BaseModel):
    invoice_id: str = Field(min_length=1, max_length=256)
    decline_code: str | None = None
    bank_bin: str | None = Field(default=None, max_length=8)
    region: str = Field(default="US", max_length=16)
    retry_count: int = Field(default=0, ge=0)
    original_amount_cents: int = Field(default=0, ge=0)
    processor_origin: ProcessorName = "stripe"
    processor_history: list[ProcessorName] = Field(default_factory=list)

    @field_validator("bank_bin")
    @classmethod
    def validate_bin_digits(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not value.isdigit():
            raise ValueError("bank_bin must contain only digits")
        if len(value) < 6:
            raise ValueError("bank_bin must be at least 6 digits when provided")
        return value


class ScheduleResponse(BaseModel):
    invoice_id: str
    scheduled_at_utc: datetime
    reason: str
    strategy_version: str
    eligible_processors: list[ProcessorName]


class SegmentBreakdownItem(BaseModel):
    """Per-category breakdown returned in AuditEstimateResponse."""
    category: str
    amount_cents: int
    recovery_rate: float
    recoverable_cents: int
    do_not_retry: bool
    description: str


class AuditEstimateRequest(BaseModel):
    failed_transactions: int = Field(ge=0)
    failed_amount_cents: int = Field(ge=0)
    region: str = Field(default="US")
    # Optional segmented breakdown; keys must be DeclineCategory values.
    # If omitted, the engine applies the documented default decline mix.
    breakdown_by_category: dict[str, Annotated[int, Field(ge=0)]] | None = None


class AuditEstimateResponse(BaseModel):
    # --- fields already consumed by the portal (backward-compatible) ---
    recoverable_monthly_cents: int
    churn_reduction_percent: float
    confidence_band: str
    # --- new segmented fields ---
    recoverable_amount_cents: int
    blended_recovery_rate: float
    confidence_low_cents: int
    confidence_high_cents: int
    segments: list[SegmentBreakdownItem] = Field(default_factory=list)
    used_default_mix: bool = False
    disclaimer: str = (
        "Recovery rates are industry-informed estimates, NOT guarantees. "
        "Actual recovery depends on merchant category, issuer, retry timing, and card mix."
    )

