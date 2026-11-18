export interface SlotUsage {
  // a fraction of 1, such as 0.92
  readonly fraction: number;

  // ISO time the window resets, or null when the answer gives none
  readonly resetsAt: string | null;
}

// The account's unified 7-day rate-limit headers, or null when the use header is missing or
// malformed. The use header is a fraction of 1, and the reset header is epoch seconds.
export function parseUsageHeaders(headers: Headers): SlotUsage | null {
  const fraction = parseNonNegative(headers.get('anthropic-ratelimit-unified-7d-utilization'));

  if (fraction === null) {
    return null;
  }

  const resetS = parseNonNegative(headers.get('anthropic-ratelimit-unified-7d-reset'));

  return {
    fraction,
    resetsAt:
      resetS === null ? null : Temporal.Instant.fromEpochMilliseconds(resetS * 1000).toString(),
  };
}

function parseNonNegative(text: string | null): number | null {
  // Number('') is 0, so an empty header must not read as no use
  if (text === null || text.trim() === '') {
    return null;
  }

  const value = Number(text);

  return Number.isFinite(value) && value >= 0 ? value : null;
}
