import type { ComponentOptionsMixin, DefineComponent } from 'vue';
import type { ElementEvent, ImportError, ImportResult, SelectionEvent, ViewportEvent } from './index.js';
import type { BpmnViewerHandle, ViewerCallbacks, WrapperProps } from './wrappers.js';
export type { BpmnViewerHandle } from './wrappers.js';
export interface BpmnViewerProps extends WrapperProps, ViewerCallbacks {}
export type BpmnViewerEmits = {
  load: (result: ImportResult) => void;
  error: (error: ImportError) => void;
  'element-click': (event: ElementEvent) => void;
  'element-hover': (event: ElementEvent) => void;
  'element-out': (event: ElementEvent) => void;
  'selection-change': (event: SelectionEvent) => void;
  'viewport-change': (event: ViewportEvent) => void;
};
export const BpmnViewer: DefineComponent<
  BpmnViewerProps, BpmnViewerHandle, {}, {}, {},
  ComponentOptionsMixin, ComponentOptionsMixin, BpmnViewerEmits
>;
export default BpmnViewer;
