import { useNavigate } from 'react-router-dom';
import { Mail, MessageCircle, Workflow, Megaphone } from 'lucide-react';
import { Card } from '../../components/ui/Card';

const TOOLS = [
  { key: 'email', name: 'Email Marketing', description: '11 modules — dashboard, compose, segments, templates, analytics, SMTP.', icon: Mail, to: '/lead-automation/email' },
  { key: 'waba', name: 'WABA', description: '8 modules — setup, compliance, templates, dashboard.', icon: MessageCircle, to: '/lead-automation/waba' },
  { key: 'automation', name: 'Automation', description: '5 modules — ChatFlow + Workflow builder, triggers, execution logs.', icon: Workflow, to: '/lead-automation/workflows' },
  { key: 'bulk', name: 'Bulk Campaigns', description: 'Multi-channel campaigns across WABA + Email.', icon: Megaphone, to: '/lead-automation/bulk-campaigns' },
];

export function LeadAutomationHome() {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {TOOLS.map((tool) => (
        <Card key={tool.key} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => navigate(tool.to)}>
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <tool.icon className="h-5 w-5" aria-hidden />
          </div>
          <h3 className="mt-3 font-semibold">{tool.name}</h3>
          <p className="text-sm text-[var(--color-text-muted)]">{tool.description}</p>
        </Card>
      ))}
    </div>
  );
}
