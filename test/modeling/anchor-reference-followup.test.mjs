/** Actual pinned event-chain evidence; these probes do not certify native input. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setupDOM } from "../helpers/dom.mjs";
import {
  observeReferenceConnection,
  finishReferenceConnection,
  assertReferenceConnectionRoute,
} from "../helpers/anchor-reference-followup.mjs";
import {
  assertReferenceConnectionUndo,
  assertReferenceMessageConversion,
  parseExport,
  canonicalExport,
} from "../helpers/anchor-followup-model.mjs";
const require = createRequire(import.meta.url),
  dependency = createRequire(require.resolve("bpmn-js/package.json"));
let dom, Modeler;
const xy = (p) => ({ x: p.x, y: p.y });
const labelBounds = (e) =>
  e?.label && Object.fromEntries(["x", "y", "width", "height"].map((k) => [k, e.label[k]]));
const near = (a, b, error, message) =>
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= error, message);
const page = { evaluate: async (fn, arg) => fn(arg) };
const files = {
  approval: "approval-rejection-rework",
  order: "order-payment-delivery",
  booking: "booking-timeout-compensation",
};
before(async () => {
  assert.equal(require("bpmn-js/package.json").version, "18.30.1");
  assert.equal(dependency("diagram-js/package.json").version, "15.27.1");
  dom = await setupDOM();
  globalThis.MouseEvent = dom.window.MouseEvent;
  ({ default: Modeler } = await dom.loadModule("/node_modules/bpmn-js/lib/Modeler.js"));
});
after(async () => {
  delete globalThis.MouseEvent;
  await dom.cleanup();
});
async function editor(sample) {
  const model = new Modeler({ container: dom.createContainer() });
  assert.deepEqual(
    (await model.importXML(await readFile(`test/fixtures/scenarios/${files[sample]}.bpmn`, "utf8")))
      .warnings,
    [],
  );
  window.referenceModeler = model;
  const canvas = model.get("canvas");
  Object.defineProperties(canvas._container, {
    clientWidth: { configurable: true, value: 1800 },
    clientHeight: { configurable: true, value: 1158 },
  });
  canvas._container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1800, height: 1158 });
  canvas._viewport.transform.baseVal.createSVGTransformFromMatrix = (matrix) =>
    canvas._svg.createSVGTransformFromMatrix(matrix);
  canvas.viewbox({ x: 0, y: 0, width: 1800, height: 1158 });
  return model;
}
const event = (type, p) =>
  new dom.window.MouseEvent(type, {
    clientX: p.x,
    clientY: p.y,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
    bubbles: true,
    cancelable: true,
  });
function semanticSnapshot(root) {
  const records = [],
    seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const props = Object.getOwnPropertyNames(value)
      .filter((key) => key !== "$model")
      .map((key) => [key, Object.getOwnPropertyDescriptor(value, key)]);
    records.push([value, props]);
    for (const [, descriptor] of props) if ("value" in descriptor) visit(descriptor.value);
  };
  visit(root);
  return records;
}
function installPassivityCheck(model, prefix) {
  let before,
    observed = false;
  model.get("eventBus").on(prefix + ".end", 1101, () => {
    before = semanticSnapshot(model.getDefinitions());
  });
  model.get("eventBus").on(prefix + ".end", 1099, () => {
    const after = semanticSnapshot(model.getDefinitions());
    observed = true;
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i++) {
      assert.equal(after[i][0], before[i][0]);
      assert.deepEqual(
        after[i][1].map((p) => p[0]),
        before[i][1].map((p) => p[0]),
      );
      for (let j = 0; j < before[i][1].length; j++) {
        const a = after[i][1][j][1],
          b = before[i][1][j][1];
        for (const key of ["value", "get", "set", "enumerable", "configurable", "writable"])
          assert.equal(a[key], b[key]);
      }
    }
  });
  return () => assert.equal(observed, true);
}
const save = async (m) => (await m.saveXML({ format: true })).xml;
const edgeInfo = (e) => ({
  id: e.id,
  type: e.type,
  source: e.source.id,
  target: e.target.id,
  points: e.waypoints.map(xy),
});
async function finish(model, before, eventName) {
  const events = await finishReferenceConnection(page),
    record = events.findLast((e) => e.type === eventName),
    edge = model
      .get("elementRegistry")
      .getAll()
      .filter((e) => e.waypoints)
      .find((e) => !before.edgeIds.includes(e.id));
  const actual = edge || model.get("elementRegistry").get(before.reconnectId);
  await mkdir("/tmp/bpmn-followup-reference-evidence", { recursive: true });
  const key = `${eventName}-${record?.source}-${record?.target}`;
  await writeFile(
    `/tmp/bpmn-followup-reference-evidence/${key}.json`,
    JSON.stringify({ record, actual: actual && edgeInfo(actual) }, null, 2),
  );
  assert.ok(actual);
  assertReferenceConnectionRoute({ near }, edgeInfo(actual), record);
  assert.equal(actual.type, record.expectedInput.type);
  for (const edit of [
    (e) => {
      e.type = "bpmn:Association";
    },
    (e) => {
      e.source = "WrongSource";
    },
    (e) => {
      e.target = "WrongTarget";
    },
    (e) => {
      e.points[0].x += 1;
    },
  ]) {
    const bad = structuredClone(edgeInfo(actual));
    edit(bad);
    assert.throws(() => assertReferenceConnectionRoute({ near }, bad, record));
  }
  const after = await save(model);
  model.get("commandStack").undo();
  const restored = await save(model);
  await writeFile(`/tmp/bpmn-followup-reference-evidence/${key}-before.bpmn`, before.xml);
  await writeFile(`/tmp/bpmn-followup-reference-evidence/${key}-after.bpmn`, after);
  await writeFile(`/tmp/bpmn-followup-reference-evidence/${key}-restored.bpmn`, restored);
  if (before.undoPolicy)
    await assertReferenceConnectionUndo(before.xml, restored, before.undoPolicy);
  else assert.equal(restored, before.xml);
  model.get("commandStack").redo();
  assert.equal(await save(model), after);
  return { events, record, actual, after, restored };
}
for (const [sample, from, to] of [
  ["approval", "ReviewRequest", "ApprovedEnd"],
  ["approval", "SubmitRequest", "ApprovalDecision"],
  ["order", "Payment", "FulfillmentFork"],
  ["order", "ShipOrder", "BuyerPool"],
  ["order", "BuyerPool", "ShipOrder"],
  ["approval", "ApprovalDecision", "ApprovalDecision"],
])
  test(`passive create ${from}→${to} matches actual pinned snapped routing and exact history`, async () => {
    const model = await editor(sample);
    try {
      const registry = model.get("elementRegistry"),
        source = registry.get(from),
        target = registry.get(to),
        dragging = model.get("dragging");
      assert.ok(source && target);
      const start = { x: source.x + source.width, y: source.y + source.height / 2 },
        drop = { x: target.x, y: target.y + target.height * 0.35 };
      const before = {
        xml: await save(model),
        edgeIds: registry
          .getAll()
          .filter((e) => e.waypoints)
          .map((e) => e.id),
        undoPolicy:
          from === to
            ? { operation: "gateway-loop", shapeId: from, labelBounds: labelBounds(source) }
            : null,
      };
      await observeReferenceConnection(page, "connect");
      const assertPassive = installPassivityCheck(model, "connect");
      model.get("connect").start(event("mousedown", start), source);
      dragging.move(event("mousemove", { x: start.x + 70, y: start.y + 60 }));
      dragging.hover({ element: target, gfx: registry.getGraphics(target) });
      dragging.move(event("mousemove", drop));
      assert.equal(
        await save(model),
        before.xml,
        "observation and preview leave full XML unchanged before the command",
      );
      dragging.end(event("mouseup", drop));
      assertPassive();
      const result = await finish(model, before, "connect.end");
      assert.notEqual(
        result.record.original.trusted,
        true,
        "structural input is explicitly not native evidence",
      );
      if (target.type.endsWith("Event") || target.type.endsWith("Gateway"))
        assert.deepEqual(
          { x: result.record.x, y: result.record.y },
          { x: target.x + target.width / 2, y: target.y + target.height / 2 },
        );
      if (from === "ShipOrder") assert.equal(result.actual.type, "bpmn:MessageFlow");
    } finally {
      if (window.anchorFollowupObservation) await finishReferenceConnection(page);
      model.destroy();
    }
  });
for (const [sample, id, endpoint, targetId] of [
  ["approval", "ApproveFlow", "source", "SubmitRequest"],
  ["approval", "ApproveFlow", "target", "ReworkRequest"],
  ["order", "OrderMessage", "target", "ReceiveDelivery"],
])
  test(`passive reconnect ${id}.${endpoint}→${targetId} predicts pre-drag route repair and replacement type`, async () => {
    const model = await editor(sample);
    try {
      const registry = model.get("elementRegistry"),
        edge = registry.get(id),
        target = registry.get(targetId),
        index = endpoint === "source" ? 0 : edge.waypoints.length - 1,
        start = xy(edge.waypoints[index]),
        drop = { x: target.x, y: target.y + target.height * 0.25 },
        dragging = model.get("dragging");
      const before = {
        xml: await save(model),
        edgeIds: registry
          .getAll()
          .filter((e) => e.waypoints)
          .map((e) => e.id),
        reconnectId: id,
        undoPolicy: {
          operation: id === "OrderMessage" ? "message-conversion" : "reconnect",
          connectionId: id,
          endpoint,
          labelBounds: labelBounds(edge),
        },
      };
      await observeReferenceConnection(page, "bendpoint.move");
      const assertPassive = installPassivityCheck(model, "bendpoint.move");
      model.get("bendpointMove").start(event("mousedown", start), edge, index, false);
      dragging.move(event("mousemove", { x: start.x + 70, y: start.y + 60 }));
      dragging.hover({ element: target, gfx: registry.getGraphics(target) });
      dragging.move(event("mousemove", drop));
      assert.equal(
        await save(model),
        before.xml,
        "pre-command route reconstruction changes no semantic/DI XML",
      );
      dragging.end(event("mouseup", drop));
      assertPassive();
      const result = await finish(model, before, "bendpoint.move.end");
      for (const edit of [
        (p) => {
          p.elementsById[id].sourceRef = p.elementsById[targetId];
        },
        (p) => {
          p.elementsById[id + "_di"].waypoint[0].x += 1;
        },
        (p) => {
          p.rootElement.$attrs["xmlns:v"] = "urn:negative-metadata";
          p.elementsById[id].$attrs["v:unexpected"] = "changed";
        },
        (p) => {
          p.rootElement.diagrams[0].plane.planeElement.reverse();
        },
      ]) {
        const changed = await parseExport(result.restored);
        edit(changed);
        await assert.rejects(
          assertReferenceConnectionUndo(
            before.xml,
            await canonicalExport(changed.rootElement),
            before.undoPolicy,
          ),
        );
      }
      if (id === "OrderMessage") {
        assert.notEqual(result.actual.id, id);
        assert.equal(result.actual.type, "bpmn:SequenceFlow");
        assert.equal(result.actual.businessObject.name, undefined);
        await assertReferenceMessageConversion(
          before.xml,
          result.after,
          id,
          result.actual.id,
          targetId,
        );
      }
    } finally {
      if (window.anchorFollowupObservation) await finishReferenceConnection(page);
      model.destroy();
    }
  });
