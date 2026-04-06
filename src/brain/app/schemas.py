from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


ProcessorName = Literal["stripe", "adyen", "braintree"]


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


class AuditEstimateRequest(BaseModel):
    failed_transactions: int = Field(ge=0)
    failed_amount_cents: int = Field(ge=0)
    region: str = Field(default="US")


class AuditEstimateResponse(BaseModel):
    recoverable_monthly_cents: int
    churn_reduction_percent: float
    confidence_band: str

