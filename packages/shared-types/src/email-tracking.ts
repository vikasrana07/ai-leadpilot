export interface TrackedEmailDto {
  id: string;
  tenantId: string;
  leadId: string | null;
  leadName?: string | null;
  recipient: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'OPENED' | 'CLICKED' | 'BOUNCED' | 'COMPLAINED' | 'REJECTED' | 'SUPPRESSED' | 'FAILED';
  sesMessageId: string | null;
  smtpMessageId: string | null;
  openCount: number;
  clickCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  bounceType: string | null;
  bounceSubType: string | null;
  complaintAt: string | null;
  complaintFeedbackType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EmailEngagementEventDto {
  id: string;
  type: 'SEND' | 'DELIVERY' | 'OPEN' | 'CLICK' | 'BOUNCE' | 'COMPLAINT' | 'REJECT';
  timestamp: string;
  ipAddress: string | null;
  userAgent: string | null;
  clickUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface TrackedEmailDetailDto extends TrackedEmailDto {
  events: EmailEngagementEventDto[];
}

export interface EmailEngagementStatsDto {
  totalSent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  suppressed: number;
  deliveryRatePercent: number;
  openRatePercent: number;
  clickRatePercent: number;
  bounceRatePercent: number;
}

export interface EmailSuppressionDto {
  id: string;
  tenantId: string;
  email: string;
  reason: 'HARD_BOUNCE' | 'COMPLAINT' | 'UNSUBSCRIBED' | 'MANUAL';
  source: string;
  notes: string | null;
  createdAt: string;
}
