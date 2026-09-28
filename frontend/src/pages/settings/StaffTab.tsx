import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { listMembers, inviteMember, listRoles, listDepartments, createDepartment } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const SECTIONS = ['Members', 'Departments'] as const;

function MembersSection() {
  const queryClient = useQueryClient();
  const { data: members, isLoading } = useQuery({ queryKey: ['members'], queryFn: listMembers });
  const { data: rolesData } = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');

  const inviteMutation = useMutation({
    mutationFn: () => inviteMember({ name, email, roleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      toast('Member invited', { variant: 'success' });
      setName('');
      setEmail('');
      setRoleId('');
    },
  });

  if (isLoading) return <SkeletonList rows={2} />;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Role</label>
          <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Select…</option>
            {(rolesData?.roles ?? []).map((r) => (
              <option key={r._id} value={r._id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" disabled={!name || !email || !roleId} loading={inviteMutation.isPending} onClick={() => inviteMutation.mutate()}>
          <Plus className="h-4 w-4" /> Invite
        </Button>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Email</th>
              <th className="p-3">Role</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => (
              <tr key={m._id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="p-3">{m.userId.name}</td>
                <td className="p-3">{m.userId.email}</td>
                <td className="p-3">{m.roleId.name}</td>
                <td className="p-3">
                  <Badge tone={m.status === 'active' ? 'success' : 'neutral'}>{m.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function DepartmentsSection() {
  const queryClient = useQueryClient();
  const { data: departments, isLoading } = useQuery({ queryKey: ['settings-departments'], queryFn: listDepartments });
  const [name, setName] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createDepartment(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-departments'] });
      setName('');
      toast('Department added', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={2} />;

  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Input label="Department name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" disabled={!name} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
      <ul className="text-sm">
        {(departments ?? []).map((d) => (
          <li key={d._id}>{d.name}</li>
        ))}
      </ul>
    </Card>
  );
}

export function StaffTab() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('Members');
  return (
    <div className="space-y-4">
      <nav className="flex gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              section === s ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]',
            )}
          >
            {s}
          </button>
        ))}
      </nav>
      {section === 'Members' && <MembersSection />}
      {section === 'Departments' && <DepartmentsSection />}
    </div>
  );
}
