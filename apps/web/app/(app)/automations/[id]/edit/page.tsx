'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';

const AutomationEditor = dynamic(() => import('@/components/automation-builder/automation-editor').then((m) => m.AutomationEditor), { ssr: false, loading: () => <Skeleton className="h-96" /> });

export default function EditAutomationPage() {
  const { id } = useParams<{ id: string }>();
  return <AutomationEditor id={id} />;
}
