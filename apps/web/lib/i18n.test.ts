import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import hi from '../messages/hi.json';

describe('i18n message catalogues', () => {
  it('has identical keys and non-empty translations in en and hi', () => {
    const enKeys = Object.keys(en).sort();
    const hiKeys = Object.keys(hi).sort();
    expect(hiKeys).toEqual(enKeys);
    for (const k of enKeys) {
      expect((en as Record<string, string>)[k]?.trim().length).toBeGreaterThan(0);
      expect((hi as Record<string, string>)[k]?.trim().length).toBeGreaterThan(0);
    }
  });
});
