# Offline checks

`npm test` runs isolated Node 24 test workers with real HTTP disabled by default.
Current Preview cloud-storage and live-AI-stop tests load application code unchanged.

The eleven older provider/ledger suites listed in `legacy-provider-fixture.js`
exercise retained implementation code behind the now unconditional live-AI stop.
Only those test workers instrument that stop in memory so their mocked provider,
timeout, quota, version and rollback assertions still run. The loader checks the
exact guard text and refuses to run outside a Node test worker. It never changes
application files, enables a runtime environment flag or deploys an AI bypass.
`content-preview.test.js` independently verifies the actual uninstrumented chat,
job, idea and gateway entry points refuse real AI before DB writes or HTTP.
The shared budget fixture is 5 USD to match current configuration validation.

`tests/cloud-workspace-browser.mjs` uses a fresh SQLite D1 fixture, intercepted
HTTP and synthetic credentials. Run both desktop and `MOBILE_TEST=1` layouts.
Real D1 verification is a separately authorized Preview-only operation; these
local tests do not establish production or authenticated deployed UI behavior.
