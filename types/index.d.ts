/** Public browser API of bpmn-xyflow. Framework wrappers are separate entrypoints. */
export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }
export interface Viewport extends Point { zoom: number }
export interface FitInsets { top?: number; right?: number; bottom?: number; left?: number }
export interface ViewportTransform extends Point { k: number }
export interface ViewportOptions {
  duration?: number;
  ease?: (progress: number) => number;
  interpolate?: 'smooth' | 'linear';
}
export interface ModdlePropertyDescriptor {
  name: string;
  type?: string;
  isAttr?: boolean;
  isMany?: boolean;
  isReference?: boolean;
  isBody?: boolean;
  isVirtual?: boolean;
  default?: unknown;
  [key: string]: unknown;
}
export interface ModdleTypeDescriptor {
  name: string;
  superClass?: string[];
  extends?: string[];
  properties?: ModdlePropertyDescriptor[];
  [key: string]: unknown;
}
export interface ModdlePackage {
  name: string;
  prefix: string;
  uri: string;
  types: ModdleTypeDescriptor[];
  xml?: Record<string, unknown>;
  [key: string]: unknown;
}
export type ModdleExtensions = Record<string, ModdlePackage>;
export interface ModdleElement {
  $type: string;
  $parent: ModdleElement | null;
  $attrs: Record<string, unknown>;
  $instanceOf(type: string): boolean;
  get(name: string): unknown;
  set(name: string, value: unknown): this;
  id?: string;
  name?: string;
  [property: string]: unknown;
}
export interface BpmnPlane extends ModdleElement {
  $type: 'bpmndi:BPMNPlane';
  bpmnElement?: ModdleElement;
  planeElement?: ModdleElement[];
}
export interface BpmnDiagram extends ModdleElement {
  $type: 'bpmndi:BPMNDiagram';
  plane?: BpmnPlane;
}
export interface Definitions extends ModdleElement {
  $type: 'bpmn:Definitions';
  rootElements?: ModdleElement[];
  diagrams?: BpmnDiagram[];
}
export interface Warning {
  message: string;
  context?: unknown;
  error?: Error;
  element?: GraphElement;
}
export interface XMLReference {
  element: ModdleElement;
  property: string;
  id: string;
}
export interface ParseResult<T extends ModdleElement = Definitions> {
  rootElement: T;
  warnings: Warning[];
  references: XMLReference[];
  elementsById: Map<string, ModdleElement>;
}
export interface XMLOptions { format?: boolean; preamble?: boolean }
export interface Moddle {
  fromXML(xml: string, options?: Record<string, unknown>): Promise<ParseResult>;
  fromXML<T extends ModdleElement = Definitions>(xml: string, typeName: string, options?: Record<string, unknown>): Promise<ParseResult<T>>;
  toXML(element: ModdleElement, options?: XMLOptions): Promise<{ xml: string }>;
  create(type: string, attributes?: Record<string, unknown>): ModdleElement;
  createAny(name: string, uri: string, properties?: Record<string, unknown>): ModdleElement;
  getType(type: string): {
    (attributes?: Record<string, unknown>): ModdleElement;
    new(attributes?: Record<string, unknown>): ModdleElement;
    hasType(type: string): boolean;
  };
  getTypeDescriptor(type: string): ModdleTypeDescriptor | null;
  getElementDescriptor(element: ModdleElement): ModdleTypeDescriptor;
  getPropertyDescriptor(element: ModdleElement, name: string): ModdlePropertyDescriptor | undefined;
  getPackage(name: string): ModdlePackage | undefined;
  getPackages(): ModdlePackage[];
  hasType(element: ModdleElement, type: string): boolean;
}
export interface BaseElement {
  id: string;
  type: string;
  businessObject: ModdleElement;
  di: ModdleElement;
  parent?: GraphNode | GraphRoot;
  hidden?: boolean;
  label?: GraphNode;
}
export interface GraphNode extends BaseElement, Bounds {
  isRoot?: false;
  waypoints?: never;
  children?: GraphNode[];
  collapsed?: boolean;
  isFrame?: boolean;
  host?: GraphNode;
  attachers?: GraphNode[];
  labelTarget?: GraphNode | GraphEdge;
  text?: string;
}
export interface GraphEdge extends BaseElement {
  isRoot?: false;
  source: GraphNode;
  target: GraphNode;
  waypoints: Point[];
}
export interface GraphRoot extends BaseElement {
  isRoot: true;
  children: GraphNode[];
}
export type GraphElement = GraphNode | GraphEdge | GraphRoot;
export interface Graph {
  diagram: BpmnDiagram;
  nodes: GraphNode[];
  edges: GraphEdge[];
  roots: GraphRoot[];
  warnings: Warning[];
  elementsById: Map<string, GraphElement>;
}
export interface ImportResult { graph: Graph; warnings: Warning[] }
export interface ImportError extends Error { warnings?: Warning[] }
export interface ElementEvent {
  event: PointerEvent;
  id: string | null;
  element: GraphElement | null;
}
export interface SelectionEvent { ids: string[]; elements: GraphElement[] }
export interface ViewportEvent { viewport: Viewport }
export interface ViewerEvents {
  'element.click': ElementEvent;
  'element.hover': ElementEvent;
  'element.out': ElementEvent;
  'selection.change': SelectionEvent;
  'viewport.change': ViewportEvent;
  'import.parse.start': { xml: string };
  'import.parse.complete': { definitions: Definitions; warnings: Warning[]; error?: never } | { error: ImportError; warnings: Warning[]; definitions?: never };
  'import.render.start': { definitions: Definitions; graph: Graph };
  'import.render.complete': ImportResult;
  'import.done': (ImportResult & { error?: never }) | { error: ImportError; warnings: Warning[]; graph?: never };
  'render.warning': Warning;
  'diagram.clear': Record<string, never>;
  'diagram.destroy': Record<string, never>;
}
export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
}
export interface RendererConfig {
  bpmnRenderer?: { defaultFillColor?: string; defaultStrokeColor?: string; defaultLabelColor?: string };
  textRenderer?: { defaultStyle?: TextStyle; externalStyle?: TextStyle };
}
export interface MinimapOptions {
  width?: number;
  height?: number;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  margin?: number;
  background?: string;
  border?: string;
  nodeFill?: string;
  viewportFill?: string;
  viewportStroke?: string;
}
export interface ViewerOptions {
  container: HTMLElement;
  ariaLabel?: string;
  config?: RendererConfig;
  moddle?: Moddle;
  moddleExtensions?: ModdleExtensions;
  minZoom?: number;
  maxZoom?: number;
  /** Padding and insets are measured in CSS pixels. */
  fitPadding?: number;
  fitInsets?: FitInsets;
  fitViewOnInit?: boolean;
  selectOnClick?: boolean;
  minimap?: boolean | MinimapOptions;
  keyboard?: boolean;
  refitOnResize?: boolean;
  zoomOnDoubleClick?: boolean;
}
export interface SVGOptions { padding?: number }
export interface SVGResult { svg: string }
/** Methods shared by the viewer and the modeler's explicitly forwarded API. */
export interface DiagramAPI {
  importXML(xml: string, bpmnDiagramId?: string): Promise<ImportResult>;
  getModdle(): Moddle;
  getGraph(): Graph | null;
  getDefinitions(): Definitions | null;
  getContainer(): HTMLElement;
  getSvg(): SVGSVGElement;
  fitView(padding?: number): Viewport | undefined;
  getViewport(): Viewport;
  setViewport(viewport: Viewport, options?: ViewportOptions): Promise<ViewportTransform | undefined> | undefined;
  select(ids: string | string[]): void;
  deselect(ids?: string | string[]): void;
  getSelection(): string[];
  clearSelection(): void;
  getElement(id: string): GraphElement | null;
  findElements(query?: string): (GraphNode | GraphEdge)[];
  focusElement(element: string | Pick<GraphElement, 'id'>): boolean;
  saveSVG(options?: SVGOptions): Promise<SVGResult>;
  exportSVG(options?: SVGOptions): Promise<SVGResult>;
  setMinimap(value: boolean | MinimapOptions): void;
  on<K extends keyof ViewerEvents>(event: K, handler: (payload: ViewerEvents[K]) => void): () => void;
  off<K extends keyof ViewerEvents>(event: K, handler: (payload: ViewerEvents[K]) => void): void;
  destroy(): void;
}
export interface Viewer extends DiagramAPI {
  clear(): void;
  switchDiagram(bpmnDiagramId: string, options?: { reuseGraph?: Graph }): Promise<ImportResult>;
}
export const Viewer: { new(options: ViewerOptions): Viewer };
export default Viewer;

export interface ReplaceOptions { removeContents?: boolean }
export interface ReplacementTarget {
  type: string;
  eventDefinitionType?: string;
  eventDefinitionAttrs?: Record<string, string | number | boolean>;
  isExpanded?: boolean;
  triggeredByEvent?: boolean;
  isInterrupting?: boolean;
  cancelActivity?: boolean;
  instantiate?: boolean;
  eventGatewayType?: string;
}
export interface ModelerOptions extends ViewerOptions { palette?: boolean; snap?: boolean; editorActions?: boolean }
export interface AddShapeOptions extends Omit<ReplacementTarget, 'type'> {
  businessObject?: ModdleElement;
  di?: ModdleElement;
  width?: number;
  height?: number;
  parent?: GraphNode | GraphRoot;
  host?: GraphNode | null;
}
export interface ConnectionOptions {
  type?: string;
  businessObject?: ModdleElement;
  di?: ModdleElement;
  waypoints?: Point[];
}
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'horizontal' | 'vertical';
export type ActivityMarker = 'compensation' | 'loop' | 'parallelMI' | 'sequentialMI';
export type SequenceFlowType = 'normal' | 'default' | 'conditional';
export type LaneLocation = 'before' | 'after' | 'top' | 'bottom' | 'left' | 'right';
export type SpaceDirection = 'e' | 'w' | 'n' | 's';
export interface SpaceOptions {
  direction?: SpaceDirection;
  padding?: number;
  minWidth?: number;
  minHeight?: number;
}
export interface SpacePlan {
  direction: SpaceDirection;
  axis: 'x' | 'y';
  coordinate: number;
  delta: Point;
  movingShapes: GraphNode[];
  resizingShapes: GraphNode[];
  moves: { node: GraphNode; dx: number; dy: number }[];
  resizes: { node: GraphNode; bounds: Bounds }[];
}
export interface ClipboardNode extends Bounds {
  id: string;
  type: string;
  parentId: string | null;
  hostId: string | null;
  businessObject: ModdleElement;
  di: ModdleElement;
}
export interface ClipboardEdge {
  sourceId: string;
  targetId: string;
  type: string;
  businessObject: ModdleElement;
  di: ModdleElement;
  waypoints: Point[];
}
export interface Clipboard {
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
  roots: ModdleElement[];
  diagrams: ModdleElement[];
}
/** Composition, not inheritance: use modeler.viewer for clear/switchDiagram. */
export interface Modeler extends DiagramAPI {
  readonly viewer: Viewer;
  readonly commandStack: CommandStack;
  addShape(type: string, position: Point, options?: AddShapeOptions): GraphNode | null;
  moveShape(node: GraphNode, delta: Point, parent?: GraphNode | GraphRoot): boolean;
  moveShapes(nodes: GraphNode | GraphNode[], delta: Point, parent?: GraphNode | GraphRoot): boolean;
  resizeShape(node: GraphNode, bounds: Bounds): GraphNode | false;
  updateWaypoints(edge: GraphEdge, waypoints: Point[]): GraphEdge | false;
  reconnect(edge: GraphEdge, side: 'source' | 'target', endpoint: GraphNode, points?: Point[]): GraphEdge | null;
  connect(source: GraphNode, target: GraphNode, options?: ConnectionOptions): GraphEdge | null;
  insertShape(nodeOrType: GraphNode | string, connection: GraphEdge, position?: Point): GraphNode | null;
  delete(element: GraphElement): boolean | void;
  addLane(shape: GraphNode, location?: LaneLocation): GraphNode | null;
  splitLane(shape: GraphNode, count: number): GraphNode[] | null;
  deleteLane(lane: GraphNode): boolean;
  replace(element: GraphNode, target: string | ReplacementTarget, attributes?: Record<string, unknown>, options?: ReplaceOptions): GraphNode | null;
  attachBoundary(element: GraphNode, host: GraphNode, position?: Point): GraphNode | null;
  setSequenceFlowType(edge: GraphEdge, type: SequenceFlowType, condition?: string): GraphEdge | null;
  updateLabel(element: GraphNode | GraphEdge, name: string): GraphNode | GraphEdge | false;
  updateProperties<T extends GraphElement>(element: T, properties: Record<string, unknown>): T | false;
  copy(nodes?: GraphNode[]): Clipboard | null;
  paste(position: Point, parent?: GraphNode | GraphRoot): GraphNode[];
  cancel(): void;
  align(nodes: (GraphNode | GraphEdge)[], direction: Alignment): void;
  distribute(nodes: (GraphNode | GraphEdge)[], axis: Axis): void;
  createSpace(elements: GraphElement[] | null | undefined, axis: Axis, coordinate: number, delta: number, options?: SpaceOptions): SpacePlan | false;
  toggleMarker(activity: GraphNode, marker: ActivityMarker): GraphNode | false;
  toggleCollection(element: GraphNode): GraphNode | false;
  toggleParticipantMultiplicity(element: GraphNode): GraphNode | false;
  toggleEventInterrupting(element: GraphNode): GraphNode | false;
  toggleExpanded(node: GraphNode): GraphNode | false;
  drillInto(node: GraphNode): Promise<boolean>;
  navigateBack(): Promise<boolean>;
  canNavigateBack(): boolean;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  getXML(options?: Pick<XMLOptions, 'format'>): Promise<string>;
}
export const Modeler: { new(options: ModelerOptions): Modeler };
export interface Command {
  name?: string;
  do(): void;
  undo(): void;
  payload?: unknown;
  children?: Command[];
}
export interface CommandState { canUndo: boolean; canRedo: boolean }
export interface CommandSnapshot { undo: Command[]; redo: Command[] }
export interface CommandStack {
  execute(command: Command): void;
  compound<T>(name: string, operation: () => T): T;
  undo(): boolean;
  redo(): boolean;
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  size(): number;
  onChange(handler: (state: CommandState) => void): () => boolean;
  snapshot(): CommandSnapshot;
  restore(snapshot?: Partial<CommandSnapshot> | null): void;
}
export const CommandStack: {
  (options?: { limit?: number }): CommandStack;
  new(options?: { limit?: number }): CommandStack;
};
export interface RenderAttributes {
  fill?: string;
  stroke?: string;
  [attribute: string]: string | number | boolean | undefined;
}
export interface RendererMethods {
  canRender(element: GraphElement): boolean;
  drawShape(parent: SVGElement, shape: GraphNode, attributes?: RenderAttributes): SVGElement;
  drawConnection(parent: SVGElement, edge: GraphEdge, attributes?: RenderAttributes): SVGElement;
}
export interface Renderer extends RendererMethods {
  getExternalLabelStyle(element: GraphNode | GraphEdge): TextStyle & { fill: string };
  readonly bpmnRenderer: RendererMethods & {
    getShapePath(shape: GraphNode): string;
    getConnectionPath(edge: GraphEdge): string;
  };
  readonly textRenderer: {
    getExternalLabelBounds(bounds: Bounds, text: string): Bounds;
    getTextAnnotationBounds(bounds: Bounds, text: string): Bounds;
    getDefaultStyle(): TextStyle;
    getExternalStyle(): TextStyle;
  };
}
export const Renderer: { new(options: { rootSvg: SVGSVGElement; config?: RendererConfig }): Renderer };
export function parseBpmnXML(xml: string, modelOrExtensions?: Moddle | ModdleExtensions): Promise<ParseResult>;
export function buildGraph(definitions: Definitions, diagram?: BpmnDiagram): Graph;
