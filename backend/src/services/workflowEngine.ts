import { eventBus, PlatformEvent, PlatformEventPayload } from '../lib/eventBus';
import { Workflow } from '../models/Workflow';
import { executeWorkflow } from './workflow.service';
import { getWiredTriggerKeys } from '../constants/triggers';

let listenersRegistered = false;

async function handleTrigger(triggerKey: string, payload: PlatformEventPayload) {
  const workflows = await Workflow.find({
    workspaceId: payload.workspaceId,
    triggerKey,
    status: 'published',
    archived: false,
  });

  for (const workflow of workflows) {
    await executeWorkflow(workflow, payload.contactId ?? null, false);
  }
}

export function registerWorkflowEngine(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  for (const triggerKey of getWiredTriggerKeys()) {
    eventBus.on(triggerKey as PlatformEvent, (payload: PlatformEventPayload) => {
      handleTrigger(triggerKey, payload).catch((err) => console.error(`Workflow engine error for ${triggerKey}:`, err));
    });
  }
}

/** Test-only: force re-registration after listener state is reset between test files. */
export function _resetWorkflowEngineForTests(): void {
  listenersRegistered = false;
}
