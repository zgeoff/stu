export interface MonitorTraits {
  readonly type: 'Threshold' | 'MatchEvent' | 'AnomalyDetection';
  readonly disabled?: boolean | undefined;
  readonly skipResolved?: boolean | undefined;
}

// A monitor whose newest notification stays open after its condition ends would hold a fault
// until it left the history window: a disabled monitor stops running, one that skips resolved
// notices sends none, and a MatchEvent monitor fires once per match and never resolves.
export function canMonitorResolve(monitor: MonitorTraits): boolean {
  return (
    monitor.disabled !== true &&
    monitor.skipResolved !== true &&
    (monitor.type === 'Threshold' || monitor.type === 'AnomalyDetection')
  );
}
