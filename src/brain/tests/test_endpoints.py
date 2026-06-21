"""Endpoint contract tests for /v1/audit/estimate and /v1/schedule."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app, raise_server_exceptions=True)
KEY = settings.brain_api_key
AUTH = {"X-Syzm-Key": KEY}


# ---------------------------------------------------------------------------
# /v1/audit/estimate
# ---------------------------------------------------------------------------

class TestAuditEstimate:
    def test_returns_200_with_valid_key(self) -> None:
        resp = client.post(
            "/v1/audit/estimate",
            json={"failed_transactions": 100, "failed_amount_cents": 100_000, "region": "US"},
            headers=AUTH,
        )
        assert resp.status_code == 200

    def test_backward_compatible_fields_present(self) -> None:
        resp = client.post(
            "/v1/audit/estimate",
            json={"failed_transactions": 600, "failed_amount_cents": 200_000, "region": "US"},
            headers=AUTH,
        )
        body = resp.json()
        # Fields the portal already consumes
        assert "recoverable_monthly_cents" in body
        assert "churn_reduction_percent" in body
        assert "confidence_band" in body

    def test_new_fields_present(self) -> None:
        resp = client.post(
            "/v1/audit/estimate",
            json={"failed_transactions": 100, "failed_amount_cents": 50_000},
            headers=AUTH,
        )
        body = resp.json()
        assert "recoverable_amount_cents" in body
        assert "blended_recovery_rate" in body
        assert "confidence_low_cents" in body
        assert "confidence_high_cents" in body
        assert "segments" in body
        assert isinstance(body["segments"], list)
        assert len(body["segments"]) > 0
        assert "disclaimer" in body

    def test_confidence_band_medium_when_gte_500_transactions(self) -> None:
        resp = client.post(
            "/v1/audit/estimate",
            json={"failed_transactions": 500, "failed_amount_cents": 10_000},
            headers=AUTH,
        )
        assert resp.json()["confidence_band"] == "medium"

    def test_confidence_band_low_when_lt_500_transactions(self) -> None:
        resp = client.post(
            "/v1/audit/estimate",
            json={"failed_transactions": 499, "failed_amount_cents": 10_000},
            headers=AUTH,
        )
        assert resp.json()["confidence_band"] == "low"

    def test_churn_reduction_us_vs_non_us(self) -> None:
        us = client.post(
            "/v1/audit/estimate",
            json={"failed_transactions": 100, "failed_amount_cents": 10_000, "region": "US"},
            headers=AUTH,
        ).json()
        eu = client.post(
            "/v1/audit/estimate",
            json={"failed_transactions": 100, "failed_amount_cents": 10_000, "region": "EU"},
            headers=AUTH,
        ).json()
        assert us["churn_reduction_percent"] > eu["churn_reduction_percent"]

    def test_explicit_breakdown_used(self) -> None:
        resp = client.post(
            "/v1/audit/estimate",
            json={
                "failed_transactions": 100,
                "failed_amount_cents": 100_000,
                "breakdown_by_category": {
                    "fraud": 100_000,
                },
            },
            headers=AUTH,
        )
        body = resp.json()
        assert body["recoverable_amount_cents"] == 0
        assert body["used_default_mix"] is False

    def test_default_mix_flag_set_when_no_breakdown(self) -> None:
        resp = client.post(
            "/v1/audit/estimate",
            json={"failed_transactions": 100, "failed_amount_cents": 100_000},
            headers=AUTH,
        )
        assert resp.json()["used_default_mix"] is True

    def test_zero_amount_returns_zero(self) -> None:
        resp = client.post(
            "/v1/audit/estimate",
            json={"failed_transactions": 0, "failed_amount_cents": 0},
            headers=AUTH,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["recoverable_amount_cents"] == 0

    def test_segment_items_have_required_fields(self) -> None:
        resp = client.post(
            "/v1/audit/estimate",
            json={
                "failed_transactions": 100,
                "failed_amount_cents": 50_000,
                "breakdown_by_category": {"insufficient_funds": 50_000},
            },
            headers=AUTH,
        )
        seg = resp.json()["segments"][0]
        for key in ("category", "amount_cents", "recovery_rate", "recoverable_cents", "do_not_retry", "description"):
            assert key in seg, f"missing field: {key}"


# ---------------------------------------------------------------------------
# /v1/schedule
# ---------------------------------------------------------------------------

class TestSchedule:
    def test_returns_200_with_valid_key(self) -> None:
        resp = client.post(
            "/v1/schedule",
            json={"invoice_id": "inv_ep_1", "retry_count": 0, "region": "US"},
            headers=AUTH,
        )
        assert resp.status_code == 200

    def test_response_has_required_fields(self) -> None:
        resp = client.post(
            "/v1/schedule",
            json={"invoice_id": "inv_ep_2", "retry_count": 1},
            headers=AUTH,
        )
        body = resp.json()
        for key in ("invoice_id", "scheduled_at_utc", "reason", "strategy_version", "eligible_processors"):
            assert key in body, f"missing field: {key}"

    def test_retry_exhausted_returns_422(self) -> None:
        resp = client.post(
            "/v1/schedule",
            json={"invoice_id": "inv_ep_3", "retry_count": 4},
            headers=AUTH,
        )
        assert resp.status_code == 422

    def test_invoice_id_in_response(self) -> None:
        resp = client.post(
            "/v1/schedule",
            json={"invoice_id": "my-unique-inv", "retry_count": 0},
            headers=AUTH,
        )
        assert resp.json()["invoice_id"] == "my-unique-inv"
