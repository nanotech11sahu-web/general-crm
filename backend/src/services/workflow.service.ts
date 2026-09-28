import { Types } from 'mongoose';
import { IWorkflow, IWorkflowNode } from '../models/Workflow';
import { WorkflowRun, IWorkflowStepLog } from '../models/WorkflowRun';
import { Contact } from '../models/Contact';
import { Tag } from '../models/Tag';
import { sendEmail, sendWhatsApp } from './messaging.service';
import { notifyWorkspaceOwner } from './notification.service';

export function computeWorkflowIssues(workflow: Pick<IWorkflow, 'nodes' | 'edges'>): string[] {
  const issues: string[] = [];
  const triggerNode = workflow.nodes.find((n) => n.kind === 'trigger');
  if (!triggerNode) {
    issues.push('Missing a trigger node');
    return issues;
  }

  const actionNodes = workflow.nodes.filter((n) => n.kind !== 'trigger');
  if (actionNodes.length === 0) {
    issues.push('Workflow has no actions — add at least one action node');
    return issues;
  }

  const reachable = reachableNodeIds(workflow.nodes, workflow.edges, triggerNode.id);
  for (const node of actionNodes) {
    const data = node.data ?? {};
    if (!reachable.has(node.id)) {
      issues.push(`Node "${node.kind}" is not connected to the trigger`);
      continue;
    }
    if (node.kind === 'add_tag' && !data.tagName) issues.push('Add Tag node is missing a tag name');
    if (node.kind === 'update_lifecycle_stage' && !data.stage) issues.push('Update Lifecycle Stage node is missing a stage');
    if (node.kind === 'send_email' && !data.subject) issues.push('Send Email node is missing a subject');
    if (node.kind === 'send_whatsapp' && !data.message) issues.push('Send WhatsApp node is missing a message');
  }

  return issues;
}

function reachableNodeIds(nodes: IWorkflowNode[], edges: { source: string; target: string }[], startId: string): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push(edge.target);
  }
  const visited = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

async function executeActionNode(
  workspaceId: Types.ObjectId,
  node: IWorkflowNode,
  contactId: string | null,
): Promise<IWorkflowStepLog> {
  if (!contactId) {
    return { nodeId: node.id, kind: node.kind, status: 'skipped', message: 'No contact in trigger payload' };
  }

  try {
    switch (node.kind) {
      case 'add_tag': {
        const tagName = String(node.data?.tagName ?? '');
        if (!tagName) return { nodeId: node.id, kind: node.kind, status: 'failed', message: 'No tag name configured' };
        let tag = await Tag.findOne({ workspaceId, name: tagName });
        if (!tag) tag = await Tag.create({ workspaceId, name: tagName, appliesTo: ['Contact'] });
        await Contact.findByIdAndUpdate(contactId, { $addToSet: { tagIds: tag._id } });
        return { nodeId: node.id, kind: node.kind, status: 'success', message: `Tagged contact with "${tagName}"` };
      }
      case 'update_lifecycle_stage': {
        const stage = String(node.data?.stage ?? '');
        if (!stage) return { nodeId: node.id, kind: node.kind, status: 'failed', message: 'No stage configured' };
        await Contact.findByIdAndUpdate(contactId, { $set: { lifecycleStage: stage } });
        return { nodeId: node.id, kind: node.kind, status: 'success', message: `Set lifecycle stage to ${stage}` };
      }
      case 'send_email': {
        const subject = String(node.data?.subject ?? '');
        if (!subject) return { nodeId: node.id, kind: node.kind, status: 'failed', message: 'No subject configured' };
        const result = await sendEmail(workspaceId, contactId, subject, 'workflow');
        return {
          nodeId: node.id,
          kind: node.kind,
          status: result === 'sent' ? 'success' : 'skipped',
          message: result === 'sent' ? `Email "${subject}" sent` : `Email suppressed (${result})`,
        };
      }
      case 'send_whatsapp': {
        const message = String(node.data?.message ?? '');
        if (!message) return { nodeId: node.id, kind: node.kind, status: 'failed', message: 'No message configured' };
        const result = await sendWhatsApp(workspaceId, contactId, message, 'workflow');
        return {
          nodeId: node.id,
          kind: node.kind,
          status: result === 'sent' ? 'success' : 'skipped',
          message: result === 'sent' ? 'WhatsApp message sent' : `WhatsApp message suppressed (${result})`,
        };
      }
      default:
        return { nodeId: node.id, kind: node.kind, status: 'skipped', message: `Unknown action kind: ${node.kind}` };
    }
  } catch (err) {
    return { nodeId: node.id, kind: node.kind, status: 'failed', message: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function executeWorkflow(
  workflow: IWorkflow,
  contactId: string | null,
  isTestRun = false,
): Promise<InstanceType<typeof WorkflowRun>> {
  const triggerNode = workflow.nodes.find((n) => n.kind === 'trigger');
  const steps: IWorkflowStepLog[] = [];

  if (triggerNode) {
    const orderedActionNodes = workflow.nodes.filter((n) => n.kind !== 'trigger' && reachableNodeIds(workflow.nodes, workflow.edges, triggerNode.id).has(n.id));
    for (const node of orderedActionNodes) {
      steps.push(await executeActionNode(workflow.workspaceId, node, contactId));
    }
  }

  const status = steps.length === 0 ? 'failed' : steps.every((s) => s.status === 'success') ? 'success' : steps.some((s) => s.status === 'failed') ? 'partial' : 'success';

  const run = await WorkflowRun.create({
    workspaceId: workflow.workspaceId,
    workflowId: workflow._id,
    triggerKey: workflow.triggerKey,
    contactId: contactId ?? undefined,
    status,
    steps,
    isTestRun,
  });

  if (status === 'failed' && !isTestRun) {
    await notifyWorkspaceOwner(
      String(workflow.workspaceId),
      'workflow.failed',
      'Workflow failed',
      `"${workflow.name}" failed to complete a run`,
      `/lead-automation/workflows/${workflow._id}`,
    );
  }

  return run;
}
