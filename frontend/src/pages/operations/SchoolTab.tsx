import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Plus } from 'lucide-react';
import {
  getSchoolDashboard,
  getSetupProgress,
  listAcademicYears,
  createAcademicYear,
  listClasses,
  createClass,
  listSubjects,
  createSubject,
  listStudents,
  createStudent,
  getPortalAccess,
} from '../../lib/api/school';
import { listStaff } from '../../lib/api/hrm';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const SCHOOL_TABS = ['Dashboard', 'Academics', 'People', 'More', 'Portal Access'] as const;

function SetupProgressCard() {
  const { data, isLoading } = useQuery({ queryKey: ['school-setup-progress'], queryFn: getSetupProgress });
  if (isLoading || !data) return <SkeletonList rows={2} />;
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Setup Progress</h3>
        <Badge tone={data.fullFunctionality ? 'success' : 'warning'}>{data.fullFunctionality ? 'Full functionality unlocked' : 'Setup incomplete'}</Badge>
      </div>
      <ul className="space-y-1.5">
        {data.items.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-sm">
            {item.complete ? <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" /> : <Circle className="h-4 w-4 text-[var(--color-text-muted)]" />}
            <span className={item.complete ? '' : 'text-[var(--color-text-muted)]'}>{item.label}</span>
            {item.required && <Badge tone="neutral">required</Badge>}
            <span className="text-xs text-[var(--color-text-muted)]">({item.count})</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DashboardSection() {
  const { data, isLoading } = useQuery({ queryKey: ['school-dashboard'], queryFn: getSchoolDashboard });
  return (
    <div className="space-y-4">
      <SetupProgressCard />
      {isLoading || !data ? (
        <SkeletonList rows={2} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Students', data.kpis.students],
            ['Teachers', data.kpis.teachers],
            ['Classes', data.kpis.classes],
            ['Attendance %', data.kpis.attendancePercent],
            ['Events Today', data.kpis.eventsToday],
          ].map(([label, value]) => (
            <Card key={label as string} className="text-center">
              <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
              <p className="text-xl font-semibold">{value}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AcademicsSection() {
  const queryClient = useQueryClient();
  const { data: years } = useQuery({ queryKey: ['school-years'], queryFn: listAcademicYears });
  const { data: classes } = useQuery({ queryKey: ['school-classes'], queryFn: listClasses });
  const { data: subjects } = useQuery({ queryKey: ['school-subjects'], queryFn: listSubjects });

  const [yearName, setYearName] = useState('');
  const [className, setClassName] = useState('');
  const [subjectName, setSubjectName] = useState('');

  const yearMutation = useMutation({
    mutationFn: () => createAcademicYear({ name: yearName, startDate: new Date().toISOString(), endDate: new Date(Date.now() + 31536000000).toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['school-years'] });
      queryClient.invalidateQueries({ queryKey: ['school-setup-progress'] });
      setYearName('');
      toast('Academic year added', { variant: 'success' });
    },
  });

  const classMutation = useMutation({
    mutationFn: () => createClass({ name: className }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['school-classes'] });
      queryClient.invalidateQueries({ queryKey: ['school-setup-progress'] });
      setClassName('');
      toast('Class added', { variant: 'success' });
    },
  });

  const subjectMutation = useMutation({
    mutationFn: () => createSubject({ name: subjectName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['school-subjects'] });
      queryClient.invalidateQueries({ queryKey: ['school-setup-progress'] });
      setSubjectName('');
      toast('Subject added', { variant: 'success' });
    },
  });

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card className="space-y-2">
        <h4 className="font-semibold">Academic Years</h4>
        <div className="flex gap-2">
          <Input value={yearName} onChange={(e) => setYearName(e.target.value)} placeholder="2026-27" />
          <Button size="sm" disabled={!yearName} loading={yearMutation.isPending} onClick={() => yearMutation.mutate()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ul className="text-sm">
          {(years ?? []).map((y) => (
            <li key={y._id}>{y.name}</li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Classes & Sections</h4>
        <div className="flex gap-2">
          <Input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="Grade 5" />
          <Button size="sm" disabled={!className} loading={classMutation.isPending} onClick={() => classMutation.mutate()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ul className="text-sm">
          {(classes ?? []).map((c) => (
            <li key={c._id}>
              {c.name} ({c.sections.join(', ')})
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Subjects</h4>
        <div className="flex gap-2">
          <Input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="Mathematics" />
          <Button size="sm" disabled={!subjectName} loading={subjectMutation.isPending} onClick={() => subjectMutation.mutate()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ul className="text-sm">
          {(subjects ?? []).map((s) => (
            <li key={s._id}>{s.name}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function PeopleSection() {
  const queryClient = useQueryClient();
  const { data: staff } = useQuery({ queryKey: ['hrm-people'], queryFn: listStaff });
  const { data: students } = useQuery({ queryKey: ['school-students'], queryFn: listStudents });
  const teachers = (staff ?? []).filter((s) => s.isTeacher);
  const [studentName, setStudentName] = useState('');

  const studentMutation = useMutation({
    mutationFn: () => createStudent({ name: studentName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['school-students'] });
      queryClient.invalidateQueries({ queryKey: ['school-setup-progress'] });
      queryClient.invalidateQueries({ queryKey: ['school-dashboard'] });
      setStudentName('');
      toast('Student admitted', { variant: 'success' });
    },
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="space-y-2">
        <h4 className="font-semibold">Teachers ({teachers.length})</h4>
        <p className="text-xs text-[var(--color-text-muted)]">Synced from HRM Staff, marked as teachers.</p>
        <ul className="text-sm">
          {teachers.map((t) => (
            <li key={t._id}>{t.name}</li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Students ({(students ?? []).length})</h4>
        <div className="flex gap-2">
          <Input value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Student name" />
          <Button size="sm" disabled={!studentName} loading={studentMutation.isPending} onClick={() => studentMutation.mutate()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ul className="text-sm">
          {(students ?? []).map((s) => (
            <li key={s._id}>{s.name}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function PortalAccessSection() {
  const { data, isLoading } = useQuery({ queryKey: ['school-portal-access'], queryFn: getPortalAccess });
  if (isLoading) return <SkeletonList rows={2} />;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {(data ?? []).map((p) => (
        <Card key={p.role} className="capitalize">
          <p className="font-medium">{p.role} portal</p>
          <p className="text-sm text-[var(--color-text-muted)]">
            {p.accountsEnabled} / {p.total} accounts enabled
          </p>
        </Card>
      ))}
    </div>
  );
}

export function SchoolTab() {
  const [tab, setTab] = useState<(typeof SCHOOL_TABS)[number]>('Dashboard');
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" aria-label="School tabs">
        {SCHOOL_TABS.map((t) => (
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
      {tab === 'Academics' && <AcademicsSection />}
      {tab === 'People' && <PeopleSection />}
      {tab === 'More' && <Card className="text-sm text-[var(--color-text-muted)]">Timetables and Curriculum ship in a later phase.</Card>}
      {tab === 'Portal Access' && <PortalAccessSection />}
    </div>
  );
}
