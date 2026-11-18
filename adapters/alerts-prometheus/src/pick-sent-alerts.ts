export type AlertLabels = Readonly<Record<string, string>>;

// Alertmanager routes these two to its null receiver: Watchdog always fires, and InfoInhibitor only
// feeds the inhibit rules.
const UNSENT_ALERT_NAMES = new Set(['Watchdog', 'InfoInhibitor']);

// The firing alerts that Alertmanager sends on: every alert but the two it never sends and those
// an inhibit rule silences.
export function pickSentAlerts(firing: readonly AlertLabels[]): AlertLabels[] {
  return firing.filter(
    (alert) => !UNSENT_ALERT_NAMES.has(alert['alertname'] ?? '') && !isInhibited(alert, firing),
  );
}

interface InhibitRule {
  readonly isSource: (labels: AlertLabels) => boolean;
  readonly targetSeverities: ReadonlySet<string>;
  readonly equal: readonly string[];
}

// The kube-prometheus-stack chart's default inhibit rules, which the stack's Alertmanager keeps.
const INHIBIT_RULES: readonly InhibitRule[] = [
  {
    isSource: (labels) => labels['severity'] === 'critical',
    targetSeverities: new Set(['warning', 'info']),
    equal: ['namespace', 'alertname'],
  },
  {
    isSource: (labels) => labels['severity'] === 'warning',
    targetSeverities: new Set(['info']),
    equal: ['namespace', 'alertname'],
  },
  {
    isSource: (labels) => labels['alertname'] === 'InfoInhibitor',
    targetSeverities: new Set(['info']),
    equal: ['namespace'],
  },
];

function isInhibited(target: AlertLabels, firing: readonly AlertLabels[]): boolean {
  return INHIBIT_RULES.some(
    (rule) =>
      rule.targetSeverities.has(target['severity'] ?? '') &&
      firing.some(
        (source) =>
          source !== target && rule.isSource(source) && hasEqualLabels(source, target, rule.equal),
      ),
  );
}

// Alertmanager reads a missing label as empty, so two missing labels are equal.
function hasEqualLabels(
  source: AlertLabels,
  target: AlertLabels,
  names: readonly string[],
): boolean {
  return names.every((name) => (source[name] ?? '') === (target[name] ?? ''));
}
