# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security tab → "Report a vulnerability"** on this repository. Include what you found, how to reproduce it, and the impact you expect.

We aim to acknowledge a report within 3 working days and to tell you what we plan to do within 10.

## Scope

This repository contains the LeadPilot API, web app and workers. Reports about customer data exposure, authentication or authorisation
bypass, tenant isolation (row-level security), webhook/signature verification, and secrets handling are the most valuable.

## Automated checks

CI runs a dependency audit (`pnpm audit`, high/critical block), secret scanning (gitleaks, full history) and CodeQL; Dependabot opens
weekly update PRs. See `.github/workflows/security.yml` and `docs/security-review.md`.
