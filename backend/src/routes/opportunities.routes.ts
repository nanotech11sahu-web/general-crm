import { Router } from 'express';
import { z } from 'zod';
import { Opportunity } from '../models/Opportunity';
import { Pipeline } from '../models/Pipeline';
import { Contact } from '../models/Contact';
import { TimelineEvent } from '../models/TimelineEvent';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { emitPlatformEvent } from '../lib/eventBus';

export const opportunitiesRouter = Router();

opportunitiesRouter.use(authenticate);

opportunitiesRouter.get('/', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const pipelineId = req.query.pipelineId as string | undefined;
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (pipelineId) filter.pipelineId = pipelineId;
    const opportunities = await Opportunity.find(filter).sort({ stageKey: 1, order: 1 }).lean();
    res.json({ opportunities });
  } catch (err) {
    next(err);
  }
});

const createOpportunitySchema = z.object({
  contactId: z.string().min(1),
  pipelineId: z.string().min(1),
  stageKey: z.string().min(1),
  name: z.string().min(1),
  productInterest: z.string().optional(),
  city: z.string().optional(),
  value: z.number().optional(),
});

opportunitiesRouter.post('/', requirePermission('leadManagement', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createOpportunitySchema.parse(req.body);
    const [contact, pipeline] = await Promise.all([
      Contact.findOne({ _id: body.contactId, workspaceId: req.auth!.workspaceId }),
      Pipeline.findOne({ _id: body.pipelineId, workspaceId: req.auth!.workspaceId }),
    ]);
    if (!contact) throw new HttpError(404, 'Contact not found');
    if (!pipeline) throw new HttpError(404, 'Pipeline not found');
    if (!pipeline.stages.some((s) => s.key === body.stageKey)) {
      throw new HttpError(400, 'Unknown stage for this pipeline');
    }

    const count = await Opportunity.countDocuments({ pipelineId: pipeline._id, stageKey: body.stageKey });
    const opportunity = await Opportunity.create({
      ...body,
      workspaceId: req.auth!.workspaceId,
      order: count,
    });
    res.status(201).json({ opportunity });
  } catch (err) {
    next(err);
  }
});

const moveSchema = z.object({
  stageKey: z.string().min(1),
  order: z.number().int().min(0),
});

opportunitiesRouter.patch('/:id/move', requirePermission('leadManagement', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = moveSchema.parse(req.body);
    const opportunity = await Opportunity.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!opportunity) throw new HttpError(404, 'Opportunity not found');

    const pipeline = await Pipeline.findById(opportunity.pipelineId);
    if (!pipeline || !pipeline.stages.some((s) => s.key === body.stageKey)) {
      throw new HttpError(400, 'Unknown stage for this pipeline');
    }

    const previousStage = opportunity.stageKey;
    opportunity.stageKey = body.stageKey;
    opportunity.order = body.order;
    await opportunity.save();

    if (previousStage !== body.stageKey) {
      await TimelineEvent.create({
        workspaceId: req.auth!.workspaceId,
        contactId: opportunity.contactId,
        type: 'stage_changed',
        message: `Opportunity "${opportunity.name}" moved from ${previousStage} to ${body.stageKey}.`,
      });
      emitPlatformEvent('contact.stageChanged', {
        workspaceId: req.auth!.workspaceId,
        contactId: String(opportunity.contactId),
        opportunityId: String(opportunity._id),
        from: previousStage,
        to: body.stageKey,
      });
    }

    res.json({ opportunity });
  } catch (err) {
    next(err);
  }
});

const updateOpportunitySchema = createOpportunitySchema.partial().omit({ contactId: true, pipelineId: true });

opportunitiesRouter.patch('/:id', requirePermission('leadManagement', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateOpportunitySchema.parse(req.body);
    const opportunity = await Opportunity.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: body },
      { new: true },
    );
    if (!opportunity) throw new HttpError(404, 'Opportunity not found');
    res.json({ opportunity });
  } catch (err) {
    next(err);
  }
});

opportunitiesRouter.delete('/:id', requirePermission('leadManagement', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const opportunity = await Opportunity.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!opportunity) throw new HttpError(404, 'Opportunity not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'leadManagement',
      originalCollection: 'Opportunity',
      originalId: opportunity._id,
      snapshot: opportunity.toObject(),
      deletedBy: req.auth!.userId,
    });
    await opportunity.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
