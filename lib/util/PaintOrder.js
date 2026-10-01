/**
 * Stable SVG paint order, independent of the importer's semantic visit order.
 * Lanes are visited after flow nodes and are not their graph parents; use their
 * flowNodeRef membership as an explicit paint dependency instead.
 */
export function isFrameElement(node) {
  if (node.type === 'label' || node.labelTarget) return false;
  // Imported and newly authored Groups must agree. An available current
  // semantic type wins over a missing or stale importer convenience flag.
  const type = node.businessObject?.$type || node.type;
  return type ? type === 'bpmn:Group' : !!node.isFrame;
}

export function getShapePaintOrder(nodes) {
  const shapes = nodes.filter(node => node.type !== 'label');
  const byId = new Map(shapes.map(node => [node.id, node]));
  const lanesFor = new Map();
  for (const lane of shapes) {
    if (lane.type !== 'bpmn:Lane') continue;
    for (const member of lane.businessObject?.flowNodeRef || []) {
      if (!lanesFor.has(member.id)) lanesFor.set(member.id, []);
      lanesFor.get(member.id).push(lane);
    }
  }
  const rank = node => isFrameElement(node) ? 0 : (
    node.type === 'bpmn:Participant' || node.type === 'bpmn:Lane' ||
    node.businessObject?.$instanceOf?.('bpmn:SubProcess') ? 1 : 2
  );
  const ordered = [], seen = new Set(), visiting = new Set();
  function visit(node) {
    if (!node || !byId.has(node.id) || seen.has(node.id) || visiting.has(node.id)) return;
    visiting.add(node.id);
    visit(node.parent);
    visit(node.host);
    for (const lane of lanesFor.get(node.id) || []) visit(lane);
    visiting.delete(node.id);
    seen.add(node.id);
    ordered.push(node);
  }
  // Modern stable sort retains source order for unrelated peers. Dependencies
  // take precedence, including a frame whose enclosing pool must paint first.
  [...shapes].sort((a, b) => rank(a) - rank(b)).forEach(visit);
  return ordered;
}
