# Preview cleanup decisions — 2026-11-24

Scope: feature/ai-business-rebuild only. Production/main/production D1/backups MUST remain untouched.

User-approved choices:
- KEEP: AI conversation + voice; CORE admin; AI API; dialogue history and persistence; BTC chart/financial analysis; pet video studio; all Production features untouched.
- HIDE IN PREVIEW: Google Calendar UI; weather and rain radar UI; old test and prototype screens.
- Preserve the underlying code and data. No deletion, database migration, production secret change, or automatic posting.
- Keep the existing /office.html 12-role office and its owner approval / budget protections.

Important existing state observed:
- index.html already links to /office.html and exposes a weather menu.
- office.html and assets/office.js already implement an opt-in office UI, task workflow and optional Preview D1 path.
- command.js imports weather and BTC modules, so deleting imports or files would risk regressions.

Implementation checklist (not yet completed):
1. Inventory actual selectors and initialization dependencies for calendar, weather, and test/prototype UI.
2. Introduce a Preview-host-gated visibility configuration (not Production) and test it.
3. Make VIRTUAL OFFICE easier to reach without breaking CORE, finance, or pet studio.
4. Verify hidden components cannot be accidentally re-exposed by navigation.
5. Run all unit and browser regression tests; deploy Preview only and verify.
6. Report exactly what was hidden and confirm no underlying data was deleted.

This document records approved cleanup settings; it does NOT claim the UI has already been changed or deployed.
