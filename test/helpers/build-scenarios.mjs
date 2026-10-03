/** Original representative business-process fixtures. Not process-engine execution tests. */
import { BpmnModdle } from 'bpmn-moddle';
import { writeFile, mkdir } from 'node:fs/promises';
const destination = new URL('../fixtures/scenarios/', import.meta.url);
await mkdir(destination, { recursive: true });
async function scenario(name, build) {
  const m = new BpmnModdle();
  const defs=m.create('bpmn:Definitions',{id:'Definitions_'+name,targetNamespace:'https://bpmn-xyflow.example/scenarios',rootElements:[],diagrams:[]});
  const plane=m.create('bpmndi:BPMNPlane',{id:'Plane_'+name,planeElement:[]});
  defs.diagrams.push(m.create('bpmndi:BPMNDiagram',{id:'Diagram_'+name,plane}));
  const nodes=new Map();
  function root(type,id,attrs={}) { const bo=m.create('bpmn:'+type,{id,...attrs});bo.$parent=defs;defs.rootElements.push(bo);return bo; }
  function shape(type,id,name,parent,x,y,width=100,height=80,attrs={}) {
    const bo=m.create('bpmn:'+type,{id,name,...attrs}); bo.$parent=parent;
    const owner=type==='Participant'?'participants':type==='Lane'?'lanes':type==='TextAnnotation'?'artifacts':'flowElements';
    (parent[owner]||=[]).push(bo);
    const bounds=m.create('dc:Bounds',{x,y,width,height});
    const di=m.create('bpmndi:BPMNShape',{id:id+'_di',bpmnElement:bo,bounds,...(type==='SubProcess'||type==='Transaction'?{isExpanded:true}:{})});
    plane.planeElement.push(di);nodes.set(id,{bo,di,x,y,width,height});return bo;
  }
  function definition(bo,type,attrs={}) {const ed=m.create('bpmn:'+type+'EventDefinition',attrs);ed.$parent=bo;(bo.eventDefinitions||=[]).push(ed);return ed;}
  function flow(id,sourceId,targetId,parent,attrs={},points) {
    const s=nodes.get(sourceId),t=nodes.get(targetId);
    const bo=m.create('bpmn:SequenceFlow',{id,sourceRef:s.bo,targetRef:t.bo,...attrs});bo.$parent=parent;(parent.flowElements||=[]).push(bo);
    (s.bo.outgoing||=[]).push(bo);(t.bo.incoming||=[]).push(bo);
    const waypoint=(points||[{x:s.x+s.width,y:s.y+s.height/2},{x:t.x,y:t.y+t.height/2}]).map(p=>m.create('dc:Point',p));
    plane.planeElement.push(m.create('bpmndi:BPMNEdge',{id:id+'_di',bpmnElement:bo,waypoint}));return bo;
  }
  function connection(type,id,sourceId,targetId,parent,attrs={}) {
    const s=nodes.get(sourceId),t=nodes.get(targetId);const bo=m.create('bpmn:'+type,{id,sourceRef:s.bo,targetRef:t.bo,...attrs});bo.$parent=parent;
    (parent[type==='MessageFlow'?'messageFlows':'artifacts']||=[]).push(bo);
    plane.planeElement.push(m.create('bpmndi:BPMNEdge',{id:id+'_di',bpmnElement:bo,waypoint:[m.create('dc:Point',{x:s.x+s.width/2,y:s.y+s.height}),m.create('dc:Point',{x:t.x+t.width/2,y:t.y})]}));return bo;
  }
  await build({m,defs,plane,nodes,root,shape,definition,flow,connection});
  const {xml}=await m.toXML(defs,{format:true}); await writeFile(new URL(name+'.bpmn',destination),xml);
}
await scenario('order-payment-delivery',({m,plane,root,shape,definition,flow,connection})=>{
  const buyer=root('Process','BuyerProcess',{isExecutable:false}),seller=root('Process','SellerProcess',{isExecutable:false});
  const collab=root('Collaboration','OrderCollaboration');plane.bpmnElement=collab;
  shape('Participant','BuyerPool','Customer',collab,30,30,1450,170,{processRef:buyer});
  shape('Participant','SellerPool','Order fulfillment',collab,30,250,1450,420,{processRef:seller});
  shape('StartEvent','BuyerStart','Need product',buyer,100,96,36,36);
  shape('SendTask','SubmitOrder','Submit order',buyer,200,75);
  shape('ReceiveTask','ReceiveDelivery','Receive delivery',buyer,1210,75);
  shape('EndEvent','BuyerEnd','Order received',buyer,1380,96,36,36);
  flow('BuyerFlow1','BuyerStart','SubmitOrder',buyer);flow('BuyerFlow2','SubmitOrder','ReceiveDelivery',buyer);flow('BuyerFlow3','ReceiveDelivery','BuyerEnd',buyer);
  const start=shape('StartEvent','OrderReceived','Order received',seller,100,410,36,36);definition(start,'Message');
  shape('Task','ValidateOrder','Validate order',seller,200,390);
  const payment=shape('SubProcess','Payment','Authorize and capture payment',seller,350,320,340,250);
  shape('StartEvent','PaymentStart','',payment,380,417,36,36);
  const charge=shape('ServiceTask','CapturePayment','Capture payment',payment,460,395,120,80);
  charge.documentation=[m.create('bpmn:Documentation',{text:'Capture payment only after order validation; a failed charge must not start fulfillment.'})];
  shape('EndEvent','PaymentEnd','Payment captured',payment,620,417,36,36);
  flow('PaymentFlow1','PaymentStart','CapturePayment',payment);flow('PaymentFlow2','CapturePayment','PaymentEnd',payment);
  shape('ParallelGateway','FulfillmentFork','Prepare shipment and invoice',seller,740,405,50,50);
  shape('ServiceTask','CreateInvoice','Create invoice',seller,840,305);
  shape('Task','PackOrder','Pick and pack',seller,840,505);
  shape('ParallelGateway','FulfillmentJoin','Ready to dispatch',seller,1020,405,50,50);
  shape('SendTask','ShipOrder','Dispatch order',seller,1160,390);
  shape('EndEvent','SellerEnd','Fulfilled',seller,1370,412,36,36);
  for(const [i,a,b] of [[1,'OrderReceived','ValidateOrder'],[2,'ValidateOrder','Payment'],[3,'Payment','FulfillmentFork'],[4,'FulfillmentFork','CreateInvoice'],[5,'FulfillmentFork','PackOrder'],[6,'CreateInvoice','FulfillmentJoin'],[7,'PackOrder','FulfillmentJoin'],[8,'FulfillmentJoin','ShipOrder'],[9,'ShipOrder','SellerEnd']])flow('SellerFlow'+i,a,b,seller);
  connection('MessageFlow','OrderMessage','SubmitOrder','OrderReceived',collab,{name:'Purchase order'});
  connection('MessageFlow','DeliveryMessage','ShipOrder','ReceiveDelivery',collab,{name:'Delivery notice'});
});
await scenario('approval-rejection-rework',({m,plane,root,shape,flow})=>{
  const process=root('Process','ApprovalProcess',{isExecutable:false});plane.bpmnElement=process;
  const laneSet=m.create('bpmn:LaneSet',{id:'ApprovalLanes',lanes:[]});laneSet.$parent=process;process.laneSets=[laneSet];
  const requester=shape('Lane','RequesterLane','Requester',laneSet,20,20,1250,220,{flowNodeRef:[]});
  const reviewer=shape('Lane','ReviewerLane','Reviewer',laneSet,20,240,1250,220,{flowNodeRef:[]});
  const start=shape('StartEvent','RequestStart','New request',process,100,100,36,36);
  const submit=shape('UserTask','SubmitRequest','Prepare request',process,230,78);
  const review=shape('UserTask','ReviewRequest','Review request',process,450,308);
  const decision=shape('ExclusiveGateway','ApprovalDecision','Approved?',process,650,323,50,50);
  const rework=shape('UserTask','ReworkRequest','Address review feedback',process,800,78,140,80);
  const approved=shape('EndEvent','ApprovedEnd','Approved',process,1100,330,36,36);
  requester.flowNodeRef=[start,submit,rework];reviewer.flowNodeRef=[review,decision,approved];
  flow('SubmitFlow','RequestStart','SubmitRequest',process);flow('ReviewFlow','SubmitRequest','ReviewRequest',process);flow('DecisionFlow','ReviewRequest','ApprovalDecision',process);
  flow('ApproveFlow','ApprovalDecision','ApprovedEnd',process,{name:'Approved',conditionExpression:m.create('bpmn:FormalExpression',{body:'${approved == true}',language:'juel'})});
  decision.default=flow('RejectFlow','ApprovalDecision','ReworkRequest',process,{name:'Needs changes'});
  flow('ReworkFlow','ReworkRequest','ReviewRequest',process,{name:'Resubmit'},[{x:870,y:158},{x:870,y:210},{x:500,y:210},{x:500,y:308}]);
});
await scenario('booking-timeout-compensation',({m,plane,root,shape,definition,flow,connection})=>{
  const process=root('Process','BookingProcess',{isExecutable:false});plane.bpmnElement=process;
  shape('StartEvent','BookingStart','Travel request',process,80,260,36,36);
  const transaction=shape('Transaction','BookingTransaction','Book flight and hotel',process,220,110,700,440);
  shape('StartEvent','ReservationStart','',transaction,260,240,36,36);
  const hotel=shape('ServiceTask','ReserveHotel','Reserve hotel',transaction,360,220,120,80);
  const flight=shape('ServiceTask','ReserveFlight','Reserve flight',transaction,620,220,120,80);
  shape('EndEvent','ReservationsComplete','Reserved',transaction,830,240,36,36);
  const compensation=shape('BoundaryEvent','HotelCompensation','Compensate hotel',transaction,400,282,36,36,{attachedToRef:hotel,cancelActivity:false});definition(compensation,'Compensate');
  shape('ServiceTask','ReleaseHotel','Release hotel reservation',transaction,350,385,150,80,{isForCompensation:true});
  connection('Association','CompensateHotel','HotelCompensation','ReleaseHotel',transaction,{associationDirection:'One'});
  const timer=shape('BoundaryEvent','FlightTimeout','One hour timeout',transaction,670,282,36,36,{attachedToRef:flight,cancelActivity:true});
  definition(timer,'Timer',{timeDuration:m.create('bpmn:FormalExpression',{body:'PT1H'})});
  const cancelled=shape('EndEvent','CancelBooking','Cancel transaction',transaction,790,405,36,36);definition(cancelled,'Cancel');
  flow('ReservationFlow1','ReservationStart','ReserveHotel',transaction);flow('ReservationFlow2','ReserveHotel','ReserveFlight',transaction);flow('ReservationFlow3','ReserveFlight','ReservationsComplete',transaction);flow('TimeoutFlow','FlightTimeout','CancelBooking',transaction);
  const cancelBoundary=shape('BoundaryEvent','BookingCancelled','Booking cancelled',process,850,532,36,36,{attachedToRef:transaction});definition(cancelBoundary,'Cancel');
  shape('SendTask','ConfirmBooking','Send confirmation',process,1020,238,120,80);shape('EndEvent','ConfirmedEnd','Confirmed',process,1240,260,36,36);
  shape('SendTask','NotifyCancellation','Notify cancellation',process,1020,500,120,80);shape('EndEvent','CancelledEnd','Cancelled and compensated',process,1240,522,36,36);
  flow('BookingFlow1','BookingStart','BookingTransaction',process);flow('BookingFlow2','BookingTransaction','ConfirmBooking',process);flow('BookingFlow3','ConfirmBooking','ConfirmedEnd',process);flow('CancellationFlow1','BookingCancelled','NotifyCancellation',process);flow('CancellationFlow2','NotifyCancellation','CancelledEnd',process);
});
