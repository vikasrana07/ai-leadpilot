import { Hammer } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page/page-header';
import { ALL_NAV } from '@/lib/nav';

const PHASES: Record<number, string> = { 2: 'CRM', 3: 'Communication', 4: 'AI', 5: 'Automation & appointments', 6: 'SaaS & billing' };

export function ComingSoon({ href }: { href: string }) {
  const item = ALL_NAV.find((n) => n.href === href);
  if (!item) return null;
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <Card><EmptyState icon={item.icon === undefined ? Hammer : item.icon} title={`${item.label} is not built yet`} description={`This module ships in phase ${item.phase} (${PHASES[item.phase] ?? 'later'}). Nothing here is connected to data yet, so it is intentionally empty.`} /></Card>
    </>
  );
}
