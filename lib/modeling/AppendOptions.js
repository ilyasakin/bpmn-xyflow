/** Core shape append entries, matching bpmn-js 18.30.1 ContextPadProvider. */
const entry = (actionName, label, type, attributes = {}) => ({ actionName, label, target: { type, ...attributes } });
const is = (element, type) => !!element?.businessObject?.$instanceOf(type);
const event = (element, type, definition) => is(element, type) && (element.businessObject.eventDefinitions || []).some(value => value.$type === definition);
export function getAppendOptions(element) {
  if (!element || element.type === 'label' || element.labelTarget) return [];
  const bo = element.businessObject, options = [];
  if (is(element, 'bpmn:FlowNode')) {
    if (is(element, 'bpmn:EventBasedGateway')) {
      options.push(entry('append.receive-task', 'Append receive task', 'bpmn:ReceiveTask'));
      for (const [name, title, definition] of [
        ['message', 'message', 'Message'], ['timer', 'timer', 'Timer'],
        ['condition', 'conditional', 'Conditional'], ['signal', 'signal', 'Signal']
      ]) options.push(entry(`append.${name}-intermediate-event`, `Append ${title} intermediate catch event`, 'bpmn:IntermediateCatchEvent', { eventDefinitionType: `bpmn:${definition}EventDefinition` }));
    } else if (event(element, 'bpmn:BoundaryEvent', 'bpmn:CompensateEventDefinition')) {
      options.push(entry('append.compensation-activity', 'Append compensation activity', 'bpmn:Task', { isForCompensation: true }));
    } else if (!is(element, 'bpmn:EndEvent') && !bo.isForCompensation &&
      !event(element, 'bpmn:IntermediateThrowEvent', 'bpmn:LinkEventDefinition') && !(is(element, 'bpmn:SubProcess') && bo.triggeredByEvent)) {
      options.push(entry('append.end-event', 'Append end event', 'bpmn:EndEvent'),
        entry('append.gateway', 'Append gateway', 'bpmn:ExclusiveGateway'),
        entry('append.append-task', 'Append Task', 'bpmn:Task'),
        entry('append.intermediate-event', 'Append intermediate/boundary event', 'bpmn:IntermediateThrowEvent'));
    }
  }
  if (['bpmn:FlowNode', 'bpmn:InteractionNode', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Group'].some(type => is(element, type))) {
    options.push(entry('append.text-annotation', 'Add text annotation', 'bpmn:TextAnnotation'));
  }
  return options;
}

/** Executable editor subset. Flow-owned annotation docking is an open core gap:
 * owner-route changes must propagate to dependent associations before enabling it.
 * Keep getAppendOptions unchanged as the pinned upstream catalogue oracle.
 */
export function getExecutableAppendOptions(element) {
  if (element?.waypoints || is(element, 'bpmn:SequenceFlow') || is(element, 'bpmn:MessageFlow')) return [];
  return getAppendOptions(element);
}
