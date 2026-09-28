import { Router } from 'express';
import { z } from 'zod';
import { Contact, TEMPERATURES, LIFECYCLE_STAGES } from '../models/Contact';
import { Tag } from '../models/Tag';
import { ContactNote } from '../models/ContactNote';
import { TimelineEvent } from '../models/TimelineEvent';
import { DeletedItem } from '../models/DeletedItem';
import { Opportunity } from '../models/Opportunity';
import { LeadScoreLog } from '../models/LeadScoreLog';
import { Project } from '../models/Project';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { emitPlatformEvent } from '../lib/eventBus';
import { recalculateContactScore } from '../services/leadScoring.service';
import { callGateway } from '../services/aiGateway.service';

export const contactsRouter = Router();

contactsRouter.use(authenticate);

const listQuerySchema = z.object({
  search: z.string().optional(),
  archived: z.enum(['true', 'false']).optional(),
  temperature: z.enum(TEMPERATURES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

contactsRouter.get('/', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = {
      workspaceId: req.auth!.workspaceId,
      archived: query.archived === 'true',
    };
    if (query.temperature) filter.temperature = query.temperature;
    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { email: { $regex: query.search, $options: 'i' } },
        { phone: { $regex: query.search, $options: 'i' } },
        { company: { $regex: query.search, $options: 'i' } },
      ];
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const [contacts, total] = await Promise.all([
      Contact.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Contact.countDocuments(filter),
    ]);
    res.json({ contacts, total, page, limit });
  } catch (err) {
    next(err);
  }
});

const createContactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
  temperature: z.enum(TEMPERATURES).optional(),
  contactType: z.string().optional(),
  leadValue: z.number().optional(),
  source: z.string().optional(),
  customFieldValues: z.record(z.string(), z.unknown()).optional(),
});

contactsRouter.post('/', requirePermission('leadManagement', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createContactSchema.parse(req.body);
    const contact = await Contact.create({
      ...body,
      workspaceId: req.auth!.workspaceId,
      attributionFirst: { source: body.source ?? 'Manual', date: new Date() },
      attributionLatest: { source: body.source ?? 'Manual', date: new Date() },
    });
    await TimelineEvent.create({
      workspaceId: req.auth!.workspaceId,
      contactId: contact._id,
      type: 'contact_created',
      message: `${contact.name} was added as a contact.`,
    });
    emitPlatformEvent('contact.created', { workspaceId: req.auth!.workspaceId, contactId: String(contact._id) });
    res.status(201).json({ contact });
  } catch (err) {
    next(err);
  }
});

contactsRouter.get('/:id', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const contact = await Contact.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!contact) throw new HttpError(404, 'Contact not found');
    res.json({ contact });
  } catch (err) {
    next(err);
  }
});

const updateContactSchema = createContactSchema.partial().extend({
  assignedCloserIds: z.array(z.string()).optional(),
  dnd: z
    .object({
      email: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      waba: z.boolean().optional(),
      calls: z.boolean().optional(),
      blockAll: z.boolean().optional(),
    })
    .optional(),
});

contactsRouter.patch('/:id', requirePermission('leadManagement', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateContactSchema.parse(req.body);
    const contact = await Contact.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!contact) throw new HttpError(404, 'Contact not found');

    const previousStage = contact.lifecycleStage;
    Object.assign(contact, body);
    if (body.dnd) Object.assign(contact.dnd, body.dnd);
    await contact.save();

    if (body.lifecycleStage && body.lifecycleStage !== previousStage) {
      await TimelineEvent.create({
        workspaceId: req.auth!.workspaceId,
        contactId: contact._id,
        type: 'stage_changed',
        message: `Lifecycle stage changed from ${previousStage} to ${body.lifecycleStage}.`,
      });
      emitPlatformEvent('contact.lifecycleStageChanged', {
        workspaceId: req.auth!.workspaceId,
        contactId: String(contact._id),
        from: previousStage,
        to: body.lifecycleStage,
      });
    }

    res.json({ contact });
  } catch (err) {
    next(err);
  }
});

contactsRouter.post('/:id/tags', requirePermission('leadManagement', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ tagName: z.string().min(1) }).parse(req.body);
    const contact = await Contact.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!contact) throw new HttpError(404, 'Contact not found');

    let tag = await Tag.findOne({ workspaceId: req.auth!.workspaceId, name: body.tagName });
    if (!tag) tag = await Tag.create({ workspaceId: req.auth!.workspaceId, name: body.tagName, appliesTo: ['Contact'] });

    const alreadyTagged = contact.tagIds.some((id) => String(id) === String(tag!._id));
    if (!alreadyTagged) {
      contact.tagIds.push(tag._id);
      await contact.save();
      emitPlatformEvent('contact.tagAdded', {
        workspaceId: req.auth!.workspaceId,
        contactId: String(contact._id),
        tagId: String(tag._id),
        tagName: tag.name,
      });
    }

    res.status(201).json({ contact });
  } catch (err) {
    next(err);
  }
});

contactsRouter.post('/:id/archive', requirePermission('leadManagement', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { archived: true } },
      { new: true },
    );
    if (!contact) throw new HttpError(404, 'Contact not found');
    res.json({ contact });
  } catch (err) {
    next(err);
  }
});

contactsRouter.delete('/:id', requirePermission('leadManagement', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const contact = await Contact.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!contact) throw new HttpError(404, 'Contact not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'leadManagement',
      originalCollection: 'Contact',
      originalId: contact._id,
      snapshot: contact.toObject(),
      deletedBy: req.auth!.userId,
    });
    await contact.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// --- Notes ---
contactsRouter.get('/:id/notes', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const notes = await ContactNote.find({ contactId: req.params.id, workspaceId: req.auth!.workspaceId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ notes });
  } catch (err) {
    next(err);
  }
});

contactsRouter.post('/:id/notes', requirePermission('leadManagement', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ body: z.string().min(1) }).parse(req.body);
    const contact = await Contact.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!contact) throw new HttpError(404, 'Contact not found');
    const note = await ContactNote.create({
      workspaceId: req.auth!.workspaceId,
      contactId: contact._id,
      body: body.body,
      authorId: req.auth!.userId,
    });
    await TimelineEvent.create({
      workspaceId: req.auth!.workspaceId,
      contactId: contact._id,
      type: 'note_added',
      message: 'A note was added.',
    });
    res.status(201).json({ note });
  } catch (err) {
    next(err);
  }
});

// --- Timeline ---
contactsRouter.get('/:id/timeline', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const events = await TimelineEvent.find({ contactId: req.params.id, workspaceId: req.auth!.workspaceId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

// --- Opportunities for this contact ---
contactsRouter.get('/:id/opportunities', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const opportunities = await Opportunity.find({ contactId: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    res.json({ opportunities });
  } catch (err) {
    next(err);
  }
});

// --- Projects (Phase 8 two-way link) ---
contactsRouter.get('/:id/projects', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const projects = await Project.find({ contactId: req.params.id, workspaceId: req.auth!.workspaceId, archived: false }).sort({ createdAt: -1 }).lean();
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

// --- Lead scoring ---
contactsRouter.get('/:id/lead-score', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const contact = await Contact.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!contact) throw new HttpError(404, 'Contact not found');
    const logs = await LeadScoreLog.find({ contactId: req.params.id }).sort({ createdAt: -1 }).limit(30).lean();
    res.json({
      score: contact.leadScore,
      updatedAt: contact.leadScoreUpdatedAt,
      trend: logs.reverse().map((l) => ({ score: l.score, at: l.createdAt })),
      signals: logs.length ? logs[logs.length - 1].signals : [],
    });
  } catch (err) {
    next(err);
  }
});

contactsRouter.post('/:id/lead-score/recalculate', requirePermission('leadManagement', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const contact = await Contact.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!contact) throw new HttpError(404, 'Contact not found');
    const result = await recalculateContactScore(String(contact._id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- AI Next Best Action (Phase 7 gateway retrofit) ---
contactsRouter.post('/:id/next-best-action', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const contact = await Contact.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!contact) throw new HttpError(404, 'Contact not found');

    const result = await callGateway({
      workspaceId: req.auth!.workspaceId,
      purpose: 'nextBestAction',
      prompt: `Suggest the next best action for ${contact.name}, a ${contact.lifecycleStage} with ${contact.temperature} temperature and lead score ${contact.leadScore}.`,
      context: { lifecycleStage: contact.lifecycleStage, temperature: contact.temperature, leadScore: contact.leadScore },
    });

    res.json({ suggestion: result.content });
  } catch (err) {
    next(err);
  }
});
