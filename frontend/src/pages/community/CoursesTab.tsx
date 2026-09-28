import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { listCourses, createCourse, purchaseCourse } from '../../lib/api/community';
import { listContacts } from '../../lib/api/contacts';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

function CreateCourseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');

  const createMutation = useMutation({
    mutationFn: () => createCourse({ name, description, status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-courses'] });
      toast('Course created', { variant: 'success' });
      setName('');
      setDescription('');
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Create Course">
      <div className="space-y-3">
        <Input label={`Name (${name.length}/120)`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Description</label>
          <textarea
            className="min-h-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm outline-none focus:border-[var(--color-primary)]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Status</label>
          <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name || !description} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            <Plus className="h-4 w-4" /> Create Course
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CoursesTab() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const { data: courses, isLoading } = useQuery({ queryKey: ['community-courses'], queryFn: listCourses });
  const { data: contactResults } = useQuery({ queryKey: ['contacts-first-page'], queryFn: () => listContacts({ limit: 20 }) });

  const purchaseMutation = useMutation({
    mutationFn: ({ courseId, contactId }: { courseId: string; contactId: string }) => purchaseCourse(courseId, contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-dashboard'] });
      toast('Enrollment granted', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" /> Create Course
        </Button>
      </div>
      {(courses ?? []).length === 0 ? (
        <Card className="text-sm text-[var(--color-text-muted)]">No courses yet.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(courses ?? []).map((course) => (
            <Card key={course._id} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">{course.name}</p>
                <Badge tone={course.status === 'published' ? 'success' : 'neutral'}>{course.status}</Badge>
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">{course.description}</p>
              {course.status === 'published' && (contactResults?.contacts.length ?? 0) > 0 && (
                <select
                  aria-label={`Enroll a contact in ${course.name}`}
                  className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) purchaseMutation.mutate({ courseId: course._id, contactId: e.target.value });
                  }}
                >
                  <option value="" disabled>
                    Enroll a contact…
                  </option>
                  {contactResults?.contacts.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Card>
          ))}
        </div>
      )}
      <CreateCourseModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
