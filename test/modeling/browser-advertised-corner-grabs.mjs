/** D20 native advertised-corner acceptance; separate from the unchanged twelve painted-origin workflows. */
import { pathToFileURL } from 'node:url';
import { viewportSourceWorkflow, runViewportSourceCases } from './browser-viewport-source-grabs.mjs';

const corners = [
  ['north-west', 'nw', [340,220]], ['north-east', 'ne', [-340,220]],
  ['south-west', 'sw', [340,-220]], ['south-east', 'se', [-340,-220]]
];
export const advertisedCornerCases = corners.flatMap(([name,direction,offset], i) => [.5,2].map((zoom,j) => ({
  id: `D20-${String(i*2+j+1).padStart(2,'0')}`, name: `${name}-${zoom === .5 ? 'low' : 'high'}`,
  engine: 'local', sample: 'Empty diagram', direction, zoom,
  run: (h,page,key) => viewportSourceWorkflow(h,page,key,{name,direction,zoom,offset,advertised:true})
})));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--list')) console.log(JSON.stringify(advertisedCornerCases.map(({run:_run,...c})=>({...c,status:'prepared-unrun'})),null,2));
  else await runViewportSourceCases(advertisedCornerCases, {
    output: 'test-artifacts/advertised-corner-grabs', basePort: Number(process.env.BPMN_ADVERTISED_CORNER_PORT || 5360)
  });
}
