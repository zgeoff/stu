import type { Fault } from '@stu/model';
import type { AlertLabels } from './pick-sent-alerts.ts';

// labels Prometheus adds to every ALERTS series, which name no alert
const SERIES_LABELS = new Set(['__name__', 'alertstate']);

// The key is the alert's labels, sorted by name, so it is the same whatever order Prometheus gives.
export function buildAlertFault(labels: AlertLabels): Fault {
  const named = Object.entries(labels)
    .filter(([name]) => !SERIES_LABELS.has(name))
    .toSorted(([left], [right]) => (left < right ? -1 : 1));

  const others = named.filter(([name]) => name !== 'alertname' && name !== 'severity');
  const heading = `Prometheus alert ${labels['alertname'] ?? 'with no alertname'} (${labels['severity'] ?? 'no severity'}) is firing`;

  return {
    key: formatLabels(named),
    line: others.length === 0 ? heading : `${heading}: ${formatLabels(others)}`,
  };
}

function formatLabels(labels: readonly (readonly [string, string])[]): string {
  return labels.map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(',');
}
