import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** A software WebAuthn authenticator (ES256, "none" attestation) so the real verification code is exercised without a browser. */
const head = (major: number, n: number) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
export function cbor(v: unknown): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('unsupported cbor value');
}
const b64u = (b: Buffer) => b.toString('base64url');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();

export class SoftKey {
  private readonly priv: KeyObject; private readonly x: Buffer; private readonly y: Buffer;
  readonly id = randomBytes(32); counter = 0;
  constructor() {
    const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); this.priv = kp.privateKey;
    const jwk: any = kp.publicKey.export({ format: 'jwk' }); this.x = Buffer.from(jwk.x, 'base64url'); this.y = Buffer.from(jwk.y, 'base64url');
  }
  private counterBytes() { const c = Buffer.alloc(4); c.writeUInt32BE(this.counter); return c; }
  register(rpId: string, origin: string, challenge: string) {
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, this.x], [-3, this.y]]));
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(this.id.length);
    const authData = Buffer.concat([sha(rpId), Buffer.from([0x45]), this.counterBytes(), Buffer.alloc(16), idLen, this.id, cose]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
    const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return { id: b64u(this.id), rawId: b64u(this.id), type: 'public-key', response: { attestationObject: b64u(attestationObject), clientDataJSON: b64u(clientDataJSON), transports: ['internal'] }, clientExtensionResults: {}, authenticatorAttachment: 'platform' };
  }
  assert(rpId: string, origin: string, challenge: string, o: { counter?: number } = {}) {
    this.counter = o.counter ?? this.counter + 1;
    const authData = Buffer.concat([sha(rpId), Buffer.from([0x05]), this.counterBytes()]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
    const signature = sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), this.priv);
    return { id: b64u(this.id), rawId: b64u(this.id), type: 'public-key', response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientDataJSON), signature: b64u(signature) }, clientExtensionResults: {}, authenticatorAttachment: 'platform' };
  }
}
