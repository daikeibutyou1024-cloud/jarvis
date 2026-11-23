# J.A.R.V.I.S. VIRTUAL OFFICE — Preview-only implementation plan

Status: Preview implementation prepared; device-local workflow implemented. Remote D1/live AI remain OFF pending verified bindings and explicit cost authorization. See [implementation and operations](VIRTUAL_OFFICE_PREVIEW.md).
Target branch: feature/ai-business-rebuild.
Never modify main, Production, production D1 (jarvis-calendar), secrets, or backups.

## Twelve agent roles
01 J.A.R.V.I.S. orchestrator
02 Strategy and revenue planning
03 Trend and competitor research
04 YouTube planning and scripts
05 Instagram content
06 TikTok content
07 Threads editorial
08 Creative assets
09 SEO and web content
10 Google Business Profile service planning
11 Sales and affiliate operations
12 Finance, KPI and cost monitoring

## Workflow
research -> propose task -> assign -> produce draft -> quality and policy review -> owner approval -> authorized publishing -> analytics -> report.
All external actions must be auditable and idempotent. No autonomous spending, contracting, publishing, or outreach without owner approval.
Respect each platform's API permissions and policies; no fake reviews, fake engagement, scraped personal data, or unlicensed content.

## Data model (Preview DB only)
agents(id, name, role, enabled, budget_limit)
tasks(id, agent_id, status, objective, input_json, output_json, created_at, updated_at)
approvals(id, task_id, action, status, reviewer, created_at)
runs(id, task_id, model, token_usage, estimated_cost, error, created_at)
metrics(id, platform, metric, value, observed_at, source)

## Security and implementation gates
1. Read current Preview bindings and existing UI architecture before changing code.
2. Add office dashboard as isolated feature flag, off by default.
3. Add deterministic task lifecycle and approval tests; default all external operations to dry-run.
4. Connect actual model execution with per-agent budgets and error handling.
5. Only then connect authorized platforms one at a time, starting with draft creation.
6. Validate existing voice, calendar, finance, and storage regressions.
7. Deploy Preview branch only, verify Preview URL and smoke tests.
8. Production release requires a separate explicit owner request.

## Initial dashboard
Show 12 role cards, agent status, task queue, drafts, approval queue, run history, API spend, actual attributable revenue, and a clear distinction between simulated and live data.
No fabricated sales or job completion claims.
