import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormErrorAlert } from './form-error-alert';

describe('FormErrorAlert', () => {
  it('renders nothing when there are no errors', () => {
    const htmlEmpty = renderToStaticMarkup(<FormErrorAlert errors={{}} />);
    expect(htmlEmpty).toBe('');

    const htmlNull = renderToStaticMarkup(<FormErrorAlert errors={null} />);
    expect(htmlNull).toBe('');

    const htmlUndefined = renderToStaticMarkup(<FormErrorAlert />);
    expect(htmlUndefined).toBe('');
  });

  it('renders with role="alert" and aria-live="polite" when validation errors exist', () => {
    const errors = {
      title: { message: 'Task title is required' },
    };
    const html = renderToStaticMarkup(<FormErrorAlert errors={errors} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Task title is required');
    expect(html).toContain('Please fix the error below before submitting:');
  });

  it('extracts multiple validation errors and displays plural message', () => {
    const errors = {
      title: { message: 'Task title is required' },
      phone: { message: 'Provide a phone number or email' },
    };
    const html = renderToStaticMarkup(<FormErrorAlert errors={errors} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Please fix the 2 errors below before submitting:');
    expect(html).toContain('Task title is required');
    expect(html).toContain('Provide a phone number or email');
  });

  it('handles custom message while preserving aria-live="polite" and role="alert"', () => {
    const html = renderToStaticMarkup(
      <FormErrorAlert message="Validation failed. Please review the missing inputs." />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Validation failed. Please review the missing inputs.');
  });
});
