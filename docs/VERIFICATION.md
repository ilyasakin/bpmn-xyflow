# WIP verification checkpoint (2026-09-30)

This checkpoint is ready for independent hosted browser testing. It is **not a
full parity completion claim**. [PARITY.md](PARITY.md) remains the acceptance
ledger; [SCENARIOS.md](SCENARIOS.md) describes business workflows and sources.

## Passed locally on the checkpoint source

- Frozen dependency install
- `python3 test/xml-schema.py`: upstream semantic-oracle corpus, rich metadata
  Modeler mutations, business scenarios and official XSD validation of **33
  generated exports**
- `node --test test/modeling/*.test.mjs test/geometry/*.test.mjs test/rules/*.test.mjs test/viewer/*.test.mjs`: **67 tests passed**
- Rules compare complete connection attributes across **110,500 pairs** with
  actual bpmn-js 18.30.1, using both the custom and upstream moddle models;
  attachment-host cases are checked separately
- Library build: root, React, Vue and Svelte entry points
- Lint: **0 errors**, 35 existing/non-blocking warnings
- Package dry-run: includes upstream LICENSE, unchanged attribution source,
  descriptor data and its MIT notice; excludes test fixtures
- `git diff --check`
- Isolated site: lint, TypeScript and Next production build
- Independent review re-ran adversarial namespace/QName/mixed-content cases,
  imported-edge label delete/rename/reconnect, React lifecycle and subprocess
  navigation; reviewed subset has no outstanding checkpoint blocker

## Not yet run

- Real Chromium suites, including pointer/keyboard/cancellation interaction,
  pixel geometry and rendering, independent upstream browser open/save, and
  hosted site checks
- Full package-consumer typing and public-entrypoint checks

Chromium cannot launch in the current local test environment. No browser
security settings were disabled to bypass that restriction. CI runs the
prepared suites in a normal browser environment and saves screenshot evidence.

## Reproduce

Use Node 24 and the pinned pnpm version. Run `pnpm install --frozen-lockfile
--ignore-scripts`; install Python `lxml==6.1.1`; install the test browser with
`pnpm exec puppeteer browsers install chrome-headless-shell --install-deps`.
Then run `pnpm check`. The source XML oracle alone is `pnpm test:xml`, actual
Modeler metadata interoperability is `pnpm test:xml-modeler`, and full XSD
validation is `pnpm test:schema`.

For the deployed site, run `SITE_BASE_URL=<verified-preview-url> node
test/viewer/site-browser-parity.mjs` in an authorized browser environment.
