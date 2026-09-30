/** Reconcile a fresh diagram while keeping objects/arrays held by undo commands. */
export function reconcileGraph(previous, fresh) {
  const reused = new Map();
  const arrayKeys = [ 'children', 'attachers', 'incoming', 'outgoing' ];
  const previousArrays = new Map();
  for (const [ id, element ] of fresh.elementsById) {
    const target = previous.elementsById.get(id) || element;
    if (target !== element) {
      previousArrays.set(id, Object.fromEntries(arrayKeys.filter(key => Array.isArray(target[key])).map(key => [key, target[key]])));
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(target, element);
    }
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
