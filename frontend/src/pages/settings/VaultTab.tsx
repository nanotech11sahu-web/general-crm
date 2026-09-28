import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { listVaultFiles, listVaultFolders, uploadVaultFile, deleteVaultFile } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function VaultTab() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState('General');
  const { data, isLoading } = useQuery({ queryKey: ['vault-files'], queryFn: () => listVaultFiles() });
  const { data: folders } = useQuery({ queryKey: ['vault-folders'], queryFn: listVaultFolders });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await readFileAsBase64(file);
      return uploadVaultFile({ folder, filename: file.name, mimeType: file.type || 'application/octet-stream', dataBase64 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vault-files'] });
      queryClient.invalidateQueries({ queryKey: ['vault-folders'] });
      toast('File uploaded', { variant: 'success' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteVaultFile(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vault-files'] }),
  });

  if (isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)} />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) uploadMutation.mutate(e.target.files[0]);
              e.target.value = '';
            }}
          />
          <Button size="sm" loading={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">Storage used: {formatBytes(data?.storageUsedBytes ?? 0)}</p>
      </Card>
      {(folders?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">Folders: {folders?.join(', ')}</div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {(data?.files ?? []).length === 0 && <Card className="text-sm text-[var(--color-text-muted)]">No files uploaded yet.</Card>}
        {(data?.files ?? []).map((f) => (
          <Card key={f._id} className="space-y-1">
            <p className="truncate text-sm font-medium">{f.filename}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {f.folder} · {formatBytes(f.sizeBytes)}
            </p>
            <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(f._id)}>
              Delete
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
