import { Flame, Sun, Snowflake } from 'lucide-react';
import { Badge } from '../ui/Badge';
import type { Temperature } from '../../types/crm';

const CONFIG: Record<Temperature, { icon: typeof Flame; tone: 'hot' | 'warm' | 'cold' }> = {
  Hot: { icon: Flame, tone: 'hot' },
  Warm: { icon: Sun, tone: 'warm' },
  Cold: { icon: Snowflake, tone: 'cold' },
};

export function TemperatureBadge({ temperature }: { temperature: Temperature }) {
  const { icon: Icon, tone } = CONFIG[temperature];
  return (
    <Badge tone={tone} className="gap-1">
      <Icon className="h-3 w-3" aria-hidden />
      {temperature}
    </Badge>
  );
}
