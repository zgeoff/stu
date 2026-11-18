export interface WindowUsage {
  // a fraction of 1, such as 0.92
  readonly fraction: number;

  // ISO time the window resets, or null when the answer gives none
  readonly resetsAt: string | null;
}

export interface SlotUsage {
  readonly fiveHour: WindowUsage;
  readonly sevenDay: WindowUsage;
}

// The account's unified rate-limit headers, or null when either window's use is missing. The use
// headers are fractions of 1, and the reset headers are epoch seconds.
export function parseUsageHeaders(headers: Headers): SlotUsage | null {
  const fiveHour = parseWindow(headers, '5h');
  const sevenDay = parseWindow(headers, '7d');

  return fiveHour === null || sevenDay === null ? null : { fiveHour, sevenDay };
}

function parseWindow(headers: Headers, window: '5h' | '7d'): WindowUsage | null {
  const fraction = parseNonNegative(
    headers.get(`anthropic-ratelimit-unified-${window}-utilization`),
  );

  if (fraction === null) {
    return null;
  }

  const resetS = parseNonNegative(headers.get(`anthropic-ratelimit-unified-${window}-reset`));

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
