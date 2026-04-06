from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.schemas import ScheduleRequest
from app.services.scheduler import RetryExhaustedError, RetryScheduler


class StaticModel:
    def __init__(self, minutes: int) -> None:
        self.minutes = minutes

    def score_delay_minutes(self, payload: ScheduleRequest) -> int:
        return self.minutes


def test_rejects_retry_count_at_or_above_limit() -> None:
    scheduler = RetryScheduler(model=StaticModel(30))
    payload = ScheduleRequest(invoice_id="inv_1", retry_count=4)

    with pytest.raises(RetryExhaustedError):
        scheduler.compute_optimal_retry(payload)


def test_shifts_out_of_sunday_maintenance_blackout() -> None:
    scheduler = RetryScheduler(model=StaticModel(90))
    scheduler.tz = timezone(timedelta(hours=-5), name="EST")
    # 2026-01-04 05:20 UTC = Sunday 00:20 EST.
    now = datetime(2026, 1, 4, 5, 20, tzinfo=UTC)
    payload = ScheduleRequest(invoice_id="inv_2", retry_count=1)

    result = scheduler.compute_optimal_retry(payload, now_utc=now)
    local = result.scheduled_at_utc.astimezone(scheduler.tz)

    assert local.weekday() == 6
    assert local.hour == 3
    assert local.minute == 5


def test_returns_timezone_aware_utc_timestamp() -> None:
    scheduler = RetryScheduler(model=StaticModel(12))
    payload = ScheduleRequest(invoice_id="inv_3")
    result = scheduler.compute_optimal_retry(payload)

    assert result.scheduled_at_utc.tzinfo == UTC
