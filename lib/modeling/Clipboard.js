/** Clone a BPMN containment graph while remapping its internal references.
 * External references (messages, called processes, etc.) keep their identity.
 * Unlike JSON cloning, this preserves moddle types, extension trees and cycles.
 */
export function cloneSemanticGraph(moddle, roots, { newId = null } = {}) {
  const clones = new Map();
  const ownEntries = object => Object.entries(object).filter(([ key ]) =>
    ![ '$parent', '$type', '$model', '$descriptor', '$attrs', '$xml' ].includes(key));
  const property = (object, key) => object.$descriptor && (object.$descriptor.properties || []).find(prop =>
    prop.name === key || prop.ns && prop.ns.localName === key);
  const isReference = (object, key, value) => {
    const prop = property(object, key);
    if (prop) return prop.isReference || prop.isVirtual;
    // Generic extension children are owned; their XML parser metadata is
    // copied separately so mixed-content order and namespaces survive.
    if (key === '$children') return false;
    const values = Array.isArray(value) ? value : [ value ];
    return values.some(item => item && item.$type && item.$parent !== object);
  };
  function collect(object) {
    if (!object || typeof object !== 'object' || clones.has(object)) return;
    let clone;
    if (object.$type) {
      clone = object.$descriptor && object.$descriptor.isGeneric
        ? moddle.createAny(object.$type, object.$descriptor.ns.uri, {})
        : moddle.create(object.$type);
    } else clone = Array.isArray(object) ? [] : {};
    clones.set(object, clone);
    for (const [ key, value ] of ownEntries(object)) {
      if (isReference(object, key, value)) continue;
      (Array.isArray(value) ? value : [ value ]).forEach(item => {
        if (item && typeof item === 'object') collect(item);
      });
    }
  }
  roots.forEach(collect);
  const plain = value => {
    if (clones.has(value)) return clones.get(value);
    if (Array.isArray(value)) return value.map(plain);
    if (value && typeof value === 'object' && !value.$type) return Object.fromEntries(Object.entries(value).map(([ k, v ]) => [ k, plain(v) ]));
    return value;
  };
  clones.forEach((clone, original) => {
    for (const [ key, value ] of ownEntries(original)) {
      if (key === 'id' && newId) clone.id = newId(original.$type || 'Element');
      else Object.defineProperty(clone, key, { value: plain(value), writable: true, enumerable: true, configurable: true });
    }
    if (original.$attrs) {
      const attributes = clone.$attrs || (clone.$attrs = Object.create(null));
      for (const [key, value] of Object.entries(original.$attrs)) {
        Object.defineProperty(attributes, key, { value: plain(value), writable: true, enumerable: true, configurable: true });
      }
    }
    if (original.$xml) Object.defineProperty(clone, '$xml', { value: plain(original.$xml), writable: true, configurable: true });
    if (original.$xmlBody !== undefined) Object.defineProperty(clone, '$xmlBody', { value: original.$xmlBody, writable: true, configurable: true });
    if (original.$type) clone.$parent = clones.get(original.$parent) || original.$parent || null;
  });
  return clones;
}
