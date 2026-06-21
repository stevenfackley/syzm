"""Decline-code-segmented recoverable-revenue estimator.

IMPORTANT — ALL RATES ARE INDUSTRY-INFORMED ESTIMATES, NOT GUARANTEES.
Sources: card-network published soft-decline guidance, publicly available
dunning-benchmark studies (Chargebee, Recurly, Paddle 2022-2024).  Actual
recovery depends on merchant category, issuer, retry timing, and card mix.
Do NOT present these numbers to customers as contractual commitments.

Decline category vocabulary (shared contract with portal and other agents):
  insufficient_funds   ISO 51
  do_not_honor         ISO 05 / generic
  transient            ISO 91, 96, processing_error — issuer temporarily unavailable
  velocity             ISO 65, 75 — card-limit / frequency exceeded
  expired_card         ISO 54
  invalid_data         ISO 14 — wrong card number / CVV / zip
  fraud                ISO 41, 43, 07 — lost/stolen/pickup  → DO NOT RETRY
  authentication       3DS / authentication_required
  unknown              anything not mapped above
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TypedDict


# ---------------------------------------------------------------------------
# Recovery rates by segment
# ---------------------------------------------------------------------------

class _SegmentConfig(TypedDict):
    rate: float
    do_not_retry: bool
    description: str


# Keys are the canonical category names used throughout the system.
SEGMENT_CONFIG: dict[str, _SegmentConfig] = {
    "insufficient_funds": {
        "rate": 0.35,
        "do_not_retry": False,
        "description": "ISO 51 — insufficient funds; retry after a few days (~35% est.)",
    },
    "do_not_honor": {
        "rate": 0.22,
        "do_not_retry": False,
        "description": "ISO 05 / generic decline (~22% est.)",
    },
    "transient": {
        "rate": 0.45,
        "do_not_retry": False,
        "description": "ISO 91/96/processing_error — issuer temporarily unavailable (~45% est.)",
    },
    "velocity": {
        "rate": 0.30,
        "do_not_retry": False,
        "description": "ISO 65/75 — frequency or limit exceeded; retry later (~30% est.)",
    },
    "expired_card": {
        "rate": 0.15,
        "do_not_retry": False,
        "description": "ISO 54 — card expired; requires customer card update (~15% est.)",
    },
    "invalid_data": {
        "rate": 0.08,
        "do_not_retry": False,
        "description": "ISO 14 — bad card number/CVV/zip; requires customer correction (~8% est.)",
    },
    "fraud": {
        "rate": 0.00,
        "do_not_retry": True,
        "description": "ISO 41/43/07 — lost/stolen/pickup/fraud; DO NOT RETRY (0%)",
    },
    "authentication": {
        "rate": 0.10,
        "do_not_retry": False,
        "description": "3DS / authentication_required; retry with step-up auth (~10% est.)",
    },
    "unknown": {
        "rate": 0.15,
        "do_not_retry": False,
        "description": "Unclassified decline — conservative fallback estimate (~15% est.)",
    },
}

# ---------------------------------------------------------------------------
# Default decline mix — used when the caller supplies only a total amount.
# Based on published industry benchmarks (2022-2024 SaaS dunning studies).
# These proportions are approximate; replace with merchant-specific data
# when available.
# ---------------------------------------------------------------------------
DEFAULT_DECLINE_MIX: dict[str, float] = {
    "insufficient_funds": 0.35,
    "do_not_honor":       0.20,
    "transient":          0.15,
    "velocity":           0.08,
    "expired_card":       0.07,
    "invalid_data":       0.06,
    "fraud":              0.05,
    "authentication":     0.04,
}
# Sanity-check: must sum to 1.0 (within float tolerance).
assert abs(sum(DEFAULT_DECLINE_MIX.values()) - 1.0) < 1e-9, "DEFAULT_DECLINE_MIX must sum to 1.0"


# ---------------------------------------------------------------------------
# Public data types
# ---------------------------------------------------------------------------

@dataclass
class SegmentEstimate:
    category: str
    amount_cents: int
    recovery_rate: float
    recoverable_cents: int
    do_not_retry: bool
    description: str


@dataclass
class RecoveryEstimate:
    recoverable_amount_cents: int
    blended_recovery_rate: float
    """Weighted average rate across all segments (0–1)."""
    confidence_low_cents: int
    """Lower bound of ±20% confidence band."""
    confidence_high_cents: int
    """Upper bound of ±20% confidence band."""
    segments: list[SegmentEstimate] = field(default_factory=list)
    used_default_mix: bool = False
    """True when the caller supplied only a total and we applied DEFAULT_DECLINE_MIX."""
    disclaimer: str = (
        "Recovery rates are industry-informed estimates, NOT guarantees. "
        "Actual recovery depends on merchant category, issuer, retry timing, and card mix."
    )


# ---------------------------------------------------------------------------
# Core estimator
# ---------------------------------------------------------------------------

def estimate_recovery(
    breakdown: dict[str, int] | None,
    total_amount_cents: int,
) -> RecoveryEstimate:
    """Compute the segmented recovery estimate.

    Parameters
    ----------
    breakdown:
        Optional mapping of {category: amount_cents}.  Categories must be
        keys from ``SEGMENT_CONFIG``.  Unknown categories are treated as
        ``"unknown"``.
    total_amount_cents:
        The aggregate failed amount.  Used as a fallback when ``breakdown``
        is None or empty, and also to catch callers who supply a breakdown
        that doesn't sum to total (we don't error — we trust the breakdown).
    """
    if not breakdown:
        # Caller didn't segment — apply the documented default mix.
        breakdown = {
            cat: int(total_amount_cents * share)
            for cat, share in DEFAULT_DECLINE_MIX.items()
        }
        used_default_mix = True
    else:
        used_default_mix = False

    segments: list[SegmentEstimate] = []
    total_recoverable = 0

    for cat, amount in breakdown.items():
        canonical = cat if cat in SEGMENT_CONFIG else "unknown"
        cfg = SEGMENT_CONFIG[canonical]
        recoverable = int(amount * cfg["rate"])
        total_recoverable += recoverable
        segments.append(
            SegmentEstimate(
                category=canonical,
                amount_cents=amount,
                recovery_rate=cfg["rate"],
                recoverable_cents=recoverable,
                do_not_retry=cfg["do_not_retry"],
                description=cfg["description"],
            )
        )

    total_input = sum(s.amount_cents for s in segments) or 1  # guard div-by-zero
    blended_rate = total_recoverable / total_input

    # ±20% confidence band (rough heuristic; tighten with real labeled data).
    low = int(total_recoverable * 0.80)
    high = int(total_recoverable * 1.20)

    return RecoveryEstimate(
        recoverable_amount_cents=total_recoverable,
        blended_recovery_rate=round(blended_rate, 4),
        confidence_low_cents=low,
        confidence_high_cents=high,
        segments=segments,
        used_default_mix=used_default_mix,
    )
