/**
 * Plan explicit removal of incompatible BPMN IO without changing the model.
 * Activity, catch and throw events have different item ownership. This follows
 * the removal policy exercised by bpmn-js 18.30.1 BpmnReplace (its resolved
 * diagram-js version is 15.27.1), while preserving compatible metadata and IDs.
 * The caller owns the atomic command, DI cleanup and exact undo.
 */
const IO_KEYS = [ 'ioSpecification', 'dataInputs', 'dataOutputs', 'inputSet', 'outputSet',
  'dataInputAssociations', 'dataOutputAssociations' ];
const values = value => Array.isArray(value) ? value : value == null ? [] : [ value ];
const is = (object, type) => !!object?.$instanceOf?.(type);

function contained(root) {
  const result = new Set();
  const visit = object => {
    if (!object || typeof object !== 'object' || result.has(object)) return;
    result.add(object);
    for (const property of object.$descriptor?.properties || []) {
      if (!property.isReference && !property.isVirtual && !property.isAttr) values(object[property.name]).forEach(visit);
    }
    values(object.$children).forEach(visit);
    values(object.__extras).forEach(visit);
  };
  visit(root);
  return result;
}

const family = object => is(object, 'bpmn:Activity') ? 'activity' :
  is(object, 'bpmn:CatchEvent') ? 'catch' : is(object, 'bpmn:ThrowEvent') ? 'throw' : null;

export function planIOReplacement(source, target, root) {
  const result = { required: false, keys: [], associations: new Set(), removed: new Set(), blockedReferences: [] };
  if (!source?.$descriptor || !target?.$descriptor) return result;
  const supported = new Set(target.$descriptor.properties.map(property => property.name));
  for (const key of [ ...IO_KEYS, 'properties' ]) {
    if (!values(source[key]).length) continue;
    if (supported.has(key) && (key === 'properties' || family(source) === family(target))) continue;
    result.keys.push(key);
    values(source[key]).forEach(item => contained(item).forEach(object => result.removed.add(object)));
  }
  result.required = result.keys.length > 0;
  if (!result.required) return result;
  if (!root) {
    root = source;
    const seen = new Set();
    while (root.$parent && !seen.has(root.$parent)) { seen.add(root); root = root.$parent; }
  }
  const all = contained(root);
  // Associations may be owned by another activity or visible only on a
  // sibling plane, but still refer to an item being removed here.
  for (const object of all) {
    if (!is(object, 'bpmn:DataAssociation')) continue;
    if (result.removed.has(object) || [ ...values(object.sourceRef), ...values(object.targetRef) ].some(item => result.removed.has(item))) {
      result.associations.add(object);
      contained(object).forEach(item => result.removed.add(item));
    }
  }
  for (const object of all) {
    if (result.removed.has(object) || /^bpmndi:|^di:|^dc:/.test(object.$type || '')) continue;
    for (const property of object.$descriptor?.properties || []) {
      if (property.isReference && !property.isVirtual && values(object[property.name]).some(item => result.removed.has(item))) {
        result.blockedReferences.push({ object, key: property.name });
      }
    }
  }
  return result;
}
