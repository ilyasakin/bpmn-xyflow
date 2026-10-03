import UpdateCategoryValueRefsHandler from '../upstream/modeling/cmd/UpdateCategoryValueRefsHandler';

/** Plan a Group label's standard binding without changing its document. */
export function planGroupCategory(group, definitions, moddle, createId) {
  if (!group?.$instanceOf?.('bpmn:Group') || !definitions || !moddle?.create || typeof createId !== 'function') return null;
  let value = group.categoryValueRef;
  if (value != null && !value.$instanceOf?.('bpmn:CategoryValue')) return null;
  const createdValue = value == null;
  if (createdValue) value = moddle.create('bpmn:CategoryValue', { id: createId('CategoryValue') });
  let category = value.$parent?.$instanceOf?.('bpmn:Category') ? value.$parent :
    (definitions.rootElements || []).find(root => root.$instanceOf?.('bpmn:Category') && (root.categoryValue || []).includes(value));
  const createdCategory = !category;
  if (!category) category = moddle.create('bpmn:Category', { id: createId('Category') });
  return {
    value, category, createdValue, createdCategory,
    needsRootMembership: !(definitions.rootElements || []).includes(category),
    needsValueMembership: !(category.categoryValue || []).includes(value),
    previousValue: group.categoryValueRef, previousValueParent: value.$parent,
    previousCategoryParent: category.$parent
  };
}

/**
 * Targeted standard grouping deltas. Shadow objects isolate upstream lazy
 * property initialization and legacy binding repair. Collapsed descendants
 * share a shadow subprocess-plane root, so collapsing removes outer-group
 * membership while retaining the child diagram's own categories.
 *
 * affectedGroups are pre-operation { groupShape, categoryValue } identities,
 * including removed Groups. The Modeler owns exact arrays, bindings and Undo.
 */
export function planGroupMembership(affectedFlowElements, affectedGroups, elements, moddle, createId) {
  const validValue = value => value == null || !!value.$instanceOf?.('bpmn:CategoryValue');
  const scopes = new Map();
  const scope = element => {
    if (scopes.has(element)) return scopes.get(element);
    const seen = new Set([element]); let parent = element?.parent, collapsed = null, cyclic = false;
    while (parent) {
      if (seen.has(parent)) { cyclic = true; break; }
      seen.add(parent);
      if (!collapsed && parent.parent && (parent.collapsed ||
          parent.businessObject?.$instanceOf?.('bpmn:SubProcess') && parent.di?.isExpanded === false)) collapsed = parent;
      parent = parent.parent;
    }
    const result = { collapsed, cyclic }; scopes.set(element, result); return result;
  };
  const validBinding = element => element && !scope(element).cyclic &&
    (!element.businessObject?.$instanceOf?.('bpmn:Group') || validValue(element.businessObject.categoryValueRef));
  const eligible = element => validBinding(element) && (!element.hidden || !!scope(element).collapsed);
  const present = new Set(elements);
  elements = elements.filter(eligible);
  affectedFlowElements = affectedFlowElements.filter(element => eligible(element) &&
    !element.labelTarget && element.type !== 'label' && element.businessObject?.$instanceOf?.('bpmn:FlowElement'));
  affectedGroups = affectedGroups.filter(entry => validBinding(entry.groupShape) && validValue(entry.categoryValue) &&
    (!present.has(entry.groupShape) || eligible(entry.groupShape)));
  const shadows = new Map(), originals = new Map(), planeRoots = new Map();
  const planeRoot = element => {
    if (!planeRoots.has(element)) planeRoots.set(element, {
      id: `${element.id}__category_plane`, type: element.type,
      businessObject: element.businessObject, parent: null
    });
    return planeRoots.get(element);
  };
  const shadow = element => {
    if (!element) return element;
    if (shadows.has(element)) return shadows.get(element);
    const businessObject = element.businessObject && Object.create(element.businessObject);
    if (Array.isArray(element.businessObject?.categoryValueRef)) businessObject.categoryValueRef = element.businessObject.categoryValueRef.slice();
    const result = { ...element, businessObject };
    shadows.set(element, result); originals.set(result, element);
    if (businessObject) originals.set(businessObject, element.businessObject);
    if (element.parent) {
      const collapsed = scope(element).collapsed;
      result.parent = element.parent === collapsed ? planeRoot(collapsed) : shadow(element.parent);
    }
    return result;
  };
  const shadowElements = elements.map(shadow);
  const registry = { filter: predicate => shadowElements.filter(predicate), getAll: () => shadowElements };
  const factory = { create: (type, attrs = {}) => moddle.create(type, { id: createId(type.replace(/^bpmn:/, '')), ...attrs }) };
  const handler = new UpdateCategoryValueRefsHandler(factory, registry);
  const changes = handler._computeUpdates(affectedFlowElements.map(shadow),
    affectedGroups.map(entry => ({ ...entry, groupShape: shadow(entry.groupShape) })));
  return {
    flowElements: changes.flowElements.map(change => ({ ...change, businessObject: originals.get(change.businessObject) || change.businessObject })),
    groups: changes.groups.map(change => ({ ...change, groupShape: originals.get(change.groupShape) || change.groupShape }))
  };
}
