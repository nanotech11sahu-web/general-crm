import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Globe, MessageSquare, FileText, Megaphone, Share2, Search, Link2 } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

const TOOLS = [
  { key: 'ecom', name: 'Ecom', description: 'Launch a store and sell products.', icon: ShoppingBag, to: '/lead-generation/ecom' },
  { key: 'sites', name: 'Sites', description: 'Build funnels and landing pages.', icon: Globe, to: '/lead-generation/sites' },
  { key: 'chat-widget', name: 'Chat Widget', description: 'Capture leads with live chat.', icon: MessageSquare, to: '/lead-generation/chat-widget' },
  { key: 'forms', name: 'Forms', description: 'Collect leads with custom forms.', icon: FileText, to: '/lead-generation/forms' },
  { key: 'ad-launcher', name: 'Ad Launcher', description: 'Run and optimize ad campaigns.', icon: Megaphone, to: '/lead-generation/ad-launcher' },
  { key: 'ai-social', name: 'AI Social', description: 'Plan and publish social content.', icon: Share2, to: '/lead-generation/ai-social' },
  { key: 'vibe-prospecting', name: 'Vibe Prospecting', description: 'Find new leads with AI search.', icon: Search, to: '/lead-generation/vibe-prospecting', badge: 'NEW' },
  { key: 'urls', name: 'URLs', description: 'Shorten and track links.', icon: Link2, to: '/lead-generation/urls' },
];

export function LeadGenerationHome() {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {TOOLS.map((tool) => (
        <Card
          key={tool.key}
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => navigate(tool.to)}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <tool.icon className="h-5 w-5" aria-hidden />
            </div>
            {tool.badge && <Badge tone="success">{tool.badge}</Badge>}
          </div>
          <h3 className="mt-3 font-semibold">{tool.name}</h3>
          <p className="text-sm text-[var(--color-text-muted)]">{tool.description}</p>
        </Card>
      ))}
    </div>
  );
}
