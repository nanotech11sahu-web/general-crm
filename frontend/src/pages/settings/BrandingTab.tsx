import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBranding, updateBranding } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

export function BrandingTab() {
  const queryClient = useQueryClient();
  const { data: branding, isLoading } = useQuery({ queryKey: ['branding'], queryFn: getBranding });
  const [experienceName, setExperienceName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#4f46e5');
  const [loaderText, setLoaderText] = useState('');
  const [mobileNavLocked, setMobileNavLocked] = useState(false);

  useEffect(() => {
    if (branding) {
      setExperienceName(branding.experienceName);
      setPrimaryColor(branding.primaryColor);
      setLoaderText(branding.loaderText ?? '');
      setMobileNavLocked(branding.mobileNavLocked);
    }
  }, [branding]);

  const saveMutation = useMutation({
    mutationFn: () => updateBranding({ experienceName, primaryColor, loaderText, mobileNavLocked }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branding'] });
      toast('Branding saved — reflected live in the sidebar', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h4 className="font-semibold">Identity & Experience</h4>
        <Input label="Experience Name" value={experienceName} onChange={(e) => setExperienceName(e.target.value)} />
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">Primary Color</label>
          <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-9 w-14 cursor-pointer rounded" />
          <span className="font-mono text-sm">{primaryColor}</span>
        </div>
        <Input label="Loader Text" value={loaderText} onChange={(e) => setLoaderText(e.target.value)} />
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Images</h4>
        <p className="text-sm text-[var(--color-text-muted)]">Logo (light/dark), favicon, and login banner uploads use the Vault media library.</p>
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Mobile</h4>
        <label className="flex items-center justify-between text-sm">
          Lock mobile nav for sub-accounts (agency-level)
          <input type="checkbox" checked={mobileNavLocked} onChange={(e) => setMobileNavLocked(e.target.checked)} />
        </label>
      </Card>
      <Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
        Save Branding
      </Button>
    </div>
  );
}
