/**
 * Pure TypeScript HTML/text email layout helper.
 * Escapes all interpolated dynamic values to prevent HTML/XSS injection.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

/** Converts plain text with blank-line paragraphs into escaped `<p>` blocks for HTML emails. */
export function textToHtmlParagraphs(text: string): string {
  const blocks = text
    .trim()
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length === 0) return '';
  return blocks
    .map(
      (b) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(b).replace(/\n/g, '<br />')}</p>`,
    )
    .join('\n');
}

export interface EmailLayoutOptions {
  /** Short summary shown in inbox preview next to subject. */
  preheader: string;
  /** Main heading inside the email card. */
  heading: string;
  /** Pre-escaped HTML body content (e.g. from `textToHtmlParagraphs` or trusted template markup). */
  bodyHtml: string;
  /** Optional primary call-to-action button. */
  cta?: { label: string; url: string };
  /** Optional fallback raw URL shown below CTA (useful for verification/reset links). */
  fallbackUrl?: string;
  /** Optional footer note. */
  footerNote?: string;
  /** Brand label shown in header (defaults to "LeadPilot"). */
  brandName?: string;
}

/**
 * Renders a responsive, table-based 600px transactional email layout
 * compatible with Gmail, Apple Mail, and Outlook.
 */
export function renderEmailLayout(opts: EmailLayoutOptions): string {
  const brand = escapeHtml(opts.brandName ?? 'LeadPilot');
  const preheader = escapeHtml(opts.preheader);
  const heading = escapeHtml(opts.heading);
  const footerNote = escapeHtml(
    opts.footerNote ?? 'Sent by LeadPilot. Please do not reply directly to automated system notifications.',
  );

  const ctaBlock = opts.cta
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 16px 0;">
        <tr>
          <td style="border-radius:6px;background-color:#0f172a;">
            <a href="${escapeHtml(opts.cta.url)}" target="_blank" rel="noopener noreferrer"
               style="display:inline-block;padding:12px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
              ${escapeHtml(opts.cta.label)}
            </a>
          </td>
        </tr>
      </table>`
    : '';

  const fallbackBlock = opts.fallbackUrl
    ? `<p style="margin:0 0 16px 0;font-size:12px;line-height:1.5;color:#64748b;word-break:break-all;">
        If the button above does not work, copy and paste this link into your browser:<br />
        <a href="${escapeHtml(opts.fallbackUrl)}" style="color:#2563eb;text-decoration:underline;">${escapeHtml(opts.fallbackUrl)}</a>
      </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:20px 32px;background-color:#0f172a;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:-0.01em;">
              ${brand}
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;font-weight:700;color:#0f172a;">
                ${heading}
              </h1>
              ${opts.bodyHtml}
              ${ctaBlock}
              ${fallbackBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;">
              ${footerNote}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
