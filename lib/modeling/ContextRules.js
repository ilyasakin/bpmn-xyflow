/** Thin direct-API adapter around pinned upstream pure contextual predicates.
 * No upstream Modeler, Canvas, command stack or module injector is instantiated.
 * See ../upstream/PROVENANCE.json and ../upstream/LICENSE.
 */
import BpmnRules from '../upstream/rules/BpmnRules';
const rules = BpmnRules.prototype;
const hasBusinessObject = shape => !!shape?.businessObject?.$instanceOf;
const list = shapes => Array.isArray(shapes) ? shapes : [shapes];
export function canCreate(shape, parent, source, position) {
  return hasBusinessObject(shape) && hasBusinessObject(parent) && !!rules.canCreate(shape,parent,source,position);
}
export function canDrop(shape, parent) {
  return hasBusinessObject(shape) && hasBusinessObject(parent) && !!rules.canDrop(shape,parent);
}
export function canMove(shapes, parent) {
  return list(shapes).every(hasBusinessObject) && (parent === undefined || hasBusinessObject(parent)) && !!rules.canMove(list(shapes),parent);
}
export function canAttach(shapes, host, position) {
  return list(shapes).every(hasBusinessObject) && hasBusinessObject(host) && !!rules.canAttach(list(shapes),host,null,position);
}
export function dropReplacements(shapes, parent, position) {
  return list(shapes).every(hasBusinessObject) && hasBusinessObject(parent) ? rules.canReplace(list(shapes),parent,position) : false;
}
export function canInsert(shape, edge, position) {
  return hasBusinessObject(shape) && hasBusinessObject(edge) && !!rules.canInsert(shape,edge,position);
}
export function canCopy(selected, element) {
  return hasBusinessObject(element) && !!rules.canCopy(selected,element);
}
export function canResize(shape, newBounds, direction) {
  return hasBusinessObject(shape) && !!rules.canResize(shape, newBounds, direction);
}
