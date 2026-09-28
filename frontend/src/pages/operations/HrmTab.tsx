import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getHrmDashboard, listStaff, createStaff, listRoles, createRole, listCandidates, createCandidate, listInterviews, createInterview, listLeave, createLeave, decideLeave } from '../../lib/api/hrm';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import { OrgChartView } from './OrgChartView';

const HRM_TABS = ['Dashboard', 'People', 'Hiring', 'More'] as const;
const MORE_SECTIONS = ['Org Chart', 'Leave', 'Attendance', 'Payroll', 'Shifts & Roster', 'Performance', 'Approvals', 'Documents', 'Productivity Hub', 'Announcements'] as const;
const LATER_PHASE_SECTIONS = new Set(['Attendance', 'Payroll', 'Shifts & Roster', 'Performance', 'Approvals', 'Documents', 'Productivity Hub', 'Announcements']);

function DashboardSection() {
  const { data, isLoading } = useQuery({ queryKey: ['hrm-dashboard'], queryFn: getHrmDashboard });
  if (isLoading || !data) return <SkeletonList rows={2} />;
  const tiles = [
    ['Headcount', data.kpis.headcount],
    ['Present Today', data.kpis.presentToday],
    ['Pending Leave', data.kpis.pendingLeave],
    ['Payroll Status', data.kpis.payrollStatus],
    ['Open Approvals', data.kpis.openApprovals],
    ['Document Expiries', data.kpis.documentExpiries],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map(([label, value]) => (
        <Card key={label}>
          <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </Card>
      ))}
    </div>
  );
}

function PeopleSection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const { data: staff, isLoading } = useQuery({ queryKey: ['hrm-people'], queryFn: listStaff });

  const createMutation = useMutation({
    mutationFn: () => createStaff({ name, email, department: department || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrm-people'] });
      queryClient.invalidateQueries({ queryKey: ['hrm-org-chart'] });
      toast('Staff member added', { variant: 'success' });
      setName('');
      setEmail('');
      setDepartment('');
    },
  });

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} />
        <Button disabled={!name || !email} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </Card>
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Department</th>
                <th className="p-3">Manager</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(staff ?? []).map((s) => (
                <tr key={s._id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="p-3">{s.name}</td>
                  <td className="p-3">{s.email}</td>
                  <td className="p-3">{s.department ?? '—'}</td>
                  <td className="p-3">{s.managerName ?? '—'}</td>
                  <td className="p-3">
                    <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function HiringSection() {
  const queryClient = useQueryClient();
  const [roleTitle, setRoleTitle] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const { data: roles, isLoading: rolesLoading } = useQuery({ queryKey: ['hrm-roles'], queryFn: () => listRoles() });
  const { data: candidates } = useQuery({ queryKey: ['hrm-candidates', selectedRoleId], queryFn: () => listCandidates(selectedRoleId || undefined) });
  const { data: interviews } = useQuery({ queryKey: ['hrm-interviews'], queryFn: () => listInterviews() });

  const createRoleMutation = useMutation({
    mutationFn: () => createRole({ title: roleTitle }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrm-roles'] });
      setRoleTitle('');
      toast('Role created', { variant: 'success' });
    },
  });

  const createCandidateMutation = useMutation({
    mutationFn: () => createCandidate({ roleId: selectedRoleId, name: candidateName, email: candidateEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrm-candidates'] });
      setCandidateName('');
      setCandidateEmail('');
      toast('Candidate added', { variant: 'success' });
    },
  });

  const scheduleInterviewMutation = useMutation({
    mutationFn: (candidateId: string) => createInterview({ candidateId, roleId: selectedRoleId, scheduledAt: new Date(Date.now() + 86400000).toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrm-interviews'] });
      toast('Interview scheduled', { variant: 'success' });
    },
  });

  if (rolesLoading) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2">
        <Input label="New role title" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Backend Engineer" />
        <Button disabled={!roleTitle} loading={createRoleMutation.isPending} onClick={() => createRoleMutation.mutate()}>
          <Plus className="h-4 w-4" /> Add Role
        </Button>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {(roles ?? []).map((role) => (
          <Card key={role._id} className={clsx('cursor-pointer space-y-1', selectedRoleId === role._id && 'border-[var(--color-primary)]')} onClick={() => setSelectedRoleId(role._id)}>
            <p className="font-medium">{role.title}</p>
            <div className="flex gap-2 text-xs text-[var(--color-text-muted)]">
              <span>{role.department ?? 'Unassigned'}</span>
              <Badge tone={role.status === 'open' ? 'success' : 'neutral'}>{role.status}</Badge>
              <span>{role.openings} opening(s)</span>
            </div>
          </Card>
        ))}
      </div>

      {selectedRoleId && (
        <Card className="space-y-3">
          <h4 className="font-semibold">Candidates for this role</h4>
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Name" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} />
            <Input label="Email" value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} />
            <Button disabled={!candidateName || !candidateEmail} loading={createCandidateMutation.isPending} onClick={() => createCandidateMutation.mutate()}>
              <Plus className="h-4 w-4" /> Add Candidate
            </Button>
          </div>
          <div className="space-y-2">
            {(candidates ?? []).map((c) => (
              <div key={c._id} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] p-2 text-sm">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{c.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{c.stage}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => scheduleInterviewMutation.mutate(c._id)}>
                    Schedule Interview
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="space-y-2">
        <h4 className="font-semibold">Upcoming Interviews</h4>
        {(interviews ?? []).length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No interviews scheduled.</p>}
        {(interviews ?? []).map((i) => (
          <div key={i._id} className="flex items-center justify-between text-sm">
            <span>{new Date(i.scheduledAt).toLocaleString()}</span>
            <Badge>{i.status}</Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}

function LeaveSection() {
  const queryClient = useQueryClient();
  const { data: staff } = useQuery({ queryKey: ['hrm-people'], queryFn: listStaff });
  const { data: leave, isLoading } = useQuery({ queryKey: ['hrm-leave'], queryFn: () => listLeave() });
  const [staffId, setStaffId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const requestMutation = useMutation({
    mutationFn: () => createLeave({ staffId, startDate, endDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrm-leave'] });
      queryClient.invalidateQueries({ queryKey: ['hrm-dashboard'] });
      toast('Leave requested', { variant: 'success' });
      setStartDate('');
      setEndDate('');
    },
  });

  const decisionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => decideLeave(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrm-leave'] });
      queryClient.invalidateQueries({ queryKey: ['hrm-dashboard'] });
    },
  });

  if (isLoading) return <SkeletonList rows={2} />;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Staff</label>
          <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">Select…</option>
            {(staff ?? []).map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <Input label="Start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <Input label="End" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <Button disabled={!staffId || !startDate || !endDate} loading={requestMutation.isPending} onClick={() => requestMutation.mutate()}>
          Request Leave
        </Button>
      </Card>
      <div className="space-y-2">
        {(leave ?? []).map((l) => (
          <Card key={l._id} className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium">
                {l.type} · {new Date(l.startDate).toLocaleDateString()} – {new Date(l.endDate).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={l.status === 'approved' ? 'success' : l.status === 'rejected' ? 'danger' : 'neutral'}>{l.status}</Badge>
              {l.status === 'pending' && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => decisionMutation.mutate({ id: l._id, status: 'approved' })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decisionMutation.mutate({ id: l._id, status: 'rejected' })}>
                    Reject
                  </Button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function MoreSection() {
  const [section, setSection] = useState<(typeof MORE_SECTIONS)[number]>('Org Chart');
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2">
        {MORE_SECTIONS.map((s) => (
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
      {section === 'Org Chart' && <OrgChartView />}
      {section === 'Leave' && <LeaveSection />}
      {LATER_PHASE_SECTIONS.has(section) && (
        <Card className="text-sm text-[var(--color-text-muted)]">{section} ships in a later phase.</Card>
      )}
    </div>
  );
}

export function HrmTab() {
  const [tab, setTab] = useState<(typeof HRM_TABS)[number]>('Dashboard');
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" aria-label="HRM tabs">
        {HRM_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === 'Dashboard' && <DashboardSection />}
      {tab === 'People' && <PeopleSection />}
      {tab === 'Hiring' && <HiringSection />}
      {tab === 'More' && <MoreSection />}
    </div>
  );
}
