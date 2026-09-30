import assert from 'node:assert/strict';
export function indexDefinitions(definitions) {
  const byId=new Map(), visited=new Set();
  function walk(element) {
    if (!element || typeof element!=='object' || visited.has(element)) return;
    visited.add(element);
    if(element.id) {
      assert.ok(!byId.has(element.id)||byId.get(element.id)===element,`duplicate ID ${element.id}`);
      byId.set(element.id,element);
    }
    for(const property of element.$descriptor?.properties||[]) {
      if(property.isReference||property.isVirtual||property.isAttr)continue;
      const value=element[property.name];
      if(Array.isArray(value))value.forEach(walk);else walk(value);
    }
  }
  walk(definitions);return byId;
}
export function assertScenario(name, definitions) {
  const map=indexDefinitions(definitions);
  const at=id=>{assert.ok(map.has(id),`missing ${id}`);return map.get(id);};
  const ref=(id,key,expected)=>assert.equal(at(id)[key]?.id,expected,`${id}.${key}`);
  const event=(id,type)=>assert.ok(at(id).eventDefinitions?.some(def=>def.$type==='bpmn:'+type+'EventDefinition'),`${id} ${type} event`);
  if(name==='order-payment-delivery') {
    ref('BuyerPool','processRef','BuyerProcess');ref('SellerPool','processRef','SellerProcess');
    ref('Payment','$parent','SellerProcess');ref('CapturePayment','$parent','Payment');
    ref('SellerFlow3','sourceRef','Payment');ref('SellerFlow3','targetRef','FulfillmentFork');
    assert.equal(at('FulfillmentFork').outgoing.length,2);assert.equal(at('FulfillmentJoin').incoming.length,2);
    ref('SellerFlow8','sourceRef','FulfillmentJoin');ref('SellerFlow8','targetRef','ShipOrder');
    for(const id of ['OrderMessage','DeliveryMessage']) {assert.equal(at(id).$type,'bpmn:MessageFlow');ref(id,'$parent','OrderCollaboration');}
    ref('OrderMessage','sourceRef','SubmitOrder');ref('OrderMessage','targetRef','OrderReceived');
    ref('DeliveryMessage','sourceRef','ShipOrder');ref('DeliveryMessage','targetRef','ReceiveDelivery');
  } else if(name==='approval-rejection-rework') {
    ref('ApprovalDecision','default','RejectFlow');
    ref('RejectFlow','targetRef','ReworkRequest');ref('ReworkFlow','sourceRef','ReworkRequest');ref('ReworkFlow','targetRef','ReviewRequest');
    assert.equal(at('ApproveFlow').conditionExpression.body,'${approved == true}');
    assert.ok(at('RequesterLane').flowNodeRef.includes(at('ReworkRequest')));
    assert.ok(at('ReviewerLane').flowNodeRef.includes(at('ReviewRequest')));
  } else if(name==='booking-timeout-compensation') {
    assert.equal(at('BookingTransaction').$type,'bpmn:Transaction');
    ref('ReserveFlight','$parent','BookingTransaction');ref('FlightTimeout','attachedToRef','ReserveFlight');
    event('FlightTimeout','Timer');assert.equal(at('FlightTimeout').eventDefinitions[0].timeDuration.body,'PT1H');
    assert.notEqual(at('FlightTimeout').cancelActivity,false);
    ref('TimeoutFlow','targetRef','CancelBooking');event('CancelBooking','Cancel');
    ref('BookingCancelled','attachedToRef','BookingTransaction');event('BookingCancelled','Cancel');
    ref('CancellationFlow1','sourceRef','BookingCancelled');ref('CancellationFlow1','targetRef','NotifyCancellation');
    ref('HotelCompensation','attachedToRef','ReserveHotel');event('HotelCompensation','Compensate');
    ref('CompensateHotel','sourceRef','HotelCompensation');ref('CompensateHotel','targetRef','ReleaseHotel');
    assert.equal(at('CompensateHotel').associationDirection,'One');assert.equal(at('ReleaseHotel').isForCompensation,true);
  } else throw new Error('Unknown scenario: '+name);
  for(const element of map.values()) {
    if(element.$type==='bpmn:SequenceFlow') {
      assert.equal(element.sourceRef.$parent,element.targetRef.$parent,`${element.id} must not cross sequence-flow scope`);
      assert.equal(element.$parent,element.sourceRef.$parent,`${element.id} must belong to source scope`);
    }
  }
  return map;
}
