import type { Temperature } from '@leadpilot/shared-types';
import { Badge } from '@/components/ui/badge';
import { TEMPERATURE_LABELS } from '@/lib/format';

export function TemperatureBadge({ value }: { value: Temperature }) {
  if (value === 'UNKNOWN') return <Badge>Unscored</Badge>;
  return <Badge tone={value === 'HOT' ? 'danger' : value === 'WARM' ? 'warning' : 'neutral'}>{TEMPERATURE_LABELS[value]}</Badge>;
}

export function StageBadge({ name, kind }: { name: string; kind: string }) {
  return <Badge tone={kind === 'WON' ? 'success' : kind === 'LOST' ? 'danger' : 'primary'}>{name}</Badge>;
}
