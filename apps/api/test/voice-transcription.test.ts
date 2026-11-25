import { describe, expect, it, vi } from 'vitest';
import { MockVoiceTranscriptionProvider, VoiceTranscriptionService } from '../src/conversations/voice-transcription.service.js';

describe('Voice Transcription Service', () => {
  it('MockVoiceTranscriptionProvider returns deterministic Hindi/Hinglish real estate enquiry', async () => {
    const provider = new MockVoiceTranscriptionProvider();
    const result = await provider.transcribe(Buffer.from('fake-audio-bytes'), 'audio/ogg');

    expect(result.text).toContain('Baner mein 2 BHK');
    expect(result.text).toContain('80 lakh');
    expect(result.language).toBe('hi-IN');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('transcribes voice note and updates message body, preview and triggers AI', async () => {
    const mockTx = {
      message: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'msg-audio-1',
          conversationId: 'convo-1',
          media: { originalMime: 'audio/ogg' },
        }),
        update: vi.fn().mockResolvedValue({ id: 'msg-audio-1' }),
      },
      conversation: {
        update: vi.fn().mockResolvedValue({ id: 'convo-1' }),
      },
    };

    const mockDb = {
      tenantTx: vi.fn(async (_ctx, fn) => fn(mockTx)),
    } as any;

    const mockRt = {
      publish: vi.fn(),
    } as any;

    const mockAiTrigger = {
      fire: vi.fn(),
    } as any;

    const mockEnv = {
      AI_PROVIDER: 'mock',
    } as any;

    const service = new VoiceTranscriptionService(mockDb, mockRt, mockAiTrigger, mockEnv);
    const res = await service.transcribeAndEnrich('tenant-1', 'msg-audio-1', Buffer.from('test'), 'audio/ogg');

    expect(res.text).toContain('2 BHK');
    expect(mockTx.message.update).toHaveBeenCalledWith({
      where: { id: 'msg-audio-1' },
      data: expect.objectContaining({
        body: expect.stringContaining('2 BHK'),
        media: expect.objectContaining({ transcribed: true }),
      }),
    });
    expect(mockTx.conversation.update).toHaveBeenCalledWith({
      where: { id: 'convo-1' },
      data: expect.objectContaining({
        lastMessagePreview: expect.stringContaining('[Voice Note]'),
      }),
    });
    expect(mockRt.publish).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      type: 'conversation.updated',
      conversationId: 'convo-1',
    }));
    expect(mockAiTrigger.fire).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      conversationId: 'convo-1',
      messageId: 'msg-audio-1',
    });
  });
});
