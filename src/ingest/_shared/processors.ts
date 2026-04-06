import type { ProcessorName } from "./types.ts";

export type RetryAttempt = {
  invoiceId: string;
  amountCents: number;
  paymentReference?: string;
};

export type RetryResult = {
  ok: boolean;
  processor: ProcessorName;
  processorReference?: string;
  declineCode?: string;
};

export async function retryPayment(
  processor: ProcessorName,
  attempt: RetryAttempt,
): Promise<RetryResult> {
  // Scaffold stub: replace with official processor SDK/API calls.
  const pseudoRandom = Math.abs(hash(`${processor}:${attempt.invoiceId}`)) % 100;
  const approved = pseudoRandom > 35;

  return {
    ok: approved,
    processor,
    processorReference: `${processor}_retry_${Date.now()}`,
    declineCode: approved ? undefined : "do_not_honor",
  };
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return h;
}

