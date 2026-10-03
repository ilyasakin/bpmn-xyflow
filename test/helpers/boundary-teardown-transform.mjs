import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const TEARDOWN_STATEMENT = '    connectHandle?.remove(); connectOutline?.remove(); connectDockingMarker?.remove();';
const FUNCTION_PREFIX = '  function destroyConnectHandle() {\n';

/** Test-server transform only; no file on disk is rewritten. */
export function instrumentBoundaryTeardown(source) {
  const anchor=FUNCTION_PREFIX+TEARDOWN_STATEMENT;
  assert.equal(source.split(anchor).length,2,'one exact reviewed teardown statement');
  const sourceSha256=createHash('sha256').update(source).digest('hex');
  const trace=`
    // Diagnostic-only served code. Original removals already completed.
    if (connectHandle) { try {
      globalThis.__bpmnBoundaryTeardownRecord?.({
        time: performance.now(), sourceSha256: '${sourceSha256}',
        stack: new Error('diagnostic destroyConnectHandle caller').stack,
        handle: connectHandle, owner: hoveredForConnect?.id ?? null,
        anchor: connectPort && { x: connectPort.x, y: connectPort.y },
        grab: connectGrab && { x: connectGrab.x, y: connectGrab.y },
        acquisition: connectApproach && {
          point: connectApproach.point && { x: connectApproach.point.x, y: connectApproach.point.y },
          origin: connectApproach.origin && { x: connectApproach.origin.x, y: connectApproach.origin.y },
          acquired: connectApproach.acquired, travelling: connectApproach.travelling,
          reachedGrab: connectApproach.reachedGrab
        }
      });
    } catch (error) {
      try { (globalThis.__bpmnBoundaryTeardownErrors ||= []).push({ time: performance.now(), message: String(error) }); } catch {}
    } }
`;
  const code=source.replace(anchor,anchor+trace);
  return {code,map:null,sourceSha256,servedSha256:createHash('sha256').update(code).digest('hex'),trace};
}

export function boundaryTeardownPlugin(repoRoot) {
  const target=path.join(repoRoot,'lib/Modeler.js');
  return {name:'test-only-boundary-teardown',enforce:'pre',transform(source,id){
    if(id.split('?')[0]!==target)return null;
    const {code,map}=instrumentBoundaryTeardown(source);
    return {code,map};
  }};
}
