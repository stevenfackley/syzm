from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import settings
from app.schemas import ProcessorName, ScheduleRequest
from app.services.model_registry import BrainModel


class RetryExhaustedError(ValueError):
    """Raised when a retry candidate has reached the global retry ceiling."""


@dataclass
class RetryScheduleResult:
    scheduled_at_utc: datetime
    reason: str
    eligible_processors: list[ProcessorName]


class RetryScheduler:
    def __init__(self, model: BrainModel) -> None:
        self.model = model
        try:
            self.tz = ZoneInfo(settings.timezone)
        except ZoneInfoNotFoundError:
            self.tz = UTC

    def compute_optimal_retry(
        self,
        payload: ScheduleRequest,
        now_utc: datetime | None = None,
    ) -> RetryScheduleResult:
        if payload.retry_count >= settings.max_retries:
            raise RetryExhaustedError("retry_count must be < 4")

        now = now_utc or datetime.now(UTC)
        if now.tzinfo is None:
            now = now.replace(tzinfo=UTC)

        delay_minutes = self.model.score_delay_minutes(payload)
        candidate = now + timedelta(minutes=delay_minutes)
        candidate = self._shift_outside_maintenance(candidate)
        candidate = candidate.replace(second=0, microsecond=0)

        minimum_window = now + timedelta(minutes=5)
        if candidate < minimum_window:
            candidate = minimum_window.replace(second=0, microsecond=0)

        reason = f"predicted delay={delay_minutes}m, compliance-adjusted"
        return RetryScheduleResult(
            scheduled_at_utc=candidate.astimezone(UTC),
            reason=reason,
            eligible_processors=self._compute_processor_route(payload),
        )

    def _shift_outside_maintenance(self, candidate_utc: datetime) -> datetime:
        local = candidate_utc.astimezone(self.tz)
        is_sunday = local.weekday() == 6
        in_blackout = settings.maintenance_start_hour <= local.hour < settings.maintenance_end_hour

        if is_sunday and in_blackout:
            shifted_local = local.replace(hour=settings.maintenance_end_hour, minute=5, second=0, microsecond=0)
            return shifted_local.astimezone(UTC)

        return candidate_utc

    def _compute_processor_route(self, payload: ScheduleRequest) -> list[ProcessorName]:
        processors: list[ProcessorName] = ["stripe", "adyen", "braintree"]
        history = set(payload.processor_history)
        preferred = [p for p in processors if p not in history]
        if not preferred:
            return processors
        return preferred
