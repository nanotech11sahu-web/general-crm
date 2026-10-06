import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';

/** Object storage for recordings (and, later, imports/exports). Access is always through short-lived signed URLs. */
export interface ObjectStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Short-lived URL a browser can open without credentials. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');

/**
 * Local-disk store for development/tests and single-node installs. URLs point at the API's own
 * `/v1/recordings/:token` route; the token is an HMAC over {key, expiry}, so nothing else is needed to serve it.
 */
export class FsObjectStore implements ObjectStore {
  constructor(private readonly dir: string, private readonly secret: string, private readonly baseUrl = '', private readonly now: () => number = Date.now) {
    if (secret.length < 16) throw new Error('FsObjectStore needs a signing secret of at least 16 characters');
  }
  private path(key: string) {
    const p = normalize(join(this.dir, key));
    if (!p.startsWith(normalize(this.dir) + sep)) throw new Error('Invalid object key'); // no path traversal
    return p;
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    await writeFile(`${p}.type`, contentType);
  }
  private sign(payload: string) { return createHmac('sha256', this.secret).update(payload).digest('base64url'); }
  async signedUrl(key: string, ttlSeconds: number) {
    const payload = b64(JSON.stringify({ k: key, e: Math.floor(this.now() / 1000) + ttlSeconds }));
    return `${this.baseUrl}/v1/recordings/${payload}.${this.sign(payload)}`;
  }
  /** Returns the object only for an untampered, unexpired token. */
  async open(token: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const want = Buffer.from(this.sign(payload)), got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    let p: { k: string; e: number };
    try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
    if (typeof p.k !== 'string' || p.e * 1000 < this.now()) return null;
    try {
      return { bytes: await readFile(this.path(p.k)), contentType: (await readFile(`${this.path(p.k)}.type`, 'utf8').catch(() => 'audio/mpeg')) };
    } catch { return null; }
  }
}

/**
 * S3-compatible store (AWS S3 / MinIO). Loaded lazily so installs without it work.
 * NOTE: not exercised against a real bucket in this repository's tests.
 */
export class S3ObjectStore implements ObjectStore {
  private client: any; private presign: any; private cmds: any;
  constructor(private readonly o: { bucket: string; endpoint?: string; region?: string; accessKeyId: string; secretAccessKey: string }) {}
  private async init() {
    if (this.client) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const s3 = require('@aws-sdk/client-s3'); const pre = require('@aws-sdk/s3-request-presigner'); // eslint-disable-line @typescript-eslint/no-require-imports
    this.client = new s3.S3Client({ region: this.o.region ?? 'us-east-1', endpoint: this.o.endpoint, forcePathStyle: !!this.o.endpoint, credentials: { accessKeyId: this.o.accessKeyId, secretAccessKey: this.o.secretAccessKey } });
    this.presign = pre.getSignedUrl; this.cmds = s3;
  }
  async put(key: string, bytes: Buffer, contentType: string) { await this.init(); await this.client.send(new this.cmds.PutObjectCommand({ Bucket: this.o.bucket, Key: key, Body: bytes, ContentType: contentType, ServerSideEncryption: this.o.endpoint ? undefined : 'AES256' })); }
  async signedUrl(key: string, ttl: number) { await this.init(); return this.presign(this.client, new this.cmds.GetObjectCommand({ Bucket: this.o.bucket, Key: key }), { expiresIn: ttl }); }
}

export function objectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  if (env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY) return new S3ObjectStore({ bucket: env.S3_BUCKET, endpoint: env.S3_ENDPOINT, region: env.S3_REGION, accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY });
  return new FsObjectStore(env.RECORDINGS_DIR ?? './data/objects', env.OBJECT_SIGNING_SECRET ?? env.JWT_ACCESS_SECRET ?? 'dev-only-signing-secret', (env.PUBLIC_API_URL ?? '').replace(/\/$/, ''));
}
