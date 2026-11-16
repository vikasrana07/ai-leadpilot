'use client';

import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useTheme, type ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeSwitcher() {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = resolved === 'dark' ? Moon : Sun;
  return (
    <Dropdown trigger={<Button variant="ghost" size="icon" aria-label="Change theme"><Icon className="h-4 w-4" /></Button>}>
      {OPTIONS.map((o) => (
        <DropdownItem key={o.value} onSelect={() => setPreference(o.value)}>
          <o.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="flex-1">{o.label}</span>
          {preference === o.value ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
