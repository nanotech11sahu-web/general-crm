// k6 run -e BASE=https://hooks.example.in -e PUBLIC_ID=<connection publicId> -e SECRET=<signing secret> load/webhook-burst.js
// Spec §19: webhook burst of 1k leads/min. This ramps to 1,500/min (25 rps) held for 5 minutes, then a 60-second spike to 5,000/min.
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';

export const options = {
  scenarios: {
    sustained: { executor: 'constant-arrival-rate', rate: 25, timeUnit: '1s', duration: '5m', preAllocatedVUs: 50, maxVUs: 200 },
    spike: { executor: 'constant-arrival-rate', rate: 85, timeUnit: '1s', duration: '1m', startTime: '5m', preAllocatedVUs: 100, maxVUs: 400 },
  },
  thresholds: { http_req_failed: ['rate<0.001'], 'http_req_duration{scenario:sustained}': ['p(95)<100'], http_req_duration: ['p(99)<1000'] },
};

export default function () {
  const id = `${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({ externalRef: id, name: `Load ${id}`, phone: `98${String(10000000 + ((__VU * 100000 + __ITER) % 89999999))}` });
  const res = http.post(`${__ENV.BASE}/hooks/website-webhook/${__ENV.PUBLIC_ID}`, body, {
    headers: { 'content-type': 'application/json', 'x-event-id': id, 'x-signature-256': `sha256=${crypto.hmac('sha256', __ENV.SECRET, body, 'hex')}` },
  });
  check(res, { 'acked 200': (r) => r.status === 200 });
}
