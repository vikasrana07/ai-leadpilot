'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

// The editor is large (forms, outline, dialogs): load it only on the screens that need it, so the automations list stays light.
const AutomationEditor = dynamic(() => import('@/components/automation-builder/automation-editor').then((m) => m.AutomationEditor), { ssr: false, loading: () => <Skeleton className="h-96" /> });

export default function NewAutomationPage() { return <AutomationEditor />; }
