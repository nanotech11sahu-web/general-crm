import { ConnectorRegistry, websiteWebhook, type FetchLike } from '@leaddesk/connectors-core';
import { createMetaLeadAds } from '@leaddesk/connector-meta-leadads';
import { createGoogleSheets } from '@leaddesk/connector-google-sheets';
import { createWhatsAppCloud } from '@leaddesk/connector-whatsapp-cloud';
import { createMsg91Sms } from '@leaddesk/connector-sms-msg91';
import { createGroqAi } from '@leaddesk/connector-ai-groq';
import { createExotel } from '@leaddesk/connector-telephony-exotel';

export { metaChallenge, leadgenChanges } from '@leaddesk/connector-meta-leadads';
export { googleAuthUrl, SHEETS_SCOPE } from '@leaddesk/connector-google-sheets';
export { splitWhatsAppWebhook, whatsappChallenge, exchangeEmbeddedSignupCode } from '@leaddesk/connector-whatsapp-cloud';

/**
 * Providers are enabled by platform-level app credentials in env (spec rule 2: client
 * credentials never live in env; the OAuth *app* credentials of the platform do).
 * Adding a provider = one folder + one line here; no migration, no UI change.
 */
export function createRegistry(env: NodeJS.ProcessEnv = process.env, fetch?: FetchLike): ConnectorRegistry {
  const r = new ConnectorRegistry().register(websiteWebhook);
  if (env.META_APP_ID && env.META_APP_SECRET) r.register(createMetaLeadAds({ appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, verifyToken: env.META_WEBHOOK_VERIFY_TOKEN ?? '', graphVersion: env.META_GRAPH_VERSION, fetch }));
  if (env.META_APP_ID && env.META_APP_SECRET) r.register(createWhatsAppCloud({ appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, verifyToken: env.META_WEBHOOK_VERIFY_TOKEN ?? '', graphVersion: env.META_GRAPH_VERSION, fetch }));
  r.register(createMsg91Sms({ fetch }));
  r.register(createExotel({ fetch }));
  r.register(createGroqAi({ fetch, baseUrl: env.GROQ_API_BASE_URL }));
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) r.register(createGoogleSheets({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, fetch }));
  return r;
}
