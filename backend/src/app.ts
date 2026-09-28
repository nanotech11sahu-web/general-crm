import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { authRouter } from './routes/auth.routes';
import { workspaceRouter } from './routes/workspace.routes';
import { tagsRouter } from './routes/tags.routes';
import { customFieldsRouter } from './routes/customFields.routes';
import { deletedItemsRouter } from './routes/deletedItems.routes';
import { notificationsRouter } from './routes/notifications.routes';
import { rolesRouter } from './routes/roles.routes';
import { contactsRouter } from './routes/contacts.routes';
import { leadImportRouter } from './routes/leadImport.routes';
import { pipelinesRouter } from './routes/pipelines.routes';
import { opportunitiesRouter } from './routes/opportunities.routes';
import { contactStatsRouter } from './routes/contactStats.routes';
import { funnelsRouter } from './routes/funnels.routes';
import { formsRouter } from './routes/forms.routes';
import { chatWidgetsRouter } from './routes/chatWidgets.routes';
import { publicRouter } from './routes/public.routes';
import { walletRouter } from './routes/wallet.routes';
import { ecomRouter } from './routes/ecom.routes';
import { adLauncherRouter } from './routes/adLauncher.routes';
import { aiSocialRouter } from './routes/aiSocial.routes';
import { vibeProspectingRouter } from './routes/vibeProspecting.routes';
import { urlsRouter } from './routes/urls.routes';
import { workflowsRouter } from './routes/workflows.routes';
import { emailMarketingRouter } from './routes/emailMarketing.routes';
import { wabaRouter } from './routes/waba.routes';
import { bulkCampaignsRouter } from './routes/bulkCampaigns.routes';
import { eventTypesRouter } from './routes/eventTypes.routes';
import { appointmentsRouter } from './routes/appointments.routes';
import { salesPerformanceRouter } from './routes/salesPerformance.routes';
import { webinarsRouter } from './routes/webinars.routes';
import { ivrRouter } from './routes/ivr.routes';
import { proposalsRouter } from './routes/proposals.routes';
import { financeRouter } from './routes/finance.routes';
import { aiSuiteRouter } from './routes/aiSuite.routes';
import { projectsRouter } from './routes/projects.routes';
import { hrmRouter } from './routes/hrm.routes';
import { schoolRouter } from './routes/school.routes';
import { inboxRouter } from './routes/inbox.routes';
import { communityRouter } from './routes/community.routes';
import { domainsRouter } from './routes/domains.routes';
import { brandingRouter } from './routes/branding.routes';
import { vaultRouter } from './routes/vault.routes';
import { templatesRouter } from './routes/templates.routes';
import { appStoreRouter } from './routes/appStore.routes';
import { analyticsRouter } from './routes/analytics.routes';
import { dashboardRouter } from './routes/dashboard.routes';
import { agencyRouter } from './routes/agency.routes';
import { searchRouter } from './routes/search.routes';
import { registerWorkflowEngine } from './services/workflowEngine';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp() {
  registerWorkflowEngine();
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.nodeEnv === 'production' ? env.clientOrigin : /^http:\/\/localhost:\d+$/,
      credentials: true,
    }),
  );
  app.use(express.json());
  if (env.nodeEnv !== 'test') {
    app.use(morgan('dev'));
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRouter);
  app.use('/api/workspaces', workspaceRouter);
  app.use('/api/tags', tagsRouter);
  app.use('/api/custom-fields', customFieldsRouter);
  app.use('/api/deleted-items', deletedItemsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/lead-import', leadImportRouter);
  app.use('/api/pipelines', pipelinesRouter);
  app.use('/api/opportunities', opportunitiesRouter);
  app.use('/api/contact-stats', contactStatsRouter);
  app.use('/api/funnels', funnelsRouter);
  app.use('/api/forms', formsRouter);
  app.use('/api/chat-widgets', chatWidgetsRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/ecom', ecomRouter);
  app.use('/api/ad-launcher', adLauncherRouter);
  app.use('/api/ai-social', aiSocialRouter);
  app.use('/api/vibe-prospecting', vibeProspectingRouter);
  app.use('/api/urls', urlsRouter);
  app.use('/api/workflows', workflowsRouter);
  app.use('/api/email-marketing', emailMarketingRouter);
  app.use('/api/waba', wabaRouter);
  app.use('/api/bulk-campaigns', bulkCampaignsRouter);
  app.use('/api/event-types', eventTypesRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/sales-performance', salesPerformanceRouter);
  app.use('/api/webinars', webinarsRouter);
  app.use('/api/ivr', ivrRouter);
  app.use('/api/proposals', proposalsRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/ai-suite', aiSuiteRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/hrm', hrmRouter);
  app.use('/api/school', schoolRouter);
  app.use('/api/inbox', inboxRouter);
  app.use('/api/community', communityRouter);
  app.use('/api/domains', domainsRouter);
  app.use('/api/branding', brandingRouter);
  app.use('/api/vault', vaultRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/app-store', appStoreRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/agency', agencyRouter);
  app.use('/api/search', searchRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
