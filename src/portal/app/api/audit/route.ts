import { NextResponse } from "next/server";

type CsvSummary = {
  rows: number;
  failedAmountCents: number;
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
    }

    const csv = await file.text();
    const summary = summarizeCsv(csv);
    const recoverableMonthlyCents = Math.floor(summary.failedAmountCents * 0.005);

    return NextResponse.json({
      rows: summary.rows,
      failedAmountCents: summary.failedAmountCents,
      recoverableMonthlyCents,
      churnReductionPercent: 1.7,
    });
  } catch {
    return NextResponse.json({ error: "Unable to process CSV" }, { status: 500 });
  }
}

function summarizeCsv(csv: string): CsvSummary {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { rows: 0, failedAmountCents: 0 };
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const amountIndex = header.findIndex((h) => ["original_amount_cents", "amount_cents", "amount"].includes(h));
  let failedAmountCents = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const raw = amountIndex >= 0 ? cols[amountIndex] ?? "0" : "0";
    const parsed = Number(raw);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      failedAmountCents += Math.max(0, Math.trunc(parsed));
    }
  }

  return {
    rows: Math.max(0, lines.length - 1),
    failedAmountCents,
  };
}

