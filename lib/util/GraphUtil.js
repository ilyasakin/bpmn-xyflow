/** Reconcile a fresh diagram while keeping objects/arrays held by undo commands. */
export function reconcileGraph(previous, fresh) {
  const reused = new Map();
  for (const [ id, element ] of fresh.elementsById) {
    const target = previous.elementsById.get(id) || element;
    if (target !== element) {
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(target, element);
    }
    reused.set(id, target);
  }
  const resolve = element => element && (reused.get(element.id) || element);
  for (const element of reused.values()) {
    for (const key of [ 'parent', 'host', 'label', 'labelTarget', 'source', 'target' ]) {
      if (element[key]) element[key] = resolve(element[key]);
    }
    for (const key of [ 'children', 'attachers', 'incoming', 'outgoing' ]) {
      if (Array.isArray(element[key])) element[key] = element[key].map(resolve);
    }
  }
  for (const key of [ 'nodes', 'edges', 'roots' ]) {
    previous[key].splice(0, previous[key].length, ...fresh[key].map(resolve));
  }
  previous.elementsById.clear();
  for (const [ id, element ] of reused) previous.elementsById.set(id, element);
  previous.warnings = fresh.warnings;
  return previous;
}
