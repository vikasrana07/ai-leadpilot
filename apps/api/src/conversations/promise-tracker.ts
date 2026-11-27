export interface DetectedPromise {
  title: string;
  dueAt: Date;
  snippet: string;
  suggestedFollowUp: string;
}

const EN_COMMITMENT =
  /\b(?:i(?:'ll| will| am going to|'m going to)|we(?:'ll| will)|will)\s+(?:definitely\s+)?(?:send|share|email|whatsapp|forward|call|ring|schedule|confirm|update|check|get back|follow up)\b|\blet me\s+(?:send|share|check|get back)\b/i;

const HINGLISH_COMMITMENT =
  /\b(?:bhejta|bhejunga|bhej\s+dunga|bhejungi|share\s+karunga|share\s+karta|call\s+karunga|call\s+karta|batata|bata\s+dunga|update\s+karta|update\s+karunga)\b/i;

function extractDeliverable(text: string): { label: string; followUp: string } {
  const lower = text.toLowerCase();
  if (/floor\s*plan|layout/.test(lower)) {
    return {
      label: 'Send floor plan',
      followUp: 'Hi! Sharing the floor plan as promised. Let me know which layout works best for you.',
    };
  }
  if (/brochure|catalog|catalogue|deck|pdf/.test(lower)) {
    return {
      label: 'Share brochure',
      followUp: 'Hi! Sharing the brochure as promised. Happy to walk you through the highlights anytime.',
    };
  }
  if (/quote|quotation|price|pricing|cost|offer|proposal/.test(lower)) {
    return {
      label: 'Send pricing / quote',
      followUp: 'Hi! Following up with the pricing details I promised. Let me know if you would like to review them on a quick call.',
    };
  }
  if (/call|ring|connect|phone/.test(lower)) {
    return {
      label: 'Call back',
      followUp: 'Hi! Just checking if now is a good time for the quick call we discussed.',
    };
  }
  return {
    label: 'Follow up on commitment',
    followUp: 'Hi! Following up on what I promised to share earlier — let me know if you need anything else.',
  };
}

function extractDueAt(text: string, now: Date): Date {
  const lower = text.toLowerCase();

  const inMins = lower.match(/\bin\s+(\d{1,3})\s*(?:min|mins|minute|minutes)\b/);
  if (inMins) {
    return new Date(now.getTime() + Number(inMins[1]) * 60_000);
  }

  const inHours = lower.match(/\bin\s+(\d{1,2})\s*(?:hr|hrs|hour|hours)\b/);
  if (inHours) {
    return new Date(now.getTime() + Number(inHours[1]) * 3_600_000);
  }

  const clock = lower.match(/\b(?:by|at|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] ?? '0');
    const meridiem = clock[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (!meridiem && hour >= 1 && hour <= 7) hour += 12; // business hours heuristic (e.g. "by 5")
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (/\b(?:tomorrow|kal)\b/.test(lower) || target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  if (/\b(?:tomorrow|kal)\b/.test(lower)) {
    const target = new Date(now);
    target.setDate(target.getDate() + 1);
    target.setHours(/\b(?:evening|shaam)\b/.test(lower) ? 18 : 10, 0, 0, 0);
    return target;
  }

  if (/\b(?:evening|shaam|tonight)\b/.test(lower)) {
    const target = new Date(now);
    target.setHours(18, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      return new Date(now.getTime() + 2 * 3_600_000);
    }
    return target;
  }

  return new Date(now.getTime() + 2 * 3_600_000);
}

/**
 * Detects an explicit or implicit sales commitment in an outbound message or voice memo
 * (English & Hinglish) and returns a structured promise with due time and 1-tap follow-up.
 */
export function detectPromise(text: string, now = new Date()): DetectedPromise | null {
  const trimmed = text.trim();
  if (trimmed.length < 8) return null;
  if (!EN_COMMITMENT.test(trimmed) && !HINGLISH_COMMITMENT.test(trimmed)) return null;

  const { label, followUp } = extractDeliverable(trimmed);
  return {
    title: `Promise: ${label}`.slice(0, 120),
    dueAt: extractDueAt(trimmed, now),
    snippet: trimmed.slice(0, 240),
    suggestedFollowUp: followUp,
  };
}
