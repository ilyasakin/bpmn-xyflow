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
