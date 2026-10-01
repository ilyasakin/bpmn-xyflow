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
export function externalLabelResizeBounds(original,direction,deltaX,{round=true,snap=false,snapTargets=[]}={}) {
  if(!validBounds(original)||!['e','w'].includes(direction)||!Number.isFinite(deltaX))return null;
  if(snap) {
    // diagram-js 15.27.1 ResizeSnapping precedes GridSnapping: first border
    // within 7 graph units wins, in parent.children insertion order. Each
    // sibling contributes bottomRight then topLeft, followed by the original
    // dragged edge. Do not use nearest-distance or node-move grid semantics.
    const edge=direction==='e'?original.x+original.width:original.x;
    const pointer=edge+deltaX,candidates=[];
    for(const target of snapTargets) {
      if(target.hidden||target.waypoints||target.labelTarget||target.type==='label'||!validBounds(target))continue;
      candidates.push(target.x+target.width,target.x);
    }
    candidates.push(edge);
    const border=candidates.find(value=>Math.abs(value-pointer)<=7);
    let snapped=border;
    if(snapped===undefined) {
      snapped=Math.round(pointer/10)*10;
      // GridSnapping.snapValue quantizes the directional constraint too.
      snapped=direction==='e'?Math.max(snapped,Math.ceil((original.x+10)/10)*10)
        :Math.min(snapped,Math.floor((original.x+original.width-10)/10)*10);
    }
    deltaX=snapped-edge;
  }
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
