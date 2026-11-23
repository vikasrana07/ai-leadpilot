import { createVerify } from 'node:crypto';
import type { SnsMessageInput } from '@leadpilot/validation';

/** Strict regex ensuring SigningCertURL and SubscribeURL belong exclusively to genuine AWS SNS endpoints. */
const SNS_HOST_REGEX = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/i;

interface CachedCert {
  pem: string;
  expiresAt: number;
}

const CERT_CACHE = new Map<string, CachedCert>();
const CERT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHED_CERTS = 20;

export class SnsVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnsVerificationError';
  }
}

/**
 * Validates that a URL is a legitimate AWS SNS certificate URL.
 * Throws SnsVerificationError if the URL fails protocol, hostname, or extension security constraints.
 */
export function validateSnsCertUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new SnsVerificationError('Invalid SigningCertURL: malformed URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new SnsVerificationError(`Invalid SigningCertURL protocol: expected https:, got ${parsed.protocol}`);
  }

  if (!SNS_HOST_REGEX.test(parsed.hostname)) {
    throw new SnsVerificationError(`Invalid SigningCertURL hostname: ${parsed.hostname} is not an authorized AWS SNS domain`);
  }

  if (!parsed.pathname.endsWith('.pem')) {
    throw new SnsVerificationError('Invalid SigningCertURL path: must end with .pem');
  }

  return parsed;
}

/**
 * Validates that a SubscribeURL is an authorized AWS SNS endpoint before calling it.
 */
export function validateSnsSubscribeUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new SnsVerificationError('Invalid SubscribeURL: malformed URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new SnsVerificationError(`Invalid SubscribeURL protocol: expected https:, got ${parsed.protocol}`);
  }

  if (!SNS_HOST_REGEX.test(parsed.hostname)) {
    throw new SnsVerificationError(`Invalid SubscribeURL hostname: ${parsed.hostname} is not an authorized AWS SNS domain`);
  }

  return parsed;
}

/**
 * Fetches and caches the X.509 certificate PEM from AWS SNS.
 */
export async function getSnsCertificate(certUrlStr: string): Promise<string> {
  validateSnsCertUrl(certUrlStr);

  const now = Date.now();
  const cached = CERT_CACHE.get(certUrlStr);
  if (cached && cached.expiresAt > now) {
    return cached.pem;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(certUrlStr, { signal: controller.signal });
    if (!res.ok) {
      throw new SnsVerificationError(`Failed to fetch SNS signing cert: HTTP ${res.status}`);
    }
    const pem = await res.text();
    if (!pem.includes('BEGIN CERTIFICATE')) {
      throw new SnsVerificationError('Invalid certificate content fetched from SigningCertURL');
    }

    if (CERT_CACHE.size >= MAX_CACHED_CERTS) {
      const oldestKey = CERT_CACHE.keys().next().value;
      if (oldestKey) CERT_CACHE.delete(oldestKey);
    }

    CERT_CACHE.set(certUrlStr, { pem, expiresAt: now + CERT_CACHE_TTL_MS });
    return pem;
  } catch (err) {
    if (err instanceof SnsVerificationError) throw err;
    throw new SnsVerificationError(`Network error while retrieving SNS certificate: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Builds the canonical string to sign per AWS SNS specification.
 * Fields must be ordered alphabetically with each key name followed by \n, value followed by \n.
 */
export function buildStringToSign(message: SnsMessageInput): string {
  let signString = '';

  if (message.Type === 'Notification') {
    signString += `Message\n${message.Message}\n`;
    signString += `MessageId\n${message.MessageId}\n`;
    if (message.Subject) {
      signString += `Subject\n${message.Subject}\n`;
    }
    signString += `Timestamp\n${message.Timestamp}\n`;
    signString += `TopicArn\n${message.TopicArn}\n`;
    signString += `Type\n${message.Type}\n`;
  } else if (message.Type === 'SubscriptionConfirmation' || message.Type === 'UnsubscribeConfirmation') {
    signString += `Message\n${message.Message}\n`;
    signString += `MessageId\n${message.MessageId}\n`;
    if (message.SubscribeURL) {
      signString += `SubscribeURL\n${message.SubscribeURL}\n`;
    }
    signString += `Timestamp\n${message.Timestamp}\n`;
    if (message.Token) {
      signString += `Token\n${message.Token}\n`;
    }
    signString += `TopicArn\n${message.TopicArn}\n`;
    signString += `Type\n${message.Type}\n`;
  } else {
    throw new SnsVerificationError(`Unsupported SNS message type: ${message.Type}`);
  }

  return signString;
}

/**
 * Cryptographically verifies an AWS SNS message signature.
 * In 'mock' mode, verification succeeds without network calls to AWS.
 */
export async function verifySnsSignature(message: SnsMessageInput, mode: 'mock' | 'live' = 'live'): Promise<boolean> {
  if (mode === 'mock') {
    return true;
  }

  const certPem = await getSnsCertificate(message.SigningCertURL);
  const stringToSign = buildStringToSign(message);

  let algorithm: string;
  if (message.SignatureVersion === '1') {
    algorithm = 'RSA-SHA1';
  } else if (message.SignatureVersion === '2') {
    algorithm = 'RSA-SHA256';
  } else {
    throw new SnsVerificationError(`Unsupported SignatureVersion: ${message.SignatureVersion}`);
  }

  const verifier = createVerify(algorithm);
  verifier.update(stringToSign, 'utf8');
  return verifier.verify(certPem, message.Signature, 'base64');
}
