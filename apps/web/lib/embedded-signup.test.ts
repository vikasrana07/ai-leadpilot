import { describe, expect, it } from 'vitest';
import { createSignupCollector, parseSignupMessage } from './embedded-signup';

const FB = 'https://www.facebook.com';
const finish = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: '109876543210', waba_id: '208765432109' }, version: '3' };

describe('parseSignupMessage', () => {
  it('reads the finish message (object or JSON string) from Facebook origins', () => {
    const want = { kind: 'finish', phoneNumberId: '109876543210', wabaId: '208765432109' };
    expect(parseSignupMessage(FB, finish)).toEqual(want);
    expect(parseSignupMessage('https://web.facebook.com', JSON.stringify(finish))).toEqual(want);
  });
  it('ignores messages from any other origin, even a look-alike, and anything that is not an Embedded Signup message', () => {
    for (const o of ['https://evil.example', 'https://www.facebook.com.evil.example', 'http://www.facebook.com', 'https://facebook.com', '']) expect(parseSignupMessage(o, finish), o).toBeNull();
    for (const d of [null, undefined, 42, 'not json', '{"type":"OTHER"}', { type: 'WA_EMBEDDED_SIGNUP', event: 'SOMETHING_ELSE' }, []]) expect(parseSignupMessage(FB, d)).toBeNull();
  });
  it('turns a finish without usable ids into an error rather than connecting the wrong thing', () => {
    expect(parseSignupMessage(FB, { ...finish, data: { phone_number_id: 'abc', waba_id: '208765432109' } })).toMatchObject({ kind: 'error' });
    expect(parseSignupMessage(FB, { ...finish, data: {} })).toMatchObject({ kind: 'error' });
  });
  it('reads cancel and error messages', () => {
    expect(parseSignupMessage(FB, { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'x' } })).toEqual({ kind: 'cancel' });
    expect(parseSignupMessage(FB, { type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_message: 'Phone not eligible' } })).toEqual({ kind: 'error', message: 'Phone not eligible' });
    expect(parseSignupMessage(FB, { type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: {} })).toMatchObject({ kind: 'error' });
  });
});

describe('createSignupCollector', () => {
  const fin = { kind: 'finish' as const, phoneNumberId: '109876543210', wabaId: '208765432109' };
  it('needs both answers and works in either order', () => {
    const a = createSignupCollector();
    expect(a.pushCode('the-code')).toEqual({ status: 'waiting' });
    expect(a.pushMessage(fin)).toEqual({ status: 'done', result: { code: 'the-code', phoneNumberId: '109876543210', wabaId: '208765432109' } });
    const b = createSignupCollector();
    expect(b.pushMessage(fin)).toEqual({ status: 'waiting' });
    expect(b.pushCode('the-code').status).toBe('done');
  });
  it('is cancelled when the login closes without a code or the pop-up reports cancel', () => {
    expect(createSignupCollector().pushCode(null)).toEqual({ status: 'cancelled' });
    expect(createSignupCollector().pushCode('')).toEqual({ status: 'cancelled' });
    expect(createSignupCollector().pushMessage({ kind: 'cancel' })).toEqual({ status: 'cancelled' });
  });
  it('reports an error from the pop-up, and settles only once', () => {
    const c = createSignupCollector();
    expect(c.pushMessage({ kind: 'error', message: 'boom' })).toEqual({ status: 'error', message: 'boom' });
    expect(c.pushCode('late-code')).toEqual({ status: 'error', message: 'boom' }); // a late answer cannot turn a failure into a success
    const d = createSignupCollector(); d.pushCode('x'); d.pushMessage(fin);
    expect(d.pushMessage({ kind: 'cancel' }).status).toBe('done');
  });
});
