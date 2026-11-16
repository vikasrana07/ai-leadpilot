# apps/worker

Reserved for the BullMQ queue processors (AI replies, automations, document processing, outbound messaging).
Built in **Phase 5**; it will import the same NestJS modules as `apps/api` and bootstrap without an HTTP listener
(see `docs/architecture.md` §2). Intentionally empty until then: there is no placeholder code.
