import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type RowDensity = 'compact' | 'normal' | 'relaxed';

export interface ColumnDef {
  id: string;
  label: string;
  /** If true, the column cannot be hidden by the user (e.g. checkbox or primary name) */
  alwaysVisible?: boolean;
  /** Whether the column starts visible by default (default true) */
  defaultVisible?: boolean;
  /** Whether the column is pinned/frozen by default */
  pinned?: boolean;
}

export interface FilterOption {
  value: string;
  label: string;
  dotColor?: string;
  badge?: string;
  icon?: ReactNode;
}

export interface FilterDimension {
  id: string;
  label: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  placeholder?: string;
  /** 'multi' allows multiple selections, 'single' allows picking one value */
  mode?: 'multi' | 'single';
  options: FilterOption[];
}
