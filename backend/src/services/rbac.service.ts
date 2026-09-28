import { Types } from 'mongoose';
import { Membership } from '../models/Membership';
import { Role } from '../models/Role';
import { LeadershipTitle } from '../models/LeadershipTitle';
import { MODULES, PERMISSION_ACTIONS, ModuleKey, PermissionAction, PermissionMap, emptyPermissionMap, fullPermissionMap } from '../constants/modules';

export async function resolveEffectivePermissions(
  membershipId: Types.ObjectId | string,
): Promise<PermissionMap> {
  const membership = await Membership.findById(membershipId).lean();
  if (!membership) return emptyPermissionMap();

  const role = await Role.findById(membership.roleId).lean();
  const base = role ? (role.permissions as PermissionMap) : emptyPermissionMap();
  if (role?.isSystem) {
    // Owner role: full access always
    return fullPermissionMap();
  }

  const effective: PermissionMap = emptyPermissionMap();
  for (const mod of MODULES) {
    effective[mod] = { ...base[mod] };
  }

  if (membership.leadershipTitleIds?.length) {
    const titles = await LeadershipTitle.find({ _id: { $in: membership.leadershipTitleIds } }).lean();
    for (const title of titles) {
      for (const mod of MODULES) {
        const override = title.overrides?.[mod as ModuleKey];
        if (!override) continue;
        for (const action of PERMISSION_ACTIONS) {
          if (override[action] === true) {
            effective[mod][action] = true;
          }
        }
      }
    }
  }

  return effective;
}

export function hasPermission(map: PermissionMap, mod: ModuleKey, action: PermissionAction): boolean {
  return Boolean(map[mod]?.[action]);
}
