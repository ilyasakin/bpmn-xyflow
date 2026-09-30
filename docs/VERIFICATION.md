# WIP verification checkpoint (2026-09-30)

This checkpoint is ready for independent hosted browser testing. It is **not a
full parity completion claim**. [PARITY.md](PARITY.md) remains the acceptance
ledger; [SCENARIOS.md](SCENARIOS.md) describes business workflows and sources.

## Historical first checkpoint: passed locally

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

## Historical first checkpoint: then pending

- Real Chromium suites, including pointer/keyboard/cancellation interaction,
  pixel geometry and rendering, independent upstream browser open/save, and
  hosted site checks
- Full package-consumer typing and public-entrypoint checks

Chromium cannot launch in the current local test environment. No browser
security settings were disabled to bypass that restriction. CI runs the
prepared suites in a normal browser environment and saves screenshot evidence.

## Reproduce

Use Node 24 and the pinned pnpm version. Run `pnpm install --frozen-lockfile
--ignore-scripts`; install Python `lxml==6.1.1`; use a supported sandbox-capable Chrome installation and set
`PUPPETEER_EXECUTABLE_PATH` to its executable. GitHub CI selects its preinstalled
official Google Chrome, prints its version/path, and preserves its sandbox.
Then run `pnpm check`. The source XML oracle alone is `pnpm test:xml`, actual
Modeler metadata interoperability is `pnpm test:xml-modeler`, and full XSD
validation is `pnpm test:schema`.

For the deployed site, run `SITE_BASE_URL=<verified-preview-url> node
test/viewer/site-browser-parity.mjs` in an authorized browser environment.

## Second local checkpoint

The next source checkpoint adds independently reviewed SAX/XML fidelity fixes,
exact fractional DI restoration, initial paint ordering, lane/space/insertion
operations, explicit subtree replacement, typed public package exports, theme
tokens and real-scenario menus. Local aggregate: **139 Node tests**, **66 generated
XSD-valid exports**, packed root/framework TypeScript and bundle/runtime checks,
lint with **0 errors / 30 warnings**, build and workflow actionlint pass.

The hosted security-only checkpoint passed CodeQL with no new alerts and executed
Chrome without disabling its sandbox. Existing smoke/framework/viewer checks and
order/booking scenarios pass. That earlier head still exposed approval lane paint
order and HR undo precision failures; local fixes above require fresh hosted
verification. Remaining contextual menu/rule and UI gates stay open in PARITY.md.

## Green hosted checkpoint (2026-09-30)

Library commit `37e9ec053190516c4c9fb52abe01c58650baac7a` passed the full
configured GitHub CI run [36773803293](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36773803293).
This includes native smoke gestures, React/multi-instance/wrapper lifecycle,
viewer/theme/security tests, all three business workflows, exact HR DI undo,
independent upstream browser open/save, source/XSD/unit/build and packed consumers.
CodeQL reported no new alerts. Earlier approval-lane and HR precision failures
are fixed and pass in real Chrome on this revision.

Site commit `0c86270e3d70ea0f6d6a0b55fe975202efa855b3` pins that library revision
and passed its CI and normal Vercel preview build. Both PRs remain draft.

The next contextual menu/create/drop/attachment work and its dedicated native
UI suite remain in progress. The green checkpoint proves the configured gates,
not completion of every open row in PARITY.md.

The subsequent site-only test checkpoint `98be8faacf872554d458cc8ac14f0045cb795e55`
passed [run 36775989922](https://github.com/ilyasakin/ilyasakin.github.io/actions/runs/36775989922),
including native browser assertions against a served production Next build.
It uses pinned puppeteer-core and the supported runner Chrome without disabling
its sandbox; passing screenshot evidence is uploaded by the site workflow.

## Contextual source checkpoint

Independent review reran 177 unit tests, XML/security probes, and packed consumers.
The modeling and schema gates validate 87 generated exports. The new native action
suite covers nine independently aggregated groups, including boundary creation and
drag attachment, host history, edge cleanup through event replacement, flow types,
headers, populated replacement confirmation and geometry controls. Its source is
checked locally; actual execution awaits the next hosted revision. Touch gestures
remain an explicit additional core gate, not established by phone layout checks.

## Pointer-accurate connection checkpoint (awaiting hosted native execution)

User testing exposed basic source-port/drop-anchor and route-edit behavior that
prior connection-existence tests did not cover. The focused correction preserves
explicit pointer intent through preview/create/reconnect, repairs end legs while
retaining manual interior bends, supports two-point segment manipulation, and
adds screen-sized hit regions. Variable-length and same-count DI edits preserve
surviving waypoint metadata and exact history restoration.

Independent local verification: **216 unit tests**, **88 XSD-valid exports**,
**1,008 additional anchor/shape/placement cases**, exact pointer-state and metadata
probes, packed consumers, build and lint pass. The dedicated native Chromium
connection suite additionally checks chosen on-screen ports, preview and final
DI at several zoom levels, the reported Conditional-sample reconnect, source and
target reconnection, opposite-anchor stability, repeated route edits, cancellation
and movement/resize. Its hosted result is still required before claiming the
reported interaction defects are resolved. Touch work remains paused and outside
this checkpoint.

### Native follow-up: fractional near-axis segments

All 25 first connection groups passed in hosted Chrome, and production-site native
port/preview/export checks passed. Manual replay then exposed a real imported
Conditional-flow segment with ordinates 265.199203187251 and 265.4183266932271:
exact-axis classification incorrectly treated its ordinary drag as a free bend.
The focused correction shares the pinned upstream inclusive 2-diagram-unit
classification across handles, gesture selection and segment planning. Only the
edited segment is normalized; original fractional DI remains exact on cancellation
and undo. Local follow-up passes 222 unit tests. The native suite now has 27 groups,
including the exact horizontal case, a vertical counterpart and actual viewer
reimport of all 12 creation variants. These new assertions await hosted execution.
