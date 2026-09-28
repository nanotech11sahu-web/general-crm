import { useQuery } from '@tanstack/react-query';
import { getCommunityDashboard } from '../../lib/api/community';
import { Card } from '../../components/ui/Card';
import { SkeletonList } from '../../components/ui/Skeleton';

export function DashboardTab() {
  const { data, isLoading } = useQuery({ queryKey: ['community-dashboard'], queryFn: getCommunityDashboard });
  if (isLoading || !data) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Total Courses', data.kpis.totalCourses],
          ['Enrollments', data.kpis.enrollments],
          ['Active Members', data.kpis.activeMembers],
          ['Revenue', `₹${data.kpis.revenue.toLocaleString()}`],
        ].map(([label, value]) => (
          <Card key={label as string} className="text-center">
            <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
            <p className="text-xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-2">
          <h4 className="font-semibold">Engagement</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <p>Feed Posts: {data.engagement.feedPosts}</p>
            <p>Messages: {data.engagement.messages}</p>
            <p>Channels: {data.engagement.channels}</p>
            <p>Events: {data.engagement.events}</p>
          </div>
        </Card>
        <Card className="space-y-2">
          <h4 className="font-semibold">Top Courses</h4>
          <ul className="text-sm">
            {data.topCourses.length === 0 && <p className="text-[var(--color-text-muted)]">No enrollments yet.</p>}
            {data.topCourses.map((c) => (
              <li key={c.courseId} className="flex justify-between">
                <span>{c.name}</span>
                <span className="text-[var(--color-text-muted)]">{c.enrollments} enrolled</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="space-y-2">
        <h4 className="font-semibold">Top Members by XP</h4>
        <ol className="space-y-1 text-sm">
          {data.topMembers.length === 0 && <p className="text-[var(--color-text-muted)]">No members yet.</p>}
          {data.topMembers.map((m, i) => (
            <li key={m.contactId} className="flex justify-between">
              <span>
                #{i + 1} {m.contactId}
              </span>
              <span className="font-medium">{m.xp} XP</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
