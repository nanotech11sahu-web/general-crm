import { Types } from 'mongoose';
import { Agency } from '../models/Agency';
import { Workspace } from '../models/Workspace';
import { createWorkspaceForOwner } from './workspace.service';
import { computeDashboardKpis, flattenKpis } from './dashboard.service';

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export async function createAgencyForWorkspace(ownerUserId: Types.ObjectId, workspaceId: string, agencyName: string) {
  const agency = await Agency.create({ name: agencyName, ownerUserId });
  await Workspace.findByIdAndUpdate(workspaceId, { $set: { agencyId: agency._id } });
  return agency;
}

export async function createSubAccount(ownerUserId: Types.ObjectId, agencyId: string, name: string) {
  const { workspace, membership } = await createWorkspaceForOwner(ownerUserId, name);
  await Workspace.findByIdAndUpdate(workspace._id, { $set: { agencyId } });
  return { workspace, membership };
}

export async function listAgencyWorkspaces(agencyId: string) {
  return Workspace.find({ agencyId }).lean();
}

export async function computeAgencyRollup(agencyId: string) {
  const workspaces = await listAgencyWorkspaces(agencyId);
  const now = new Date();
  const range = { from: startOfMonth(now), to: now };

  const perWorkspace = await Promise.all(
    workspaces.map(async (ws) => ({
      workspaceId: String(ws._id),
      name: ws.name,
      kpis: flattenKpis(await computeDashboardKpis(String(ws._id), range)),
    })),
  );

  const totals: Record<string, number> = {};
  for (const ws of perWorkspace) {
    for (const kpi of ws.kpis) {
      if (typeof kpi.value === 'number') {
        totals[kpi.key] = (totals[kpi.key] ?? 0) + kpi.value;
      }
    }
  }

  return { workspaces: perWorkspace, totals, subAccountCount: workspaces.length };
}
