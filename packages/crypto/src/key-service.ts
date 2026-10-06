import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Wraps/unwraps data keys. Prod = AWS KMS, dev = local key. */
export interface KeyService {
  readonly keyRef: string;
  wrap(dek: Buffer, context: Record<string, string>): Promise<Buffer>;
  unwrap(wrapped: Buffer, context: Record<string, string>): Promise<Buffer>;
}

function aadOf(context: Record<string, string>): Buffer {
  const keys = Object.keys(context).sort();
  return Buffer.from(JSON.stringify(keys.map((k) => [k, context[k]])));
}

/** Dev/test only. AES-256-GCM wrap with a 32-byte KEK; context is bound as AAD. */
export class LocalKeyService implements KeyService {
  readonly keyRef: string;
  constructor(private readonly kek: Buffer, keyRef = 'local:v1') {
    if (kek.length !== 32) throw new Error('LocalKeyService KEK must be 32 bytes');
    this.keyRef = keyRef;
  }
  static fromBase64(b64: string, keyRef?: string) {
    return new LocalKeyService(Buffer.from(b64, 'base64'), keyRef);
  }
  async wrap(dek: Buffer, context: Record<string, string>): Promise<Buffer> {
    const nonce = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.kek, nonce);
    c.setAAD(aadOf(context));
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Buffer.concat([nonce, c.getAuthTag(), ct]);
  }
  async unwrap(wrapped: Buffer, context: Record<string, string>): Promise<Buffer> {
    const nonce = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const ct = wrapped.subarray(28);
    const d = createDecipheriv('aes-256-gcm', this.kek, nonce);
    d.setAAD(aadOf(context));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }
}

/** Prod: AWS KMS with the encryption context bound to tenant/connection. */
export class AwsKmsKeyService implements KeyService {
  readonly keyRef: string;
  private client: any;
  constructor(private readonly keyId: string, region?: string) {
    this.keyRef = `kms:${keyId}`;
    // lazy require keeps dev/test free of AWS at import time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { KMSClient } = require('@aws-sdk/client-kms');
    this.client = new KMSClient({ region });
  }
  async wrap(dek: Buffer, context: Record<string, string>): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EncryptCommand } = require('@aws-sdk/client-kms');
    const r = await this.client.send(new EncryptCommand({ KeyId: this.keyId, Plaintext: dek, EncryptionContext: context }));
    return Buffer.from(r.CiphertextBlob);
  }
  async unwrap(wrapped: Buffer, context: Record<string, string>): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DecryptCommand } = require('@aws-sdk/client-kms');
    const r = await this.client.send(new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: wrapped, EncryptionContext: context }));
    return Buffer.from(r.Plaintext);
  }
}
