/** Independent full-document expectations for native follow-up operations. */
import assert from "node:assert/strict";
import { BpmnModdle } from "bpmn-moddle";
const moddle = new BpmnModdle();
export async function parseExport(xml) {
  const result = await moddle.fromXML(xml);
  assert.deepEqual(result.warnings, []);
  return result;
}
export const canonicalExport = async (root) => (await moddle.toXML(root, { format: true })).xml;
export function drawing(parsed, id) {
  const found = parsed.rootElement.diagrams
    .flatMap((d) => d.plane.planeElement || [])
    .filter((di) => di.bpmnElement?.id === id);
  assert.equal(found.length, 1, `one DI for ${id}`);
  return found[0];
}
function route(expected, actual) {
  assert.ok(actual.waypoint?.length >= 2);
  for (const point of expected.waypoint || [])
    assert.deepEqual(
      Object.keys(point)
        .filter((key) => key !== "$type")
        .sort(),
      ["x", "y"],
      "this authored route guard refuses to discard rich waypoint metadata",
    );
  expected.waypoint = actual.waypoint.map((p) => {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    return moddle.create("dc:Point", { x: p.x, y: p.y });
  });
}
async function equality(expected, actual) {
  assert.equal(
    await canonicalExport(actual.rootElement),
    await canonicalExport(expected.rootElement),
    "all unrelated semantics, refs, metadata and DI stay exact",
  );
}
export async function assertMessageConversion(beforeXML, afterXML, id, targetId) {
  const before = await parseExport(beforeXML),
    after = await parseExport(afterXML),
    old = before.elementsById[id],
    target = before.elementsById[targetId];
  assert.equal(old.$type, "bpmn:MessageFlow");
  assert.equal(target.$parent, old.sourceRef.$parent);
  const replacement = moddle.create("bpmn:SequenceFlow", {
    id,
    name: old.name,
    sourceRef: old.sourceRef,
    targetRef: target,
  });
  for (const key of ["documentation", "extensionElements"])
    if (old[key] !== undefined) replacement[key] = old[key];
  Object.assign(replacement.$attrs, old.$attrs);
  old.$parent.messageFlows = old.$parent.messageFlows.filter((flow) => flow !== old);
  const owner = target.$parent;
  replacement.$parent = owner;
  owner.flowElements.push(replacement);
  replacement.sourceRef.outgoing = [...(replacement.sourceRef.outgoing || []), replacement];
  target.incoming = [...(target.incoming || []), replacement];
  const di = drawing(before, id);
  di.bpmnElement = replacement;
  route(di, drawing(after, id));
  await equality(before, after);
}
export async function assertDataChange(beforeXML, afterXML, id, { mode, dataId, ownerId }) {
  const before = await parseExport(beforeXML),
    after = await parseExport(afterXML),
    actual = after.elementsById[id];
  assert.equal(actual?.$type, "bpmn:DataInputAssociation");
  const owner = before.elementsById[ownerId],
    data = before.elementsById[dataId];
  assert.ok(owner && data);
  assert.equal(actual.$parent.id, ownerId);
  assert.deepEqual(
    actual.sourceRef.map((ref) => ref.id),
    [dataId],
  );
  let expected = before.elementsById[id];
  if (mode === "create") {
    assert.equal(expected, undefined);
    assert.equal(before.elementsById[actual.targetRef.id], undefined);
    const property = moddle.create("bpmn:Property", {
      id: actual.targetRef.id,
      name: "__targetRef_placeholder",
    });
    property.$parent = owner;
    owner.properties = [...(owner.properties || []), property];
    expected = moddle.create("bpmn:DataInputAssociation", {
      id,
      sourceRef: [data],
      targetRef: property,
    });
    expected.$parent = owner;
    owner.dataInputAssociations = [...(owner.dataInputAssociations || []), expected];
    const actualDI = drawing(after, id);
    assert.equal(before.elementsById[actualDI.id], undefined);
    const di = moddle.create("bpmndi:BPMNEdge", { id: actualDI.id, bpmnElement: expected });
    route(di, actualDI);
    const plane = before.rootElement.diagrams.find(
      (d) => d.plane.id === actualDI.$parent.id,
    )?.plane;
    assert.ok(plane);
    di.$parent = plane;
    plane.planeElement = [...(plane.planeElement || []), di];
  } else {
    assert.equal(expected?.$type, "bpmn:DataInputAssociation");
    if (mode === "owner") {
      const oldOwner = expected.$parent,
        oldItem = expected.targetRef;
      assert.equal(oldItem.$type, "bpmn:Property");
      assert.equal(oldItem.name, "__targetRef_placeholder");
      assert.deepEqual(
        Object.keys(oldItem)
          .filter((key) => key !== "$type")
          .sort(),
        ["id", "name"],
        "only an explicitly fresh plain placeholder may be removed",
      );
      oldOwner.dataInputAssociations = oldOwner.dataInputAssociations.filter((a) => a !== expected);
      oldOwner.properties = oldOwner.properties.filter((p) => p !== oldItem);
      assert.equal(before.elementsById[actual.targetRef.id], undefined);
      const property = moddle.create("bpmn:Property", {
        id: actual.targetRef.id,
        name: "__targetRef_placeholder",
      });
      property.$parent = owner;
      owner.properties = [...(owner.properties || []), property];
      expected.targetRef = property;
      expected.$parent = owner;
      owner.dataInputAssociations = [...(owner.dataInputAssociations || []), expected];
    } else assert.equal(mode, "source");
    expected.sourceRef = [data];
    route(drawing(before, id), drawing(after, id));
  }
  await equality(before, after);
}
export async function assertDeletedClosure(beforeXML, afterXML, ids) {
  const before = await parseExport(beforeXML),
    after = await parseExport(afterXML),
    removed = new Set(ids.map((id) => before.elementsById[id]));
  assert.ok([...removed].every(Boolean));
  for (const id of ids)
    assert.equal(after.elementsById[id], undefined, `deleted ${id} has no remaining object`);
  const owners = new Set([...removed].map((bo) => bo.$parent));
  for (const owner of owners)
    for (const key of ["flowElements", "artifacts", "messageFlows"])
      if (Array.isArray(owner[key])) owner[key] = owner[key].filter((bo) => !removed.has(bo));
  for (const bo of Object.values(before.elementsById)) {
    for (const key of ["incoming", "outgoing", "flowNodeRef"])
      if (Array.isArray(bo[key])) bo[key] = bo[key].filter((ref) => !removed.has(ref));
    if (removed.has(bo.default)) delete bo.default;
  }
  for (const diagram of before.rootElement.diagrams)
    diagram.plane.planeElement = diagram.plane.planeElement.filter(
      (di) => !removed.has(di.bpmnElement),
    );
  await equality(before, after);
}

/** Measured pinned Undo effects for this one semantic operation, never a global sort. */
export async function assertReferenceConnectionUndo(
  beforeXML,
  restoredXML,
  { operation, connectionId, endpoint, labelBounds, shapeId } = {},
) {
  const before = await parseExport(beforeXML),
    restored = await parseExport(restoredXML);
  let labelOwner;
  if (operation === "gateway-loop") {
    const shape = before.elementsById[shapeId];
    assert.ok(shape?.$instanceOf("bpmn:Gateway"));
    assert.ok(shape.name);
    labelOwner = shapeId;
  } else {
    assert.ok(["reconnect", "message-conversion"].includes(operation));
    const edge = before.elementsById[connectionId];
    if (operation === "message-conversion") {
      assert.equal(edge?.$type, "bpmn:MessageFlow");
      const owner = edge.$parent;
      assert.equal(owner.$type, "bpmn:Collaboration");
      assert.equal(owner.messageFlows.filter((e) => e === edge).length, 1);
      owner.messageFlows = [...owner.messageFlows.filter((e) => e !== edge), edge];
    } else {
      assert.equal(edge?.$type, "bpmn:SequenceFlow");
      assert.ok(["source", "target"].includes(endpoint));
      const owner = edge[`${endpoint}Ref`],
        key = endpoint === "source" ? "outgoing" : "incoming";
      assert.equal(owner[key].filter((e) => e === edge).length, 1);
      owner[key] = [...owner[key].filter((e) => e !== edge), edge];
    }
    labelOwner = connectionId;
  }
  const di = drawing(before, labelOwner);
  if (!di.label && labelBounds) {
    assert.deepEqual(Object.keys(labelBounds).sort(), ["height", "width", "x", "y"]);
    assert.ok(Object.values(labelBounds).every(Number.isFinite));
    assert.ok(labelBounds.width > 0 && labelBounds.height > 0);
    di.label = moddle.create("bpmndi:BPMNLabel", {
      bounds: moddle.create("dc:Bounds", labelBounds),
    });
  }
  await equality(before, restored);
}

/** Pinned replacement creates a fresh unnamed SequenceFlow; local conversion does not. */
export async function assertReferenceMessageConversion(
  beforeXML,
  afterXML,
  oldId,
  newId,
  targetId,
) {
  const before = await parseExport(beforeXML),
    after = await parseExport(afterXML),
    old = before.elementsById[oldId],
    target = before.elementsById[targetId];
  assert.equal(old?.$type, "bpmn:MessageFlow");
  assert.equal(after.elementsById[oldId], undefined);
  assert.equal(before.elementsById[newId], undefined);
  assert.equal(target.$parent, old.sourceRef.$parent);
  const replacement = moddle.create("bpmn:SequenceFlow", {
      id: newId,
      sourceRef: old.sourceRef,
      targetRef: target,
    }),
    owner = target.$parent;
  old.$parent.messageFlows = old.$parent.messageFlows.filter((e) => e !== old);
  replacement.$parent = owner;
  owner.flowElements.push(replacement);
  replacement.sourceRef.outgoing = [...(replacement.sourceRef.outgoing || []), replacement];
  target.incoming = [...(target.incoming || []), replacement];
  const oldDI = drawing(before, oldId),
    actualDI = drawing(after, newId),
    plane = oldDI.$parent;
  assert.equal(actualDI.$parent.id, plane.id);
  assert.equal(before.elementsById[actualDI.id], undefined);
  const di = moddle.create("bpmndi:BPMNEdge", { id: actualDI.id, bpmnElement: replacement });
  route(di, actualDI);
  // The reference exporter places the new flow with its owning process children.
  // This guard is intentionally scoped to the authored order conversion.
  assert.deepEqual(
    [oldId, old.sourceRef.id, targetId, owner.id],
    ["OrderMessage", "SubmitOrder", "ReceiveDelivery", "BuyerProcess"],
  );
  const remaining = plane.planeElement.filter((e) => e !== oldDI),
    lastOwned = remaining.findLastIndex((e) => e.bpmnElement?.$parent === owner);
  assert.ok(lastOwned >= 0);
  assert.equal(remaining[lastOwned].bpmnElement.id, "BuyerFlow3");
  di.$parent = plane;
  remaining.splice(lastOwned + 1, 0, di);
  plane.planeElement = remaining;
  await equality(before, after);
}

/** Bind visible creation to the requested semantic endpoints, including data ownership. */
export function assertCreatedConnection(
  after,
  edge,
  source,
  target,
  expectedType = "bpmn:SequenceFlow",
) {
  assert.equal(edge.type, expectedType);
  assert.deepEqual(
    edge.sourceIds,
    [source],
    "the complete source-reference list matches the requested source",
  );
  if (expectedType === "bpmn:SequenceFlow") {
    assert.equal(edge.source, source);
    assert.equal(edge.target, target);
  } else {
    assert.equal(expectedType, "bpmn:DataInputAssociation");
    const association = after.parsed.elementsById[edge.id];
    assert.equal(edge.source, null, "data-association source remains an array");
    assert.equal(edge.owner, target);
    assert.equal(edge.associationCollection, "dataInputAssociations");
    assert.equal(association.$parent.id, target);
    assert.ok(association.$parent.$instanceOf("bpmn:Activity"));
    assert.equal(association.targetRef.$type, "bpmn:Property");
    assert.equal(association.targetRef.$parent.id, target);
    assert.equal(edge.target, association.targetRef.id);
  }
}
