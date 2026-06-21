"""Tests for BrainModel — load-vs-fallback behavior."""
from __future__ import annotations

import os
import tempfile

import pytest

from app.schemas import ScheduleRequest
from app.services.model_registry import BrainModel


def make_payload(**kwargs: object) -> ScheduleRequest:
    defaults = dict(invoice_id="inv_test", retry_count=0, original_amount_cents=5000, region="US")
    defaults.update(kwargs)
    return ScheduleRequest(**defaults)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Heuristic fallback when model file is absent
# ---------------------------------------------------------------------------

def test_heuristic_fallback_when_no_model_file() -> None:
    m = BrainModel(model_path="/nonexistent/path/model.json")
    assert m.loaded is False
    # Should not raise; should return a positive integer.
    delay = m.score_delay_minutes(make_payload())
    assert isinstance(delay, int)
    assert delay >= 5


def test_heuristic_increases_with_retry_count() -> None:
    m = BrainModel(model_path="/nonexistent/path/model.json")
    d0 = m.score_delay_minutes(make_payload(retry_count=0))
    d2 = m.score_delay_minutes(make_payload(retry_count=2))
    assert d2 > d0


def test_heuristic_adds_penalty_for_insufficient_funds() -> None:
    m = BrainModel(model_path="/nonexistent/path/model.json")
    d_other = m.score_delay_minutes(make_payload(decline_code="do_not_honor"))
    d_nsf = m.score_delay_minutes(make_payload(decline_code="insufficient_funds"))
    assert d_nsf > d_other


# ---------------------------------------------------------------------------
# XGBoost model load (only runs if xgboost + a trained model are available)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    not os.path.exists(
        os.path.join(os.path.dirname(__file__), "..", "models", "latest.json")
    ),
    reason="models/latest.json not present — run scripts/train_baseline.py first",
)
def test_xgboost_model_loads_and_scores() -> None:
    model_path = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "models", "latest.json")
    )
    m = BrainModel(model_path=model_path)
    assert m.loaded is True
    delay = m.score_delay_minutes(make_payload())
    assert isinstance(delay, int)
    assert delay >= 5


def test_score_accepts_request_id_kwarg() -> None:
    """request_id kwarg must not raise, even in heuristic mode."""
    m = BrainModel(model_path="/nonexistent/model.json")
    delay = m.score_delay_minutes(make_payload(), request_id="test-rid-123")
    assert delay >= 5
