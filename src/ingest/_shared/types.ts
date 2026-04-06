export type ProcessorName = "stripe" | "adyen" | "braintree";

export type NormalizedDecline = {
  invoice_id: string;
  decline_code: string | null;
  bank_bin: string | null;
  region: string;
  retry_count: number;
  original_amount_cents: number;
  processor_origin: ProcessorName;
  processor_history: ProcessorName[];
  soft_decline: boolean;
};

export type BrainScheduleResponse = {
  invoice_id: string;
  scheduled_at_utc: string;
  reason: string;
  strategy_version: string;
  eligible_processors: ProcessorName[];
};

