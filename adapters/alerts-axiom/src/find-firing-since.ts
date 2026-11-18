export interface MonitorNotification {
  // RFC 3339, with an offset
  readonly timestamp: string;
  readonly state: 'open' | 'closed';
}

// The timestamp of the newest notification when it is an open one, or null. Axiom's history gives
// no order and holds one item per notifier, so an open and a closed item can share the newest
// time; the open one wins, so a fault never clears on a tie.
export function findFiringSince(notifications: readonly MonitorNotification[]): string | null {
  const newestMs = Math.max(...notifications.map((notification) => toEpochMs(notification)));

  const newestOpen = notifications.find(
    (notification) => notification.state === 'open' && toEpochMs(notification) === newestMs,
  );

  return newestOpen?.timestamp ?? null;
}

function toEpochMs(notification: MonitorNotification): number {
  return Temporal.Instant.from(notification.timestamp).epochMilliseconds;
}
