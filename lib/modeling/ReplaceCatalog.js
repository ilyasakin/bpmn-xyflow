/**
 * Contextual replacement catalog adapted from bpmn-js 18.30.1
 * features/popup-menu/ReplaceMenuProvider.js and util/TypeUtil.js.
 * Copyright (c) 2014-present Camunda Services GmbH. See ../../LICENSE.
 * https://github.com/bpmn-io/bpmn-js/tree/v18.30.1/lib/features
 *
 * Targets are upstream descriptors, not mutation instructions. Callers must
 * still enforce connection, containment, attachment and content-removal rules.
 */
import { is, getBusinessObject } from '../util/ModelUtil';
import { isExpanded, isEventSubProcess } from '../util/DiUtil';
import { REPLACE_OPTIONS as OPTIONS } from './ReplaceCatalogData';

const definition = name => `bpmn:${name}EventDefinition`;
const nonInterrupting = ['Message', 'Timer', 'Escalation', 'Conditional', 'Signal'].map(definition);
const processStarts = ['Message', 'Timer', 'Conditional', 'Signal'].map(definition);
const eventStarts = [...processStarts, ...['Error', 'Escalation', 'Compensate'].map(definition)];
const catches = ['Message', 'Timer', 'Conditional', 'Link', 'Signal'].map(definition);
const throws = ['Message', 'Escalation', 'Link', 'Compensate', 'Signal'].map(definition);
const ends = ['Message', 'Escalation', 'Error', 'Cancel', 'Compensate', 'Signal', 'Terminate'].map(definition);
const boundaries = ['Message', 'Timer', 'Escalation', 'Conditional', 'Error', 'Cancel', 'Signal', 'Compensate'].map(definition);
const knownTypes = new Set(Object.values(OPTIONS).flatMap(group => Array.isArray(group) ? group : Object.values(group).flat())
  .map(entry => entry.target?.type).filter(Boolean));

function scope(parent) {
  let current = parent;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    const bo = getBusinessObject(current);
    if (is(bo, 'bpmn:Participant')) return bo.processRef;
    if (!is(bo, 'bpmn:Lane') && !is(bo, 'bpmn:LaneSet')) return bo;
    current = bo.$parent || current.parent;
  }
}

function context(element) {
  const bo = getBusinessObject(element);
  return { parent: bo?.$parent || element?.parent, host: element?.host || bo?.attachedToRef };
}

/** Validate a supported core target's BPMN event/interrupting/scope discriminators. */
export function isValidTarget(target, { parent, host } = {}) {
  if (!target || typeof target !== 'object' || !knownTypes.has(target.type)) return false;
  for (const key of ['isExpanded', 'isInterrupting', 'cancelActivity', 'triggeredByEvent', 'instantiate']) {
    if (target[key] !== undefined && typeof target[key] !== 'boolean') return false;
  }
  const type = target.type, event = target.eventDefinitionType;
  const eventType = ['bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent', 'bpmn:BoundaryEvent'].includes(type);
  const subprocess = ['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction'].includes(type);
  if (event !== undefined && !eventType) return false;
  if (target.eventDefinitionAttrs !== undefined && (!event || !target.eventDefinitionAttrs ||
      typeof target.eventDefinitionAttrs !== 'object' || Array.isArray(target.eventDefinitionAttrs))) return false;
  if (target.isInterrupting !== undefined && type !== 'bpmn:StartEvent') return false;
  if (target.cancelActivity !== undefined && type !== 'bpmn:BoundaryEvent') return false;
  if (target.triggeredByEvent !== undefined && !subprocess) return false;
  if (target.triggeredByEvent && type !== 'bpmn:SubProcess') return false;
  if (target.isExpanded !== undefined && !subprocess && type !== 'bpmn:Participant') return false;
  if ((target.instantiate !== undefined || target.eventGatewayType !== undefined) && type !== 'bpmn:EventBasedGateway') return false;
  if (type === 'bpmn:EventBasedGateway' && (target.instantiate === true ||
      (target.eventGatewayType !== undefined && target.eventGatewayType !== 'Exclusive'))) return false;
  if (target.triggeredByEvent && target.isExpanded === false) return false;
  const parentScope = scope(parent);
  if (type === 'bpmn:StartEvent') {
    if (isEventSubProcess(parentScope)) {
      return eventStarts.includes(event) && (target.isInterrupting !== false || nonInterrupting.includes(event));
    }
    if (target.isInterrupting === false) return false;
    return is(parentScope, 'bpmn:SubProcess') ? event === undefined : event === undefined || processStarts.includes(event);
  }
  if (type === 'bpmn:BoundaryEvent') {
    const hostBo = getBusinessObject(host);
    if (!is(hostBo, 'bpmn:Activity') || hostBo.isForCompensation || hostBo.triggeredByEvent) return false;
    if (is(hostBo, 'bpmn:ReceiveTask') && (host?.incoming || []).some(edge => is(edge.source, 'bpmn:EventBasedGateway'))) return false;
    return boundaries.includes(event) && (target.cancelActivity !== false || nonInterrupting.includes(event)) &&
      (event !== definition('Cancel') || is(hostBo, 'bpmn:Transaction'));
  }
  if (type === 'bpmn:EndEvent') return (event === undefined || ends.includes(event)) &&
    (event !== definition('Cancel') || is(parentScope, 'bpmn:Transaction'));
  if (type === 'bpmn:IntermediateCatchEvent') return catches.includes(event);
  if (type === 'bpmn:IntermediateThrowEvent') return event === undefined || throws.includes(event);
  return true;
}

/** Direct API validity is broader than the source element's popup menu family. */
export function isValidReplacement(element, target) {
  return !!element && !Array.isArray(element) && !element.isRoot && element.type !== 'label' &&
    !element.waypoints && isValidTarget(target, context(element));
}

function different(element, target) {
  const bo = getBusinessObject(element);
  return bo.$type !== target.type || bo.eventDefinitions?.[0]?.$type !== target.eventDefinitionType ||
    !!bo.triggeredByEvent !== !!target.triggeredByEvent ||
    (target.isExpanded !== undefined && target.isExpanded !== isExpanded(element));
}

function materialize(entries, element) {
  // The upstream provider keys by action name; later duplicates replace values
  // without moving their original insertion position.
  return [...new Map(entries.map(entry => [entry.actionName, {
    ...entry, label: typeof entry.label === 'function' ? entry.label(element) : entry.label,
    ...(entry.target ? {target: {...entry.target, ...(entry.target.eventDefinitionAttrs ?
      {eventDefinitionAttrs: {...entry.target.eventDefinitionAttrs}} : {})}} : {})
  }])).values()];
}

function sequenceFlowOptions(element) {
  const bo = getBusinessObject(element), source = bo.sourceRef;
  const defaultSource = is(source, 'bpmn:Activity') || ['ExclusiveGateway','InclusiveGateway','ComplexGateway'].some(type => is(source, `bpmn:${type}`));
  return OPTIONS.SEQUENCE_FLOW.filter(option => {
    if (option.actionName === 'replace-with-default-flow') return defaultSource && source.default !== bo;
    if (option.actionName === 'replace-with-conditional-flow') return is(source, 'bpmn:Activity') && !bo.conditionExpression;
    return (is(source, 'bpmn:Activity') && !!bo.conditionExpression) || (defaultSource && source.default === bo);
  });
}

/** Ordered, fresh { label, actionName, className, target? } menu entries. */
export function getReplacementOptions(element) {
  if (!element || Array.isArray(element) || element.isRoot || element.type === 'label') return [];
  const bo = getBusinessObject(element), parent = scope(bo?.$parent || element.parent);
  if (!bo) return [];
  const other = option => different(element, option.target);
  let options;
  if (is(bo, 'bpmn:DataObjectReference')) options = OPTIONS.DATA_OBJECT_REFERENCE;
  else if (is(bo, 'bpmn:DataStoreReference')) options = is(element.parent, 'bpmn:Collaboration') ? [] : OPTIONS.DATA_STORE_REFERENCE;
  else if (is(bo, 'bpmn:Participant')) options = OPTIONS.PARTICIPANT.filter(option => isExpanded(element) !== option.target.isExpanded);
  else if (is(bo, 'bpmn:BoundaryEvent')) options = OPTIONS.BOUNDARY_EVENT.filter(option =>
    other(option) || (bo.cancelActivity !== false) !== (option.target.cancelActivity !== false));
  else if (is(bo, 'bpmn:Event')) {
    let same = OPTIONS.TYPED_EVENT[bo.eventDefinitions?.[0]?.$type] || [];
    if (is(parent, 'bpmn:SubProcess') && !isEventSubProcess(parent)) same = same.filter(option => option.target.type !== 'bpmn:StartEvent');
    if (is(bo, 'bpmn:StartEvent')) {
      if (isEventSubProcess(parent)) options = [...OPTIONS.EVENT_SUB_PROCESS_START_EVENT,...same].filter(option =>
        other(option) || (bo.isInterrupting !== false) !== (option.target.isInterrupting !== false));
      else options = [...(is(parent, 'bpmn:SubProcess') ? OPTIONS.START_EVENT_SUB_PROCESS : OPTIONS.START_EVENT),...same].filter(other);
    } else if (is(bo, 'bpmn:EndEvent')) options = [...OPTIONS.END_EVENT,...same].filter(other);
    else if (is(bo, 'bpmn:IntermediateCatchEvent') || is(bo, 'bpmn:IntermediateThrowEvent')) options = [...OPTIONS.INTERMEDIATE_EVENT,...same].filter(other);
    else options = [];
  } else if (is(bo, 'bpmn:Gateway')) options = OPTIONS.GATEWAY.filter(other);
  else if (is(bo, 'bpmn:Transaction')) options = OPTIONS.TRANSACTION.filter(other);
  else if (isEventSubProcess(bo) && isExpanded(element)) options = OPTIONS.EVENT_SUB_PROCESS.filter(other);
  else if (is(bo, 'bpmn:AdHocSubProcess') && isExpanded(element)) options = OPTIONS.AD_HOC_SUBPROCESS_EXPANDED.filter(other);
  else if (is(bo, 'bpmn:SubProcess') && isExpanded(element)) options = OPTIONS.SUBPROCESS_EXPANDED.filter(other);
  else if (is(bo, 'bpmn:SubProcess')) options = OPTIONS.TASK.filter(option =>
    (option.target.type === element.type) === (option.target.isExpanded === true));
  else if (is(bo, 'bpmn:SequenceFlow')) return materialize(sequenceFlowOptions(element), element);
  else if (is(bo, 'bpmn:FlowNode')) options = OPTIONS.TASK.filter(other);
  else options = [];
  // Upstream 18.30.1 typed-event shortcuts can offer error starts at process
  // level or none starts inside event subprocesses. Apply BPMN context validity
  // consistently to both the menu and direct API instead of copying that leak.
  return materialize(options.filter(option => isValidTarget(option.target, context(element))), element);
}

/** Valid boundary-creation entries for an activity host, including its current scope. */
export function getBoundaryEventOptions(host) {
  return materialize(OPTIONS.BOUNDARY_EVENT.filter(option => isValidTarget(option.target, {host})), host);
}
