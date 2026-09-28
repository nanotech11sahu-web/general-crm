import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCommunityProfile, updateCommunityProfile } from '../../lib/api/community';
import { PORTAL_MODULE_KEYS } from '../../types/community';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const MODULE_LABELS: Record<string, string> = {
  courses: 'Courses',
  events: 'Events',
  communityFeed: 'Community Feed',
  chatGroups: 'Chat Groups',
  members: 'Members',
  leaderboard: 'Leaderboard',
  successHabits: 'Success Habits',
  billing: 'Billing',
};

export function MoreTab() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: ['community-profile'], queryFn: getCommunityProfile });
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [modules, setModules] = useState(profile?.portalModules ?? []);

  useEffect(() => {
    if (profile) {
      setName(profile.identity.name);
      setTagline(profile.identity.tagline ?? '');
      setModules(profile.portalModules);
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: () => updateCommunityProfile({ identity: { name, tagline }, portalModules: modules }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-profile'] });
      toast('Community profile saved', { variant: 'success' });
    },
  });

  if (isLoading || !profile) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h4 className="font-semibold">Identity</h4>
        <Input label="Community Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} />
      </Card>
      <Card className="space-y-3">
        <h4 className="font-semibold">Images</h4>
        <p className="text-sm text-[var(--color-text-muted)]">Logo, banner, login banner, and favicon uploads ship alongside the Vault media library (Phase 10).</p>
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Portal Modules</h4>
        {PORTAL_MODULE_KEYS.map((key) => {
          const mod = modules.find((m) => m.key === key);
          return (
            <label key={key} className="flex items-center justify-between text-sm">
              {MODULE_LABELS[key]}
              <input
                type="checkbox"
                checked={mod?.enabled ?? true}
                onChange={(e) =>
                  setModules((prev) => {
                    const next = prev.filter((m) => m.key !== key);
                    next.push({ key, enabled: e.target.checked });
                    return next;
                  })
                }
              />
            </label>
          );
        })}
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Advanced</h4>
        <p className="text-sm text-[var(--color-text-muted)]">SEO meta and custom scripts fields exist on the model and ship a UI in a later polish pass.</p>
      </Card>
      <Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
        Save Community Profile
      </Button>
    </div>
  );
}
