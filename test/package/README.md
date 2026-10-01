# Packed consumer smoke

Run `pnpm run build && pnpm run test:package` after installing development dependencies.

This test runs `npm pack --ignore-scripts`, extracts the tarball into a temporary
consumer, and resolves the published package name and subpaths. It does not use
source aliases, publish anything, download dependencies, or launch a browser.
Installed dependencies are linked into the consumer only after the root-only
checks finish. All temporary files are removed, including after a failed check.

Coverage:

- The tarball includes every public declaration file.
- Root declarations compile with **no framework packages installed**.
- Root, React, Vue, Svelte index, and direct `.svelte` imports compile with strict
  TypeScript and `skipLibCheck: false`, under both `Bundler` and `NodeNext` module
  resolution. Negative assertions reject unsupported arguments and methods.
- React JSX, Vue component refs, Svelte 5 `mount`, callback payloads and wrapper
  imperative methods are checked using their installed framework types.
- Each entrypoint builds with Vite from the packed package; Svelte source goes
  through the installed Svelte compiler.
- The packed root bundle executes in the structural DOM harness. It verifies the
  declared Viewer/Modeler member names against the runtime instances, then checks
  importing, modeling, alignment, distribution, space, search/focus, SVG/XML
  export, and undo/redo.
- The packed Modeler also checks `replace(..., {}, { removeIncompatibleData: true })`:
  default and malformed-option refusal, explicit owned-IO cleanup across two
  diagrams, preserved metadata and Property identity, exact undo/redo, and
  independent composition with `removeContents`.
- Flow-owned annotation associations execute through the packed `connect`,
  `reconnect` and `updateWaypoints` APIs. Both endpoint directions, redocking,
  owner changes, dependent route updates, metadata, clipboard edge IDs, malformed
  routes and exact XML history/reopen are checked. Shape-only methods remain
  narrow in the declaration tests; `appendShape` remains private.

The DOM harness does not provide browser geometry or gesture coverage. Those are
covered by the separate browser suites. `NodeNext` is a **declaration-resolution**
check, not a claim that this browser-targeted library runs directly in Node.
Wrapper smoke uses installed framework versions; it is not a cross-version
compatibility matrix or a claim of upstream BPMN plugin/API compatibility.

Package `types` conditions are placed before runtime conditions, following the
[TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html#packagejson-exports).
Root declarations never import framework entrypoints; each wrapper owns its
framework-specific component type.
