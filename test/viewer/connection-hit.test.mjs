import assert from 'node:assert/strict';
import { after,test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
const dom=await setupDOM();
const {default:Viewer}=await dom.loadModule('/lib/Viewer.js');
after(()=>dom.cleanup());
test('connection hit regions track exact visual paths without widening markers or exported SVG',async()=>{
  const viewer=new Viewer({container:dom.createContainer(),fitViewOnInit:false});
  try {
    await viewer.importXML(await readFile('test/fixtures/bpmn/draw/conditional-flow.bpmn','utf8'));
    for(const edge of viewer.getGraph().edges) {
      const graphic=viewer._internals.elementGfx(edge.id),visual=graphic.querySelector('.bpmn-xyflow-connection-visual');
      const hit=graphic.querySelector('.bpmn-xyflow-connection-hit');
      assert.ok(visual);assert.ok(hit);
      assert.equal(hit.getAttribute('d'),visual.getAttribute('d'));
      assert.equal(hit.getAttribute('stroke-width'),'15','pinned diagram-js graph-space interaction width');
      assert.equal(hit.getAttribute('vector-effect'),null,'hit corridor scales with the same diagram as upstream');
      assert.equal(hit.getAttribute('pointer-events'),'stroke');
      assert.equal(hit.getAttribute('stroke'),'transparent');
      assert.equal(hit.getAttribute('marker-start'),null);assert.equal(hit.getAttribute('marker-end'),null);
      assert.equal(hit.parentNode,graphic,'the same uncut corridor applies at endpoints as pinned upstream');
      assert.equal(graphic.querySelectorAll('clipPath').length,0);
      const path=hit.getAttribute('d');viewer.select(edge.id);viewer._internals.redrawConnection(edge);
      assert.equal(viewer._internals.elementGfx(edge.id).querySelector('.bpmn-xyflow-connection-hit').getAttribute('d'),path);
    }
    const markers=[...viewer.getSvg().querySelectorAll('marker')].map(marker=>marker.id);
    assert.ok(markers.length>0);
    const svg=(await viewer.saveSVG()).svg;
    assert.ok(!svg.includes('data-bpmn-hit'));assert.ok(!svg.includes('bpmn-xyflow-hit-clip'));
    assert.ok(svg.includes('<marker'));
    for(const id of markers)assert.ok(svg.includes(`id="${id}"`),'export retains original renderer marker definitions');
  }finally{viewer.destroy();}
});
