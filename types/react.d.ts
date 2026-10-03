import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import type { Viewer, ViewerOptions } from './index.js';
import type { BpmnViewerHandle, ViewerCallbacks, WrapperProps } from './wrappers.js';
export type { BpmnViewerHandle } from './wrappers.js';
export interface BpmnViewerProps extends WrapperProps, ViewerCallbacks {
  className?: string;
  style?: CSSProperties;
}
export const BpmnViewer: ForwardRefExoticComponent<BpmnViewerProps & RefAttributes<BpmnViewerHandle>>;
export default BpmnViewer;
export interface UseBpmnViewerResult extends Pick<BpmnViewerHandle,
  'findElements' | 'focusElement' | 'saveSVG' | 'clear'> {
  containerRef: { readonly current: HTMLDivElement | null };
  /** Null until the component mounts; reactive when the instance is created. */
  viewer: Viewer | null;
  getViewer(): Viewer | null;
}
export function useBpmnViewer(options?: Omit<ViewerOptions, 'container'>): UseBpmnViewerResult;
