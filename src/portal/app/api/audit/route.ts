import { NextResponse } from "next/server";
import {
  estimateRecoverable,
  mapDeclineCode,
  mixFromTotals,
  type DeclineCategory,
} from "@/lib/recovery-model";

interface CsvSummary {
  rows: number;
  failedAmountCents: number;
  byCategory: Partial<Record<DeclineCategory, number>>;
  hasCodes: boolean;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
    }

    const summary = summarizeCsv(await file.text());
    const mix = summary.hasCodes ? mixFromTotals(summary.byCategory) : undefined;
    const estimate = estimateRecoverable(summary.failedAmountCents, mix);

    // Transparent estimate: assume ~18% of involuntary churn is addressable via recovery.
    const churnReductionPercent = Math.round(estimate.blendedRate * 100 * 0.18 * 10) / 10;

    return NextResponse.json({
      rows: summary.rows,
      failedAmountCents: summary.failedAmountCents,
      recoverableMonthlyCents: estimate.recoverableCents,
      churnReductionPercent,
      blendedRate: estimate.blendedRate,
      band: estimate.band,
      segments: estimate.segments,
      usedDeclineCodes: summary.hasCodes,
      disclaimer: "Estimate based on industry-default recovery rates. Your real number comes from a Syzm audit.",
    });
  } catch {
    return NextResponse.json({ error: "Unable to process CSV" }, { status: 500 });
  }
}

const AMOUNT_HEADERS = ["original_amount_cents", "amount_cents", "amount", "failed_amount_cents"];
const CODE_HEADERS = ["decline_code", "decline_reason", "code", "reason", "decline_category", "category"];

function summarizeCsv(csv: string): CsvSummary {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return { rows: 0, failedAmountCents: 0, byCategory: {}, hasCodes: false };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const amountIndex = header.findIndex((h) => AMOUNT_HEADERS.includes(h));
  const codeIndex = header.findIndex((h) => CODE_HEADERS.includes(h));

  let failedAmountCents = 0;
  const byCategory: Partial<Record<DeclineCategory, number>> = {};

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const parsed = Number(amountIndex >= 0 ? cols[amountIndex] ?? "0" : "0");
    if (!Number.isFinite(parsed)) continue;
    const cents = Math.max(0, Math.trunc(parsed));
    failedAmountCents += cents;

    if (codeIndex >= 0) {
      const category = mapDeclineCode(cols[codeIndex] ?? "");
      byCategory[category] = (byCategory[category] ?? 0) + cents;
    }
  }

  return {
    rows: Math.max(0, lines.length - 1),
    failedAmountCents,
    byCategory,
    hasCodes: codeIndex >= 0,
  };
}
