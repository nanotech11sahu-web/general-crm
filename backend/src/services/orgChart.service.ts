import { Types } from 'mongoose';
import { Staff, IStaff } from '../models/Staff';
import { Department } from '../models/Department';
import { AiAgent } from '../models/AiAgent';
import { Workspace } from '../models/Workspace';

interface OrgChartNode {
  id: string;
  name: string;
  jobTitle?: string;
  department?: string;
  kind: 'owner' | 'staff';
  children: OrgChartNode[];
}

function buildTree(staff: IStaff[], parentId: string | null): OrgChartNode[] {
  return staff
    .filter((s) => (s.managerId ? String(s.managerId) : null) === parentId)
    .map((s) => ({
      id: String(s._id),
      name: s.name,
      jobTitle: s.jobTitle,
      department: s.department,
      kind: 'staff' as const,
      children: buildTree(staff, String(s._id)),
    }));
}

function treeDepth(nodes: OrgChartNode[]): number {
  if (nodes.length === 0) return 0;
  return 1 + Math.max(...nodes.map((n) => treeDepth(n.children)));
}

export async function computeOrgChart(workspaceId: string) {
  const [staff, departments, activeAgents, workspace] = await Promise.all([
    Staff.find({ workspaceId, status: 'active' }).lean(),
    Department.find({ workspaceId }).lean(),
    AiAgent.countDocuments({ workspaceId, status: 'active' }),
    Workspace.findById(workspaceId).lean(),
  ]);

  const staffChildren = buildTree(staff as unknown as IStaff[], null);
  const ownerNode: OrgChartNode = {
    id: workspaceId,
    name: (workspace as { name?: string } | null)?.name ?? 'Owner',
    kind: 'owner',
    children: staffChildren,
  };

  const teams = new Set(staff.map((s) => s.department).filter(Boolean));

  return {
    kpis: {
      totalStaff: staff.length,
      humanCount: staff.length,
      aiAgentCount: activeAgents,
      departmentCount: departments.length,
      teamCount: teams.size,
      depth: treeDepth(staffChildren) + 1,
    },
    tree: ownerNode,
  };
}

export async function listStaffWithManagerName(workspaceId: string) {
  const staff = await Staff.find({ workspaceId }).sort({ createdAt: -1 }).lean();
  const byId = new Map(staff.map((s) => [String(s._id), s.name]));
  return staff.map((s) => ({ ...s, managerName: s.managerId ? byId.get(String(s.managerId)) : undefined }));
}

export function isValidObjectId(id: string) {
  return Types.ObjectId.isValid(id);
}
