import { canResize as upstreamCanResize } from './ContextRules';
import { horizontalLane, laneSplitBounds } from './LaneLayout';
const is = (node, type) => !!node?.businessObject?.$instanceOf(type);
export function canStartConnection(node) {
  return ['bpmn:FlowNode','bpmn:InteractionNode','bpmn:DataObjectReference','bpmn:DataStoreReference','bpmn:TextAnnotation'].some(type=>is(node,type)) && !node.labelTarget;
}
// Task resizing is an intentional existing editor extension. All other UI
// resize eligibility/direction is delegated to the pinned upstream predicate.
export function canResizeShape(node, bounds, direction, taskResize = true) {
  return upstreamCanResize(node,bounds,direction) || (taskResize && !node?.labelTarget && node?.type !== 'label' && is(node,'bpmn:Task'));
}
export function canAddLane(node) {
  if (!node || !['bpmn:Lane','bpmn:Participant'].includes(node.type) || (node.type==='bpmn:Participant'&&!node.businessObject.processRef)) return false;
  const parent=node.type==='bpmn:Participant'?node:node.parent;
  if(!parent)return false;
  const horizontal=horizontalLane(node),width=node.width-(parent===node&&horizontal?30:0),height=node.height-(parent===node&&!horizontal?30:0);
  if(width<20||height<20)return false;
  if(!(parent.children||[]).some(child=>child.type==='bpmn:Lane')&&laneSplitBounds(parent,1).some(bounds=>bounds.width<20||bounds.height<20))return false;
  return true;
}
export function laneActions(node) {
  if (!node || !['bpmn:Lane','bpmn:Participant'].includes(node.type) || (node.type==='bpmn:Participant'&&!node.businessObject.processRef)) return [];
  const result=[];
  if(canAddLane(node))result.push({action:'before',label:'Add lane before'},{action:'after',label:'Add lane after'});
  if((node.children||[]).filter(child=>child.type==='bpmn:Lane').length<2){
    const extent=horizontalLane(node)?node.height:node.width;
    for(const [count,label]of [[2,'Split into two lanes'],[3,'Split into three lanes']])if(extent>=count*60&&laneSplitBounds(node,count).every(bounds=>bounds.width>=20&&bounds.height>=20))result.push({action:'split',count,label});
  }
  return result;
}
