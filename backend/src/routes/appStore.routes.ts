import { Router } from 'express';
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
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const appStoreRouter = Router();

appStoreRouter.use(authenticate);

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
