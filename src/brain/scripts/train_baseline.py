"""Train a synthetic-baseline XGBoost retry-delay model.

PURPOSE
-------
This script generates SYNTHETIC, PLAUSIBLE payment-decline data and trains a
small XGBoost gradient-boosted regressor to predict optimal retry delay
(in minutes).  The resulting model is written to ``src/brain/models/latest.json``
and committed to the repo so the service loads it out-of-the-box.

IMPORTANT — SYNTHETIC DATA DISCLAIMER
--------------------------------------
ALL training data produced by this script is artificially generated using
deterministic rules that encode payment-industry intuition.  No real merchant
transaction data is used.  The model is a BASELINE for development and
demonstration only.  Replace it with a model trained on real labeled dunning
data before making any production claims about accuracy or recovery rates.

Features
--------
  0: retry_count           (0–3)
  1: original_amount_usd   (failed amount in USD, i.e. cents / 100)
  2: processor_history_len (0–2)
  3: is_us                 (1 for US, 0 otherwise)
  4: decline_category_enc  (ordinal: see CATEGORY_ENC below)

Target
------
  delay_minutes: optimal minutes to wait before retry
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import xgboost as xgb

# ---------------------------------------------------------------------------
# Ordinal encoding for decline categories
# (must stay in sync with recovery_model.SEGMENT_CONFIG key order)
# ---------------------------------------------------------------------------
CATEGORY_ENC: dict[str, int] = {
    "insufficient_funds": 0,
    "do_not_honor":       1,
    "transient":          2,
    "velocity":           3,
    "expired_card":       4,
    "invalid_data":       5,
    "fraud":              6,
    "authentication":     7,
    "unknown":            8,
}

# Heuristic delay targets per category (minutes) — these encode industry
# best-practice guidance and are the "labels" for this synthetic dataset.
CATEGORY_BASE_DELAY: dict[str, int] = {
    "insufficient_funds": 1440,   # retry next day
    "do_not_honor":       2880,   # 2 days — issuer may need time
    "transient":          30,     # issuer back up quickly
    "velocity":           720,    # wait for limit reset (half-day)
    "expired_card":       43200,  # customer must update card — big wait
    "invalid_data":       43200,  # same — customer action required
    "fraud":              99999,  # essentially "don't retry" (clamp later)
    "authentication":     60,     # try step-up auth quickly
    "unknown":            90,     # conservative default
}

RNG = np.random.default_rng(2026)
N_SAMPLES = 4_000  # small, fast, reproducible


def generate_dataset() -> tuple[np.ndarray, np.ndarray]:
    categories = list(CATEGORY_ENC.keys())
    cat_weights = [0.35, 0.20, 0.15, 0.08, 0.07, 0.06, 0.05, 0.04, 0.00]  # mirrors default mix
    # normalize (unknown gets remainder)
    cat_weights[-1] = 1.0 - sum(cat_weights[:-1])

    rows = []
    targets = []

    for _ in range(N_SAMPLES):
        retry_count = int(RNG.integers(0, 4))
        amount_usd = float(RNG.uniform(5, 2000))
        hist_len = int(RNG.integers(0, 3))
        is_us = int(RNG.integers(0, 2))
        cat = RNG.choice(categories, p=cat_weights)
        cat_enc = CATEGORY_ENC[cat]

        base_delay = CATEGORY_BASE_DELAY[cat]
        # Add realistic noise + retry-count penalty
        noise = RNG.normal(0, base_delay * 0.10)
        retry_penalty = retry_count * 15 * (1 + 0.1 * RNG.standard_normal())
        us_bonus = -20 if is_us else 0  # US issuers respond faster
        delay = max(5, base_delay + noise + retry_penalty + us_bonus)
        # Cap fraud at something sensible (model won't schedule fraud anyway)
        delay = min(delay, 99999)

        rows.append([retry_count, amount_usd, hist_len, is_us, cat_enc])
        targets.append(delay)

    return np.array(rows, dtype=float), np.array(targets, dtype=float)


def train(output_path: str) -> None:
    print("[train_baseline] Generating synthetic dataset …")
    X, y = generate_dataset()

    dtrain = xgb.DMatrix(X, label=y)
    params = {
        "objective": "reg:squarederror",
        "max_depth": 4,
        "eta": 0.1,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "seed": 42,
    }
    print("[train_baseline] Training XGBoost (100 rounds) …")
    booster = xgb.train(params, dtrain, num_boost_round=100, verbose_eval=False)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    booster.save_model(output_path)

    # Sanity-check: run a quick predict on 3 examples
    sample = xgb.DMatrix(
        np.array([[0, 100.0, 0, 1, 0],   # fresh US insufficient_funds
                  [2, 500.0, 1, 0, 2],   # 2nd retry non-US transient
                  [1, 250.0, 0, 1, 6]],  # fraud (should be large)
                 dtype=float)
    )
    preds = booster.predict(sample)
    print(f"[train_baseline] Sample predictions (minutes): {preds.tolist()}")
    print(f"[train_baseline] Model saved -> {output_path}")
    print("[train_baseline] REMINDER: this is a synthetic baseline. "
          "Replace with real labeled data before production use.")


if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(script_dir, "..", "models", "latest.json")
    output = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(default_out)
    train(output)
