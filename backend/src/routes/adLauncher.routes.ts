import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { AdAccount, AD_PLATFORMS } from '../models/AdAccount';
import { AppIntegration } from '../models/AppIntegration';
import { MetaAppConfig } from '../models/MetaAppConfig';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { getAdOverview } from '../services/adLauncher.service';
import { env } from '../config/env';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import {
  buildMetaOAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listMetaAdAccounts,
  listMetaPages,
  revokeMetaToken,
  META_ADS_SCOPES,
  type MetaOAuthState,
} from '../services/metaOAuth.service';

export const adLauncherRouter = Router();

adLauncherRouter.get('/accounts/meta/oauth-callback', async (req, res) => {
  const { code, state, error: metaError } = req.query as Record<string, string | undefined>;

  let decoded: MetaOAuthState | undefined;
  if (state) {
    try {
      decoded = jwt.verify(state, env.jwtAccessSecret) as unknown as MetaOAuthState;
    } catch {
      decoded = undefined;
    }
  }
  const intent = decoded?.intent ?? 'ads';
  const redirectBase =
    intent === 'ads' ? `${env.clientOrigin}/lead-generation/ad-launcher` : `${env.clientOrigin}/settings/app-store`;
  const appParam = intent === 'ads' ? '' : `&app=${intent}`;

  if (metaError) {
    return res.redirect(`${redirectBase}?meta=error&reason=${encodeURIComponent(metaError)}${appParam}`);
  }
  if (!code || !decoded) {
    return res.redirect(`${redirectBase}?meta=error&reason=${!code ? 'missing_code' : 'invalid_state'}${appParam}`);
  }

  try {
    const appConfig = await MetaAppConfig.findOne({ workspaceId: decoded.workspaceId }).select('+appSecretEncrypted');
    if (!appConfig) {
      return res.redirect(`${redirectBase}?meta=error&reason=meta_app_not_configured${appParam}`);
    }
    const appSecret = decryptSecret(appConfig.appSecretEncrypted);
    const shortLived = await exchangeCodeForToken(appConfig.appId, appSecret, code);
    const longLived = await exchangeForLongLivedToken(appConfig.appId, appSecret, shortLived.access_token);
    const tokenExpiresAt = longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : undefined;

    if (intent === 'ads') {
      const adAccounts = await listMetaAdAccounts(longLived.access_token);
      if (adAccounts.length === 0) {
        return res.redirect(`${redirectBase}?meta=error&reason=no_ad_accounts`);
      }
      const primary = adAccounts[0];
      await AdAccount.findOneAndUpdate(
        { workspaceId: decoded.workspaceId, platform: 'meta' },
        {
          $set: {
            status: 'connected',
            externalAccountId: primary.id,
            accountName: primary.name,
            accessTokenEncrypted: encryptSecret(longLived.access_token),
            tokenExpiresAt,
            connectedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } else {
      const pages = await listMetaPages(longLived.access_token);
      if (pages.length === 0) {
        return res.redirect(`${redirectBase}?meta=error&reason=no_pages${appParam}`);
      }
      const primaryPage = pages[0];
      await AppIntegration.findOneAndUpdate(
        { workspaceId: decoded.workspaceId, appKey: intent },
        {
          $set: {
            connected: true,
            config: {
              accessTokenEncrypted: encryptSecret(longLived.access_token),
              tokenExpiresAt,
              pageId: primaryPage.id,
              pageName: primaryPage.name,
            },
            connectedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }

    return res.redirect(`${redirectBase}?meta=connected${appParam}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return res.redirect(`${redirectBase}?meta=error&reason=${encodeURIComponent(message)}${appParam}`);
  }
});

adLauncherRouter.use(authenticate);

adLauncherRouter.get('/accounts', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const accounts = await AdAccount.find({ workspaceId: req.auth!.workspaceId }).lean();
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

adLauncherRouter.get('/accounts/meta/oauth-url', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const config = await MetaAppConfig.findOne({ workspaceId: req.auth!.workspaceId });
    if (!config) {
      throw new HttpError(400, 'Connect your Meta app first in Settings > App Store > Meta App.');
    }
    const state = jwt.sign(
      { workspaceId: req.auth!.workspaceId, nonce: crypto.randomUUID(), intent: 'ads' } satisfies MetaOAuthState,
      env.jwtAccessSecret,
      { expiresIn: '10m' },
    );
    res.json({ url: buildMetaOAuthUrl(config.appId, state, META_ADS_SCOPES) });
  } catch (err) {
    next(err);
  }
});

const connectSchema = z.object({ platform: z.enum(AD_PLATFORMS) });

adLauncherRouter.post('/accounts/connect', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = connectSchema.parse(req.body);
    if (body.platform !== 'meta') {
      throw new HttpError(
        501,
        `${body.platform} ads is not implemented yet — it needs a real ${body.platform} developer app and OAuth flow, which hasn't been built.`,
      );
    }
    // 'meta' is handled via the real OAuth redirect flow (GET /accounts/meta/oauth-url), not this endpoint.
    throw new HttpError(400, 'Use GET /accounts/meta/oauth-url to start the Meta connection flow.');
  } catch (err) {
    next(err);
  }
});

adLauncherRouter.post('/accounts/:platform/disconnect', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const account = await AdAccount.findOne({ workspaceId: req.auth!.workspaceId, platform: req.params.platform }).select('+accessTokenEncrypted');
    if (!account) throw new HttpError(404, 'Ad account not found');

    if (account.platform === 'meta' && account.accessTokenEncrypted) {
      await revokeMetaToken(decryptSecret(account.accessTokenEncrypted));
    }

    account.status = 'not_connected';
    account.externalAccountId = undefined;
    account.accountName = undefined;
    account.accessTokenEncrypted = undefined;
    account.tokenExpiresAt = undefined;
    account.connectedAt = undefined;
    await account.save();

    res.json({ account });
  } catch (err) {
    next(err);
  }
});

adLauncherRouter.get('/overview', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const overview = await getAdOverview(req.auth!.workspaceId);
    res.json(overview);
  } catch (err) {
    next(err);
  }
});
