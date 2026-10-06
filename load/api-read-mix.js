// k6 run -e BASE=https://api.example.in -e TOKEN=<agent access token> load/api-read-mix.js
// Typical agent read traffic against a tenant seeded with ~1M leads (see load/README.md). Budgets from spec §18.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: { agents: { executor: 'ramping-vus', stages: [{ duration: '2m', target: 200 }, { duration: '10m', target: 200 }, { duration: '1m', target: 0 }] } },
  thresholds: { 'http_req_duration{kind:list}': ['p(95)<300'], 'http_req_duration{kind:search}': ['p(95)<300'], 'http_req_duration{kind:queue}': ['p(95)<300'], 'http_req_duration{kind:detail}': ['p(95)<400'], http_req_failed: ['rate<0.005'] },
};
const H = { headers: { authorization: `Bearer ${__ENV.TOKEN}` } };
export default function () {
  const list = http.get(`${__ENV.BASE}/v1/leads?limit=50`, { ...H, tags: { kind: 'list' } });
  check(list, { 'list 200': (r) => r.status === 200 });
  http.get(`${__ENV.BASE}/v1/leads?q=${['9812', 'rao', 'pune'][__ITER % 3]}`, { ...H, tags: { kind: 'search' } });
  http.get(`${__ENV.BASE}/v1/do/queue`, { ...H, tags: { kind: 'queue' } });
  const id = list.json('items.0._id');
  if (id) http.get(`${__ENV.BASE}/v1/leads/${id}`, { ...H, tags: { kind: 'detail' } });
  sleep(1 + Math.random() * 2);
}
