import { describe, expect, it } from 'vitest';
import { formatCsv, parseCsv } from '../src/common/csv.js';
import { fromMinor, toMinor } from '../src/common/money.js';
import { normalizePhone } from '../src/common/phone.js';

describe('normalizePhone', () => {
  it('normalises Indian formats to the same key', () => {
    const forms = ['9876543210', '09876543210', '+91 98765 43210', '91-9876543210', '(+91) 98765-43210', '0091 9876543210'];
    for (const f of forms) expect(normalizePhone(f)?.norm, f).toBe('919876543210');
    expect(normalizePhone('9876543210')?.display).toBe('+919876543210');
  });
  it('keeps foreign numbers with their country code and rejects garbage', () => {
    expect(normalizePhone('+1 (415) 555-0132')?.norm).toBe('14155550132');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('money', () => {
  it('round-trips rupees via paise without float drift', () => {
    expect(toMinor(1250000)).toBe(125000000n);
    expect(fromMinor(toMinor(19.99))).toBe(19.99);
    expect(toMinor(null)).toBeNull();
  });
});

describe('csv', () => {
  it('parses quotes, commas, escaped quotes, CRLF, embedded newlines and BOM', () => {
    const text = '﻿name,notes\r\n"Doe, Jane","said ""hi""\nthere"\r\nAmit,plain\r\n\r\n';
    expect(parseCsv(text)).toEqual([['name', 'notes'], ['Doe, Jane', 'said "hi"\nthere'], ['Amit', 'plain']]);
  });
  it('round-trips and neutralises spreadsheet formula injection', () => {
    const out = formatCsv([['a', '=HYPERLINK("http://evil")', '+1', '@x', 'ok, fine', 5, null]]);
    expect(out).toBe(`a,"'=HYPERLINK(""http://evil"")",'+1,'@x,"ok, fine",5,`);
    expect(parseCsv(out)[0]?.[1]).toBe('\'=HYPERLINK("http://evil")');
  });
});
