/** Reconcile a fresh diagram while keeping objects/arrays held by undo commands. */
export function reconcileGraph(previous, fresh) {
  const reused = new Map();
  const arrayKeys = [ 'children', 'attachers', 'incoming', 'outgoing' ];
  const previousArrays = new Map();
  const sameRoute = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((point, index) => point.x === b[index].x && point.y === b[index].y);
  const sameEndpoint = (a, b) => a && b && a.id === b.id && a.businessObject === b.businessObject &&
    (a.waypoints || b.waypoints ? sameRoute(a.waypoints, b.waypoints) :
      [ 'x', 'y', 'width', 'height' ].every(key => a[key] === b[key]));
  const originalPoints = new Map();
  // Capture before reconciling shapes, which mutates the endpoint objects held
  // by old edges. Docking hints are transient graph data, absent from BPMN DI.
  // They remain valid only when the same representation, endpoints and route
  // are unchanged; an edited route must never inherit stale cached docking.
  for (const edge of fresh.edges) {
    const old = previous.elementsById.get(edge.id);
    if (old && old.businessObject === edge.businessObject && old.di === edge.di &&
        sameEndpoint(old.source, edge.source) && sameEndpoint(old.target, edge.target) &&
        sameRoute(old.waypoints, edge.waypoints)) originalPoints.set(edge.id, old.waypoints);
  }
  for (const [ id, element ] of fresh.elementsById) {
    const target = previous.elementsById.get(id) || element;
    if (target !== element) {
      previousArrays.set(id, Object.fromEntries(arrayKeys.filter(key => Array.isArray(target[key])).map(key => [key, target[key]])));
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(target, element);
    }
    const points = originalPoints.get(id);
    if (points) target.waypoints.forEach((point, index) => {
      if (!Object.hasOwn(point, 'original') && Object.hasOwn(points[index], 'original')) point.original = points[index].original;
    });
    reused.set(id, target);
  }
  const resolve = element => element && (reused.get(element.id) || element);
  for (const [ id, element ] of reused) {
    for (const key of [ 'parent', 'host', 'label', 'labelTarget', 'source', 'target' ]) {
      if (element[key]) element[key] = resolve(element[key]);
    }
    for (const key of arrayKeys) {
      const previousArray = previousArrays.get(id)?.[key];
      if (previousArray) {
        const members = (element[key] || []).map(resolve);
        previousArray.splice(0, previousArray.length, ...members);
        element[key] = previousArray;
      } else if (Array.isArray(element[key])) {
        element[key] = element[key].map(resolve);
      }
    }
  }
  for (const key of [ 'nodes', 'edges', 'roots' ]) {
    previous[key].splice(0, previous[key].length, ...fresh[key].map(resolve));
  }
  previous.elementsById.clear();
  for (const [ id, element ] of reused) previous.elementsById.set(id, element);
  previous.warnings = fresh.warnings;
  previous.diagram = fresh.diagram;
  return previous;
}
