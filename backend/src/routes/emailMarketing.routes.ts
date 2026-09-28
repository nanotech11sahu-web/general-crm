import { Router } from 'express';
import { z } from 'zod';
import { EmailCampaign } from '../models/EmailCampaign';
import { Contact } from '../models/Contact';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { sendEmail } from '../services/messaging.service';
import { callGateway } from '../services/aiGateway.service';

export const emailMarketingRouter = Router();

emailMarketingRouter.use(authenticate);

emailMarketingRouter.get('/dashboard', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const campaigns = await EmailCampaign.find({ workspaceId: req.auth!.workspaceId }).lean();
    const totals = campaigns.reduce(
      (acc, c) => ({
        sent: acc.sent + c.sentCount,
        delivered: acc.delivered + c.deliveredCount,
        opened: acc.opened + c.openedCount,
        clicked: acc.clicked + c.clickedCount,
        bounced: acc.bounced + c.bouncedCount,
      }),
      { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 },
    );
    res.json({
      kpis: {
        totalCampaigns: campaigns.length,
        totalSent: totals.sent,
        delivered: totals.delivered,
        opened: totals.opened,
        clicked: totals.clicked,
        bounced: totals.bounced,
        avgOpenRate: totals.delivered > 0 ? Math.round((totals.opened / totals.delivered) * 1000) / 10 : 0,
        avgClickRate: totals.delivered > 0 ? Math.round((totals.clicked / totals.delivered) * 1000) / 10 : 0,
        activeCampaigns: campaigns.filter((c) => c.status === 'draft').length,
      },
      campaigns: campaigns.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10),
    });
  } catch (err) {
    next(err);
  }
});

emailMarketingRouter.get('/campaigns', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const campaigns = await EmailCampaign.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ campaigns });
  } catch (err) {
    next(err);
  }
});

const createCampaignSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  fromName: z.string().optional(),
  fromEmail: z.string().optional(),
  bodyPreview: z.string().optional(),
});

interface AiEmailSuggestion {
  subject: string;
  bodyPreview: string;
}

const aiComposeSchema = z.object({ prompt: z.string().min(1) });

emailMarketingRouter.post('/ai-compose', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = aiComposeSchema.parse(req.body);
    const result = await callGateway({ workspaceId: req.auth!.workspaceId, purpose: 'emailCompose', prompt: body.prompt });
    const suggestion = JSON.parse(result.content) as AiEmailSuggestion;
    res.json({ suggestion });
  } catch (err) {
    next(err);
  }
});

emailMarketingRouter.post('/campaigns', requirePermission('leadAutomation', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createCampaignSchema.parse(req.body);
    const campaign = await EmailCampaign.create({ ...body, workspaceId: req.auth!.workspaceId });
    res.status(201).json({ campaign });
  } catch (err) {
    next(err);
  }
});

emailMarketingRouter.post('/campaigns/:id/send-test', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ contactId: z.string().min(1) }).parse(req.body);
    const campaign = await EmailCampaign.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!campaign) throw new HttpError(404, 'Campaign not found');
    const result = await sendEmail(req.auth!.workspaceId, body.contactId, campaign.subject, 'test', campaign._id);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

emailMarketingRouter.post('/campaigns/:id/send-now', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const campaign = await EmailCampaign.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!campaign) throw new HttpError(404, 'Campaign not found');
    if (campaign.status === 'sent') throw new HttpError(400, 'Campaign already sent');

    const contacts = await Contact.find({ workspaceId: req.auth!.workspaceId, archived: false }).select('_id').lean();
    let sent = 0;
    let suppressed = 0;
    for (const contact of contacts) {
      const result = await sendEmail(req.auth!.workspaceId, contact._id, campaign.subject, 'campaign', campaign._id);
      if (result === 'sent') sent += 1;
      else suppressed += 1;
    }

    campaign.status = 'sent';
    campaign.sentAt = new Date();
    campaign.sentCount = sent;
    campaign.deliveredCount = sent;
    await campaign.save();

    res.json({ campaign, sent, suppressed });
  } catch (err) {
    next(err);
  }
});
