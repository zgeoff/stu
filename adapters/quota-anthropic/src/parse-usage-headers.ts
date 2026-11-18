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

// The account's unified rate-limit headers, or null when the 7-day use is missing or a use header
// is malformed. The use headers are fractions of 1, and the reset headers are epoch seconds.
export function parseUsageHeaders(headers: Headers): SlotUsage | null {
  const sevenDay = parseWindow(headers, '7d');

  if (sevenDay === null) {
    return null;
  }

  // Anthropic leaves out the 5h headers while the account has no open 5-hour window
  const fiveHour = headers.has('anthropic-ratelimit-unified-5h-utilization')
    ? parseWindow(headers, '5h')
    : { fraction: 0, resetsAt: null };

  return fiveHour === null ? null : { fiveHour, sevenDay };
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
