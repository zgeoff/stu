import type { FetchHTTP, Kind } from '@stu/model';
import { z } from 'zod';
import { buildAlertFault } from './build-alert-fault.ts';
import { pickSentAlerts } from './pick-sent-alerts.ts';
import type { AlertLabels } from './pick-sent-alerts.ts';

const PROMETHEUS_PARAMS = z.strictObject({
  grafanaURL: z.url(),

  // the uid of Grafana's Prometheus datasource
  datasourceUID: z.string().min(1),

  // a Grafana token that can query the datasource, such as a Viewer's
  token: z.string().min(1),
});

export interface PrometheusAlertsPorts {
  readonly fetch: FetchHTTP;
}

export function makePrometheusAlertsKind(ports: PrometheusAlertsPorts): Kind {
  return async (params) => {
    const grafana = PROMETHEUS_PARAMS.parse(params);

    const firing = await readFiringAlerts(ports, grafana);

    return pickSentAlerts(firing).map((labels) => buildAlertFault(labels));
  };
}

const FIRING_QUERY = 'ALERTS{alertstate="firing"}';
const SERIES = z.object({ metric: z.record(z.string(), z.string()) });

const VECTOR_ANSWER = z.object({
  status: z.literal('success'),
  data: z.object({ resultType: z.literal('vector'), result: z.array(SERIES) }),
});

type GrafanaTarget = z.output<typeof PROMETHEUS_PARAMS>;

// No thrown message quotes the URL, the token or the body: the engine sends it to stu.
async function readFiringAlerts(
  ports: PrometheusAlertsPorts,
  grafana: GrafanaTarget,
): Promise<AlertLabels[]> {
  const base = grafana.grafanaURL.replace(/\/$/u, '');
  const datasource = encodeURIComponent(grafana.datasourceUID);

  const url = new URL(`${base}/api/datasources/proxy/uid/${datasource}/api/v1/query`);

  url.searchParams.set('query', FIRING_QUERY);

  const response = await ports
    .fetch(url, {
      headers: { authorization: `Bearer ${grafana.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    .catch((error: unknown) => {
      throw new Error(`grafana gave no answer (${toErrorName(error)})`);
    });

  if (!response.ok) {
    await response.body?.cancel();

    throw new Error(`grafana answered ${response.status}`);
  }

  const body: unknown = await response.json().catch(() => null);

  const answer = VECTOR_ANSWER.safeParse(body);

  if (!answer.success) {
    throw new Error('grafana gave no Prometheus vector');
  }

  return answer.data.data.result.map((series) => series.metric);
}

function toErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
