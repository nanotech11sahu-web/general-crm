import { Router } from 'express';
import { z } from 'zod';
import { BulkCampaign } from '../models/BulkCampaign';
import { Contact } from '../models/Contact';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { sendEmail, sendWhatsApp } from '../services/messaging.service';

export const bulkCampaignsRouter = Router();

bulkCampaignsRouter.use(authenticate);

bulkCampaignsRouter.get('/', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (status && status !== 'All') filter.status = status.toLowerCase();
    const campaigns = await BulkCampaign.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ campaigns });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  channels: z.array(z.enum(['email', 'whatsapp'])).min(1),
  emailSubject: z.string().optional(),
  message: z.string().optional(),
  scheduledAt: z.string().optional(),
});

bulkCampaignsRouter.post('/', requirePermission('leadAutomation', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const recipientCount = await Contact.countDocuments({ workspaceId: req.auth!.workspaceId, archived: false });
    const campaign = await BulkCampaign.create({
      ...body,
      workspaceId: req.auth!.workspaceId,
      status: body.scheduledAt ? 'scheduled' : 'draft',
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      recipientCount,
    });
    res.status(201).json({ campaign });
  } catch (err) {
    next(err);
  }
});

bulkCampaignsRouter.post('/:id/send', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const campaign = await BulkCampaign.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!campaign) throw new HttpError(404, 'Campaign not found');
    if (campaign.status === 'completed') throw new HttpError(400, 'Campaign already completed');

    const contacts = await Contact.find({ workspaceId: req.auth!.workspaceId, archived: false }).select('_id').lean();
    let sent = 0;
    for (const contact of contacts) {
      if (campaign.channels.includes('email') && campaign.emailSubject) {
        const r = await sendEmail(req.auth!.workspaceId, contact._id, campaign.emailSubject, 'campaign');
        if (r === 'sent') sent += 1;
      }
      if (campaign.channels.includes('whatsapp') && campaign.message) {
        await sendWhatsApp(req.auth!.workspaceId, contact._id, campaign.message, 'campaign');
      }
    }

    campaign.status = 'completed';
    campaign.sentCount = sent;
    await campaign.save();
    res.json({ campaign });
  } catch (err) {
    next(err);
  }
});
