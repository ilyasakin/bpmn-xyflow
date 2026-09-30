/**
 * Pure external-label resize planning. The caller owns DI, rendering and undo.
 *
 * Matches bpmn-js 18.30.1 BpmnRules.canResize (e/w only) and LabelBehavior's
 * shape.resize preExecute hook: preserve chosen width, fit height to text.
 * Sources: https://github.com/bpmn-io/bpmn-js/tree/v18.30.1/lib/features/modeling
 * and diagram-js Resize/ResizeUtil (10px default minimum and commit rounding).
 * Label layout policy adapted from Copyright (c) 2014-present Camunda Services
 * GmbH, distributed under this repository's retained upstream LICENSE.
 * No runtime bpmn-js dependency and no mutation of label, owner or metadata.
 */
import { resizeBounds, ensureConstraints, getMinResizeBounds } from 'diagram-js/lib/features/resize/ResizeUtil';
import { asTRBL, roundBounds } from 'diagram-js/lib/layout/LayoutUtil';
import { getLabel } from '../util/LabelUtil';

const validBounds=bounds=>bounds&&['x','y','width','height'].every(key=>Number.isFinite(bounds[key]))&&bounds.width>=0&&bounds.height>=0;

/** Convert a graph-coordinate horizontal drag into constrained label bounds. */
export function externalLabelResizeBounds(original,direction,deltaX,{round=true}={}) {
  if(!validBounds(original)||!['e','w'].includes(direction)||!Number.isFinite(deltaX))return null;
  const constraints={min:asTRBL(getMinResizeBounds(direction,original,{width:10,height:10}))};
  const bounds=ensureConstraints(resizeBounds(original,direction,{x:deltaX,y:0}),constraints);
  return round?roundBounds(bounds):bounds;
}

/** Fit only label height; unlike getExternalLabelBounds, never shrink width. */
export function layoutExternalLabelBounds(label,newBounds,textRenderer) {
  if(!label?.labelTarget||!validBounds(label)||!validBounds(newBounds)||newBounds.width<=0||
    !textRenderer?.getDimensions||!textRenderer?.getExternalStyle)return null;
  const dimensions=textRenderer.getDimensions(getLabel(label)||'',{
    box:{x:newBounds.x,y:newBounds.y,width:newBounds.width,height:newBounds.height},
    style:textRenderer.getExternalStyle()
  });
  if(!Number.isFinite(dimensions.height)||dimensions.height<0)return null;
  const height=Math.ceil(dimensions.height);
  return{x:newBounds.x,y:newBounds.y!==label.y?label.y+label.height-height:newBounds.y,width:newBounds.width,height};
}
