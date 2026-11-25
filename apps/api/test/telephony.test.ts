import { describe, expect, it, vi } from 'vitest';
import { parseExotelPayload, TelephonyService } from '../src/channels/telephony.service.js';

describe('Cloud Telephony Integration (Exotel)', () => {
  it('parses incoming Exotel call completion webhook', () => {
    const raw = {
      CallSid: 'call-exotel-123456',
      From: '09876543210',
      To: '02071234567',
      Direction: 'inbound',
      DialCallDuration: '145',
      Status: 'completed',
      RecordingUrl: 'https://s3.ap-south-1.amazonaws.com/exotel-recordings/call-123456.mp3',
      StartTime: '2026-11-24 14:00:00',
      EndTime: '2026-11-24 14:02:25',
    };

    const parsed = parseExotelPayload(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.callSid).toBe('call-exotel-123456');
    expect(parsed!.customerPhone).toBe('09876543210');
    expect(parsed!.durationSeconds).toBe(145);
    expect(parsed!.status).toBe('COMPLETED');
    expect(parsed!.direction).toBe('INBOUND');
    expect(parsed!.recordingUrl).toBe('https://s3.ap-south-1.amazonaws.com/exotel-recordings/call-123456.mp3');
  });

  it('parses outbound rep call to customer', () => {
    const raw = {
      CallSid: 'call-exotel-789012',
      From: '02071234567',
      To: '9812345678',
      Direction: 'outbound-dial',
      DialCallDuration: 42,
      Status: 'busy',
    };

    const parsed = parseExotelPayload(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.customerPhone).toBe('9812345678');
    expect(parsed!.durationSeconds).toBe(42);
    expect(parsed!.status).toBe('BUSY');
    expect(parsed!.direction).toBe('OUTBOUND');
  });

  it('logs call to matching lead timeline and emits outbox event', async () => {
    const mockTx = {
      lead: {
        update: vi.fn().mockResolvedValue({ id: 'lead-101' }),
      },
      leadActivity: {
        create: vi.fn().mockResolvedValue({ id: 'act-1' }),
      },
    };

    const mockDb = {
      tenantTx: vi.fn(async (_ctx, fn) => fn(mockTx)),
    } as any;

    const mockLeads = {
      findDuplicates: vi.fn().mockResolvedValue([{ id: 'lead-101' }]),
    } as any;

    const mockOutbox = {
      emit: vi.fn().mockResolvedValue(undefined),
    } as any;

    const service = new TelephonyService(mockDb, mockLeads, mockOutbox);
    const res = await service.logCall('tenant-1', {
      callSid: 'call-sid-999',
      customerPhone: '+919876543210',
      durationSeconds: 120,
      status: 'COMPLETED',
      direction: 'INBOUND',
      recordingUrl: 'https://exotel.test/rec.mp3',
      timestamp: new Date(),
    });

    expect(res.leadId).toBe('lead-101');
    expect(mockTx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-101' },
      data: expect.objectContaining({ lastContactedAt: expect.any(Date) }),
    });
    expect(mockTx.leadActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'call_logged',
        leadId: 'lead-101',
        data: expect.objectContaining({
          callSid: 'call-sid-999',
          durationSeconds: 120,
          recordingUrl: 'https://exotel.test/rec.mp3',
        }),
      }),
    });
    expect(mockOutbox.emit).toHaveBeenCalledWith(
      mockTx,
      'tenant-1',
      'lead.call_logged',
      expect.objectContaining({
        leadId: 'lead-101',
        callSid: 'call-sid-999',
        durationSeconds: 120,
      }),
    );
  });
});
