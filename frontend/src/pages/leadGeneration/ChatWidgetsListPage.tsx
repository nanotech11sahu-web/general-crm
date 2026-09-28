import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus } from 'lucide-react';
import { listChatWidgets, activateChatWidget } from '../../lib/api/chatWidgets';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ChatWidgetWizard } from '../../components/leadGeneration/ChatWidgetWizard';
import { toast } from '../../stores/toastStore';

export function ChatWidgetsListPage() {
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: widgets, isLoading } = useQuery({ queryKey: ['chat-widgets'], queryFn: listChatWidgets });

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateChatWidget(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-widgets'] });
      toast('Widget activated', { variant: 'success' });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Chat Widgets</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4" /> Create
        </Button>
      </div>

      {isLoading && <SkeletonList rows={3} />}

      {!isLoading && widgets?.length === 0 && (
        <EmptyState icon={MessageSquare} title="No chat widgets yet" description="Create a widget to start capturing leads from live chat." actionLabel="Create" onAction={() => setWizardOpen(true)} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets?.map((widget) => (
          <Card key={widget._id}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{widget.name}</h3>
              <Badge tone={widget.status === 'active' ? 'success' : 'neutral'}>{widget.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{widget.branding.companyName}</p>
            {widget.status === 'draft' && (
              <Button size="sm" variant="secondary" className="mt-3" loading={activateMutation.isPending} onClick={() => activateMutation.mutate(widget._id)}>
                Activate
              </Button>
            )}
          </Card>
        ))}
      </div>

      <ChatWidgetWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
