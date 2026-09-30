import type {
  Definitions, ElementEvent, Graph, GraphEdge, GraphNode, ImportError, ImportResult,
  MinimapOptions, SelectionEvent, SVGOptions, SVGResult, Viewer, ViewerOptions,
  Viewport, ViewportEvent, ViewportOptions, ViewportTransform
} from './index.js';

export type WrapperOptions = Pick<ViewerOptions,
  'config' | 'moddleExtensions' | 'minZoom' | 'maxZoom' | 'fitPadding' | 'fitInsets' |
  'fitViewOnInit' | 'selectOnClick' | 'minimap' | 'keyboard' | 'refitOnResize'>;
export interface WrapperProps extends WrapperOptions {
  xml?: string;
  bpmnDiagramId?: string;
}
export interface ViewerCallbacks {
  onLoad?: (result: ImportResult) => void;
  onError?: (error: ImportError) => void;
  onElementClick?: (event: ElementEvent) => void;
  onElementHover?: (event: ElementEvent) => void;
  onElementOut?: (event: ElementEvent) => void;
  onSelectionChange?: (event: SelectionEvent) => void;
  onViewportChange?: (event: ViewportEvent) => void;
}
/** Before mount and after teardown, wrapper calls may have no viewer. */
export interface BpmnViewerHandle {
  fitView(padding?: number): Viewport | undefined;
  setViewport(viewport: Viewport, options?: ViewportOptions): Promise<ViewportTransform | undefined> | undefined;
  getViewport(): Viewport | undefined;
  select(ids: string | string[]): void;
  deselect(ids?: string | string[]): void;
  getSelection(): string[];
  clearSelection(): void;
  getGraph(): Graph | null | undefined;
  getDefinitions(): Definitions | null | undefined;
  setMinimap(value: boolean | MinimapOptions): void;
  findElements(query?: string): (GraphNode | GraphEdge)[];
  focusElement(element: string | { id: string }): boolean | undefined;
  saveSVG(options?: SVGOptions): Promise<SVGResult> | undefined;
  clear(): void;
  getViewer(): Viewer | null | undefined;
}
