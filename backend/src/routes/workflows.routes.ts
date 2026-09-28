import { Router } from 'express';
import { z } from 'zod';
import { Workflow, ACTION_KINDS } from '../models/Workflow';
import { WorkflowRun } from '../models/WorkflowRun';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { computeWorkflowIssues, executeWorkflow } from '../services/workflow.service';
import { TRIGGER_CATALOG } from '../constants/triggers';

export const workflowsRouter = Router();

workflowsRouter.use(authenticate);

workflowsRouter.get('/triggers', requirePermission('leadAutomation', 'read'), async (_req, res) => {
  res.json({ triggers: TRIGGER_CATALOG });
});

workflowsRouter.get('/', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workflows = await Workflow.find({ workspaceId: req.auth!.workspaceId, archived: false }).sort({ createdAt: -1 }).lean();
    res.json({ workflows });
  } catch (err) {
    next(err);
  }
});

const createWorkflowSchema = z.object({
  name: z.string().min(1),
  triggerKey: z.string().min(1),
});

workflowsRouter.post('/', requirePermission('leadAutomation', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createWorkflowSchema.parse(req.body);
    const triggerNode = { id: 'trigger-1', kind: 'trigger' as const, position: { x: 50, y: 150 }, data: { triggerKey: body.triggerKey } };
    const workflow = await Workflow.create({
      workspaceId: req.auth!.workspaceId,
      name: body.name,
      triggerKey: body.triggerKey,
      nodes: [triggerNode],
      edges: [],
    });
    res.status(201).json({ workflow });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.get('/:id', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workflow = await Workflow.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!workflow) throw new HttpError(404, 'Workflow not found');
    const issues = computeWorkflowIssues(workflow);
    res.json({ workflow, issues });
  } catch (err) {
    next(err);
  }
});

const nodeSchema = z.object({
  id: z.string(),
  kind: z.enum(['trigger', ...ACTION_KINDS]),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()).optional().default({}),
});
const edgeSchema = z.object({ id: z.string(), source: z.string(), target: z.string() });

const updateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
});

workflowsRouter.patch('/:id', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateWorkflowSchema.parse(req.body);
    const workflow = await Workflow.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!workflow) throw new HttpError(404, 'Workflow not found');
    if (body.name) workflow.name = body.name;
    if (body.nodes) workflow.nodes = body.nodes as typeof workflow.nodes;
    if (body.edges) workflow.edges = body.edges;
    await workflow.save();
    const issues = computeWorkflowIssues(workflow);
    res.json({ workflow, issues });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.post('/:id/publish', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workflow = await Workflow.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!workflow) throw new HttpError(404, 'Workflow not found');
    const issues = computeWorkflowIssues(workflow);
    if (issues.length > 0) throw new HttpError(400, `Cannot publish — ${issues.length} issue(s) found`);
    workflow.status = 'published';
    workflow.version += 1;
    await workflow.save();
    res.json({ workflow });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.post('/:id/unpublish', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workflow = await Workflow.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { status: 'draft' } },
      { new: true },
    );
    if (!workflow) throw new HttpError(404, 'Workflow not found');
    res.json({ workflow });
  } catch (err) {
    next(err);
  }
});

const runOnceSchema = z.object({ contactId: z.string().min(1) });

workflowsRouter.post('/:id/run-once', requirePermission('leadAutomation', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = runOnceSchema.parse(req.body);
    const workflow = await Workflow.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!workflow) throw new HttpError(404, 'Workflow not found');
    const run = await executeWorkflow(workflow, body.contactId, true);
    res.status(201).json({ run });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.get('/:id/runs', requirePermission('leadAutomation', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const runs = await WorkflowRun.find({ workflowId: req.params.id, workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

workflowsRouter.delete('/:id', requirePermission('leadAutomation', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const workflow = await Workflow.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!workflow) throw new HttpError(404, 'Workflow not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'leadAutomation',
      originalCollection: 'Workflow',
      originalId: workflow._id,
      snapshot: workflow.toObject(),
      deletedBy: req.auth!.userId,
    });
    await workflow.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
