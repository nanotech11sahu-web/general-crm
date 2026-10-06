import { MongoClient } from 'mongodb';
import { migrateDown, migrateUp } from './migrate';

async function main() {
  const url = process.env.MONGO_URL;
  if (!url) throw new Error('MONGO_URL is required');
  const client = await MongoClient.connect(url);
  try {
    const db = client.db();
    const dir = process.argv[2] ?? 'up';
    const res = dir === 'down' ? await migrateDown(db) : await migrateUp(db);
    console.log(dir, res);
  } finally {
    await client.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
