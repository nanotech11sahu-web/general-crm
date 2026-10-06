/**
 * Verifies a restored database. Usage: node -r @swc-node/register scripts/verify-restore.ts <mongo-uri> <db-name> [--min-tenants N]
 * Exit code 0 = healthy, 1 = problems (printed as JSON).
 */
import { MongoClient } from 'mongodb';
import { verifyDatabase } from '@leaddesk/db';

async function main() {
  const [uri, name, ...rest] = process.argv.slice(2);
  if (!uri || !name) { console.error('usage: verify-restore <mongo-uri> <db-name> [--min-tenants N]'); process.exit(2); }
  const min = rest[0] === '--min-tenants' ? Number(rest[1]) : undefined;
  const c = await MongoClient.connect(uri);
  try { const r = await verifyDatabase(c.db(name), { expectMinTenants: min }); console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); }
  finally { await c.close(); }
}
main().catch((e) => { console.error(e); process.exit(2); });
