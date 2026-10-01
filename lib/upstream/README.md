# Pinned contextual rule source

These three source files are byte-identical to bpmn-js18.30.1, copied from its
published package. PROVENANCE.json records SHA-256 hashes. The unchanged upstream
license is included here, and the application retains visible bpmn.io attribution.

Only pure predicates on the rule prototype are called by the small
`modeling/ContextRules.js` adapter. The upstream Modeler, Canvas, injector and
command stack are never created; the application still uses XYFlow and its own
modeling commands. Existing ModelUtil/DiUtil/LabelUtil helpers are also retained
upstream implementations.

To upgrade, pin the new development oracle, compare these exact upstream paths,
copy only reviewed predicate/helper changes, update hashes/version and rerun the
adapter differential matrix plus independent real-business mutations and browser
validation. Function equality validates the adapter; it is not by itself proof
of end-to-end parity.

The four additional modeling/behavior/util files are unchanged pinned connection
attachment geometry helpers. ConnectionDependents wraps their pure adjustment
function; provenance records exact paths and hashes. No upstream engine is used.

GroupCategory uses only the pinned UpdateCategoryValueRefsHandler pure planning
method on shadow objects plus CategoryUtil. Both files are byte-identical and
listed in provenance; the fork owns mutations and exact history.

LineUtil.js is the unchanged bpmn-js 18.30.1 nearest-border geometry helper.
ExternalLabelResize uses it for the LabelBehavior owner-resize delta; its exact
source path and SHA-256 are recorded under additionalSources. The retained
upstream LICENSE applies. No upstream engine or command stack is instantiated.

The diagram-js subdirectory retains Text.js from diagram-js15.27.1, with its
original MIT LICENSE and a separate provenance manifest. One local security
patch replaces trailing-whitespace regex removal in getTextBBox with trimEnd().
The unanchored regex could retry a long whitespace run at each character when
followed by non-whitespace; the native string operation preserves ECMAScript
whitespace semantics without that polynomial backtracking. The empty-line dummy
measurement and original rendered text remain unchanged. Provenance records both
the upstream and patched hashes, and tests require this exact one-operation diff.
TextRenderer still matches the pinned exact-width line-fitting boundary. The
root diagram-js dependency and XYFlow interaction engine remain unchanged.
