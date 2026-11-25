'use client';

import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useHelpTour } from './help-tour-provider';

export function HelpTourButton() {
  const { hasTourForCurrentRoute, isCurrentRouteSeen, startTour } = useHelpTour();

  if (!hasTourForCurrentRoute) return null;

  return (
    <Tooltip label="Page help tour" side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Start page help tour"
        onClick={() => startTour()}
        className="relative"
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
        {!isCurrentRouteSeen ? (
          <span
            aria-hidden
            className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-header"
          />
        ) : null}
      </Button>
    </Tooltip>
  );
}
