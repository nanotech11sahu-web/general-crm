import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { listRoles, createRole, updateRole, listLeadershipTitles, createLeadershipTitle } from '../../lib/api/settings';
import { MODULES, PERMISSION_ACTIONS, type PermissionAction } from '../../types/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

function permissionCount(perms: Record<string, Record<PermissionAction, boolean>>): number {
  return Object.values(perms).reduce((sum, m) => sum + PERMISSION_ACTIONS.filter((a) => m?.[a]).length, 0);
}

function RoleCard({ role }: { role: { _id: string; name: string; isSystem: boolean; permissions: Record<string, Record<PermissionAction, boolean>> } }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: (payload: { mod: string; action: PermissionAction; value: boolean }) =>
      updateRole(role._id, { permissions: { [payload.mod]: { [payload.action]: payload.value } } as never }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  });

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="font-medium">{role.name}</p>
          {role.isSystem && <Badge tone="neutral">System</Badge>}
        </div>
        <button type="button" className="text-sm text-[var(--color-primary)]" onClick={() => setExpanded((v) => !v)}>
          {permissionCount(role.permissions)} grants — {expanded ? 'Hide' : 'Edit'}
        </button>
      </div>
      {expanded && !role.isSystem && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="p-1 text-left">Module</th>
                {PERMISSION_ACTIONS.map((a) => (
                  <th key={a} className="p-1 capitalize">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((mod) => (
                <tr key={mod} className="border-t border-[var(--color-border)]">
                  <td className="p-1">{mod}</td>
                  {PERMISSION_ACTIONS.map((action) => (
                    <td key={action} className="p-1 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${role.name} ${mod} ${action}`}
                        checked={role.permissions[mod]?.[action] ?? false}
                        onChange={(e) => toggleMutation.mutate({ mod, action, value: e.target.checked })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function RolesTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const { data: titles } = useQuery({ queryKey: ['leadership-titles'], queryFn: listLeadershipTitles });
  const [roleName, setRoleName] = useState('');
  const [titleName, setTitleName] = useState('');

  const createRoleMutation = useMutation({
    mutationFn: () => createRole({ name: roleName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setRoleName('');
      toast('Role created', { variant: 'success' });
    },
  });

  const createTitleMutation = useMutation({
    mutationFn: () => createLeadershipTitle({ name: titleName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leadership-titles'] });
      setTitleName('');
      toast('Leadership title created', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2">
        <Input label="New role name" value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="Sales Rep" />
        <Button size="sm" disabled={!roleName} loading={createRoleMutation.isPending} onClick={() => createRoleMutation.mutate()}>
          <Plus className="h-4 w-4" /> Create Role
        </Button>
      </Card>
      <div className="space-y-2">
        {(data?.roles ?? []).map((role) => (
          <RoleCard key={role._id} role={role as never} />
        ))}
      </div>
      <Card className="space-y-2">
        <h4 className="font-semibold">Leadership Titles (additive overrides)</h4>
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Title name" value={titleName} onChange={(e) => setTitleName(e.target.value)} placeholder="Team Lead" />
          <Button size="sm" disabled={!titleName} loading={createTitleMutation.isPending} onClick={() => createTitleMutation.mutate()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
        <ul className="text-sm">
          {(titles ?? []).map((t) => (
            <li key={t._id}>{t.name}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
