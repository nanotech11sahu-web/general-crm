import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { Proposal, PROPOSAL_STATUSES } from '../models/Proposal';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const proposalsRouter = Router();

proposalsRouter.use(authenticate);

proposalsRouter.get('/kpis', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const proposals = await Proposal.find({ workspaceId: req.auth!.workspaceId, archived: false }).lean();
    const funnel: Record<string, number> = { Built: 0, Published: 0, Sent: 0, Viewed: 0, Approved: 0, Declined: 0, Converted: 0 };
    for (const p of proposals) funnel[p.status] = (funnel[p.status] ?? 0) + 1;

    const pipelineValue = proposals.filter((p) => ['Sent', 'Viewed', 'Approved'].includes(p.status)).reduce((sum, p) => sum + p.value, 0);
    const wonValue = proposals.filter((p) => p.status === 'Converted').reduce((sum, p) => sum + p.value, 0);
    const decided = proposals.filter((p) => ['Approved', 'Declined', 'Converted'].includes(p.status)).length;
    const won = proposals.filter((p) => ['Approved', 'Converted'].includes(p.status)).length;
    const winRate = decided > 0 ? won / decided : 0;

    res.json({ funnel, pipelineValue, wonValue, winRate });
  } catch (err) {
    next(err);
  }
});

proposalsRouter.get('/', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const query: Record<string, unknown> = { workspaceId: req.auth!.workspaceId, archived: false };
    if (req.query.status) query.status = req.query.status;
    const proposals = await Proposal.find(query).sort({ createdAt: -1 }).lean();
    res.json({ proposals });
  } catch (err) {
    next(err);
  }
});

const createProposalSchema = z.object({
  name: z.string().min(1),
  contactId: z.string().optional(),
  opportunityId: z.string().optional(),
  value: z.number().min(0).optional(),
  content: z.string().optional(),
  templateName: z.string().optional(),
});

proposalsRouter.post('/', requirePermission('sales', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createProposalSchema.parse(req.body);
    const proposal = await Proposal.create({
      workspaceId: req.auth!.workspaceId,
      ...body,
      publicId: crypto.randomBytes(6).toString('hex'),
    });
    res.status(201).json({ proposal });
  } catch (err) {
    next(err);
  }
});

proposalsRouter.get('/:id', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const proposal = await Proposal.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!proposal) throw new HttpError(404, 'Proposal not found');
    res.json({ proposal });
  } catch (err) {
    next(err);
  }
});

const updateProposalSchema = createProposalSchema.partial();

proposalsRouter.patch('/:id', requirePermission('sales', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateProposalSchema.parse(req.body);
    const proposal = await Proposal.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!proposal) throw new HttpError(404, 'Proposal not found');
    if (proposal.status !== 'Built') throw new HttpError(400, 'Only proposals still in Built status can be edited');
    Object.assign(proposal, body);
    await proposal.save();
    res.json({ proposal });
  } catch (err) {
    next(err);
  }
});

const TRANSITIONS: Record<string, { from: string[]; to: (typeof PROPOSAL_STATUSES)[number] }> = {
  publish: { from: ['Built'], to: 'Published' },
  send: { from: ['Published'], to: 'Sent' },
  view: { from: ['Sent'], to: 'Viewed' },
  decline: { from: ['Sent', 'Viewed'], to: 'Declined' },
  convert: { from: ['Approved'], to: 'Converted' },
};

for (const [action, { from, to }] of Object.entries(TRANSITIONS)) {
  proposalsRouter.post(`/:id/${action}`, requirePermission('sales', 'edit'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const proposal = await Proposal.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
      if (!proposal) throw new HttpError(404, 'Proposal not found');
      if (!from.includes(proposal.status)) throw new HttpError(400, `Cannot ${action} a proposal in "${proposal.status}" status`);
      proposal.status = to;
      if (to === 'Sent') proposal.sentAt = new Date();
      if (to === 'Viewed') proposal.viewedAt = new Date();
      if (to === 'Declined' || to === 'Converted') proposal.respondedAt = new Date();
      await proposal.save();
      res.json({ proposal });
    } catch (err) {
      next(err);
    }
  });
}

const approveSchema = z.object({ signatureName: z.string().min(1) });

proposalsRouter.post('/:id/approve', requirePermission('sales', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = approveSchema.parse(req.body);
    const proposal = await Proposal.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!proposal) throw new HttpError(404, 'Proposal not found');
    if (!['Sent', 'Viewed'].includes(proposal.status)) throw new HttpError(400, `Cannot approve a proposal in "${proposal.status}" status`);
    proposal.status = 'Approved';
    proposal.signatureName = body.signatureName;
    proposal.respondedAt = new Date();
    await proposal.save();
    res.json({ proposal });
  } catch (err) {
    next(err);
  }
});

proposalsRouter.delete('/:id', requirePermission('sales', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const proposal = await Proposal.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!proposal) throw new HttpError(404, 'Proposal not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'sales',
      originalCollection: 'Proposal',
      originalId: proposal._id,
      snapshot: proposal.toObject(),
      deletedBy: req.auth!.userId,
    });
    await proposal.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
