"""Tests for API-key authentication on protected endpoints."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app, raise_server_exceptions=True)

VALID_KEY = settings.brain_api_key

SCHEDULE_PAYLOAD = {
    "invoice_id": "inv_auth_test",
    "retry_count": 0,
    "original_amount_cents": 5000,
    "region": "US",
}

AUDIT_PAYLOAD = {
    "failed_transactions": 100,
    "failed_amount_cents": 100_000,
    "region": "US",
}


# ---------------------------------------------------------------------------
# Health — must be open
# ---------------------------------------------------------------------------

def test_health_no_key_returns_200() -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"


def test_health_with_key_still_200() -> None:
    resp = client.get("/healthz", headers={"X-Syzm-Key": VALID_KEY})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /v1/schedule — must require key
# ---------------------------------------------------------------------------

def test_schedule_no_key_returns_401() -> None:
    resp = client.post("/v1/schedule", json=SCHEDULE_PAYLOAD)
    assert resp.status_code == 401
    assert "unauthorized" in resp.text.lower()


def test_schedule_wrong_key_returns_401() -> None:
    resp = client.post("/v1/schedule", json=SCHEDULE_PAYLOAD, headers={"X-Syzm-Key": "bad-key"})
    assert resp.status_code == 401


def test_schedule_valid_key_returns_200() -> None:
    resp = client.post("/v1/schedule", json=SCHEDULE_PAYLOAD, headers={"X-Syzm-Key": VALID_KEY})
    assert resp.status_code == 200
    body = resp.json()
    assert body["invoice_id"] == "inv_auth_test"
    assert "scheduled_at_utc" in body


# ---------------------------------------------------------------------------
# POST /v1/audit/estimate — must require key
# ---------------------------------------------------------------------------

def test_audit_no_key_returns_401() -> None:
    resp = client.post("/v1/audit/estimate", json=AUDIT_PAYLOAD)
    assert resp.status_code == 401


def test_audit_wrong_key_returns_401() -> None:
    resp = client.post("/v1/audit/estimate", json=AUDIT_PAYLOAD, headers={"X-Syzm-Key": "wrong"})
    assert resp.status_code == 401


def test_audit_valid_key_returns_200() -> None:
    resp = client.post("/v1/audit/estimate", json=AUDIT_PAYLOAD, headers={"X-Syzm-Key": VALID_KEY})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Correlation-id header
# ---------------------------------------------------------------------------

def test_response_echoes_provided_request_id() -> None:
    resp = client.get("/healthz", headers={"X-Request-Id": "test-corr-abc"})
    assert resp.headers.get("x-request-id") == "test-corr-abc"


def test_response_generates_request_id_when_absent() -> None:
    resp = client.get("/healthz")
    rid = resp.headers.get("x-request-id")
    assert rid is not None and len(rid) > 0
