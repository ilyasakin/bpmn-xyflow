import type { Component } from 'svelte';
import type { ElementEvent, ImportError, ImportResult, SelectionEvent, ViewportEvent } from './index.js';
import type { BpmnViewerHandle, WrapperProps } from './wrappers.js';
export type { BpmnViewerHandle } from './wrappers.js';
export interface BpmnViewerProps extends WrapperProps {
  onload?: (result: ImportResult) => void;
  onerror?: (error: ImportError) => void;
  onelementClick?: (event: ElementEvent) => void;
  onelementHover?: (event: ElementEvent) => void;
  onelementOut?: (event: ElementEvent) => void;
  onselectionChange?: (event: SelectionEvent) => void;
  onviewportChange?: (event: ViewportEvent) => void;
}
declare const BpmnViewer: Component<BpmnViewerProps, BpmnViewerHandle, ''>;
export default BpmnViewer;
