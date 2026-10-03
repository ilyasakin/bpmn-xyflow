# bpmn-xyflow — BPMN 2.0 for the web (xyflow-based)

View and edit BPMN 2.0 diagrams in the browser. Built on
[@xyflow/system](https://github.com/xyflow/xyflow) for pan/zoom and the
original
[BpmnRenderer](./lib/draw/BpmnRenderer.js) /
[TextRenderer](./lib/draw/TextRenderer.js) /
[PathMap](./lib/draw/PathMap.js) (carried over from
[bpmn-js](https://github.com/bpmn-io/bpmn-js), this project's upstream).

This is a fork: the diagram-js stack has been replaced; the public API
is smaller and direct.

## Quick start

```js
import { Viewer, Modeler } from 'bpmn-xyflow';

const viewer = new Viewer({ container: document.getElementById('app') });
await viewer.importXML(xml);
viewer.fitView();
```

For full editing:

```js
const modeler = new Modeler({
  container: document.getElementById('app'),
  minimap: true
});
await modeler.importXML(xml);

const xml = await modeler.getXML();
```

## Framework wrappers

```js
import { BpmnViewer } from 'bpmn-xyflow/lib/react';   // React 18+
import { BpmnViewer } from 'bpmn-xyflow/lib/vue';     // Vue 3
import BpmnViewer from 'bpmn-xyflow/lib/svelte/BpmnViewer.svelte';  // Svelte 5
```

`react`, `react-dom`, `vue`, and `svelte` are declared as **optional
peer dependencies** — install only the ones you actually use.

Each wrapper takes the same `xml` prop, forwards every viewer event
(`onElementClick` / `onSelectionChange` / `onViewportChange` / etc.)
and exposes the imperative API (`fitView`, `select`, `setViewport`,
…) via the framework's standard ref / `bind:this` mechanism.

`xml` and `bpmnDiagramId` are reactive inputs. Constructor options such as
`config`, `moddleExtensions`, `minZoom`, `maxZoom`, `fitPadding`, `fitInsets`, keyboard,
selection, minimap, and resize behavior are read only when the wrapper mounts.
Changing those props does not reconfigure an existing viewer: remount it (for
example with a new framework `key`), or use a supported imperative method such
as `setViewport` or `setMinimap`. Callback props use their latest values.

React's `useBpmnViewer(options)` returns `{ containerRef, viewer, getViewer }`.
Attach `containerRef` to the host element; `viewer` is initially `null` and
updates after mounting, so effects depending on `[viewer]` can import a diagram.
The hook's constructor options are also mount-only, and unmounting destroys the
instance.


### Fitting around editor controls

`fitView()` leaves room for the palette, editor-actions toolbar, minimap and
visible bpmn.io attribution. `fitPadding` is additional padding in pixels.
For app-owned controls, pass `fitInsets: { top, right, bottom, left }` in pixels.
The default minimum zoom is `0.01` so large process models can fit small screens;
an explicitly configured `minZoom` remains a lower limit.

## Modeler features

- Move shapes (drag); edges follow with bend preservation
- Resize shapes (8 handles) — descendants of a Lane / SubProcess
  follow; attached BoundaryEvents slide along the perimeter
- Connect shapes — context-pad button, hover-edge handle, or
  Shift+drag — with BPMN-aware type inference (SequenceFlow /
  MessageFlow / Association / DataAssociation)
- Reconnect by dragging an edge endpoint to a different shape
- Inline label editing (seamless: editor matches renderer font and
  position, follows zoom while open)
- Undo / redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`); compound steps —
  one user gesture = one undo
- Copy / paste (`Cmd+C` / `Cmd+V` / `Cmd+D` to duplicate)
- Modeling rules + connection-type inference
- BoundaryEvent attach / detach on drop
- SubProcess drill-in / collapse, with global undo/redo across diagrams
- Snap to siblings + 5px grid + alignment guides; `Shift` constrains
  to dominant axis
- Descriptor-driven BPMN XML parse/write with independent upstream validation

## Demo

```sh
pnpm install
pnpm start
```

The modeler sample menu includes three authored synthetic business scenarios
(order/payment/delivery, approval/rejection/rework, and booking/timeout/
compensation), plus the retained upstream HR recruitment example. Source XML
lives in `test/fixtures/scenarios/` and `test/fixtures/bpmn/complex.bpmn`.
The retained fixtures remain subject to the repository's original notices.

Then open the routes the dev server prints:

| Route       | What |
|-------------|------|
| `/`         | vanilla viewer demo (read-only) |
| `/modeler/` | full modeler with palette, minimap, export |
| `/react/`   | React-wrapped demo |
| `/vue/`     | Vue-wrapped demo |
| `/svelte/`  | Svelte-wrapped demo |

## Tests

```sh
pnpm test                    # all puppeteer-driven smoke suites
pnpm test:smoke              # modeler (~56 cases)
pnpm test:react              # React wrapper
pnpm test:multi              # React, Vue, and Svelte wrappers
```

## Tooling

- Build / dev: [Vite](https://vitejs.dev) (no webpack, no babel-loader)
- Lint: [oxlint](https://oxc.rs) — `pnpm lint`
- Format: oxfmt — `pnpm format`
- Package manager: [pnpm](https://pnpm.io)

## Repo layout

```
lib/
├── Viewer.js         read-only viewer
├── Modeler.js        full editor
├── Importer.js       BPMN XML → graph
├── Renderer.js       wraps the upstream BpmnRenderer
├── modeling/         CommandStack + Rules
├── react/  vue/  svelte/   framework wrappers
├── demo/             dev server + smoke tests
├── draw/             reused: BpmnRenderer, TextRenderer, PathMap
├── import/           reused: BpmnTreeWalker
├── util/             reused: ModelUtil, LabelUtil, DiUtil, …
└── model/            BPMN type definitions
```

## License

See [LICENSE](./LICENSE). Retained source from [bpmn-js](https://github.com/bpmn-io/bpmn-js) is subject to its original notice and visible bpmn.io watermark requirements. The upstream watermark source is retained unchanged. BPMN descriptor data has its own [MIT notice](./lib/bpmn/schema.LICENSE).

## Parity status

The [verification ledger](./docs/PARITY.md) distinguishes implemented and tested core behavior from pending gates and optional extensions. This package does not claim drop-in upstream API/plugin compatibility.

### Control themes

Editor controls use the semantic `--bio-*` tokens from bpmn-js 18.30.1
(`dist/assets/diagram-js.css` and `bpmn-js.css`, sourced from `@bpmn-io/theme`).
The exact upstream default values are retained in `lib/util/Theme.js`; the full
upstream CSS is not injected because the XYFlow DOM has different selectors.
Without a theme, surfaces stay light and control text stays readable on dark host
pages. Override tokens on the viewer container or any ancestor, for example:

```css
.my-diagram {
  --bio-primary: #006daa;
  --bio-canvas-accent: #006daa;
  --bio-focus: #006daa;
  --bio-surface: #fff;
  --bio-surface-subtle: #f5f6f8;
  --bio-text: #23252a;
  --bio-border: #bbc0cc;
  --bio-radius-md: 3px;
}
```

Overrides inherit and update mounted controls without remounting. Body-mounted
text-editing and drag overlays copy the scoped tokens when opened. For a dark
control theme, also set `--bpmn-xyflow-color-scheme: dark` so native controls match.
These tokens style editing UI, minimap, focus and selection; they do not rewrite
BPMN document colors or the retained renderer. The required bpmn.io logo remains
visible and its original attribution dialog is preserved.
