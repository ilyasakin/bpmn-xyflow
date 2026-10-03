import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';

// Exact saveXML ordering observed from the pinned full bpmn-js18.30.1 service
// for these two authored scenarios. BpmnImporter inserts lanes at index0;
// BpmnDiOrdering exports depth-first canvas order. These expected orders are
// independent of the actual XML being checked, never copied from that output.
const planeOrders = {
  'Plane_approval-rejection-rework': [
    'ReviewerLane_di','RequesterLane_di','RequestStart_di','SubmitRequest_di',
    'ReviewRequest_di','ApprovalDecision_di','ReworkRequest_di','ApprovedEnd_di',
    'SubmitFlow_di','ReviewFlow_di','DecisionFlow_di','ApproveFlow_di','RejectFlow_di','ReworkFlow_di'
  ],
  'Plane_booking-timeout-compensation': [
    'BookingStart_di','BookingTransaction_di','ReservationStart_di','ReserveHotel_di',
    'ReserveFlight_di','ReservationsComplete_di','ReleaseHotel_di','CancelBooking_di',
    'FlightTimeout_di','HotelCompensation_di','ReservationFlow1_di','ReservationFlow2_di',
    'ReservationFlow3_di','TimeoutFlow_di','CompensateHotel_di','ConfirmBooking_di',
    'ConfirmedEnd_di','NotifyCancellation_di','CancelledEnd_di','BookingCancelled_di',
    'BookingFlow1_di','BookingFlow2_di','BookingFlow3_di','CancellationFlow1_di','CancellationFlow2_di'
  ]
};

const sourcePlaneOrders = {
  'Plane_approval-rejection-rework': [
    'RequesterLane_di','ReviewerLane_di','RequestStart_di','SubmitRequest_di',
    'ReviewRequest_di','ApprovalDecision_di','ReworkRequest_di','ApprovedEnd_di',
    'SubmitFlow_di','ReviewFlow_di','DecisionFlow_di','ApproveFlow_di','RejectFlow_di','ReworkFlow_di'
  ],
  'Plane_booking-timeout-compensation': [
    'BookingStart_di','BookingTransaction_di','ReservationStart_di','ReserveHotel_di',
    'ReserveFlight_di','ReservationsComplete_di','HotelCompensation_di','ReleaseHotel_di',
    'CompensateHotel_di','FlightTimeout_di','CancelBooking_di','ReservationFlow1_di',
    'ReservationFlow2_di','ReservationFlow3_di','TimeoutFlow_di','BookingCancelled_di',
    'ConfirmBooking_di','ConfirmedEnd_di','NotifyCancellation_di','CancelledEnd_di',
    'BookingFlow1_di','BookingFlow2_di','BookingFlow3_di','CancellationFlow1_di','CancellationFlow2_di'
  ]
};

/**
 * Local import/save must preserve its input model separately. This comparison
 * accounts only for measured reference-import/export side effects; it does not
 * discard DI fields, references, namespace attributes or element membership.
 * Raw comments/PI remain the native harness's additional local invariant.
 */
export async function assertLabelReferenceImport(localXML, referenceXML) {
  const oracle=new BpmnModdle(),expected=await oracle.fromXML(localXML),actual=await oracle.fromXML(referenceXML);
  assert.deepEqual(expected.warnings,[]);assert.deepEqual(actual.warnings,[]);
  const transforms=[];
  for(const diagram of expected.rootElement.diagrams||[]) {
    const plane=diagram.plane,order=planeOrders[plane.id];
    assert.ok(order,`Reference import policy must be measured for plane ${plane.id}`);
    const byId=new Map(plane.planeElement.map(entry=>[entry.id,entry]));
    assert.deepEqual([...byId.keys()].sort(),[...order].sort(),'reference normalization never adds or removes diagram entries');
    const before=plane.planeElement.map(entry=>entry.id);
    assert.ok([sourcePlaneOrders[plane.id],order].some(known=>JSON.stringify(known)===JSON.stringify(before)),
      'input DI order must be the exact authored order or its measured upstream normalization');
    plane.planeElement=order.map(id=>byId.get(id));
    if(JSON.stringify(before)!==JSON.stringify(order))transforms.push({plane:plane.id,kind:'canvas-order',before,after:order});
  }
  // ElementFactory#createBpmnElement sets an absent ExclusiveGateway marker
  // to true on import. Explicit true/false values remain significant.
  const gateway=expected.elementsById.ApprovalDecision_di;
  if(gateway&&!Object.hasOwn(gateway,'isMarkerVisible')) {
    assert.equal(gateway.bpmnElement.$type,'bpmn:ExclusiveGateway');
    gateway.isMarkerVisible=true;
    transforms.push({id:gateway.id,kind:'default-marker',after:true});
  }
  assert.equal((await oracle.toXML(actual.rootElement,{format:true})).xml,
    (await oracle.toXML(expected.rootElement,{format:true})).xml,
    'reference reopen differs only by the exact measured canvas order and absent gateway marker');
  return transforms;
}
