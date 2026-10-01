import DefaultViewer, {
  Viewer, Modeler, Renderer, CommandStack, buildGraph, parseBpmnXML,
  type Alignment, type Axis, type Graph, type GraphNode, type GraphEdge, type ImportResult,
  type ModdleExtensions, type ViewerEvents, type Viewport,
  type ReplacementTarget, type ReplaceOptions, type SequenceFlowType, type AddShapeOptions,
  type ModelerOptions, type NavigationEvent
} from 'bpmn-xyflow';

const extensions: ModdleExtensions = {
  audit: { name: 'Audit', prefix: 'audit', uri: 'urn:example:audit', types: [
    { name: 'Tagged', extends: ['bpmn:BaseElement'], properties: [{ name: 'tag', type: 'String', isAttr: true }] }
  ] }
};
const container = document.createElement('div');
const viewer: Viewer = new DefaultViewer({ container, moddleExtensions: extensions, minimap: { position: 'top-right' }, fitInsets: { bottom: 20 }, ariaLabel: 'Process diagram' });
const modelerOptions: ModelerOptions = { container, palette: false, snap: true, taskResize: false };
const modeler = new Modeler(modelerOptions);
// @ts-expect-error task resize policy is boolean
new Modeler({ container, taskResize: 'upstream' });
const navigationListener = (state: NavigationEvent) => {
  const diagramId: string | null = state.diagramId;
  const depth: number = state.depth;
  const busy: boolean = state.pending;
  console.log(diagramId, depth, busy, state.canNavigateBack);
};
modeler.on('navigation.change', navigationListener);
modeler.off('navigation.change', navigationListener);
modeler.on('navigation.change', state => {
  const pending: boolean = state.pending;
  // @ts-expect-error navigation depth is a number
  const depth: string = state.depth;
  console.log(pending, depth);
});
const stop = viewer.on('element.click', ({ id, element, event }) => {
  const maybeId: string | null = id;
  if (element) viewer.select(element.id);
  if (event.shiftKey && maybeId) viewer.deselect(maybeId);
});
stop();
const viewportListener = ({ viewport }: ViewerEvents['viewport.change']) => { const v: Viewport = viewport; viewer.setViewport(v, { duration: 20, interpolate: 'smooth' }); };
viewer.on('viewport.change', viewportListener);
viewer.off('viewport.change', viewportListener);
viewer.on('import.done', result => { if (result.error) console.log(result.error.message); else console.log(result.graph.nodes); });
viewer.findElements('invoice').map(element => element.businessObject.name);
viewer.focusElement('Task_1');
viewer.focusElement({ id: 'Task_1' });
viewer.clear();
void viewer.switchDiagram('Diagram_2', { reuseGraph: buildGraph((await parseBpmnXML('<xml/>')).rootElement) });
const imported: ImportResult = await modeler.importXML('<xml/>');
const graph: Graph = imported.graph;
console.log(graph.diagram.plane?.bpmnElement?.id);
const node: GraphNode | null = modeler.addShape('bpmn:Task', { x: 80, y: 120 });
if (node) {
  modeler.moveShape(node, { x: 10, y: 5 });
  modeler.moveShapes([node], { x: 10, y: 5 }, graph.roots[0]);
  modeler.resizeShape(node, { x: 10, y: 10, width: 100, height: 80 });
  modeler.updateLabel(node, 'Review');
  modeler.updateProperties(node, { name: 'Review', isForCompensation: false });
  const edge = modeler.connect(node, node);
  modeler.connect(node, node, { connectionStart: { x: 110, y: 50 }, connectionEnd: { x: 90, y: 30 } });
  // @ts-expect-error docking coordinates must be finite numbers at runtime
  modeler.connect(node, node, { connectionStart: { x: '110', y: 50 } });
  // @ts-expect-error both coordinates are required for an explicit docking
  modeler.connect(node, node, { connectionEnd: { x: 90 } });
  if (edge) {
    const source: GraphNode | GraphEdge = edge.source;
    if (source.waypoints) console.log(source.waypoints[0]);
    else console.log(source.x, source.y);
    modeler.updateWaypoints(edge, [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    modeler.reconnect(edge, 'target', node);
    const annotation = modeler.addShape('bpmn:TextAnnotation', { x: 200, y: 150 });
    if (annotation) {
      const association = modeler.connect(edge, annotation);
      modeler.connect(annotation, edge, { connectionEnd: { x: 50, y: 80 } });
      if (association) modeler.reconnect(association, 'source', edge, [{ x: 10, y: 20 }, { x: 50, y: 80 }]);
    }
    // @ts-expect-error geometry movement remains shape-only
    modeler.moveShape(edge, { x: 10, y: 5 });
    // @ts-expect-error resize bounds belong to shapes, not connections
    modeler.resizeShape(edge, { x: 10, y: 10, width: 100, height: 80 });
    // @ts-expect-error replacement remains shape-only
    modeler.replace(edge, 'bpmn:Task');
    // @ts-expect-error a connection cannot host a boundary event
    modeler.attachBoundary(node, edge);
    // @ts-expect-error roots are not supported connect endpoints
    modeler.connect(graph.roots[0], node);
    // @ts-expect-error the private append action is not a public method
    modeler.appendShape(edge, 'bpmn:TextAnnotation');
    modeler.insertShape('bpmn:Task', edge, { x: 100, y: 100 });
    const flowType: SequenceFlowType = 'conditional';
    modeler.setSequenceFlowType(edge, flowType, 'approved === true');
    modeler.setSequenceFlowType(edge, 'default');
    // @ts-expect-error flow variants are a fixed vocabulary
    modeler.setSequenceFlowType(edge, 'exclusive');
    // @ts-expect-error a condition is expression text
    modeler.setSequenceFlowType(edge, 'conditional', 42);
  }
  const clipboard = modeler.copy([node]);
  const copiedEdgeIds: string[] = clipboard?.edges.map(edge => edge.id) || [];
  console.log(copiedEdgeIds);
  modeler.paste({ x: 200, y: 200 });
  modeler.replace(node, 'bpmn:ServiceTask');
  const target: ReplacementTarget = { type: 'bpmn:BoundaryEvent', eventDefinitionType: 'bpmn:TimerEventDefinition', cancelActivity: false };
  modeler.replace(node, target);
  modeler.replace(node, { type: 'bpmn:SubProcess', isExpanded: true, triggeredByEvent: true });
  modeler.attachBoundary(node, node, { x: 100, y: 120 });
  const boundaryOptions: AddShapeOptions = { host: node, eventDefinitionType: 'bpmn:MessageEventDefinition', eventDefinitionAttrs: { name: 'Received' }, cancelActivity: false };
  modeler.addShape('bpmn:BoundaryEvent', { x: 100, y: 120 }, boundaryOptions);
  // @ts-expect-error a descriptor needs its target type
  modeler.replace(node, { isExpanded: true });
  // @ts-expect-error interrupting behavior is a boolean
  modeler.replace(node, { type: 'bpmn:StartEvent', isInterrupting: 'false' });
  // @ts-expect-error event-definition attributes accept scalar values only
  modeler.replace(node, { type: 'bpmn:StartEvent', eventDefinitionType: 'bpmn:TimerEventDefinition', eventDefinitionAttrs: { nested: {} } });
  // @ts-expect-error attachment requires a host node
  modeler.attachBoundary(node, 'Task_1');
  modeler.replace(node, 'bpmn:Task', {}, { removeContents: true });
  const cleanupOptions: ReplaceOptions = { removeIncompatibleData: true };
  const converted: GraphNode | null = modeler.replace(node, 'bpmn:IntermediateCatchEvent', {}, cleanupOptions);
  modeler.replace(node, { type: 'bpmn:IntermediateThrowEvent' }, {}, { removeContents: true, removeIncompatibleData: true });
  modeler.replace(node, 'bpmn:Task', {}, { removeIncompatibleData: false });
  console.log(converted);
  // @ts-expect-error incompatible IO removal requires an explicit boolean
  modeler.replace(node, 'bpmn:Task', {}, { removeIncompatibleData: 'yes' });
  // @ts-expect-error cleanup is the fourth argument; it is not a replacement target flag
  modeler.replace(node, { type: 'bpmn:Task', removeIncompatibleData: true });
  // @ts-expect-error destructive replacement requires an explicit boolean
  modeler.replace(node, 'bpmn:Task', {}, { removeContents: 'yes' });
  const markerResult: GraphNode | false = modeler.toggleMarker(node, 'loop');
  const collectionResult: GraphNode | false = modeler.toggleCollection(node);
  const multiplicityResult: GraphNode | false = modeler.toggleParticipantMultiplicity(node);
  const interruptingResult: GraphNode | false = modeler.toggleEventInterrupting(node);
  console.log(markerResult, collectionResult, multiplicityResult, interruptingResult);
  modeler.toggleExpanded(node);
  const entered: boolean = await modeler.drillInto(node);
  console.log(entered);
  modeler.addLane(node, 'after');
  const lanes = modeler.splitLane(node, 2);
  if (lanes?.[0]) modeler.deleteLane(lanes[0]);
}
const alignment: Alignment = 'center';
const axis: Axis = 'horizontal';
modeler.align(graph.nodes, alignment);
modeler.distribute(graph.nodes, axis);
const plan = modeler.createSpace(graph.nodes, 'vertical', 100, 50, { direction: 's' });
if (plan) {
  const moved: GraphNode[] = plan.movingShapes;
  console.log(plan.axis, plan.delta.y, moved);
}
modeler.createSpace(undefined, 'horizontal', 100, -50, { direction: 'w', padding: 20 });
modeler.findElements('Review').forEach(element => modeler.focusElement(element));
await modeler.saveSVG({ padding: 15 });
await modeler.exportSVG();
await modeler.getXML({ format: true });
modeler.cancel();
modeler.undo();
modeler.redo();
await modeler.navigateBack();
const stack = CommandStack({ limit: 50 });
const alternate = new CommandStack();
stack.execute({ name: 'test', do() {}, undo() {}, payload: { value: 1 } });
const value: number = stack.compound('group', () => 42);
alternate.restore(stack.snapshot());
stack.onChange(state => console.log(state.canUndo, value));
const renderer = new Renderer({ rootSvg: viewer.getSvg(), config: { bpmnRenderer: { defaultFillColor: '#fff' } } });
if (node) renderer.drawShape(viewer.getSvg(), node);
modeler.viewer.clear();

// Rejected inputs protect the actual API, not an overly permissive declaration.
// @ts-expect-error a DOM element is required, not a selector
new Viewer({ container: '#canvas' });
// @ts-expect-error align directions are a fixed vocabulary
modeler.align(graph.nodes, 'horizontal');
// @ts-expect-error distribution axes are not point-coordinate keys
modeler.distribute(graph.nodes, 'x');
// @ts-expect-error the delta is numeric
modeler.createSpace(graph.nodes, 'horizontal', 10, '20');
// @ts-expect-error lane location is a fixed vocabulary
modeler.addLane(graph.nodes[0], 'above');
// @ts-expect-error space direction is a cardinal abbreviation
modeler.createSpace(graph.nodes, 'horizontal', 100, 50, { direction: 'east' });
// @ts-expect-error query text must be a string
viewer.findElements(123);
// @ts-expect-error modeler composes viewer; it does not inherit clear
modeler.clear();
// @ts-expect-error diagram switching belongs to the contained viewer
modeler.switchDiagram('Diagram_2');
// @ts-expect-error viewport zoom is required
viewer.setViewport({ x: 1, y: 2 });
viewer.destroy();
modeler.destroy();
