import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { APP_STORE_CATALOG } from '../constants/appStoreCatalog';
import { AdAccount } from '../models/AdAccount';
import { AiProviderConnection } from '../models/AiProviderConnection';
import { ZoomConnection } from '../models/ZoomConnection';
import { RazorpayConnection } from '../models/RazorpayConnection';
import { WabaAccount } from '../models/WabaAccount';
import { CallProviderConnection } from '../models/CallProviderConnection';
import { SmtpConnection } from '../models/SmtpConnection';
import { AppIntegration } from '../models/AppIntegration';
import { MetaAppConfig } from '../models/MetaAppConfig';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { encryptSecret, maskSecret } from '../lib/crypto';
import { buildMetaOAuthUrl, metaRedirectUri, META_LEAD_ADS_SCOPES, type MetaOAuthState } from '../services/metaOAuth.service';

export const appStoreRouter = Router();

appStoreRouter.use(authenticate);

const META_LEAD_ADS_INTENTS = ['facebook_lead_ads', 'instagram_lead_ads'] as const;

const metaAppConfigSchema = z.object({ appId: z.string().min(1), appSecret: z.string().min(1) });

appStoreRouter.get('/integrations/meta/config', requirePermission('appStore', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const config = await MetaAppConfig.findOne({ workspaceId: req.auth!.workspaceId });
    res.json({ appId: config?.appId ?? null, configured: Boolean(config), redirectUri: metaRedirectUri() });
  } catch (err) {
    next(err);
  }
});

appStoreRouter.put('/integrations/meta/config', requirePermission('appStore', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = metaAppConfigSchema.parse(req.body);
    await MetaAppConfig.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId },
      { $set: { appId: body.appId, appSecretEncrypted: encryptSecret(body.appSecret) } },
      { upsert: true },
    );
    res.json({ appId: body.appId, configured: true, redirectUri: metaRedirectUri() });
  } catch (err) {
    next(err);
  }
});

appStoreRouter.delete('/integrations/meta/config', requirePermission('appStore', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    await MetaAppConfig.deleteOne({ workspaceId: req.auth!.workspaceId });
    res.json({ configured: false });
  } catch (err) {
    next(err);
  }
});

appStoreRouter.get('/integrations/meta/oauth-url', requirePermission('appStore', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const rawIntent = req.query.intent as string;
    if (!META_LEAD_ADS_INTENTS.includes(rawIntent as (typeof META_LEAD_ADS_INTENTS)[number])) {
      throw new HttpError(400, `Unknown Meta connection intent: ${rawIntent}`);
    }
    const intent = rawIntent as (typeof META_LEAD_ADS_INTENTS)[number];
    const config = await MetaAppConfig.findOne({ workspaceId: req.auth!.workspaceId });
    if (!config) {
      throw new HttpError(400, 'Connect your Meta app first in Settings > App Store > Meta App.');
    }
    const state = jwt.sign(
      { workspaceId: req.auth!.workspaceId, nonce: crypto.randomUUID(), intent } satisfies MetaOAuthState,
      env.jwtAccessSecret,
      { expiresIn: '10m' },
    );
    res.json({ url: buildMetaOAuthUrl(config.appId, state, META_LEAD_ADS_SCOPES) });
  } catch (err) {
    next(err);
  }
});

const razorpayConnectSchema = z.object({ keyId: z.string().min(1), keySecret: z.string().min(1) });

appStoreRouter.post('/integrations/razorpay/connect', requirePermission('appStore', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = razorpayConnectSchema.parse(req.body);
    const basicAuth = Buffer.from(`${body.keyId}:${body.keySecret}`).toString('base64');
    const check = await fetch('https://api.razorpay.com/v1/payments?count=1', {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    if (!check.ok) {
      throw new HttpError(check.status === 401 ? 401 : 502, 'Razorpay rejected these API keys — double check the Key ID and Key Secret.');
    }
    const connection = await RazorpayConnection.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId },
      { $set: { connected: true, keyId: body.keyId, keySecretEncrypted: encryptSecret(body.keySecret), connectedAt: new Date() } },
      { upsert: true, new: true },
    );
    res.json({ connection: { ...connection!.toObject(), keySecretMasked: maskSecret(body.keySecret) } });
  } catch (err) {
    next(err);
  }
});

appStoreRouter.post('/integrations/razorpay/disconnect', requirePermission('appStore', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    await RazorpayConnection.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId },
      { $set: { connected: false }, $unset: { keyId: '', keySecretEncrypted: '' } },
    );
    res.json({ connected: false });
  } catch (err) {
    next(err);
  }
});

async function resolveConnectedStatus(workspaceId: string, entry: (typeof APP_STORE_CATALOG)[number]): Promise<boolean> {
  switch (entry.source) {
    case 'adAccount': {
      const doc = await AdAccount.findOne({ workspaceId, platform: entry.sourceKey });
      return doc?.status === 'connected';
    }
    case 'aiProvider': {
      const doc = await AiProviderConnection.findOne({ workspaceId, provider: entry.sourceKey });
      return doc?.connected ?? false;
    }
    case 'zoom': {
      const doc = await ZoomConnection.findOne({ workspaceId });
      return doc?.connected ?? false;
    }
    case 'razorpay': {
      const doc = await RazorpayConnection.findOne({ workspaceId });
      return doc?.connected ?? false;
    }
    case 'waba': {
      const doc = await WabaAccount.findOne({ workspaceId });
      return doc?.status === 'connected';
    }
    case 'callProvider': {
      const doc = await CallProviderConnection.findOne({ workspaceId, providerKey: entry.sourceKey });
      return doc?.connected ?? false;
    }
    case 'smtp': {
      const doc = await SmtpConnection.findOne({ workspaceId });
      return doc?.connected ?? false;
    }
    case 'generic': {
      const doc = await AppIntegration.findOne({ workspaceId, appKey: entry.key });
      return doc?.connected ?? false;
    }
    default:
      return false;
  }
}

appStoreRouter.get('/integrations', requirePermission('appStore', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workspaceId = req.auth!.workspaceId;
    const integrations = await Promise.all(
      APP_STORE_CATALOG.map(async (entry) => ({
        key: entry.key,
        name: entry.name,
        category: entry.category,
        connected: await resolveConnectedStatus(workspaceId, entry),
      })),
    );
    res.json({ integrations });
  } catch (err) {
    next(err);
  }
});

const smtpConnectSchema = z.object({ host: z.string().min(1), port: z.number(), username: z.string().min(1), password: z.string().min(1), fromEmail: z.string().email() });

appStoreRouter.post('/integrations/smtp/connect', requirePermission('appStore', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = smtpConnectSchema.parse(req.body);
    const masked = `${'*'.repeat(Math.max(body.password.length - 2, 0))}${body.password.slice(-2)}`;
    const connection = await SmtpConnection.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId },
      { $set: { connected: true, host: body.host, port: body.port, username: body.username, passwordMasked: masked, fromEmail: body.fromEmail, connectedAt: new Date() } },
      { upsert: true, new: true },
    );
    res.json({ connection });
  } catch (err) {
    next(err);
  }
});

appStoreRouter.post('/integrations/:key/connect', requirePermission('appStore', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const entry = APP_STORE_CATALOG.find((e) => e.key === req.params.key);
    if (!entry || entry.source !== 'generic') throw new HttpError(404, 'Unknown or non-generic integration');
    if (META_LEAD_ADS_INTENTS.includes(entry.key as (typeof META_LEAD_ADS_INTENTS)[number])) {
      throw new HttpError(400, 'Use GET /integrations/meta/oauth-url?intent=' + entry.key + ' to connect via Meta.');
    }
    const integration = await AppIntegration.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId, appKey: entry.key },
      { $set: { connected: true, config: req.body ?? {}, connectedAt: new Date() } },
      { upsert: true, new: true },
    );
    res.json({ integration });
  } catch (err) {
    next(err);
  }
});

appStoreRouter.post('/integrations/:key/disconnect', requirePermission('appStore', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const entry = APP_STORE_CATALOG.find((e) => e.key === req.params.key);
    if (!entry || entry.source !== 'generic') throw new HttpError(404, 'Unknown or non-generic integration');
    await AppIntegration.findOneAndUpdate({ workspaceId: req.auth!.workspaceId, appKey: entry.key }, { $set: { connected: false } });
    res.json({ connected: false });
  } catch (err) {
    next(err);
  }
});

export default appStoreRouter;
