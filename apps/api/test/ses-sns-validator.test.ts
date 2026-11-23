import { describe, expect, it } from 'vitest';
import { buildStringToSign, validateSnsCertUrl, validateSnsSubscribeUrl, verifySnsSignature } from '../src/email-tracking/sns-validator.js';
import type { SnsMessageInput } from '@leadpilot/validation';

describe('SNS Validator', () => {
  describe('validateSnsCertUrl', () => {
    it('accepts legitimate AWS SNS signing cert URLs', () => {
      const valid = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-123456789.pem';
      const parsed = validateSnsCertUrl(valid);
      expect(parsed.hostname).toBe('sns.us-east-1.amazonaws.com');
    });

    it('accepts cn-north-1 AWS SNS URLs', () => {
      const valid = 'https://sns.cn-north-1.amazonaws.com.cn/SimpleNotificationService-123456789.pem';
      const parsed = validateSnsCertUrl(valid);
      expect(parsed.hostname).toBe('sns.cn-north-1.amazonaws.com.cn');
    });

    it('rejects non-https URLs', () => {
      expect(() => validateSnsCertUrl('http://sns.us-east-1.amazonaws.com/cert.pem')).toThrow(
        /expected https:/,
      );
    });

    it('rejects forged/unauthorized domains (SSRF guard)', () => {
      expect(() => validateSnsCertUrl('https://evil-attacker.com/sns.us-east-1.amazonaws.com/cert.pem')).toThrow(
        /not an authorized AWS SNS domain/,
      );
      expect(() => validateSnsCertUrl('https://sns.us-east-1.amazonaws.com.evil.com/cert.pem')).toThrow(
        /not an authorized AWS SNS domain/,
      );
    });

    it('rejects non-.pem files', () => {
      expect(() => validateSnsCertUrl('https://sns.us-east-1.amazonaws.com/index.html')).toThrow(
        /must end with \.pem/,
      );
    });
  });

  describe('validateSnsSubscribeUrl', () => {
    it('accepts legitimate AWS SNS subscribe URLs', () => {
      const valid = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:123&Token=456';
      const parsed = validateSnsSubscribeUrl(valid);
      expect(parsed.hostname).toBe('sns.us-east-1.amazonaws.com');
    });

    it('rejects forged/unauthorized subscribe domains', () => {
      expect(() => validateSnsSubscribeUrl('https://internal-service.local/admin')).toThrow(
        /not an authorized AWS SNS domain/,
      );
    });
  });

  describe('buildStringToSign', () => {
    it('builds canonical string for Notification with Subject', () => {
      const msg: SnsMessageInput = {
        Type: 'Notification',
        MessageId: 'msg-123',
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:ses-events',
        Subject: 'Amazon SES Notification',
        Message: '{"eventType":"Delivery"}',
        Timestamp: '2026-11-23T10:00:00.000Z',
        SignatureVersion: '1',
        Signature: 'dummy',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      };

      const signString = buildStringToSign(msg);
      expect(signString).toBe(
        'Message\n{"eventType":"Delivery"}\nMessageId\nmsg-123\nSubject\nAmazon SES Notification\nTimestamp\n2026-11-23T10:00:00.000Z\nTopicArn\narn:aws:sns:us-east-1:123456789012:ses-events\nType\nNotification\n',
      );
    });

    it('builds canonical string for SubscriptionConfirmation', () => {
      const msg: SnsMessageInput = {
        Type: 'SubscriptionConfirmation',
        MessageId: 'sub-123',
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:ses-events',
        Message: 'Confirm subscription',
        Timestamp: '2026-11-23T10:00:00.000Z',
        Token: 'token-abc',
        SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=Confirm',
        SignatureVersion: '1',
        Signature: 'dummy',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      };

      const signString = buildStringToSign(msg);
      expect(signString).toBe(
        'Message\nConfirm subscription\nMessageId\nsub-123\nSubscribeURL\nhttps://sns.us-east-1.amazonaws.com/?Action=Confirm\nTimestamp\n2026-11-23T10:00:00.000Z\nToken\ntoken-abc\nTopicArn\narn:aws:sns:us-east-1:123456789012:ses-events\nType\nSubscriptionConfirmation\n',
      );
    });
  });

  describe('verifySnsSignature', () => {
    it('always passes in mock mode without remote cert network fetching', async () => {
      const msg: SnsMessageInput = {
        Type: 'Notification',
        MessageId: 'msg-123',
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:ses-events',
        Message: '{"eventType":"Delivery"}',
        Timestamp: '2026-11-23T10:00:00.000Z',
        SignatureVersion: '1',
        Signature: 'fake-sig',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      };

      const result = await verifySnsSignature(msg, 'mock');
      expect(result).toBe(true);
    });
  });
});
