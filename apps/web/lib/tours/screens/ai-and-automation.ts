import type { ScreenTour } from '../types';

export const AI_AND_AUTOMATION_TOURS: ScreenTour[] = [
  {
    id: 'ai-assistant',
    route: '/ai-assistant',
    title: 'AI Assistant',
    buildSteps: (terms) => [
      {
        id: 'ai-overview',
        title: 'Configure your AI assistant',
        description: `Shape how your AI greets ${terms.leads}, qualifies intent, and hands off to your team.`,
        placement: 'center',
      },
      {
        id: 'ai-persona',
        target: 'ai-persona',
        title: 'Persona & tone',
        description: 'Set the assistant name, language style, greeting, and escalation rules.',
        placement: 'bottom',
      },
      {
        id: 'ai-scoring',
        target: 'ai-scoring',
        title: `${terms.Lead} scoring & qualification`,
        description: `Define the questions and scoring weights used to classify ${terms.leads} as Hot, Warm, or Cold.`,
        placement: 'top',
      },
      {
        id: 'ai-sandbox',
        target: 'ai-sandbox',
        title: 'Test your assistant live',
        description: 'Simulate a conversation here to verify replies and knowledge grounding before going live.',
        placement: 'left',
      },
    ],
  },
  {
    id: 'knowledge',
    route: '/knowledge',
    title: 'Knowledge Base',
    buildSteps: () => [
      {
        id: 'knowledge-overview',
        title: 'Ground AI answers in your docs',
        description: 'Upload brochures, FAQs, pricing sheets, or web URLs so your AI assistant answers accurately.',
        placement: 'center',
      },
      {
        id: 'knowledge-upload',
        target: 'knowledge-upload',
        title: 'Add knowledge sources',
        description: 'Upload PDFs, text files, or paste URLs to index them into your workspace knowledge base.',
        placement: 'bottom',
      },
      {
        id: 'knowledge-list',
        target: 'knowledge-list',
        title: 'Indexed documents & status',
        description: 'Check indexing progress, preview chunks, or remove outdated documents.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'appointments',
    route: '/appointments',
    title: 'Appointments',
    buildSteps: (terms) => [
      {
        id: 'appointments-overview',
        title: `${terms.Visits} & scheduling`,
        description: `Book, reschedule, and track ${terms.visits} without double-booking your team.`,
        placement: 'center',
      },
      {
        id: 'appointments-actions',
        target: 'appointments-actions',
        title: `Book ${terms.aVisit}`,
        description: `Schedule a new ${terms.visit} for any ${terms.lead} and assign a host or practitioner.`,
        placement: 'bottom',
      },
      {
        id: 'appointments-list',
        target: 'appointments-list',
        title: 'Calendar & status controls',
        description: 'Switch views, mark attendance, or trigger no-show recovery follow-ups.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'tasks',
    route: '/tasks',
    title: 'Tasks',
    buildSteps: (terms) => [
      {
        id: 'tasks-overview',
        title: 'Follow-ups & team to-dos',
        description: `Stay on top of manual follow-ups and tasks created automatically for ${terms.leads}.`,
        placement: 'center',
      },
      {
        id: 'tasks-filters',
        target: 'tasks-filters',
        title: 'Filter by due state & owner',
        description: 'Focus on overdue, due today, upcoming, or completed tasks across your team.',
        placement: 'bottom',
      },
      {
        id: 'tasks-list',
        target: 'tasks-list',
        title: 'Complete or add tasks',
        description: `Check off tasks inline or click into the linked ${terms.lead} for full context.`,
        placement: 'top',
      },
    ],
  },
  {
    id: 'automations',
    route: '/automations',
    title: 'Automations',
    buildSteps: () => [
      {
        id: 'automations-overview',
        title: 'Automated workflows',
        description: 'Build event-driven workflows for instant WhatsApp replies, task assignments, and stage alerts.',
        placement: 'center',
      },
      {
        id: 'automations-create',
        target: 'automations-create',
        title: 'Create or pick a template',
        description: 'Start from a blank visual canvas or launch a pre-built industry template.',
        placement: 'bottom',
      },
      {
        id: 'automations-list',
        target: 'automations-list',
        title: 'Manage active workflows',
        description: 'Pause, resume, inspect run history, or open any workflow in the visual editor.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'automations-new',
    route: '/automations/new',
    title: 'New Automation',
    buildSteps: () => [
      {
        id: 'automations-new-header',
        target: 'automations-new-header',
        title: 'Name & publish controls',
        description: 'Give your workflow a clear name, test or validate connections, and publish when ready.',
        placement: 'bottom',
      },
      {
        id: 'automations-new-palette',
        target: 'automations-new-palette',
        title: 'Triggers, conditions & actions',
        description: 'Add trigger events, branching conditions, delays, WhatsApp/email actions, or webhook calls.',
        placement: 'right',
      },
      {
        id: 'automations-new-canvas',
        target: 'automations-new-canvas',
        title: 'Visual workflow canvas',
        description: 'Connect nodes on the canvas and click any node to configure its parameters.',
        placement: 'left',
      },
    ],
  },
  {
    id: 'automations-edit',
    route: '/automations/[id]/edit',
    title: 'Edit Automation',
    buildSteps: () => [
      {
        id: 'automations-edit-header',
        target: 'automations-edit-header',
        title: 'Save, toggle & run history',
        description: 'Update the workflow, toggle it active/paused, or switch to inspect recent execution runs.',
        placement: 'bottom',
      },
      {
        id: 'automations-edit-canvas',
        target: 'automations-edit-canvas',
        title: 'Interactive graph & run overlay',
        description: 'Edit nodes and edges, or select a past run to highlight the exact execution path and node outputs.',
        placement: 'top',
      },
    ],
  },
  {
    id: 'reports',
    route: '/reports',
    title: 'Reports & Analytics',
    buildSteps: (terms) => [
      {
        id: 'reports-overview',
        title: 'Performance analytics',
        description: `Measure ${terms.lead} conversion, response times, AI deflection, and team productivity.`,
        placement: 'center',
      },
      {
        id: 'reports-controls',
        target: 'reports-controls',
        title: 'Date range & CSV export',
        description: 'Slice metrics by time window and export clean CSV reports for leadership reviews.',
        placement: 'bottom',
      },
      {
        id: 'reports-charts',
        target: 'reports-charts',
        title: 'Conversion & team charts',
        description: 'Compare stage funnels, channel attribution, and agent response SLAs.',
        placement: 'top',
      },
    ],
  },
];
