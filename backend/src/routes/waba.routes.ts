import { Router } from 'express';
import { z } from 'zod';
import { WabaAccount } from '../models/WabaAccount';
import { WabaTemplate } from '../models/WabaTemplate';
import { OptOut } from '../models/OptOut';
import { Contact } from '../models/Contact';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { processInboundWhatsAppMessage } from '../services/optOut.service';
import { getOrCreateWallet } from '../services/wallet.service';

export const wabaRouter = Router();

wabaRouter.use(authenticate);

async function getOrCreateAccount(workspaceId: string) {
  let account = await WabaAccount.findOne({ workspaceId });
  if (!account) account = await WabaAccount.create({ workspaceId });
  return account;
}

wabaRouter.get('/dashboard', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const account = await getOrCreateAccount(req.auth!.workspaceId);
    const wallet = await getOrCreateWallet(req.auth!.workspaceId);
    const optOutCount = await OptOut.countDocuments({ workspaceId: req.auth!.workspaceId, channel: 'whatsapp' });
    res.json({ account, wallet: { balance: wallet.balance }, optOutCount });
  } catch (err) {
    next(err);
  }
});

const setupSchema = z.object({
  onboardingType: z.enum(['own_number', 'coexistence']),
  billingMode: z.enum(['byob', 'credit_line']),
});

wabaRouter.post('/setup', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = setupSchema.parse(req.body);
    const account = await WabaAccount.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId },
      {
        $set: {
          status: 'connected',
          onboardingType: body.onboardingType,
          billingMode: body.billingMode,
          qualityRating: 'green',
          tier: 'Tier 1 (1K/24h)',
          messagingLimit: 1000,
          connectedAt: new Date(),
        },
      },
      { new: true, upsert: true },
    );
    res.json({ account });
  } catch (err) {
    next(err);
  }
});

wabaRouter.patch('/compliance', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ autoOptOutEnabled: z.boolean() }).parse(req.body);
    const account = await WabaAccount.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId },
      { $set: { autoOptOutEnabled: body.autoOptOutEnabled } },
      { new: true, upsert: true },
    );
    res.json({ account });
  } catch (err) {
    next(err);
  }
});

wabaRouter.get('/opt-outs', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const optOuts = await OptOut.find({ workspaceId: req.auth!.workspaceId, channel: 'whatsapp' })
      .populate('contactId', 'name phone')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ optOuts });
  } catch (err) {
    next(err);
  }
});

const inboundSchema = z.object({ contactId: z.string().min(1), text: z.string().min(1) });

wabaRouter.post('/inbound', requirePermission('leadAutomation', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = inboundSchema.parse(req.body);
    const account = await getOrCreateAccount(req.auth!.workspaceId);
    const contact = await Contact.findOne({ _id: body.contactId, workspaceId: req.auth!.workspaceId });
    if (!contact) throw new HttpError(404, 'Contact not found');

    if (!account.autoOptOutEnabled) {
      return res.json({ optedOut: false, keyword: null, message: 'Auto opt-out is disabled for this workspace' });
    }

    const result = await processInboundWhatsAppMessage(req.auth!.workspaceId, contact._id, body.text);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

wabaRouter.get('/templates', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const templates = await WabaTemplate.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

const createTemplateSchema = z.object({ name: z.string().min(1), body: z.string().min(1) });

wabaRouter.post('/templates', requirePermission('leadAutomation', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createTemplateSchema.parse(req.body);
    const template = await WabaTemplate.create({ ...body, workspaceId: req.auth!.workspaceId, status: 'pending_approval' });
    res.status(201).json({ template });
  } catch (err) {
    next(err);
  }
});

wabaRouter.post('/templates/:id/approve', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const template = await WabaTemplate.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { status: 'approved' } },
      { new: true },
    );
    if (!template) throw new HttpError(404, 'Template not found');
    res.json({ template });
  } catch (err) {
    next(err);
  }
});
