/** Batch B of ANCHOR-UX-FOLLOWUP.md. Prepared native cases, all unrun.
 * Model APIs are used only by the shared read-only evidence collectors. */
import assert from "node:assert/strict";
import { selectedBendpoint } from "../helpers/native-bendpoint-control.mjs";
import { projectRoundedTask } from "../helpers/anchor-ownership-browser.mjs";
import {
  observeReferenceConnection as observeReference,
  finishReferenceConnection as finishReferenceObservation,
  assertReferenceConnectionRoute as referenceRoute,
} from "../helpers/anchor-reference-followup.mjs";
import { assertReferenceConnectionUndo } from "../helpers/anchor-followup-model.mjs";
import { continuingPort, readFollowupPort, chooseFollowupEdge } from "../helpers/anchor-followup-controls.mjs";
import {
  assertOnlyAnchorGeometry,
  assertOnlyAnchorDeletion,
} from "../helpers/anchor-model-guard.mjs";

import { renderedDI, selectVisibleFollowupBody, chooseAdjacentReferenceDrop, clickReferenceSubprocessReplacement, prepareReferenceOutlineTarget } from '../helpers/anchor-followup-dom.mjs';
import { assertReferenceBodyMove } from '../helpers/anchor-followup-reference-move.mjs';

export const anchorShapeCases = [];
const EMPTY = "Empty diagram",
  APPROVAL = "Approval, rejection and rework";
const ORDER = "Order, payment and delivery",
  BOOKING = "Booking, timeout and compensation";
const register = (id, name, engine, sample, run) =>
  anchorShapeCases.push({ id, name, engine, sample, run });
const engines = ["local", "upstream"];
const bounds = (n) => ({ x: n.x, y: n.y, width: n.width, height: n.height });
const incident = (s, ids) =>
  Object.values(s.edges)
    .filter((e) => ids.includes(e.source) || ids.includes(e.target))
    .map((e) => e.id);
const drawing = (s, id) =>
  s.parsed.rootElement.diagrams
    .flatMap((d) => d.plane.planeElement || [])
    .find((di) => di.bpmnElement?.id === id);
function owner(s, id, expected) {
  assert.equal(s.parsed.elementsById[id].$parent.id, expected);
}

function circleContact(shape, actual, tolerance) {
  if (!shape.type.endsWith("Event")) return;
  const radius = shape.width / 2;
  assert.ok(
    Math.abs(Math.hypot(actual.x - shape.x - radius, actual.y - shape.y - radius) - radius) <=
      tolerance,
    "docking contacts the actual circle as well as the intended route",
  );
}

async function control(h, page, selector) {
  const element = await page.waitForSelector(selector, { visible: true });
  const box = await element.boundingBox();
  assert.ok(box);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  assert.equal(
    await element.evaluate((e, p) => e.contains(document.elementFromPoint(p.x, p.y)), point),
    true,
    `visible control receives the press: ${selector}`,
  );
  await h.settle(page);
  return point;
}
async function selectOutline(h, page, id, which = "top", fraction = 0.5) {
  const s = await h.state(page),
    point = h.screen(s, h.side(h.node(s, id), which, fraction));
  if (s.selection.length === 1 && s.selection[0] === id) return point;
  // Select the empty frame just inside its outline, beyond the painted source
  // tool. This is selection setup; the connection origin remains the separately
  // requested perimeter point, with its own marker/press/commit assertions.
  point.x += which === "left" ? 12 : which === "right" ? -12 : 0;
  point.y += which === "top" ? 12 : which === "bottom" ? -12 : 0;
  await page.mouse.move(point.x, point.y);
  await h.settle(page);
  assert.equal((await h.hit(page, point)).id, id, "visible frame body selects its actual owner");
  await page.mouse.click(point.x, point.y);
  await h.settle(page);
  assert.deepEqual((await h.raw(page)).selection, [id]);
  return point;
}
async function frameContext(h, page, id) {
  await selectOutline(h, page, id, "left", 0.2);
  return h.contextConnect(page, id);
}
async function capture(h, page, key) {
  const preview = await h.preview(page);
  assert.ok(preview, "activated native creation preview");
  await page.screenshot({ path: `${h.output}/${key}-preview.png`, fullPage: true });
  return preview;
}
async function painted(h, page, state, edge) {
  return renderedDI(page, edge);
}
async function bodyMove(h, page, id, dx, dy, key) {
  const before = await h.state(page),
    n = h.node(before, id),
    start = h.screen(before, { x: n.x + n.width / 2, y: n.y + n.height / 2 });
  await page.mouse.move(start.x, start.y);
  await h.settle(page);
  assert.equal((await h.hit(page, start)).id, id, "ordinary body receives the move press");
  await h.save(page, key + "-before", { operation: "body-move", id, start });
  await h.drag(page, start, { x: start.x + dx, y: start.y + dy });
  const after = await h.state(page);
  assert.notDeepEqual(bounds(h.node(after, id)), bounds(n), "body move actually changes bounds");
  if (before.engine === "upstream") await assertReferenceBodyMove(h, before, after, id);
  else await assertOnlyAnchorGeometry(before.xml, after.xml, {
    shapeIds: [id],
    edgeIds: incident(before, [id]),
    labelIds: drawing(before, id)?.label?.bounds ? [id] : [],
  });
  await h.history(page, before, after);
  await h.save(page, key + "-after", { operation: "body-move", id });
  return { before, after };
}
async function connect(h, page, key, source, target, from, to, options = {}) {
  const s = await h.state(page);
  await h.save(page, key + "-before", { source, target, from, to, options });
  const sourceNode = h.node(s, source);
  if (
    (options.selected || s.engine === "upstream") &&
    ["bpmn:Participant", "bpmn:SubProcess", "bpmn:Transaction"].includes(sourceNode.type)
  )
    await selectOutline(h, page, source, "left", 0.2);
  else if (options.selected || s.engine === "upstream") await selectVisibleFollowupBody(h, page, source);
  let result;
  if (s.engine === "local") {
    result = await h.create(page, source, target, from, to, { ...options, name: key });
    const release = result.after.input.findLast((event) => event.type === "mouseup");
    assert.equal(release?.trusted, true);
    assert.ok(release.graphPoint);
    h.near(
      result.edge.points.at(-1),
      h.projected(h.node(result.before, target), release.graphPoint),
      0.05 / result.after.viewport.zoom,
      "local target retains the exact delivered pointer",
    );
    h.near(
      result.live.screenStart,
      h.screen(result.after, result.edge.points[0]),
      0.05,
      "local source preview exactly matches commit",
    );
    h.near(
      result.live.screenEnd,
      h.screen(result.after, result.edge.points.at(-1)),
      0.05,
      "local target preview exactly matches commit",
    );
  } else {
    const start = { point: await h.contextConnect(page, source) },
      before = await h.state(page),
      targetNode = h.node(before, target);
    const chosen = h.side(targetNode, to, options.fraction ?? 0.5),
      requestedEnd = h.screen(before, chosen);
    const targetPreparation = options.integerReferenceDrop
      ? await chooseAdjacentReferenceDrop(h, page, target, requestedEnd) : null;
    const end = targetPreparation?.point || requestedEnd;
    if (targetPreparation) await h.save(page, key + "-reference-target-pixels", {
      targetPreparation,
      priorMeasuredRefusal: { revision: "0c33c80", hover: "ApprovalDecision_label", canExecute: null, createdEdges: 0 },
    });
    assert.ok(
      (await h.hit(page, end)).owners.includes(target),
      "reference drop includes the intended target in the actual hit stack",
    );
    let live, observation, previewContext;
    await observeReference(page, "connect");
    try {
      await h.drag(page, start.point, end, {
        capture: async () => {
          live = await capture(h, page, key);
          const input = (await h.raw(page)).input.findLast(event => event.type === "mousemove");
          previewContext = await page.evaluate(() => {
            const d = window.referenceModeler.get("dragging").context(), c = d?.data?.context;
            return { active: !!d?.active, prefix: d?.prefix, start: c?.start?.id,
              source: c?.source?.id, target: c?.target?.id, hover: c?.hover?.id,
              contextPadShown: window.referenceModeler.get("contextPad").isShown(),
              canExecute: c?.canExecute && typeof c.canExecute === "object" ? { type: c.canExecute.type } : c?.canExecute };
          });
          previewContext.input = input;
          previewContext.hit = input ? await h.hit(page, input) : null;
          if (targetPreparation || options.exactReferenceTarget) {
            assert.equal(input?.trusted, true);
            if (targetPreparation) assert.deepEqual({ x: input.x, y: input.y }, end);
            assert.equal(previewContext.active, true);
            assert.equal(previewContext.prefix, "connect");
            assert.equal(previewContext.start, source);
            assert.equal(previewContext.hover, target);
            assert.equal(previewContext.target, target);
            assert.deepEqual(previewContext.canExecute, { type: options.expectedType || "bpmn:SequenceFlow" });
            assert.equal(previewContext.hit.id, target);
            if (options.exactReferenceTarget) assert.equal(previewContext.contextPadShown, false,
              "active Connect removes the resting source context-pad obstruction");
          }
          await h.save(page, key + "-reference-preview-state", { live, previewContext });
        },
      });
    } finally {
      observation = await finishReferenceObservation(page);
    }
    const after = await h.state(page),
      added = Object.values(after.edges).filter((edge) => !before.edges[edge.id]);
    await h.save(page, key + "-reference-commit", { observation, added, live, previewContext });
    assert.equal(added.length, 1);
    const edge = added[0];
    assert.equal(edge.source, source);
    assert.equal(edge.target, target);
    assert.equal(edge.type, options.expectedType || "bpmn:SequenceFlow");
    const release = after.input.findLast((event) => event.type === "mouseup"),
      snapped = observation.findLast((event) => event.type === "connect.end");
    assert.equal(release?.trusted, true);
    assert.ok(release.graphPoint);
    if (options.exactReferenceTarget) {
      assert.deepEqual({ x: release.x, y: release.y },
        { x: previewContext.input.x, y: previewContext.input.y },
        "release uses the exact delivered point whose active hover belongs to the subprocess");
    }
    referenceRoute(h, edge, snapped);
    circleContact(targetNode, edge.points.at(-1), 0.75);
    const rendered = await painted(h, page, after, edge);
    h.near(live.screenStart, rendered.start, 1.5, "reference preview source matches commit");
    h.near(live.screenEnd, rendered.end, 1.5, "reference preview target matches commit");
    await h.creationOnly(before, after, edge);
    await h.history(page, before, after);
    result = { before, after, edge, start, live, chosen, release, observation, targetPreparation };
  }
  await h.save(page, key + "-after", {
    edge: result.edge,
    sourceControl: result.start,
    preview: result.live,
    release: result.release,
    observation: result.observation,
  });
  return result;
}
async function selectedEndpoint(h, page, id, index) {
  const s = await h.state(page);
  if (s.engine === "local") return selectedBendpoint(page, id, index);
  const point = h.screen(s, s.edges[id].points[index]);
  await page.mouse.move(point.x, point.y);
  await h.settle(page);
  assert.equal(
    await page.evaluate(
      ({ id, p }) => {
        const e = document.elementFromPoint(p.x, p.y);
        return (
          e?.closest(".djs-bendpoints")?.getAttribute("data-element-id") === id &&
          !!e?.closest(".djs-bendpoint")
        );
      },
      { id, p: point },
    ),
    true,
    "actual reference endpoint control owns the native point",
  );
  return point;
}
async function reconnectPreview(h, page, id, old, key) {
  const s = await h.raw(page);
  let preview;
  if (s.engine === "upstream") {
    const active = await page.evaluate(() => {
      const d = window.referenceModeler.get("dragging").context();
      return d && { active: !!d.active, prefix: d.prefix };
    });
    assert.equal(active?.active, true);
    assert.equal(active.prefix, "bendpoint.move");
    preview = await h.preview(page);
    assert.ok(preview, "reference has its separate visible drag preview");
  } else {
    const current = s.nodes.find((n) => n.id === id)?.points;
    assert.ok(
      Array.isArray(current) &&
        current.length >= 2 &&
        current.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      "local preview retains its actual finite connection route",
    );
    assert.notDeepEqual(current, old.points, "local reconnect is positively activated");
    preview = await h.renderEnds(page, id);
  }
  await page.screenshot({ path: `${h.output}/${key}-preview.png`, fullPage: true });
  return preview;
}
async function reconnectGesture(h, page, key, edge, from, end, cancel = false) {
  const reference = (await h.raw(page)).engine === "upstream";
  let live, observation;
  if (reference) await observeReference(page, "bendpoint.move");
  try {
    await h.drag(page, from, end, {
      cancel,
      capture: async () => {
        live = await reconnectPreview(h, page, edge.id, edge, key);
      },
    });
  } finally {
    if (reference) observation = await finishReferenceObservation(page);
  }
  return { live, observation, after: await h.state(page) };
}
async function reconnectDocking(h, page, result, edge, endpoint, recipient) {
  const { after, live, observation } = result,
    changed = after.edges[edge.id];
  const release = after.input.findLast((event) => event.type === "mouseup");
  assert.equal(release?.trusted, true);
  assert.ok(release.graphPoint);
  const point = endpoint === "source" ? changed.points[0] : changed.points.at(-1);
  if (after.engine === "local")
    h.near(
      point,
      h.projected(recipient, release.graphPoint),
      0.05 / after.viewport.zoom,
      "reconnect follows exact delivered native pointer",
    );
  else
    referenceRoute(
      h,
      changed,
      observation.findLast((event) => event.type === "bendpoint.move.end"),
    );
  circleContact(recipient, point, after.engine === "local" ? 1e-6 : 0.75);
  const visible = await painted(h, page, after, changed);
  h.near(
    live.screenStart || live.start,
    visible.start,
    after.engine === "local" ? 0.05 : 1.5,
    "reconnect preview source agrees with commit",
  );
  h.near(
    live.screenEnd || live.end,
    visible.end,
    after.engine === "local" ? 0.05 : 1.5,
    "reconnect preview target agrees with commit",
  );
  return { release, observation, visible };
}
async function reconnectHistory(h, page, before, after, connectionId, endpoint) {
  if (before.engine === "local") return h.history(page, before, after);
  // The Conditional fixture uses unnamed flows: no label materialization is
  // permitted. The measured upstream difference is the edited inverse-array
  // membership appended on Undo, with all other content checked in full.
  assert.equal(before.parsed.elementsById[connectionId].name, undefined);
  for (let cycle = 0; cycle < 3; cycle++) {
    await h.clickButton(page, "#undo-btn");
    await assertReferenceConnectionUndo(before.xml, (await h.state(page)).xml, {
      operation: "reconnect",
      connectionId,
      endpoint,
    });
    await h.clickButton(page, "#redo-btn");
    assert.equal(
      (await h.state(page)).canonical,
      after.canonical,
      "reference Redo restores the complete committed document",
    );
  }
}

async function resize(h, page, id, direction, dx, dy, key, allowedShapes = [id], policy = {}) {
  const initial = await h.state(page),
    n = h.node(initial, id);
  if (n.type === "bpmn:SubProcess" || n.type === "bpmn:Transaction")
    await selectOutline(h, page, id, "top", 0.4);
  else await h.selectNode(page, id);
  const before = await h.state(page),
    selector =
      before.engine === "local"
        ? `.bpmn-xyflow-resize-handle[data-resize-dir="${direction}"]`
        : `.djs-resizer-${direction}`;
  const from = await control(h, page, selector);
  await h.save(page, key + "-before", { operation: "resize", id, direction, from });
  let activated;
  await h.drag(
    page,
    from,
    { x: from.x + dx, y: from.y + dy },
    {
      capture: async () => {
        activated = await h.raw(page);
        if (before.engine === "local")
          assert.notDeepEqual(
            bounds(h.node(activated, id)),
            bounds(h.node(before, id)),
            "local resize preview changes the owner",
          );
        else
          assert.equal(
            await page.evaluate(() => !!window.referenceModeler.get("dragging").context()?.active),
            true,
            "reference resize is activated",
          );
        await page.screenshot({ path: `${h.output}/${key}-preview.png`, fullPage: true });
      },
    },
  );
  const after = await h.state(page);
  assert.notDeepEqual(
    bounds(h.node(after, id)),
    bounds(h.node(before, id)),
    "resize commits owner bounds",
  );
  const edgeIds = incident(before, allowedShapes),
    labelIds = allowedShapes.filter((value) => drawing(before, value)?.label?.bounds);
  await h.save(page, key + "-after", { operation: "resize", id, direction });
  if (policy.scope) await policy.scope(before, after);
  else
    await assertOnlyAnchorGeometry(before.xml, after.xml, {
      shapeIds: allowedShapes,
      edgeIds,
      labelIds,
    });
  if (policy.history) await policy.history(before, after);
  else await h.history(page, before, after);
  return { before, after, activated, edgeIds };
}

for (const engine of engines)
  for (const overlap of [false, true])
    register(
      "F23-B",
      overlap ? "boundary-host-flow-hit-and-reachable-origin" : "selected-boundary-lower-origin",
      engine,
      BOOKING,
      async (h, page, key) => {
        await h.zoom(page, 0.8);
        const initial = await h.state(page),
          b = h.node(initial, "FlightTimeout");
        let overlapHit;
        if (overlap) {
          const point = h.screen(initial, h.side(b, "right"));
          await page.mouse.move(point.x, point.y);
          await h.settle(page);
          const delivered = (await h.raw(page)).input.findLast(
            (event) => event.type === "mousemove",
          );
          assert.equal(delivered?.trusted, true);
          overlapHit = {
            status: "verified-hover-owner",
            requested: point,
            delivered,
            target: await h.hit(page, delivered),
            policy: "exact delivered hover receiver; no unperformed click-selection claim",
          };
          assert.equal(overlapHit.target.inside, true);
          assert.equal(overlapHit.target.id, "TimeoutFlow");
          assert.equal(overlapHit.target.tag, "circle");
          assert.equal(overlapHit.target.class, engine === "local" ? "bpmn-xyflow-hover-bendpoint-hit" : "djs-hit");
          assert.equal(delivered.target, engine === "local" ? "bpmn-xyflow-connection-visual" : "djs-hit djs-hit-stroke");
          for (const owner of ["FlightTimeout", "ReserveFlight", "BookingTransaction"]) assert.ok(overlapHit.target.owners.includes(owner));
          await h.noChange(page, initial, "inspecting overlap changes no model");
          assert.deepEqual((await h.raw(page)).selection, initial.selection);
          await h.save(page, key + "-overlap", { point, overlapHit });
        }
        const r = await connect(h, page, key, "FlightTimeout", "CancelBooking", "bottom", "left", {
          selected: true,
          sourceFraction: 0.25,
        });
        const bo = r.after.parsed.elementsById.FlightTimeout;
        assert.equal(bo.attachedToRef.id, "ReserveFlight");
        assert.equal(bo.eventDefinitions[0].timeDuration.body, "PT1H");
        owner(r.after, r.edge.id, "BookingTransaction");
        return {
          edge: r.edge,
          overlapHit,
          acceptanceScope: overlap ? "exact delivered overlap hover receiver plus intended boundary source connection" : "the intended boundary source control and resulting connection",
          referenceAffordance:
            engine === "upstream" ? "visible context Connect; no local perimeter port" : null,
        };
      },
    );

for (const edit of ["resize", "endpoint"])
  register(
    "F23-T",
    `moved-task-exact-midpoint-${edit}-priority`,
    "local",
    EMPTY,
    async (h, page, key) => {
      const { source, target } = await h.tasks(page),
        made = await connect(h, page, key + "-initial", source, target, "right", "left");
      await bodyMove(h, page, source, 0, 60, key + "-setup-move");
      await h.selectNode(page, source);
      const port = await continuingPort(h, page, source, "right"),
        before = await h.state(page),
        n = h.node(before, source);
      assert.equal(
        port.anchor.x,
        n.x + n.width,
        "the actual right side remains the selected origin",
      );
      h.near(
        port.anchor,
        h.projected(n, h.graph(before, port.initial.delivered)),
        1e-7,
        "along-side position follows the acquired native pointer",
      );
      assert.equal(
        port.initial.displaced,
        true,
        "exact midpoint uses an outward grab beside resize control",
      );
      assert.ok(
        Math.hypot(
          port.point.x - h.screen(before, port.initial.anchor).x,
          port.point.y - h.screen(before, port.initial.anchor).y,
        ) > 8,
      );
      await h.save(page, key + "-tether", { port });
      const additional = await connect(h, page, key + "-connect", source, target, "right", "top", {
        selected: true,
        fraction: 0.3,
      });
      assert.deepEqual(additional.edge.points[0], port.anchor);
      await h.clickButton(page, "#undo-btn");
      assert.equal((await h.state(page)).xml, before.xml);
      if (edit === "resize") {
        const result = await resize(h, page, source, "e", 20, 0, key);
        assert.deepEqual(
          result.after.edges[made.edge.id].points.at(-1),
          result.before.edges[made.edge.id].points.at(-1),
          "remote target remains exact",
        );
        return {
          port,
          edge: result.after.edges[made.edge.id],
          policy: "local Task resize extension",
        };
      }
      await chooseFollowupEdge(h, page, made.edge.id);
      const old = await h.state(page),
        edge = old.edges[made.edge.id],
        from = await selectedEndpoint(h, page, edge.id, 0);
      const end = h.screen(old, h.side(h.node(old, source), "top", 0.35));
      await h.drag(page, from, end, {
        cancel: true,
        capture: () => reconnectPreview(h, page, edge.id, edge, key),
      });
      await h.noChange(
        page,
        old,
        "original endpoint remains usable and Escape restores exact model",
      );
      return { port, edge };
    },
  );

for (const engine of engines)
  for (const variant of ["selected-task-to-end", "deselected-start-top"])
    register("F09", variant, engine, EMPTY, async (h, page, key) => {
      const sourceLabel = variant === "deselected-start-top" ? "Start" : "Task",
        targetLabel = variant === "selected-task-to-end" ? "End" : "Task";
      const { source, target } = await h.tasks(page, "right", 0.5, { sourceLabel, targetLabel });
      const event = sourceLabel === "Start" ? source : target;
      const moved = await bodyMove(h, page, event, 0, 35, key + "-event-move");
      await h.clickButton(page, "#undo-btn");
      assert.equal((await h.state(page)).xml, moved.before.xml);
      const r = await connect(
        h,
        page,
        key,
        source,
        target,
        sourceLabel === "Start" ? "top" : "right",
        "left",
        { selected: sourceLabel === "Task", fraction: 0.3 },
      );
      const shape = h.node(r.after, event),
        p = sourceLabel === "Start" ? r.edge.points[0] : r.edge.points.at(-1),
        c = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
      h.near(
        { x: Math.hypot(p.x - c.x, p.y - c.y), y: 0 },
        { x: shape.width / 2, y: 0 },
        engine === "local" ? 1e-6 : 0.75,
        "event contact lies on its circular outline",
      );
      if (engine === "local" && sourceLabel === "Start")
        assert.equal(
          r.start.evidence.dockingVisible,
          true,
          "small event uses an offset source grab",
        );
      await h.reopenThroughVisibleReference(page, r.after, key);
      return { edge: r.edge, sourceLabel, targetLabel, viewport: r.after.viewport };
    });

for (const engine of engines)
  for (const variant of ["selected-gateway-left", "task-to-gateway-bottom"])
    register("F10", variant, engine, APPROVAL, async (h, page, key) => {
      await h.zoom(page, 0.8);
      const r =
        variant === "selected-gateway-left"
          ? await connect(h, page, key, "ApprovalDecision", "ReworkRequest", "left", "bottom", {
              selected: true,
              fraction: 0.3,
            })
          : await connect(h, page, key, "SubmitRequest", "ApprovalDecision", "bottom", "bottom", {
              fraction: 0.65,
              integerReferenceDrop: engine === "upstream",
            });
      const gateway = h.node(r.after, "ApprovalDecision"),
        p = variant === "selected-gateway-left" ? r.edge.points[0] : r.edge.points.at(-1);
      const distance =
        Math.abs(p.x - gateway.x - gateway.width / 2) / (gateway.width / 2) +
        Math.abs(p.y - gateway.y - gateway.height / 2) / (gateway.height / 2);
      assert.ok(
        Math.abs(distance - 1) < (engine === "local" ? 1e-6 : 0.06),
        "docking lies on a diamond side",
      );
      assert.equal(r.after.parsed.elementsById.ApprovalDecision.default.id, "RejectFlow");
      assert.equal(
        r.after.parsed.elementsById.ApproveFlow.conditionExpression.body,
        r.before.parsed.elementsById.ApproveFlow.conditionExpression.body,
      );
      owner(r.after, r.edge.id, "ApprovalProcess");
      return { edge: r.edge };
    });

async function toggleSubprocess(h, page, id, expanded, key) {
  await selectOutline(h, page, id, "top", 0.35);
  const before = await h.state(page);
  if (before.engine === "local") {
    // The existing context menu is reached through an empty visible part of
    // this fixture's frame, away from the explicit perimeter Connect tool.
    const shape = h.node(before, id),
      contextPoint = h.screen(before, { x: shape.x + 20, y: shape.y + 35 });
    await page.mouse.move(contextPoint.x, contextPoint.y);
    await h.settle(page);
    assert.equal((await h.hit(page, contextPoint)).id, id);
    await page.mouse.click(contextPoint.x, contextPoint.y, { button: "right" });
    await h.settle(page);
    const entry = await page.evaluateHandle(() =>
      [...document.querySelectorAll(".bpmn-xyflow-context-menu > div")].find(
        (e) => e.textContent === "Toggle expanded / collapsed",
      ),
    );
    const el = entry.asElement();
    assert.ok(el, "visible subprocess expansion action");
    const box = await el.boundingBox();
    assert.ok(box);
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    assert.equal(
      await el.evaluate((e, p) => e.contains(document.elementFromPoint(p.x, p.y)), at),
      true,
    );
    await page.mouse.click(at.x, at.y);
  } else {
    await h.clickButton(page, '.djs-context-pad [data-action="replace"]');
    await clickReferenceSubprocessReplacement(h, page,
      `replace-with-${expanded ? "expanded" : "collapsed"}-subprocess`,
      evidence => h.save(page, `${key}-popup-${expanded ? "expand" : "collapse"}`, { evidence }));
  }
  await h.settle(page);
  const after = await h.state(page);
  assert.equal(drawing(after, id).isExpanded, expanded, "visible action changes subprocess state");
  // Expansion is setup here. Require all semantic content to survive it; the
  // subsequent connection guard includes every resulting active/hidden DI plane.
  const a = await h.oracle.fromXML(before.xml),
    b = await h.oracle.fromXML(after.xml);
  a.rootElement.diagrams = [];
  b.rootElement.diagrams = [];
  assert.equal(
    (await h.oracle.toXML(a.rootElement, { format: true })).xml,
    (await h.oracle.toXML(b.rootElement, { format: true })).xml,
    "collapse/expand preserves the entire semantic document",
  );
  return after;
}
for (const engine of engines)
  for (const variant of ["collapsed-left-source", "expanded-outline-target"])
    register("F11", variant, engine, ORDER, async (h, page, key) => {
      await h.zoom(page, 0.8);
      await toggleSubprocess(h, page, "Payment", false, key);
      let r;
      if (variant === "collapsed-left-source")
        r = await connect(h, page, key, "Payment", "ShipOrder", "left", "top", {
          selected: true,
          fraction: 0.3,
        });
      else {
        const expanded = await toggleSubprocess(h, page, "Payment", true, key),
          sub = h.node(expanded, "Payment"),
          child = h.node(expanded, "CapturePayment");
        assert.equal(child.hidden, false);
        const intended = h.screen(expanded, { x: sub.x, y: child.y + child.height / 2 });
        if (engine === "upstream") {
          // Expanding leaves Payment selected. Its west resize hit covers this
          // exact child-aligned midpoint until the real Connect source is selected.
          await prepareReferenceOutlineTarget(h, page,
            { source: "ValidateOrder", target: "Payment", point: intended },
            evidence => h.save(page, key + "-target-ownership", { evidence }));
        }
        if (engine === "local") assert.equal(
          (await h.hit(page, intended)).id,
          "Payment",
          "subprocess outline near its child is the actual target",
        );
        r = await connect(h, page, key, "ValidateOrder", "Payment", "top", "left", {
          fraction: (child.y + child.height / 2 - sub.y) / sub.height,
          exactReferenceTarget: engine === "upstream",
        });
      }
      owner(r.after, r.edge.id, "SellerProcess");
      assert.ok(r.after.parsed.elementsById.CapturePayment);
      return { edge: r.edge, planes: r.after.parsed.rootElement.diagrams.map((d) => d.id) };
    });

for (const engine of engines)
  for (const variant of ["selected-task-to-pool", "pool-nonmidpoint-source"])
    register("F12", variant, engine, ORDER, async (h, page, key) => {
      await h.zoom(page, 0.8);
      if (variant === "pool-nonmidpoint-source")
        await selectOutline(h, page, "BuyerPool", "left", 0.2);
      const r =
        variant === "selected-task-to-pool"
          ? await connect(h, page, key, "ShipOrder", "BuyerPool", "top", "bottom", {
              selected: true,
              fraction: 0.72,
              expectedType: "bpmn:MessageFlow",
            })
          : await connect(h, page, key, "BuyerPool", "ValidateOrder", "bottom", "top", {
              selected: true,
              sourceFraction: 0.36,
              fraction: 0.7,
              expectedType: "bpmn:MessageFlow",
            });
      owner(r.after, r.edge.id, "OrderCollaboration");
      assert.ok(
        r.after.parsed.elementsById.BuyerPool.processRef,
        "expanded participant identity survives",
      );
      return {
        edge: r.edge,
        referenceAffordance:
          engine === "upstream"
            ? "context Connect chooses its own source docking; local nonmidpoint is separately guarded"
            : null,
      };
    });

async function paintedTaskCorner(h, page, id) {
  const evidence = await page.evaluate((id) => {
    const root = [...document.querySelectorAll("#viewer [data-element-id]")].find(
      (e) =>
        e.getAttribute("data-element-id") === id &&
        (e.classList.contains("bpmn-xyflow-shape") || e.querySelector(":scope > .djs-visual")),
    );
    const visual = root?.classList.contains("bpmn-xyflow-shape")
      ? root
      : root?.querySelector(":scope > .djs-visual");
    const rects = [...(visual?.querySelectorAll(":scope > rect") || [])].filter(
      (e) => !e.hasAttribute("data-bpmn-hit") && Number(e.getAttribute("rx")) > 0,
    );
    const rect = rects.sort(
      (a, b) => b.getBBox().width * b.getBBox().height - a.getBBox().width * a.getBBox().height,
    )[0];
    if (!rect) return null;
    const box = rect.getBBox(),
      rx = Math.min(Number(rect.getAttribute("rx")), box.width / 2),
      ry = Math.min(Number(rect.getAttribute("ry") || rx), box.height / 2);
    const local = {
      x: box.x + box.width - rx + rx / Math.sqrt(2),
      y: box.y + ry - ry / Math.sqrt(2),
    };
    const p = new DOMPoint(local.x, local.y).matrixTransform(rect.getScreenCTM());
    return {
      local,
      rx,
      ry,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      point: { x: p.x, y: p.y },
      tag: rect.tagName,
    };
  }, id);
  assert.ok(
    evidence?.rx > 0 && evidence.ry > 0,
    "painted task supplies a real rounded SVG rectangle",
  );
  const s = await h.state(page);
  assert.equal(evidence.box.width, h.node(s, id).width);
  assert.equal(evidence.box.height, h.node(s, id).height);
  assert.equal(evidence.rx, evidence.ry, "actual Task paint uses circular rounded corners");
  return { ...evidence, anchor: h.graph(s, evidence.point) };
}
async function arbitraryPort(h, page, id, requested, radius) {
  const before = await h.state(page),
    shape = h.node(before, id);
  await page.mouse.move(requested.x, requested.y, { steps: 6 });
  await h.settle(page);
  await page.waitForSelector(`#viewer .bpmn-xyflow-connect-handle[data-connect-source="${id}"]`, {
    visible: true,
  });
  const initial = await readFollowupPort(page, id);
  assert.equal(initial.owner, id);
  assert.equal(initial.count, 1);
  assert.equal(initial.visible, true);
  assert.equal(initial.owned, true);
  assert.equal(initial.delivered?.trusted, true);
  h.near(
    initial.anchor,
    projectRoundedTask(shape, radius, h.graph(before, initial.delivered)),
    1e-7,
    "corner marker follows the actual delivered point on the independently measured painted outline",
  );
  h.near(
    h.screen(before, initial.anchor),
    requested,
    1.5,
    "the native pixel still reaches the requested painted corner",
  );
  const point = { x: Math.round(initial.grabScreen.x), y: Math.round(initial.grabScreen.y) };
  await page.mouse.move(point.x, point.y, { steps: 8 });
  await h.settle(page);
  const reached = await readFollowupPort(page, id, point);
  assert.equal(reached.owner, id);
  assert.equal(reached.count, 1);
  assert.equal(reached.visible, true);
  assert.equal(reached.owned, true);
  assert.equal(reached.delivered?.trusted, true);
  assert.deepEqual({ x: reached.delivered.x, y: reached.delivered.y }, point);
  if (initial.displaced) assert.deepEqual(reached.anchor, initial.anchor);
  else
    h.near(
      reached.anchor,
      projectRoundedTask(shape, radius, h.graph(before, point)),
      1e-7,
      "coincident corner marker follows the final integer native point",
    );
  await h.noChange(page, before, "corner control inspection");
  assert.deepEqual((await h.raw(page)).selection, before.selection);
  return { point, anchor: reached.anchor, requested, initial, reached };
}

for (const engine of engines)
  register(
    "F02-03",
    "rounded-painted-corner-to-nonmidpoint",
    engine,
    EMPTY,
    async (h, page, key) => {
      const { source, target } = await h.tasks(page, "right");
      await h.selectNode(page, source);
      const corner = await paintedTaskCorner(h, page, source);
      if (engine === "upstream") {
        const r = await connect(h, page, key, source, target, "right", "left", { fraction: 0.3 });
        await h.reopenThroughVisibleReference(page, r.after, key);
        return {
          corner,
          edge: r.edge,
          referenceAffordance:
            "visible context Connect supplies its reference source anchor; rounded source port is a local affordance",
          observation: r.observation,
        };
      }
      const start = await arbitraryPort(h, page, source, corner.point, corner.rx);
      const before = await h.state(page),
        targetNode = h.node(before, target),
        end = h.screen(before, h.side(targetNode, "left", 0.3));
      assert.ok((await h.hit(page, end)).owners.includes(target));
      await h.save(page, key + "-before", { corner, start, source, target });
      let live;
      await h.drag(page, start.point, end, {
        capture: async () => {
          live = await capture(h, page, key);
        },
      });
      const after = await h.state(page),
        added = Object.values(after.edges).filter((e) => !before.edges[e.id]);
      assert.equal(added.length, 1);
      const edge = added[0];
      assert.equal(edge.source, source);
      assert.equal(edge.target, target);
      assert.equal(edge.type, "bpmn:SequenceFlow");
      if (engine === "local")
        assert.deepEqual(
          edge.points[0],
          start.anchor,
          "committed rounded-corner source matches exact marker",
        );
      const release = after.input.findLast((e) => e.type === "mouseup");
      assert.equal(release.trusted, true);
      assert.ok(release.graphPoint);
      h.near(
        edge.points.at(-1),
        h.projected(targetNode, release.graphPoint),
        0.05 / after.viewport.zoom,
        "nonmidpoint target follows exact delivered pointer",
      );
      const paintedEnds = await painted(h, page, after, edge);
      h.near(live.screenStart, paintedEnds.start, 0.05, "corner preview/source paint agree");
      h.near(live.screenEnd, paintedEnds.end, 0.05, "corner preview/target paint agree");
      await h.creationOnly(before, after, edge);
      await h.history(page, before, after);
      await h.save(page, key + "-after", { edge, corner, start });
      await h.reopenThroughVisibleReference(page, after, key);
      return {
        corner,
        start,
        edge,
        referenceAffordance:
          engine === "upstream"
            ? "visible context Connect supplies its reference source anchor, not a perimeter handle"
            : null,
      };
    },
  );
register(
  "F02-03",
  "below-target-bottom-to-top-exterior-route",
  "local",
  EMPTY,
  async (h, page, key) => {
    const { source, target } = await h.tasks(page, "top"),
      r = await connect(h, page, key, source, target, "bottom", "top", {
        selected: true,
        fraction: 0.3,
      });
    const a = h.node(r.after, source),
      b = h.node(r.after, target);
    assert.ok(a.y > b.y, "source starts below target");
    assert.ok(
      r.edge.points.some((p) => p.y > a.y + a.height),
      "route exits below the source",
    );
    assert.ok(
      r.edge.points.some((p) => p.y < b.y),
      "route approaches above the target",
    );
    assert.ok(r.edge.points.length >= 4, "backwards-side route uses an exterior detour");
    await h.reopenThroughVisibleReference(page, r.after, key);
    return { edge: r.edge };
  },
);

for (const engine of engines)
  for (const kind of ["Task", "Start", "End", "Gateway", "Participant"])
    register(
      "F05",
      `${kind.toLowerCase()}-self-connection-policy`,
      engine,
      kind === "Participant" ? ORDER : EMPTY,
      async (h, page, key) => {
        let source, target;
        if (kind === "Participant") {
          await h.zoom(page, 0.8);
          source = "BuyerPool";
          target = "ValidateOrder";
          await selectOutline(h, page, source, "left", 0.2);
        } else ({ source, target } = await h.tasks(page, "right", 1, { sourceLabel: kind }));
        const before = await h.state(page),
          n = h.node(before, source),
          end = h.screen(before, h.side(n, kind === "Participant" ? "left" : "bottom", 0.35));
        let start, live, observation;
        await h.save(page, key + "-before", { kind, source, target });
        if (engine === "upstream") {
          await observeReference(page, "connect");
          try {
            await h.clickButton(page, '.djs-palette [data-action="global-connect-tool"]');
            const chosen = h.screen(
              before,
              h.side(n, kind === "Participant" ? "left" : "right", 0.35),
            );
            assert.equal((await h.hit(page, chosen)).id, source);
            await page.mouse.click(chosen.x, chosen.y);
            const departure =
              kind === "Participant"
                ? h.screen(before, { x: n.x + n.width / 4, y: n.y + n.height + 30 })
                : { x: chosen.x + 80, y: chosen.y + 70 };
            await page.mouse.move(departure.x, departure.y, { steps: 8 });
            await page.mouse.move(end.x, end.y, { steps: 8 });
            await h.settle(page);
            const active = await page.evaluate(() => {
              const d = window.referenceModeler.get("dragging").context();
              return d && { active: !!d.active, prefix: d.prefix };
            });
            assert.equal(
              active?.active,
              true,
              "native reference self-connection attempt is activated",
            );
            assert.equal(active.prefix, "connect");
            if (kind === "Participant") {
              const rejected = await page.evaluate(() => {
                const d = window.referenceModeler.get("dragging").context(), c = d?.data?.context;
                return { active: !!d?.active, prefix: d?.prefix, allowed: c?.canExecute, start: c?.start?.id, hover: c?.hover?.id };
              });
              assert.deepEqual(rejected, { active: true, prefix: "connect", allowed: false, start: source, hover: source });
              // Returning to the same invalid pool position can collapse the
              // preview to zero length. Active rejection is the exact oracle.
              live = await h.preview(page);
              await h.save(page, key + "-active-rejection", { rejected, live });
            } else live = await capture(h, page, key);
            await page.mouse.click(end.x, end.y);
            await h.settle(page);
            start = chosen;
          } finally {
            observation = await finishReferenceObservation(page);
          }
        } else {
          start =
            kind === "Participant"
              ? await frameContext(h, page, source)
              : await h.contextConnect(page, source);
          await h.drag(page, start, end, {
            via: [{ x: start.x + 90, y: start.y + 70 }],
            capture: async () => {
              live = await capture(h, page, key);
            },
          });
        }
        const after = await h.state(page),
          added = Object.values(after.edges).filter((e) => !before.edges[e.id]),
          allowed = ["Task", "Gateway"].includes(kind);
        await h.save(page, key + "-attempt", { kind, allowed, start, live, added, observation });
        if (!allowed) {
          assert.equal(added.length, 0);
          await h.noChange(page, before, `${kind} native self-connection is rejected`);
          await page.keyboard.press("Escape");
          await h.settle(page);
          await h.noChange(page, before, "clear rejected Connect tool");
          if (kind === "Participant") await selectOutline(h, page, source, "left", 0.2);
          const valid =
            kind === "End"
              ? await connect(h, page, key + "-next", target, source, "right", "left")
              : await connect(h, page, key + "-next", source, target, "right", "left", {
                  expectedType: kind === "Participant" ? "bpmn:MessageFlow" : "bpmn:SequenceFlow",
                  selected: kind === "Participant",
                });
          return { kind, allowed, live, next: valid.edge };
        }
        assert.equal(added.length, 1);
        const edge = added[0];
        assert.equal(edge.source, source);
        assert.equal(edge.target, source);
        assert.equal(edge.type, "bpmn:SequenceFlow");
        if (engine === "upstream")
          referenceRoute(
            h,
            edge,
            observation.findLast((event) => event.type === "connect.end"),
          );
        assert.ok(edge.points.length >= 4);
        assert.ok(
          edge.points.some(
            (p) => p.x < n.x || p.x > n.x + n.width || p.y < n.y || p.y > n.y + n.height,
          ),
          "loop is visibly outside the shape",
        );
        assert.ok(live.length > Math.min(n.width, n.height) / 2);
        const loopPaint = await painted(h, page, after, edge);
        h.near(
          live.screenStart,
          loopPaint.start,
          engine === "local" ? 0.05 : 1.5,
          "loop preview source agrees with commit",
        );
        h.near(
          live.screenEnd,
          loopPaint.end,
          engine === "local" ? 0.05 : 1.5,
          "loop preview target agrees with commit",
        );
        await h.creationOnly(before, after, edge);
        await h.history(page, before, after);
        if (kind === "Task") {
          const moved = await bodyMove(h, page, source, 35, 40, key + "-loop-move");
          const route = moved.after.edges[edge.id];
          assert.equal(route.source, source);
          assert.equal(route.target, source);
          await painted(h, page, moved.after, route);
          await chooseFollowupEdge(h, page, edge.id);
          const preDelete = await h.state(page);
          await h.save(page, key + "-delete-before", { edgeId: edge.id });
          await page.keyboard.press("Delete");
          await h.settle(page);
          const deleted = await h.state(page);
          assert.equal(deleted.edges[edge.id], undefined);
          await assertOnlyAnchorDeletion(preDelete.xml, deleted.xml, edge.id);
          await h.history(page, preDelete, deleted);
          await h.save(page, key + "-delete-after", { edgeId: edge.id });
          await h.clickButton(page, "#undo-btn");
        }
        return { kind, allowed, edge, live };
      },
    );

async function hoverEndpoint(h, page, id, index) {
  const before = await h.state(page),
    e = before.edges[id],
    point = e.points[index],
    adjacent = e.points[index === 0 ? 1 : index - 1],
    length = Math.hypot(adjacent.x - point.x, adjacent.y - point.y);
  assert.ok(length > 20, "route has an exposed approach outside endpoint hit circle");
  const approach = h.screen(before, {
      x: point.x + ((adjacent.x - point.x) * 15) / length,
      y: point.y + ((adjacent.y - point.y) * 15) / length,
    }),
    at = h.screen(before, point);
  assert.equal(
    (await h.hit(page, approach)).id,
    id,
    "actual route approach belongs to intended unselected edge",
  );
  await page.mouse.move(approach.x, approach.y);
  await h.settle(page);
  await page.mouse.move(at.x, at.y);
  await h.settle(page);
  const hit = await page.evaluate(
    ({ p }) => {
      const e = document.elementFromPoint(p.x, p.y),
        local = e?.closest(".bpmn-xyflow-hover-controls"),
        reference = e?.closest(".djs-bendpoints");
      return {
        owner: (local || reference)?.getAttribute("data-element-id"),
        index: local ? e?.closest("[data-bend-index]")?.getAttribute("data-bend-index") : null,
        endpoint: !!(local
          ? e?.closest(".bpmn-xyflow-hover-bendpoint")
          : e?.closest(".djs-bendpoint")),
      };
    },
    { id, index, p: at },
  );
  assert.equal(hit.owner, id);
  assert.equal(hit.endpoint, true);
  if (before.engine === "local") assert.equal(hit.index, String(index));
  assert.deepEqual(
    (await h.raw(page)).selection,
    before.selection,
    "hover preserves different selected edge",
  );
  return at;
}
for (const engine of engines)
  for (const variant of [
    "hovered-source-other-selection",
    "target-to-source-loop",
    "background-rejection",
    "activated-escape",
  ])
    register("F15-16", variant, engine, "Conditional flows", async (h, page, key) => {
      const initial = await h.state(page),
        a = initial.nodes.find((n) => n.name === "A"),
        b = initial.nodes.find((n) => n.name === "B"),
        t = initial.nodes.find((n) => n.name === "T1");
      assert.ok(a && b && t);
      const edge = Object.values(initial.edges).find((e) => e.source === a.id && e.target === t.id),
        other = Object.values(initial.edges).find((e) => e.source === t.id);
      assert.ok(edge && other);
      const source = variant === "hovered-source-other-selection",
        index = source ? 0 : edge.points.length - 1;
      if (source) await chooseFollowupEdge(h, page, other.id);
      else await chooseFollowupEdge(h, page, edge.id);
      const before = await h.state(page),
        from = source
          ? await hoverEndpoint(h, page, edge.id, index)
          : await selectedEndpoint(h, page, edge.id, index);
      await h.save(page, key + "-before", { variant, edge, from });
      const recipient = variant === "target-to-source-loop" ? a : b;
      const end =
        variant === "background-rejection"
          ? await h.blank(page)
          : h.screen(before, h.side(recipient, source ? "top" : "bottom", 0.35));
      if (variant !== "background-rejection")
        assert.ok(
          (await h.hit(page, end)).owners.includes(recipient.id),
          "chosen reconnect recipient exists in the actual hit stack",
        );
      const gesture = await reconnectGesture(
          h,
          page,
          key,
          edge,
          from,
          end,
          variant === "activated-escape",
        ),
        { after, live } = gesture;
      await h.save(page, key + "-after", { variant, live, observation: gesture.observation });
      if (["background-rejection", "activated-escape"].includes(variant)) {
        await h.noChange(page, before, variant);
        assert.deepEqual(after.edges, before.edges);
        await chooseFollowupEdge(h, page, edge.id);
        const validFrom = await selectedEndpoint(h, page, edge.id, 0),
          validBefore = await h.state(page),
          validTo = h.screen(validBefore, h.side(b, "top", 0.3));
        const next = await reconnectGesture(h, page, key + "-next", edge, validFrom, validTo),
          valid = next.after;
        assert.equal(valid.edges[edge.id].source, b.id);
        const docking = await reconnectDocking(h, page, next, edge, "source", b);
        if (engine === "local")
          assert.deepEqual(
            valid.edges[edge.id].points.at(-1),
            edge.points.at(-1),
            "next valid local action preserves opposite docking",
          );
        await h.reconnectOnly(validBefore, valid, edge.id, "source", b.id);
        await reconnectHistory(h, page, validBefore, valid, edge.id, "source");
        await h.save(page, key + "-next-after", { docking, edge: valid.edges[edge.id] });
        return { variant, live, next: valid.edges[edge.id], docking };
      }
      const changed = after.edges[edge.id],
        endpoint = source ? "source" : "target";
      assert.equal(changed[endpoint], recipient.id);
      assert.equal(changed[source ? "target" : "source"], edge[source ? "target" : "source"]);
      if (engine === "local")
        assert.deepEqual(
          changed.points[source ? changed.points.length - 1 : 0],
          edge.points[source ? edge.points.length - 1 : 0],
          "local explicit reconnect keeps the opposite endpoint fixed",
        );
      if (source)
        assert.deepEqual(
          after.selection,
          before.selection,
          "selected A remains selected while hovered B owns the edit",
        );
      if (!source) {
        assert.equal(changed.source, changed.target);
        assert.ok(changed.points.length >= 4);
      }
      const docking = await reconnectDocking(h, page, gesture, edge, endpoint, recipient);
      await h.reconnectOnly(before, after, edge.id, endpoint, recipient.id);
      await reconnectHistory(h, page, before, after, edge.id, endpoint);
      return { variant, before: edge, after: changed, live, docking };
    });

register("F29", "connected-task-northwest-resize", "local", EMPTY, async (h, page, key) => {
  const { source, target } = await h.tasks(page),
    made = await connect(h, page, key + "-initial", source, target, "right", "left", {
      fraction: 0.3,
    });
  const result = await resize(h, page, source, "nw", -25, -20, key);
  const changed = result.after.edges[made.edge.id];
  assert.deepEqual(
    changed.points.at(-1),
    result.before.edges[made.edge.id].points.at(-1),
    "remote docking remains exact",
  );
  await painted(h, page, result.after, changed);
  return {
    edge: changed,
    policy: "documented local Task-resize extension; pinned Task has no resize control",
  };
});
/** Full-service reference evidence: only this named boundary label is
 * materialized during NW expansion/Undo. All descendant geometry is retained. */
export async function assertBookingContainerResize(h, before, after, { undo = false } = {}) {
  const id = "BookingTransaction",
    attacherId = "BookingCancelled";
  const descendant = (nodeId) => {
    let bo = before.parsed.elementsById[nodeId];
    while (bo) {
      if (bo.id === id) return true;
      bo = bo.$parent;
    }
    return false;
  };
  for (const original of before.nodes.filter(
    (node) =>
      !node.points &&
      node.id !== id &&
      (descendant(node.label ? node.id.replace(/_label$/, "") : node.id) ||
        node.id === attacherId ||
        node.id === attacherId + "_label"),
  )) {
    assert.deepEqual(
      bounds(h.node(after, original.id)),
      bounds(original),
      `NW container expansion preserves absolute child/attacher bounds: ${original.id}`,
    );
  }
  const edgeIds = incident(before, [id, attacherId]);
  assert.deepEqual(edgeIds.slice().sort(), ["BookingFlow1", "BookingFlow2", "CancellationFlow1"]);
  let expectedXML = before.xml;
  if (before.engine === "upstream") {
    const expected = await h.oracle.fromXML(before.xml);
    assert.deepEqual(expected.warnings, []);
    const di = expected.rootElement.diagrams
      .flatMap((d) => d.plane.planeElement || [])
      .find((entry) => entry.bpmnElement?.id === attacherId);
    assert.ok(
      di && !di.label,
      "this measured reference fixture starts without saved boundary label DI",
    );
    const labelBounds = bounds(h.node(before, attacherId + "_label"));
    assert.ok(Object.values(labelBounds).every(Number.isFinite));
    di.label = h.oracle.create("bpmndi:BPMNLabel", {
      bounds: h.oracle.create("dc:Bounds", labelBounds),
    });
    expectedXML = (await h.oracle.toXML(expected.rootElement, { format: true })).xml;
  }
  await assertOnlyAnchorGeometry(expectedXML, after.xml, undo ? {} : { shapeIds: [id], edgeIds });
}

for (const engine of engines)
  register(
    "F29",
    "expanded-transaction-resize-attached-boundary",
    engine,
    BOOKING,
    async (h, page, key) => {
      await h.zoom(page, 0.8);
      const before = await h.state(page),
        id = "BookingTransaction",
        boundary = before.parsed.elementsById.BookingCancelled;
      assert.equal(boundary.attachedToRef.id, id);
      const result = await resize(h, page, id, "nw", -30, -30, key, [id, "BookingCancelled"], {
        scope: (original, resized) => assertBookingContainerResize(h, original, resized),
        history: async (original, resized) => {
          if (engine === "local") return h.history(page, original, resized);
          for (let cycle = 0; cycle < 3; cycle++) {
            await h.clickButton(page, "#undo-btn");
            await assertBookingContainerResize(h, original, await h.state(page), { undo: true });
            await h.clickButton(page, "#redo-btn");
            assert.equal(
              (await h.state(page)).canonical,
              resized.canonical,
              "reference Redo restores the whole resized document exactly",
            );
          }
        },
      });
      assert.equal(result.after.parsed.elementsById.BookingCancelled.attachedToRef.id, id);
      const sub = h.node(result.after, id),
        event = h.node(result.after, "BookingCancelled"),
        center = { x: event.x + event.width / 2, y: event.y + event.height / 2 };
      assert.ok(
        Math.min(
          Math.abs(center.x - sub.x),
          Math.abs(center.x - sub.x - sub.width),
          Math.abs(center.y - sub.y),
          Math.abs(center.y - sub.y - sub.height),
        ) < 1,
        "boundary center remains on resized host outline",
      );
      for (const edgeId of result.edgeIds)
        await painted(h, page, result.after, result.after.edges[edgeId]);
      return { host: bounds(sub), boundary: bounds(event), routes: result.edgeIds };
    },
  );
