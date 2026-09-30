/**
 * Dependency-free BPMN model and XML adapter.
 *
 * The complete BPMN descriptors describe containment, references, defaults and
 * XML aliases. Extension descriptors use the same format as bpmn-moddle.
 * Unknown XML is retained as generic elements, including its namespace and
 * mixed content; editing a diagram must never silently erase vendor metadata.
 */
import builtinPackages from './schema.js';

const NS = Object.fromEntries(builtinPackages.map(pkg => [ pkg.prefix, pkg.uri ]));
NS.xsi = 'http://www.w3.org/2001/XMLSchema-instance';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const PRIMITIVES = new Set([ 'String', 'Boolean', 'Integer', 'Real', 'Element' ]);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const qualify = (name, prefix) => name.includes(':') || PRIMITIVES.has(name) ? name : prefix + ':' + name;
const localName = name => name.slice(name.indexOf(':') + 1);
const hidden = (obj, name, value) => Object.defineProperty(obj, name, { value, writable: true, configurable: true });

function createRegistry(extensions = {}) {
  const packages = Object.values({ ...Object.fromEntries(builtinPackages.map(pkg => [ pkg.prefix, pkg ])), ...extensions });
  const byPrefix = new Map(packages.map(pkg => [ pkg.prefix, pkg ]));
  const byUri = new Map(packages.map(pkg => [ pkg.uri, pkg ]));
  const types = new Map();
  const descriptors = new Map();
  const tags = new Map();

  for (const pkg of packages) {
    for (const type of pkg.types || []) {
      const name = qualify(type.name, pkg.prefix);
      types.set(name, { ...type, name, $pkg: pkg });
      const tag = pkg.xml?.tagAlias === 'lowerCase' ? localName(name)[0].toLowerCase() + localName(name).slice(1) : localName(name);
      tags.set(pkg.uri + '#' + tag, name);
    }
  }

  function isA(type, target, visited = new Set()) {
    if (type === target || target === 'Element') return true;
    if (visited.has(type)) return false;
    visited.add(type);
    const definition = types.get(type);
    if (!definition) return false;
    if ((definition.superClass || []).some(parent => isA(qualify(parent, definition.$pkg.prefix), target, visited))) return true;
    // Extension traits participate in instanceOf, but do not recurse back into
    // their targets (which would make every extended type a subtype of itself).
    const trait = types.get(target);
    return !!trait?.extends?.some(parent => {
      const targetType = qualify(parent, trait.$pkg.prefix);
      return targetType !== target && isA(type, targetType, new Set());
    });
  }

  function descriptor(type) {
    if (descriptors.has(type)) return descriptors.get(type);
    const definition = types.get(type);
    if (!definition) return null;
    const properties = [];
    const allTypes = [];
    const visited = new Set();
    const aliases = new Map();

    function add(def, extended = false) {
      if (!def || visited.has(def.name)) return;
      visited.add(def.name);
      for (const parent of def.superClass || []) add(types.get(qualify(parent, def.$pkg.prefix)), extended);
      allTypes.push(def);
      for (const raw of def.properties || []) {
        const nsName = qualify(raw.name, def.$pkg.prefix);
        const prefix = nsName.split(':')[0];
        const prop = { ...raw, name: localName(nsName), ns: { name: nsName, prefix, localName: localName(nsName) }, type: qualify(raw.type || 'String', def.$pkg.prefix), isExtended: extended, $owner: def.name };
        const replacement = raw.redefines || raw.replaces;
        if (replacement) {
          const [ ownerType, oldName ] = replacement.split('#');
          const oldType = qualify(ownerType, def.$pkg.prefix);
          const index = properties.findIndex(p => p.$owner === oldType && p.name === localName(oldName));
          if (index !== -1) {
            aliases.set(properties[index].ns.name, prop);
            aliases.set(properties[index].name, prop);
            if (raw.redefines) properties.splice(index, 1, prop);
            else { properties.splice(index, 1); properties.push(prop); }
            continue;
          }
        }
        const index = properties.findIndex(p => p.ns.name === prop.ns.name);
        if (index === -1) properties.push(prop);
        else properties[index] = prop;
      }
    }
    add(definition);
    for (const trait of types.values()) {
      if (trait.extends?.some(parent => isA(type, qualify(parent, trait.$pkg.prefix)))) add(trait, true);
    }
    const propertiesByName = Object.create(null);
    for (const [ name, prop ] of aliases) propertiesByName[name] = prop;
    for (const prop of properties) {
      propertiesByName[prop.name] = prop;
      propertiesByName[prop.ns.name] = prop;
    }
    const result = { name: type, ns: { name: type, prefix: definition.$pkg.prefix, localName: localName(type) }, properties, propertiesByName, allTypes, allTypesByName: Object.fromEntries(allTypes.map(t => [ t.name, t ])), bodyProperty: properties.find(p => p.isBody), idProperty: properties.find(p => p.isId), $pkg: definition.$pkg };
    descriptors.set(type, result);
    return result;
  }

  return { packages, byPrefix, byUri, types, tags, descriptor, isA };
}

function coerce(value, type) {
  if (type === 'Boolean') return value === true || value === 'true' || value === '1';
  if (type === 'Integer' || type === 'Real') {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  return value;
}

function createModel(extensions) {
  const registry = createRegistry(extensions);
  const prototypes = new Map();
  const model = {
    fromXML(xml, typeName = 'bpmn:Definitions', options = {}) {
      if (typeof typeName === 'object') { options = typeName; typeName = 'bpmn:Definitions'; }
      return Promise.resolve().then(() => readXML(xml, model, typeName, options));
    },
    toXML(rootElement, options = {}) {
      return Promise.resolve().then(() => ({ xml: writeXML(rootElement, model, options) }));
    },
    create(type, attrs = {}) {
      const descriptor = registry.descriptor(type);
      if (!descriptor) throw new Error(`unknown type <${ type }>`);
      let prototype = prototypes.get(type);
      if (!prototype) {
        prototype = {};
        for (const prop of descriptor.properties) {
          if (own(prop, 'default')) prototype[prop.name] = prop.default;
        }
        prototypes.set(type, prototype);
      }
      const element = Object.create(prototype);
      decorate(element, type, descriptor);
      for (const [ key, value ] of Object.entries(attrs)) if (value !== undefined) element.set(key, value);
      return element;
    },
    createAny(name, uri, properties = {}) {
      const element = {};
      const prefix = name.includes(':') ? name.split(':')[0] : '';
      decorate(element, name, { name, isGeneric: true, ns: { name, prefix, localName: localName(name), uri }, properties: [], propertiesByName: {} });
      for (const [ key, value ] of Object.entries(properties)) element[key] = value?.value !== undefined && value?.name ? value.value : value;
      return element;
    },
    getType(type) {
      if (!registry.descriptor(type)) throw new Error(`unknown type <${ type }>`);
      const Constructor = function(attrs) { return model.create(type, attrs); };
      Constructor.$descriptor = registry.descriptor(type);
      Constructor.hasType = target => registry.isA(type, target);
      return Constructor;
    },
    getTypeDescriptor: type => registry.descriptor(type),
    getElementDescriptor: element => element.$descriptor,
    getPropertyDescriptor: (element, name) => element.$descriptor.propertiesByName[name],
    getPackage: name => registry.byPrefix.get(name) || registry.byUri.get(name),
    getPackages: () => registry.packages,
    hasType: (element, type) => registry.isA(element.$type, type)
  };
  hidden(model, '_registry', registry);

  function decorate(element, type, descriptor) {
    hidden(element, '$type', type);
    hidden(element, '$parent', null);
    hidden(element, '$descriptor', descriptor);
    hidden(element, '$model', model);
    hidden(element, '$attrs', Object.create(null));
    hidden(element, '$instanceOf', function(target) { return registry.isA(this.$type, target); });
    hidden(element, 'get', function(name) {
      const prop = this.$descriptor.propertiesByName[name];
      if (!prop) return this.$descriptor.isGeneric ? this[name] : this.$attrs[name];
      if (prop.isMany && !own(this, prop.name)) this[prop.name] = [];
      return this[prop.name];
    });
    hidden(element, 'set', function(name, value) {
      const prop = this.$descriptor.propertiesByName[name];
      const target = prop || this.$descriptor.isGeneric ? this : this.$attrs;
      const key = prop ? prop.name : name;
      if (value === undefined) delete target[key];
      else target[key] = value;
      return this;
    });
  }
  return model;
}

function readXML(xml, model, rootType) {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser not available; call moddle.fromXML() in a browser context');
  // BPMN does not require a DTD. Reject it before parsing so neither external
  // entity resolution nor entity-expansion attacks depend on the host parser.
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, ''))) throw new Error('DOCTYPE and entity declarations are not supported');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  // Browser error documents use this reserved namespace. A vendor is free
  // to name its own extension 'parsererror'; that is ordinary user data.
  const error = document.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror')[0];
  if (error) throw new Error('XML parse error: ' + error.textContent);
  const root = document.documentElement;
  const registry = model._registry;
  const warnings = [];
  const references = [];
  const elementsById = new Map();

  function tagType(node) {
    return registry.tags.get(node.namespaceURI + '#' + node.localName);
  }

  function xsiType(node) {
    const value = node.getAttributeNS(NS.xsi, 'type');
    if (!value) return null;
    const [ prefix, name ] = value.includes(':') ? value.split(':') : [ null, value ];
    const pkg = registry.byUri.get(node.lookupNamespaceURI(prefix) || (!prefix && node.lookupNamespaceURI('')));
    if (!pkg) return null;
    const stripped = pkg.xml?.typePrefix && name.startsWith(pkg.xml.typePrefix) ? name.slice(pkg.xml.typePrefix.length) : name;
    return registry.types.has(pkg.prefix + ':' + stripped) ? pkg.prefix + ':' + stripped : null;
  }

  function setProperty(element, prop, value) {
    if (prop.isMany) {
      if (!own(element, prop.name)) element[prop.name] = [];
      element[prop.name].push(value);
    } else element[prop.name] = value;
    if (value?.$type && !prop.isReference) value.$parent = element;
  }

  function reference(element, prop, id) {
    // Keep unresolved IDs too. Malformed imports must not lose data on export.
    setProperty(element, prop, id);
    references.push({ element, property: prop.ns.name, id, obj: element, key: prop.name, idValue: id, isMany: !!prop.isMany, index: prop.isMany ? element[prop.name].length - 1 : undefined });
  }

  function parseNode(node, forcedType, forceGeneric = false) {
    const type = forceGeneric ? null : forcedType || tagType(node);
    const descriptor = type && registry.descriptor(type);
    const element = descriptor ? model.create(type) : model.createAny(node.nodeName, node.namespaceURI);
    const namespaces = {};
    const attrNames = {};
    const content = [];
    hidden(element, '$xml', { name: node.nodeName, uri: node.namespaceURI, namespaces, attrNames, content });

    for (const attr of Array.from(node.attributes)) {
      if (attr.namespaceURI === XMLNS || attr.name === 'xmlns') {
        namespaces[attr.name === 'xmlns' ? '' : attr.localName] = attr.value;
        continue;
      }
      const pkg = registry.byUri.get(attr.namespaceURI);
      const canonical = pkg ? pkg.prefix + ':' + attr.localName : attr.name;
      const prop = descriptor && descriptor.propertiesByName[attr.namespaceURI ? canonical : attr.localName];
      if (prop && prop.isAttr) {
        attrNames[prop.name] = { name: attr.name, uri: attr.namespaceURI };
        if (prop.isReference) {
          for (const id of prop.isMany ? attr.value.trim().split(/\s+/) : [ attr.value ]) reference(element, prop, id);
        } else setProperty(element, prop, coerce(attr.value, prop.type));
      } else if (!(attr.namespaceURI === NS.xsi && attr.localName === 'type' && descriptor && xsiType(node))) {
        if (descriptor) element.$attrs[attr.name] = attr.value;
        else element[attr.name] = attr.value;
        attrNames[attr.name] = { name: attr.name, uri: attr.namespaceURI };
      }
    }

    const id = element.id;
    if (id) {
      if (elementsById.has(id)) throw new Error(`duplicate ID <${ id }>`);
      elementsById.set(id, element);
      // Upstream's elementsById is object-like; keep the existing Map API too.
      if (!(id in elementsById)) Object.defineProperty(elementsById, id, { value: element, enumerable: true });
    }

    let body = '';
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        body += child.nodeValue;
        if (!descriptor) content.push({ kind: 'text', value: child.nodeValue });
        continue;
      }
      if (child.nodeType === 8 || child.nodeType === 7) {
        content.push({ kind: 'raw', value: new XMLSerializer().serializeToString(child) });
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (!descriptor) {
        const value = parseNode(child);
        value.$parent = element;
        (element.$children ||= []).push(value);
        content.push({ kind: 'child', value });
        continue;
      }
      const pkg = registry.byUri.get(child.namespaceURI);
      const propertyName = pkg ? pkg.prefix + ':' + child.localName : child.nodeName;
      const candidate = descriptor.propertiesByName[propertyName];
      let prop = candidate && !candidate.isAttr && !candidate.isVirtual ? candidate : null;
      const childType = tagType(child);
      if (!prop) {
        prop = descriptor.properties.find(p => !p.isAttr && !p.isVirtual && !p.isReference && p.type !== 'Element' && childType && registry.isA(childType, p.type));
      }
      if (!prop) prop = descriptor.properties.find(p => !p.isAttr && !p.isVirtual && !p.isReference && p.type === 'Element');
      if (!prop) {
        const value = parseNode(child);
        value.$parent = element;
        (element.__extras ||= []).push(value);
        content.push({ kind: 'extra', value });
        warnings.push({ message: `unmapped child <${ child.nodeName }> in <${ node.nodeName }>; preserved`, context: { element } });
        continue;
      }
      let value;
      if (prop.isReference) {
        reference(element, prop, child.textContent.trim());
      } else if (PRIMITIVES.has(prop.type) && prop.type !== 'Element' || !registry.types.has(prop.type) && prop.type !== 'Element') {
        value = coerce(child.textContent, prop.type);
        setProperty(element, prop, value);
      } else {
        const explicitType = xsiType(child);
        // Open extension slots describe the element QName, not its xsi:type.
        // An unknown subtype is an opaque XML fragment, including mixed text.
        const opaque = prop.type === 'Element' && !childType || child.hasAttributeNS(NS.xsi, 'type') && !explicitType;
        value = parseNode(child, explicitType || (prop.type === 'Element' ? childType : childType && registry.isA(childType, prop.type) ? childType : prop.type), opaque);
        setProperty(element, prop, value);
      }
      content.push({ kind: 'property', name: prop.name });
    }
    if (descriptor?.bodyProperty) element[descriptor.bodyProperty.name] = coerce(body, descriptor.bodyProperty.type);
    else if (!descriptor && !element.$children?.length) element.$body = body;
    else if (body.trim()) hidden(element, '$xmlBody', body);
    return element;
  }

  const actualRootType = tagType(root);
  if (!actualRootType || rootType && !registry.isA(actualRootType, rootType)) throw new Error(`unexpected root element <${ root.nodeName }>; expected <${ rootType }>`);
  const rootElement = parseNode(root);
  for (const ref of references) {
    const target = elementsById.get(ref.id);
    if (target) {
      if (ref.isMany) ref.element[ref.key][ref.index] = target;
      else ref.element[ref.key] = target;
    } else warnings.push({ message: `unresolved reference <${ ref.id }>`, context: { element: ref.element, property: ref.property, value: ref.id } });
  }
  return { rootElement, warnings, references, elementsById };
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
}
function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
}

function writeXML(rootElement, model, options) {
  const registry = model._registry;
  const rootNamespaces = { ...rootElement.$xml?.namespaces };
  const prefixes = new Map();
  for (const [ desired, uri ] of Object.entries({ ...NS, ...Object.fromEntries(registry.packages.map(pkg => [ pkg.prefix, pkg.uri ])) })) {
    // Reserve stable canonical prefixes without changing a source QName's
    // meaning when a document happens to bind that prefix to another URI.
    let prefix = desired;
    let i = 1;
    while (rootNamespaces[prefix] && rootNamespaces[prefix] !== uri) prefix = desired + i++;
    rootNamespaces[prefix] = uri;
    prefixes.set(uri, prefix);
  }
  const active = new Set();
  function typeTag(type, q) {
    const definition = registry.types.get(type);
    if (!definition) return type;
    const name = localName(type);
    return q(definition.$pkg.prefix, definition.$pkg.xml?.tagAlias === 'lowerCase' ? name[0].toLowerCase() + name.slice(1) : name);
  }
  const refId = value => typeof value === 'object' ? value?.id : value;

  function serialize(element, property, depth = 0, parentScope = rootNamespaces) {
    if (!element?.$type) throw new Error('cannot serialize an untyped BPMN element');
    if (active.has(element)) throw new Error(`cyclic containment at <${ element.id || element.$type }>`);
    active.add(element);
    const descriptor = element.$descriptor || registry.descriptor(element.$type);
    const generic = descriptor?.isGeneric || !registry.types.has(element.$type);
    const wrapper = property?.xml?.serialize;
    const namespaces = depth === 0 ? { ...rootNamespaces } : { ...element.$xml?.namespaces };
    const scope = { ...parentScope, ...namespaces };
    const q = (prefix, name) => {
      const uri = registry.byPrefix.get(prefix)?.uri || NS[prefix];
      let chosen = prefixes.get(uri) || prefix;
      let suffix = 1;
      while (scope[chosen] && scope[chosen] !== uri) chosen = (prefixes.get(uri) || prefix) + suffix++;
      if (uri && scope[chosen] !== uri) { namespaces[chosen] = uri; scope[chosen] = uri; }
      return chosen + ':' + name;
    };
    const tag = generic ? element.$xml?.name || element.$type : wrapper ? q(property.ns.prefix, property.ns.localName) : typeTag(element.$type, q);
    const attrs = [];
    const used = new Set();
    function attribute(name, value, uri) {
      if (value == null || used.has(name)) return;
      used.add(name);
      if (uri && name.includes(':')) namespaces[name.split(':')[0]] = uri;
      attrs.push(`${ name }="${ escapeAttr(value) }"`);
    }
    if (generic) {
      const uri = element.$xml?.uri || descriptor?.ns?.uri;
      const prefix = tag.includes(':') ? tag.split(':')[0] : '';
      if (uri != null) namespaces[prefix] = uri;
      for (const [ name, value ] of Object.entries(element)) {
        if (name.startsWith('$') || name === '__extras' || typeof value === 'object') continue;
        attribute(name, value, element.$xml?.attrNames[name]?.uri);
      }
    } else {
      const opaqueType = Object.keys(element.$attrs).some(name => localName(name) === 'type' && (name === 'xsi:type' || element.$xml?.attrNames[name]?.uri === NS.xsi));
      if (wrapper === 'xsi:type' && !opaqueType && (element.$type !== property.type || element.$xml?.name)) {
        const pkg = registry.byPrefix.get(descriptor.ns.prefix);
        attribute(q('xsi', 'type'), q(descriptor.ns.prefix, (pkg.xml?.typePrefix || '') + localName(element.$type)), NS.xsi);
      }
      for (const prop of descriptor.properties) {
        if (!prop.isAttr || prop.isVirtual || !own(element, prop.name)) continue;
        let value = element[prop.name];
        if (value == null) continue;
        if (prop.isReference) value = prop.isMany ? value.map(refId).join(' ') : refId(value);
        const name = prop.isExtended ? q(prop.ns.prefix, prop.ns.localName) : prop.ns.localName;
        attribute(name, value, prop.isExtended ? registry.byPrefix.get(prop.ns.prefix)?.uri : null);
      }
    }
    for (const [ name, value ] of Object.entries(element.$attrs || {})) {
      const knownPrefix = name.includes(':') && name.split(':')[0];
      attribute(name, value, element.$xml?.attrNames[name]?.uri || registry.byPrefix.get(knownPrefix)?.uri || NS[knownPrefix]);
    }
    const children = [];
    const emitted = new Set();
    const emittedExtras = new Set();
    const props = descriptor?.properties || [];
    function emitProperty(name) {
      if (emitted.has(name)) return;
      emitted.add(name);
      const prop = descriptor.propertiesByName[name];
      const value = element[name];
      if (!prop || prop.isAttr || prop.isBody || prop.isVirtual || value == null) return;
      for (const item of prop.isMany ? value : [ value ]) {
        if (item == null) continue;
        if (prop.isReference || typeof item !== 'object') {
          const tag = q(prop.ns.prefix, prop.ns.localName);
          children.push(`<${ tag }>${ escapeText(prop.isReference ? refId(item) : item) }</${ tag }>`);
        } else children.push(serialize(item, prop, depth + 1, scope));
      }
    }
    const content = element.$xml?.content || [];
    if (generic) {
      const emittedChildren = new Set();
      const hasMixedContent = content.some(part => part.kind === 'child');
      for (const part of content) {
        if (part.kind === 'text' && hasMixedContent) children.push(escapeText(part.value));
        else if (part.kind === 'raw') children.push(part.value);
        else if (part.kind === 'child' && element.$children?.includes(part.value)) {
          children.push(serialize(part.value, null, depth + 1, scope));
          emittedChildren.add(part.value);
        }
      }
      for (const child of element.$children || []) if (!emittedChildren.has(child)) children.push(serialize(child, null, depth + 1, scope));
      if (element.$body != null) children.push(escapeText(element.$body));
    } else {
      // Original containment order retains unknown elements/comments. New
      // properties are appended in descriptor order and deleted ones stay gone.
      for (const part of content) {
        if (part.kind === 'property') emitProperty(part.name);
        else if (part.kind === 'raw') children.push(part.value);
        else if (part.kind === 'extra' && element.__extras?.includes(part.value)) {
          children.push(serialize(part.value, null, depth + 1, scope));
          emittedExtras.add(part.value);
        }
      }
      for (const prop of props) emitProperty(prop.name);
      for (const child of element.__extras || []) if (!emittedExtras.has(child)) children.push(serialize(child, null, depth + 1, scope));
      if (descriptor.bodyProperty && element[descriptor.bodyProperty.name] != null) children.push(escapeText(element[descriptor.bodyProperty.name]));
      else if (element.$xmlBody != null) children.push(escapeText(element.$xmlBody));
    }
    const declarations = Object.entries(namespaces).map(([ prefix, uri ]) => `${ prefix ? 'xmlns:' + prefix : 'xmlns' }="${ escapeAttr(uri) }"`);
    const attrString = [ ...declarations, ...attrs ].join(' ');
    const opening = `<${ tag }${ attrString ? ' ' + attrString : '' }`;
    active.delete(element);
    if (!children.length) return opening + ' />';
    const mixed = generic || descriptor.bodyProperty || element.$xmlBody;
    if (!options.format || mixed) return opening + '>' + children.join('') + `</${ tag }>`;
    const indent = '  '.repeat(depth);
    return opening + '>\n' + children.map(child => indent + '  ' + child).join('\n') + `\n${ indent }</${ tag }>`;
  }
  const preamble = options.preamble === false ? '' : '<?xml version="1.0" encoding="UTF-8"?>\n';
  return preamble + serialize(rootElement);
}

export function BpmnModdle(extensions = {}) { return createModel(extensions); }
const defaultModel = BpmnModdle();
export function parseXML(xml) { return defaultModel.fromXML(xml); }
export function serializeXML(rootElement, options = {}) { return writeXML(rootElement, rootElement.$model || defaultModel, options); }
export function createObject(type, attrs = {}) { return defaultModel.create(type, attrs); }
export function isA(type, target) { return defaultModel._registry.isA(type, target); }
export { NS };
