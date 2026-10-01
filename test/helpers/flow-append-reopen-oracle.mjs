import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';

// These exact orders were measured through bpmn-js 18.30.1 ContextPad /
// modeling.appendShape, saveXML, importXML and saveXML again. BpmnDiOrdering
// rebuilds planeElement from the canvas tree on save. On reimport, the newly
// appended annotation and Association occupy the opposite slots. No semantic,
// attribute, reference, Bounds, waypoint or existing-DI order change is allowed.
const layouts = {
  ApproveFlow: {
    definitions: 'Definitions_approval-rejection-rework',
    plane: 'Plane_approval-rejection-rework',
    owner: 'ApprovalProcess',
    prefix: [
      'ReviewerLane_di', 'RequesterLane_di', 'RequestStart_di', 'SubmitRequest_di',
      'ReviewRequest_di', 'ApprovalDecision_di', 'ReworkRequest_di', 'ApprovedEnd_di'
    ],
    suffix: [ 'SubmitFlow_di', 'ReviewFlow_di', 'DecisionFlow_di', 'ApproveFlow_di', 'RejectFlow_di', 'ReworkFlow_di' ]
  },
  OrderMessage: {
    definitions: 'Definitions_order-payment-delivery',
    plane: 'Plane_order-payment-delivery',
    owner: 'OrderCollaboration',
    prefix: [
      'BuyerPool_di', 'BuyerStart_di', 'SubmitOrder_di', 'ReceiveDelivery_di', 'BuyerEnd_di',
      'BuyerFlow1_di', 'BuyerFlow2_di', 'BuyerFlow3_di', 'SellerPool_di', 'OrderReceived_di',
      'ValidateOrder_di', 'Payment_di', 'PaymentStart_di', 'CapturePayment_di', 'PaymentEnd_di',
      'PaymentFlow1_di', 'PaymentFlow2_di', 'FulfillmentFork_di', 'CreateInvoice_di', 'PackOrder_di',
      'FulfillmentJoin_di', 'ShipOrder_di', 'SellerEnd_di', 'SellerFlow1_di', 'SellerFlow2_di',
      'SellerFlow3_di', 'SellerFlow4_di', 'SellerFlow5_di', 'SellerFlow6_di', 'SellerFlow7_di',
      'SellerFlow8_di', 'SellerFlow9_di'
    ],
    suffix: [ 'OrderMessage_di', 'DeliveryMessage_di' ]
  }
};

/** Assert only the measured upstream append/reimport order transformation. */
export async function assertUpstreamFlowAppendReopen(beforeXML, afterXML, { ownerId, noteId, associationId }) {
  const layout = layouts[ownerId];
  assert.ok(layout, 'known append fixture owner is required');
  assert.ok(typeof noteId === 'string' && typeof associationId === 'string' && noteId !== associationId);
  const moddle = new BpmnModdle();
  const before = await moddle.fromXML(beforeXML), after = await moddle.fromXML(afterXML);
  assert.deepEqual(before.warnings, [], 'pre-reopen independent parse');
  assert.deepEqual(after.warnings, [], 'post-reopen independent parse');
  assert.equal(before.rootElement.id, layout.definitions);
  assert.equal(after.rootElement.id, layout.definitions);
  assert.equal(before.rootElement.diagrams.length, 1);
  assert.equal(after.rootElement.diagrams.length, 1);
  const first = before.rootElement.diagrams[0].plane, second = after.rootElement.diagrams[0].plane;
  assert.equal(first.id, layout.plane);
  assert.equal(second.id, layout.plane);
  const note = before.elementsById[noteId], association = before.elementsById[associationId];
  assert.equal(note?.$type, 'bpmn:TextAnnotation');
  assert.equal(association?.$type, 'bpmn:Association');
  assert.equal(note.$parent.id, layout.owner);
  assert.equal(association.$parent.id, layout.owner);
  assert.equal(association.sourceRef?.id, ownerId);
  assert.equal(association.targetRef, note);
  const noteDi = first.planeElement.filter(di => di.bpmnElement === note);
  const associationDi = first.planeElement.filter(di => di.bpmnElement === association);
  assert.equal(noteDi.length, 1);
  assert.equal(associationDi.length, 1);
  assert.equal(noteDi[0].$type, 'bpmndi:BPMNShape');
  assert.equal(associationDi[0].$type, 'bpmndi:BPMNEdge');
  const inputOrder = [ ...layout.prefix, associationDi[0].id, ...layout.suffix, noteDi[0].id ];
  const outputOrder = [ ...layout.prefix, noteDi[0].id, ...layout.suffix, associationDi[0].id ];
  assert.equal(new Set(inputOrder).size, inputOrder.length, 'generated DI IDs must not collide with fixture entries');
  assert.deepEqual(first.planeElement.map(di => di.id), inputOrder, 'exact measured pre-reopen DI order');
  assert.deepEqual(second.planeElement.map(di => di.id), outputOrder, 'exact measured post-reopen DI order');
  const byId = new Map(first.planeElement.map(di => [ di.id, di ]));
  first.planeElement = outputOrder.map(id => byId.get(id));
  const expected = (await moddle.toXML(before.rootElement, { format: true })).xml;
  const actual = (await moddle.toXML(after.rootElement, { format: true })).xml;
  assert.equal(actual, expected, 'upstream reimport changes only the measured annotation/Association DI order');
  return { planeId: layout.plane, inputOrder, outputOrder };
}
