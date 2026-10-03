/** BPMN-aware connection and containment rules, independent of the renderer. */
function is(element, type) {
  const bo = element && (element.businessObject || element);
  return !!(bo && typeof bo.$instanceOf === 'function' && bo.$instanceOf(type));
}
function hasDefinition(node, type) {
  return (node.businessObject.eventDefinitions || []).some(def => is(def, type));
}
function messageEvent(node) {
  return (node.businessObject.eventDefinitions || []).every(def => is(def, 'bpmn:MessageEventDefinition'));
}
function flowContainer(bo) {
  return is(bo, 'bpmn:Process') || is(bo, 'bpmn:SubProcess');
}
export function getFlowScope(node) {
  // Semantic ownership also works when a visual lane is in between.
  let bo = node && node.businessObject && node.businessObject.$parent;
  const seen = new Set();
  while (bo && !seen.has(bo)) {
    if (flowContainer(bo)) return bo;
    seen.add(bo);
    bo = bo.$parent;
  }
  let parent = node && node.parent;
  while (parent && !seen.has(parent)) {
    if (flowContainer(parent.businessObject)) return parent.businessObject;
    if (is(parent, 'bpmn:Participant')) return parent.businessObject.processRef || null;
    seen.add(parent);
    parent = parent.parent;
  }
  return null;
}
function organization(node) {
  if (is(node, 'bpmn:Participant')) return node.businessObject.processRef || node.businessObject;
  let bo = node && node.businessObject;
  const seen = new Set();
  while (bo && !seen.has(bo)) {
    if (is(bo, 'bpmn:Process')) return bo;
    seen.add(bo);
    bo = bo.$parent;
  }
  let parent = node && node.parent;
  while (parent && !seen.has(parent)) {
    if (is(parent, 'bpmn:Participant')) return parent.businessObject.processRef || parent.businessObject;
    if (is(parent, 'bpmn:Process')) return parent.businessObject;
    seen.add(parent);
    parent = parent.parent;
  }
  return null;
}
function ordinaryFlowNode(node) {
  return is(node, 'bpmn:FlowNode') && !node.businessObject.isForCompensation &&
    !(is(node, 'bpmn:SubProcess') && node.businessObject.triggeredByEvent);
}
function sequenceSource(node) {
  return ordinaryFlowNode(node) && !is(node, 'bpmn:EndEvent') &&
    !(is(node, 'bpmn:IntermediateThrowEvent') && hasDefinition(node, 'bpmn:LinkEventDefinition')) &&
    !(is(node, 'bpmn:BoundaryEvent') && hasDefinition(node, 'bpmn:CompensateEventDefinition'));
}
function sequenceTarget(node) {
  return ordinaryFlowNode(node) && !is(node, 'bpmn:StartEvent') && !is(node, 'bpmn:BoundaryEvent') &&
    !(is(node, 'bpmn:IntermediateCatchEvent') && hasDefinition(node, 'bpmn:LinkEventDefinition'));
}
function interaction(node) {
  return is(node, 'bpmn:InteractionNode');
}
function messageSource(node) {
  return interaction(node) && !is(node, 'bpmn:BoundaryEvent') &&
    (!is(node, 'bpmn:Event') || (is(node, 'bpmn:ThrowEvent') && messageEvent(node)));
}
function messageTarget(node) {
  return interaction(node) && !node.businessObject.isForCompensation &&
    (!is(node, 'bpmn:Event') || (is(node, 'bpmn:CatchEvent') && messageEvent(node))) &&
    (!is(node, 'bpmn:BoundaryEvent') || hasDefinition(node, 'bpmn:MessageEventDefinition'));
}
function eventGatewayTarget(node) {
  return is(node, 'bpmn:ReceiveTask') || (is(node, 'bpmn:IntermediateCatchEvent') &&
    [ 'Message', 'Timer', 'Conditional', 'Signal' ].some(t => hasDefinition(node, 'bpmn:' + t + 'EventDefinition')));
}
function ancestor(a, b) {
  const seen = new Set();
  while (b && !seen.has(b)) {
    if (a === b) return true;
    seen.add(b);
    b = b.parent;
  }
  return false;
}
export function getConnectionType(source, target, connection) {
  if (!source || !target || source.type === 'label' || target.type === 'label' ||
      source.labelTarget || target.labelTarget || !source.businessObject || !target.businessObject) return null;
  const a = organization(source), b = organization(target);
  if (!is(connection, 'bpmn:DataAssociation') && a !== b && messageSource(source) && messageTarget(target)) return 'bpmn:MessageFlow';
  const scope = getFlowScope(source);
  if (!is(connection, 'bpmn:DataAssociation') && scope === getFlowScope(target) && sequenceSource(source) && sequenceTarget(target) &&
      (!is(source, 'bpmn:EventBasedGateway') || eventGatewayTarget(target))) return 'bpmn:SequenceFlow';
  // Data associations may connect data references across visual containers.
  // Event output/input directions follow BPMN catch/throw semantics.
  const sourceData = is(source, 'bpmn:DataObjectReference') || is(source, 'bpmn:DataStoreReference');
  const targetData = is(target, 'bpmn:DataObjectReference') || is(target, 'bpmn:DataStoreReference');
  if (sourceData && (is(target, 'bpmn:Activity') || is(target, 'bpmn:ThrowEvent'))) return 'bpmn:DataInputAssociation';
  if (targetData && (is(source, 'bpmn:Activity') || is(source, 'bpmn:CatchEvent'))) return 'bpmn:DataOutputAssociation';
  if (scope === getFlowScope(target) && is(source, 'bpmn:BoundaryEvent') &&
      hasDefinition(source, 'bpmn:CompensateEventDefinition') && is(target, 'bpmn:Activity') &&
      source.host !== target && !target.attachers?.includes(source) && !target.businessObject.triggeredByEvent) return 'bpmn:Association';
  const sourceAnnotation = is(source, 'bpmn:TextAnnotation');
  const targetAnnotation = is(target, 'bpmn:TextAnnotation');
  if (sourceAnnotation !== targetAnnotation && !ancestor(source, target) && !ancestor(target, source)) return 'bpmn:Association';
  return null;
}
/** Connection semantic attributes inferred with the same priority as upstream. */
export function getConnectionAttributes(source, target, connection) {
  const type = getConnectionType(source, target, connection);
  if (!type) return null;
  if (type !== 'bpmn:Association') return { type };
  const compensation = getFlowScope(source) === getFlowScope(target) &&
    is(source, 'bpmn:BoundaryEvent') && hasDefinition(source, 'bpmn:CompensateEventDefinition') &&
    is(target, 'bpmn:Activity') && source.host !== target && !target.attachers?.includes(source) &&
    !target.businessObject.triggeredByEvent;
  return { type, associationDirection: compensation ? 'One' : 'None' };
}
export function canReconnect(connection, side, candidate) {
  if (!connection || !candidate || candidate === connection || ![ 'source', 'target' ].includes(side)) return false;
  // Connection endpoints are valid for annotation associations. Inference
  // still rejects edge-to-task/edge-to-edge combinations; never attach an
  // edited connection to itself, which would introduce a dependency cycle.
  return getConnectionType(side === 'source' ? candidate : connection.source,
    side === 'target' ? candidate : connection.target, connection);
}
export function canAttachBoundary(boundary, host) {
  return is(boundary, 'bpmn:BoundaryEvent') && is(host, 'bpmn:Activity') && boundary !== host &&
    !host.businessObject.isForCompensation && !host.businessObject.triggeredByEvent &&
    !(is(host, 'bpmn:ReceiveTask') && (host.incoming || []).some(edge => is(edge.source, 'bpmn:EventBasedGateway')));
}
export function canBeParent(parent, child) {
  if (!parent || !child || parent === child || ancestor(child, parent) || parent.hidden ||
      parent.collapsed || (is(parent, 'bpmn:SubProcess') && parent.di && parent.di.isExpanded === false)) return false;
  if (is(child, 'bpmn:Participant')) return is(parent, 'bpmn:Process') || is(parent, 'bpmn:Collaboration');
  if (is(child, 'bpmn:Lane')) return is(parent, 'bpmn:Participant') || is(parent, 'bpmn:Lane') || is(parent, 'bpmn:Process');
  if (is(parent, 'bpmn:Participant') && !parent.businessObject.processRef) return false;
  if (is(child, 'bpmn:Artifact')) return is(parent, 'bpmn:Collaboration') ||
    [ 'Lane', 'Participant', 'SubProcess', 'Process' ].some(t => is(parent, 'bpmn:' + t));
  return is(child, 'bpmn:FlowElement') &&
    [ 'Lane', 'Participant', 'SubProcess', 'Process' ].some(t => is(parent, 'bpmn:' + t));
}
