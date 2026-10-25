import type { ModelId } from "@/config/features";

export interface UsageLimit {
  /** Weighted tokens used in this window. */
  used: number;
  limit: number;
  /** ISO time the window resets; null when no session is active. */
  resets_at: string | null;
}

export interface ModelUsage {
  name: string;
  input_tokens: number;
  output_tokens: number;
  weighted: number;
  /** Usage tokens charged per real token. */
  weight: number;
}

export interface UsageSummary {
  session: UsageLimit & { hours: number };
  weekly: UsageLimit;
  models: Record<ModelId, ModelUsage>;
  messages_this_week: number;
}
