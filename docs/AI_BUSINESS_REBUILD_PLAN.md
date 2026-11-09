# J.A.R.V.I.S. AI Business Rebuild — Phase 0

Date: 2026-11-09
Status: Planning only; no production code changes.

## Verified from GitHub source
- Main UI: index.html, navy/cyan J.A.R.V.I.S. interface.
- AI endpoint: functions/api/chat.js; Cloudflare Pages Function sends requests to Anthropic Messages API using model claude-sonnet-4-6.
- Secrets are read from Cloudflare environment variables; never commit credentials.
- Google Calendar endpoint: functions/api/calendar.js and OAuth handlers.
- Separate video studio: pet-video-studio.html.
- UI includes research, content, analytics and settings sections. Some panels are placeholders; do not present them as operational integrations.
- Live Cloudflare deployment settings, current runtime status, D1 bindings and external API permissions are NOT verified.

## Business goal
Low-cost, largely automated AI-assisted publishing and affiliate workflow: research -> content draft -> compliance/quality review -> approved publishing -> metrics -> daily report.
No revenue guarantee. Do not publish, spend, or enter agreements without appropriate approval.

## Constraints
- Preserve blue orb, voice/chat UX and mobile accessibility.
- Retire weather, calendar, YouTube and pet video studio from the new business UI only after functional review; archive existing implementation.
- Keep production main unchanged until tested and approved.
- Compare Claude and OpenAI API pricing using actual usage and equivalent tasks; ChatGPT Plus does not include API credits.
- No secrets in repository, chat, or logs.
- Start with note and affiliate content; social API access is gated by provider terms, review and permissions.

## Proposed phases
1. Inventory files, live deployment and Cloudflare configuration without exposing secrets.
2. Build new business dashboard on feature branch with mocked sample data clearly labeled.
3. Implement business data storage, scheduled jobs, logs and safeguards.
4. Add one monetization workflow end-to-end; measure real performance.
5. Add platform integrations one at a time; run cost and reliability tests.
6. Merge to main and deploy only after user review.

## Immediate next check
Confirm whether the public Cloudflare Pages deployment is connected to this GitHub repository and which branch is deployed. Do not infer from source code alone.
