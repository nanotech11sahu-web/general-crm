import { Router } from 'express';
import { z } from 'zod';
import { Form, FORM_FIELD_TYPES } from '../models/Form';
import { FormSubmission } from '../models/FormSubmission';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { callGateway } from '../services/aiGateway.service';

export const formsRouter = Router();

formsRouter.use(authenticate);

formsRouter.get('/', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const forms = await Form.find({ workspaceId: req.auth!.workspaceId, archived: false }).sort({ createdAt: -1 }).lean();
    res.json({ forms });
  } catch (err) {
    next(err);
  }
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'form'
  );
}

const createFormSchema = z.object({ name: z.string().min(1).max(50) });

formsRouter.post('/', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createFormSchema.parse(req.body);
    const baseSlug = slugify(body.name);
    let slug = baseSlug;
    let suffix = 1;
    while (await Form.exists({ workspaceId: req.auth!.workspaceId, slug })) {
      slug = `${baseSlug}-${++suffix}`;
    }
    const form = await Form.create({
      workspaceId: req.auth!.workspaceId,
      name: body.name,
      slug,
      fields: [
        { id: 'name', type: 'name', label: 'Name', required: true, options: [] },
        { id: 'email', type: 'email', label: 'Email', required: true, options: [] },
        { id: 'submit', type: 'submit', label: 'Submit', required: false, options: [] },
      ],
    });
    res.status(201).json({ form });
  } catch (err) {
    next(err);
  }
});

interface AiFormSuggestion {
  name: string;
  fields: { label: string; type: string; required: boolean }[];
}

const aiBuilderSchema = z.object({ prompt: z.string().min(1) });

formsRouter.post('/ai-builder', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = aiBuilderSchema.parse(req.body);
    const result = await callGateway({ workspaceId: req.auth!.workspaceId, purpose: 'formBuilder', prompt: body.prompt });
    const suggestion = JSON.parse(result.content) as AiFormSuggestion;

    const baseSlug = slugify(suggestion.name);
    let slug = baseSlug;
    let suffix = 1;
    while (await Form.exists({ workspaceId: req.auth!.workspaceId, slug })) {
      slug = `${baseSlug}-${++suffix}`;
    }

    const form = await Form.create({
      workspaceId: req.auth!.workspaceId,
      name: suggestion.name,
      slug,
      fields: suggestion.fields.map((f, i) => ({ id: `field-${i}`, type: f.type, label: f.label, required: f.required, options: [] })),
    });
    res.status(201).json({ form });
  } catch (err) {
    next(err);
  }
});

formsRouter.get('/:id', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const form = await Form.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!form) throw new HttpError(404, 'Form not found');
    res.json({ form });
  } catch (err) {
    next(err);
  }
});

const fieldSchema = z.object({
  id: z.string().min(1),
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string().min(1),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

const updateFormSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['draft', 'published']).optional(),
  fields: z.array(fieldSchema).optional(),
  style: z
    .object({
      pageBackground: z.string().optional(),
      cardBackground: z.string().optional(),
      buttonBackground: z.string().optional(),
      cornerRadius: z.number().optional(),
    })
    .partial()
    .optional(),
  settings: z
    .object({
      onSubmitAction: z.enum(['message', 'redirect']).optional(),
      onSubmitMessage: z.string().optional(),
      redirectUrl: z.string().optional(),
      autoCreateContact: z.boolean().optional(),
      lifecycleStageOnSubmit: z.string().optional(),
      skipContactCreation: z.boolean().optional(),
      gdprConsent: z.boolean().optional(),
      requireCaptcha: z.boolean().optional(),
      rateLimitPerHour: z.number().optional(),
    })
    .partial()
    .optional(),
});

formsRouter.patch('/:id', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateFormSchema.parse(req.body);
    const form = await Form.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!form) throw new HttpError(404, 'Form not found');
    if (body.name) form.name = body.name;
    if (body.status) form.status = body.status;
    if (body.fields) form.fields = body.fields as typeof form.fields;
    if (body.style) Object.assign(form.style, body.style);
    if (body.settings) Object.assign(form.settings, body.settings);
    await form.save();
    res.json({ form });
  } catch (err) {
    next(err);
  }
});

formsRouter.delete('/:id', requirePermission('leadGeneration', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const form = await Form.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!form) throw new HttpError(404, 'Form not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'leadGeneration',
      originalCollection: 'Form',
      originalId: form._id,
      snapshot: form.toObject(),
      deletedBy: req.auth!.userId,
    });
    await form.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

formsRouter.get('/:id/submissions', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const submissions = await FormSubmission.find({ formId: req.params.id, workspaceId: req.auth!.workspaceId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ submissions });
  } catch (err) {
    next(err);
  }
});

formsRouter.get('/:id/analytics', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const total = await FormSubmission.countDocuments({ formId: req.params.id, workspaceId: req.auth!.workspaceId });
    const contactsCreated = await FormSubmission.countDocuments({
      formId: req.params.id,
      workspaceId: req.auth!.workspaceId,
      contactId: { $exists: true },
    });
    res.json({ totalSubmissions: total, contactsCreated });
  } catch (err) {
    next(err);
  }
});
