import { Notification } from '../models/Notification';
import { Workspace } from '../models/Workspace';

/**
 * Every module event lands here so the bell dropdown is one consolidated feed instead
 * of each module inventing its own toast. Targets the workspace owner for now — real
 * per-membership targeting (e.g. only notify the assigned closer) is listed as deferred.
 */
export async function notifyWorkspaceOwner(
  workspaceId: string,
  type: string,
  title: string,
  message: string,
  link?: string,
): Promise<void> {
  const workspace = await Workspace.findById(workspaceId).select('ownerUserId').lean();
  if (!workspace) return;
  await Notification.create({ workspaceId, userId: workspace.ownerUserId, type, title, message, link });
}
