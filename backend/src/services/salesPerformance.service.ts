import { Types } from 'mongoose';
import { SalesActivity } from '../models/SalesActivity';
import { Membership } from '../models/Membership';

export interface LeaderboardRow {
  membershipId: string;
  name: string;
  verifiedRevenue: number;
  totalActions: number;
  callsMade: number;
  avgResponseSeconds: number | null;
  activeNow: boolean;
}

const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

export async function buildLeaderboard(workspaceId: string, membershipIds?: string[]): Promise<LeaderboardRow[]> {
  const membershipFilter: Record<string, unknown> = { workspaceId };
  if (membershipIds?.length) membershipFilter._id = { $in: membershipIds };

  const memberships = await Membership.find(membershipFilter).populate('userId', 'name email').lean();
  const now = Date.now();

  const rows: LeaderboardRow[] = [];
  for (const membership of memberships) {
    const activities = await SalesActivity.find({ workspaceId, membershipId: membership._id }).lean();
    const verifiedRevenue = activities.filter((a) => a.type === 'revenue').reduce((sum, a) => sum + (a.amount ?? 0), 0);
    const callsMade = activities.filter((a) => a.type === 'call').length;
    const totalActions = activities.filter((a) => a.type === 'action').length + callsMade;
    const responseTimes = activities.filter((a) => a.type === 'response' && typeof a.responseTimeSeconds === 'number').map((a) => a.responseTimeSeconds as number);
    const avgResponseSeconds = responseTimes.length ? responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length : null;
    const lastActivity = activities.reduce<Date | null>((latest, a) => (!latest || a.createdAt > latest ? a.createdAt : latest), null);
    const activeNow = Boolean(lastActivity && now - lastActivity.getTime() < ACTIVE_WINDOW_MS);

    const user = membership.userId as unknown as { name?: string; email?: string } | Types.ObjectId;
    const name = user && typeof user === 'object' && 'name' in user ? (user.name ?? 'Unknown') : 'Unknown';

    rows.push({ membershipId: String(membership._id), name, verifiedRevenue, totalActions, callsMade, avgResponseSeconds, activeNow });
  }

  return rows.sort((a, b) => b.verifiedRevenue - a.verifiedRevenue);
}
