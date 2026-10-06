import { LocalKeyService, AwsKmsKeyService, KeyService } from './key-service';
export * from './key-service';
export * from './envelope';

export function keyServiceFromEnv(env: NodeJS.ProcessEnv = process.env): KeyService {
  if (env.KMS_KEY_ID) return new AwsKmsKeyService(env.KMS_KEY_ID, env.AWS_REGION);
  if (env.LOCAL_KEK_BASE64) return LocalKeyService.fromBase64(env.LOCAL_KEK_BASE64);
  throw new Error('Configure KMS_KEY_ID (prod) or LOCAL_KEK_BASE64 (dev)');
}
