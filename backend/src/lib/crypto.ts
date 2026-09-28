import crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  return crypto.scryptSync(env.encryptionKey, 'pmc-crm-secrets', 32);
}

/** Encrypts a secret (API key, access token, etc.) for storage at rest. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/** Decrypts a value previously produced by encryptSecret. */
export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Masks a secret for display, e.g. "sk_live_abc123" -> "**********c123". */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return '*'.repeat(plaintext.length);
  return `${'*'.repeat(plaintext.length - 4)}${plaintext.slice(-4)}`;
}
