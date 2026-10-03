import assert from 'node:assert/strict';

/** Browser-serializable, post-setup only; never called inside motion sampling. */
export function collectPreviewOutline({ owner, zoom }) {
  const root = document.querySelector('#viewer'), gfx = root?.querySelector(`[data-element-id="${owner}"]`);
  const visual = gfx?.querySelector(':scope > circle:not([data-bpmn-hit]), :scope > rect:not([data-bpmn-hit]), :scope > polygon:not([data-bpmn-hit])');
  const outlines = [...(root?.querySelectorAll('.bpmn-xyflow-connect-outline') || [])];
  const handle = root?.querySelector(`.bpmn-xyflow-connect-handle[data-connect-source="${owner}"]`);
  const marker = root?.querySelector(`.bpmn-xyflow-connect-docking[data-connect-source="${owner}"] .bpmn-xyflow-connect-docking-point`);
  const attrs = e => e ? Object.fromEntries([...e.attributes].map(a => [a.name, a.value])) : null;
  const bbox = e => { if (!e) return null; const b = e.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
  const visible = e => {
    if (!e?.isConnected) return false;
    for (let p = e; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; }
    return true;
  };
  const read = e => { if (!e) return null; const s = getComputedStyle(e); return { tag: e.tagName.toLowerCase(), attrs: attrs(e), bbox: bbox(e), visible: visible(e),
    strokeWidth: s.strokeWidth, inlineStrokeWidth: e.style.getPropertyValue('stroke-width'), vectorEffect: s.vectorEffect, pointerEvents: s.pointerEvents, stroke: s.stroke, strokeOpacity: s.strokeOpacity }; };
  const canonicalStroke = value => { const style = document.createElement('div').style; style.setProperty('stroke-width', `${value}px`); return style.getPropertyValue('stroke-width'); };
  return { owner, gfxOwner: gfx?.getAttribute('data-element-id'), outlineCount: outlines.length,
    visual: read(visual), outline: read(outlines[0]), marker: attrs(marker), handleOwner: handle?.getAttribute('data-connect-source'),
    hit: attrs(handle?.querySelector('.bpmn-xyflow-connect-hit')),
    fixed: [...(handle?.querySelectorAll('.bpmn-xyflow-connect-fixed-anchor') || [])].map(read),
    expectedPreviewStroke: canonicalStroke(1 / zoom), expectedFixedStroke: canonicalStroke(1 / zoom) };
}

const halfULP32 = value => {
  if (!Number.isFinite(value)) return Infinity;
  if (Math.abs(value) < 2 ** -126) return 2 ** -150;
  return 2 ** (Math.floor(Math.log2(Math.abs(value))) - 24);
};
/** Conservative path-storage interval: each operand may round to float32 and
 * each cumulative path addition may round once. Width/height subtract two
 * extrema. This bound scales with actual coordinates and operation count. */
export function outlineBBoxBounds(numbers, box) {
  const magnitude = numbers.reduce((sum, n) => sum + Math.abs(n), 0);
  const coordinate = numbers.reduce((sum, n) => sum + halfULP32(n), 0) + numbers.length * halfULP32(magnitude);
  return { x: coordinate + halfULP32(box.x), y: coordinate + halfULP32(box.y),
    width: 2 * coordinate + halfULP32(box.width), height: 2 * coordinate + halfULP32(box.height) };
}
const paintedStroke = element => {
  const value=String(element.stroke||'').trim().toLowerCase();
  const alpha=/\/\s*([\d.]+)%?\s*\)$/.exec(value) || /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/.exec(value);
  return Number(element.strokeOpacity)>0 && !['','none','transparent'].includes(value) && (!alpha || Number(alpha[1])>0);
};
const tokens = path => String(path).match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)?.map(s => /^[A-Za-z]$/.test(s) ? s : Number(s)) || [];
const close = (a, b, label) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 32 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)), `${label}: ${a} / ${b}`);

/** Independent geometry from actual main paint attributes and the requested gap. */
export function validatePreviewOutline(evidence, shape, zoom, { outlinePolicy, gatewayPolicy }) {
  assert.ok(['baseline', 'outward'].includes(outlinePolicy)); assert.ok(['continuous', 'vertices'].includes(gatewayPolicy));
  assert.equal(evidence.owner, shape.id); assert.equal(evidence.gfxOwner, shape.id); assert.equal(evidence.handleOwner, shape.id);
  assert.equal(evidence.outlineCount, 1); assert.ok(Number.isFinite(zoom) && zoom > 0);
  const { visual, outline } = evidence; assert.ok(visual?.visible && outline?.visible); assert.ok(paintedStroke(visual) && paintedStroke(outline), 'main and preview strokes are actually painted');
  assert.equal(outline.pointerEvents, 'none');
  assert.equal(outline.strokeWidth, evidence.expectedPreviewStroke, 'actual CSS stroke uses native canonicalization');
  assert.equal(outline.inlineStrokeWidth, evidence.expectedPreviewStroke, 'tiny-svg inline CSS length remains one CSSpx after viewport scale');
  close(Number(evidence.hit.r), 5.75 / zoom, 'paint-sized press target stays unchanged');
  const mainStroke = Number.parseFloat(visual.strokeWidth);
  assert.ok(mainStroke > 0 && Number(visual.strokeOpacity) > 0 && !['none', 'transparent'].includes(visual.stroke));
  const border = visual.vectorEffect === 'non-scaling-stroke' ? mainStroke / zoom : mainStroke;
  const padding = outlinePolicy === 'outward' ? border / 2 + 3 / zoom : 0;
  const a = visual.attrs, n = key => Number(a[key] || 0), marker = { x: Number(evidence.marker.cx), y: Number(evidence.marker.cy) };
  let expected, box, projectedGap, original;
  if (shape.type.endsWith('Event')) {
    assert.equal(visual.tag, 'circle');
    const cx = shape.x + n('cx'), cy = shape.y + n('cy'), radius = n('r'), r = radius + padding;
    assert.ok(radius > 0); original = { cx, cy, radius };
    expected = ['M', cx, cy, 'm', 0, -r, 'a', r, r, 0, 1, 1, 0, 2*r, 'a', r, r, 0, 1, 1, 0, -2*r, 'z'];
    box = { x: cx-r, y: cy-r, width: 2*r, height: 2*r };
    assert.ok(Math.abs(Math.hypot(marker.x-cx, marker.y-cy)-radius) <= 1e-7, 'marker remains on original painted circle centerline');
    projectedGap = (r-radius)*zoom - border*zoom/2 - .5;
  } else if (shape.type.endsWith('Gateway')) {
    assert.equal(visual.tag, 'polygon');
    const pts = String(a.points).trim().split(/[ ,]+/).map(Number);
    assert.deepEqual(pts, [shape.width/2,0,shape.width,shape.height/2,shape.width/2,shape.height,0,shape.height/2]);
    const px = padding*Math.hypot(1,shape.width/shape.height), py = padding*Math.hypot(1,shape.height/shape.width),
      x=shape.x-px,y=shape.y-py,w=shape.width+2*px,h=shape.height+2*py;
    expected=['M',x+w/2,y,'l',w/2,h/2,'l',-w/2,h/2,'l',-w/2,-h/2,'z']; box={x,y,width:w,height:h};
    const vertices=[{x:shape.x+shape.width/2,y:shape.y},{x:shape.x+shape.width,y:shape.y+shape.height/2},{x:shape.x+shape.width/2,y:shape.y+shape.height},{x:shape.x,y:shape.y+shape.height/2}];
    if(gatewayPolicy==='vertices') assert.ok(vertices.some(p=>p.x===marker.x&&p.y===marker.y),'Gateway marker is an original vertex');
    else assert.ok(Math.abs(Math.abs(marker.x-shape.x-shape.width/2)/(shape.width/2)+Math.abs(marker.y-shape.y-shape.height/2)/(shape.height/2)-1)<=1e-7);
    assert.equal(evidence.fixed.length,gatewayPolicy==='vertices'?4:0);
    evidence.fixed.forEach((fixed,i)=>{
      assert.equal(fixed.visible,true); assert.ok(paintedStroke(fixed), 'fixed indicator has a visible painted stroke'); assert.equal(fixed.pointerEvents,'none'); assert.equal(fixed.attrs['pointer-events'],'none');
      assert.deepEqual({x:Number(fixed.attrs.cx),y:Number(fixed.attrs.cy)},vertices[i]);
      close(Number(fixed.attrs.r),2/zoom,'fixed indicator CSS radius'); assert.equal(fixed.strokeWidth,evidence.expectedFixedStroke);
    });
    original={vertices}; projectedGap=padding*zoom-border*zoom/2-.5;
  } else {
    assert.equal(visual.tag,'rect');
    const ox=shape.x+n('x'),oy=shape.y+n('y'),ow=n('width'),oh=n('height'),rx=n('rx'),
      x=ox-padding,y=oy-padding,w=ow+2*padding,h=oh+2*padding,r=rx+padding;
    assert.ok(ow>0&&oh>0&&rx>0); original={x:ox,y:oy,width:ow,height:oh,radius:rx};
    expected=['M',x+r,y,'l',w-2*r,0,'a',r,r,0,0,1,r,r,'l',0,h-2*r,'a',r,r,0,0,1,-r,r,'l',-w+2*r,0,'a',r,r,0,0,1,-r,-r,'l',0,-h+2*r,'a',r,r,0,0,1,r,-r,'z'];
    box={x,y,width:w,height:h};
    const onSegment = (fixed, at, along, low, high) => Math.abs(fixed-at)<=1e-7 && along>=low-1e-7 && along<=high+1e-7;
    const straight = onSegment(marker.y,oy,marker.x,ox+rx,ox+ow-rx) || onSegment(marker.y,oy+oh,marker.x,ox+rx,ox+ow-rx) ||
      onSegment(marker.x,ox,marker.y,oy+rx,oy+oh-rx) || onSegment(marker.x,ox+ow,marker.y,oy+rx,oy+oh-rx);
    const cornerX = marker.x<ox+rx?ox+rx:marker.x>ox+ow-rx?ox+ow-rx:null;
    const cornerY = marker.y<oy+rx?oy+rx:marker.y>oy+oh-rx?oy+oh-rx:null;
    assert.ok(straight || (cornerX!==null&&cornerY!==null&&Math.abs(Math.hypot(marker.x-cornerX,marker.y-cornerY)-rx)<=1e-7), 'Task docking remains on its original rounded perimeter');
    projectedGap=padding*zoom-border*zoom/2-.5;
  }
  if(!shape.type.endsWith('Gateway')) assert.equal(evidence.fixed.length,0);
  const actual=tokens(outline.attrs.d); assert.equal(actual.length,expected.length,'outline has the exact expected geometry commands');
  actual.forEach((value,i)=>typeof expected[i]==='string'?assert.equal(value,expected[i]):close(value,expected[i],`outline geometry operand${i}`));
  const limits=outlineBBoxBounds(expected.filter(v=>typeof v==='number'),box);
  for(const key of ['x','y','width','height']) assert.ok(Number.isFinite(outline.bbox[key])&&Math.abs(outline.bbox[key]-box[key])<=limits[key],`native SVG bbox ${key} stays within its derived float32 storage/arithmetic bound`);
  if(outlinePolicy==='outward') close(projectedGap,2.5,'visual gap is2.5CSSpx outside main paint including preview half-stroke');
  return { outlinePolicy,gatewayPolicy,original,box,nativeBBox:outline.bbox,bboxLimits:limits,projectedGapCss:projectedGap,marker };
}
