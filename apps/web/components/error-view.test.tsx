import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorView, errorReference } from './error-view';

describe('errorReference', () => {
  it('prefers the API request id, then the Next digest', () => {
    expect(errorReference({ requestId: 'req-1', digest: 'd1' })).toBe('req-1');
    expect(errorReference({ digest: 'd1' })).toBe('d1');
    expect(errorReference(new Error('x'))).toBeUndefined();
    expect(errorReference(null)).toBeUndefined();
  });
});

describe('ErrorView', () => {
  it('error: friendly copy, the reference, a retry button and a way home; no technical detail', () => {
    const html = renderToStaticMarkup(<ErrorView kind="error" reference="req-abc-12345" onRetry={() => undefined} />);
    expect(html).toContain('Something went wrong'); expect(html).toContain('req-abc-12345'); expect(html).toContain('>Try again<'); expect(html).toContain('href="/dashboard"');
    expect(html).toContain('<h1'); expect(html).toContain('<main');
    expect(html).not.toMatch(/stack|TypeError|at \w+ \(/i);
  });
  it('error without a reference or retry still offers a way out', () => {
    const html = renderToStaticMarkup(<ErrorView kind="error" />);
    expect(html).not.toContain('Reference:'); expect(html).not.toContain('>Try again<'); expect(html).toContain('Go to dashboard');
  });
  it('not-found: its own heading and no retry', () => {
    const html = renderToStaticMarkup(<ErrorView kind="not-found" />);
    expect(html).toContain('We could not find that page'); expect(html).not.toContain('>Try again<');
  });
});
