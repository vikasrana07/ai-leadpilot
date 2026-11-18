import { describe, expect, it } from 'vitest';
import { parseLive, shouldToast, withUnreadTitle } from './alerts';

describe('parseLive', () => {
  it('reads a notification and keeps only safe, internal links', () => {
    expect(parseLive(JSON.stringify({ id: 'n1', type: 'new_message', title: 'New chat from Riya', body: 'Hi', link: '/inbox?c=abc' }))).toEqual({ id: 'n1', type: 'new_message', title: 'New chat from Riya', body: 'Hi', link: '/inbox?c=abc' });
    expect(parseLive(JSON.stringify({ title: 'T', link: 'https://evil.example' }))?.link).toBeNull();      // never an outside address
    for (const off of ['//evil.example', '/\\evil.example', 'javascript:alert(1)', 'inbox']) expect(parseLive(JSON.stringify({ title: 'T', link: off }))?.link, off).toBeNull(); // protocol-relative and other off-site forms
    expect(parseLive(JSON.stringify({ title: 'T' }))).toEqual({ title: 'T', body: null, link: null });
  });
  it('ignores anything unusable instead of throwing', () => { for (const bad of ['', 'nope', 'null', '[]', '{}', '{"title":""}', '{"title":5}']) expect(parseLive(bad), bad).toBeNull(); });
});

describe('shouldToast', () => {
  it('pops up for everything, except a new message while the Inbox is open and in front', () => {
    const msg = { type: 'new_message', title: 'x' };
    expect(shouldToast(msg, '/dashboard', false)).toBe(true);
    expect(shouldToast(msg, '/inbox', false)).toBe(false);
    expect(shouldToast(msg, '/inbox', true)).toBe(true);          // the tab is in the background: still tell them
    expect(shouldToast({ type: 'hot_lead', title: 'x' }, '/inbox', false)).toBe(true);
    expect(shouldToast({ title: '' }, '/leads', false)).toBe(false);
  });
});

describe('withUnreadTitle', () => {
  it('adds, updates and removes the count, without stacking prefixes', () => {
    expect(withUnreadTitle('LeadPilot', 3)).toBe('(3) LeadPilot');
    expect(withUnreadTitle('(3) LeadPilot', 5)).toBe('(5) LeadPilot');
    expect(withUnreadTitle('(5) LeadPilot', 0)).toBe('LeadPilot');
    expect(withUnreadTitle('LeadPilot', 250)).toBe('(99+) LeadPilot');
    expect(withUnreadTitle('(99+) LeadPilot', 2)).toBe('(2) LeadPilot');
  });
});
