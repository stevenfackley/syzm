"""API-key authentication dependency for protected endpoints.

Callers must supply the key in the ``X-Syzm-Key`` request header.
Set ``SYZM_BRAIN_API_KEY`` in the environment (or .env) before deploying.
The dev default is intentionally obvious and will fail any security scan that
checks for production-grade secrets.
"""
from __future__ import annotations

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

from app.config import settings

_api_key_header = APIKeyHeader(name="X-Syzm-Key", auto_error=False)


def require_api_key(api_key: str | None = Security(_api_key_header)) -> str:
    """FastAPI dependency — call via ``Depends(require_api_key)``."""
    if not api_key or api_key != settings.brain_api_key:
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized", "hint": "Supply a valid X-Syzm-Key header."},
        )
    return api_key
