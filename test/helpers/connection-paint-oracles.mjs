import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';

/** Choose an explicit integer CSS destination before native input. Model and
 * SVG coordinates remain fractional; the delivered event must equal this point. */
export function paintReleasePoint(point) {
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

/** Pinned bpmn-js 18.30.1 ElementFactory adds a visible marker on importing an
 * ExclusiveGateway whose DI omits isMarkerVisible. This is only an expected
 * reference-export model: the local exported XML is still pasted unchanged.
 * No geometry, ordering, metadata or other gateway property is normalized. */
export async function paintReferenceExpectation(xml, gatewayId) {
  const moddle = new BpmnModdle(), parsed = await moddle.fromXML(xml);
  assert.deepEqual(parsed.warnings, []);
  const shapes = parsed.rootElement.diagrams.flatMap(diagram => diagram.plane.planeElement || []);
  const gateway = parsed.elementsById[gatewayId];
  assert.equal(gateway?.$type, 'bpmn:ExclusiveGateway', 'only the explicitly named palette gateway');
  const matching = shapes.filter(shape => shape.bpmnElement === gateway);
  assert.equal(matching.length, 1, 'one exact gateway DI owner');
  const di = matching[0];
  assert.equal(di.$type, 'bpmndi:BPMNShape');
  assert.equal(Object.hasOwn(di, 'isMarkerVisible'), false, 'the measured implicit-marker case only');
  di.isMarkerVisible = true;
  return {
    canonical: (await moddle.toXML(parsed.rootElement, { format: true })).xml,
    adjustment: { gatewayId, diId: di.id, property: 'isMarkerVisible', before: 'absent', after: true }
  };
}
