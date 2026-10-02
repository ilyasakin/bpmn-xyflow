/** Read-only control attribution plus real native gestures shared by new cases. */
import assert from "node:assert/strict";
import {
  observeReferenceConnection,
  finishReferenceConnection,
  assertReferenceConnectionRoute,
} from "./anchor-reference-followup.mjs";
import { assertCreatedConnection } from "./anchor-followup-model.mjs";
import { selectedBendpoint } from "./native-bendpoint-control.mjs";

const evidenceContexts = new WeakMap();
export function beginFollowupEvidence(page, key) {
  evidenceContexts.set(page, { key, step: 0 });
}
export async function saveFollowupEvidence(h, page, phase, details) {
  const context = evidenceContexts.get(page);
  if (!context) return;
  await h.save(page, `${context.key}-step-${++context.step}-${phase}`, details);
}

export async function revealNative(h, page, points) {
  const before = await h.state(page);
  for (let step = 0; step < 24; step++) {
    const s = await h.raw(page),
      visible = points.map((p) => h.screen(s, p));
    const limits = {
      left: Math.max(0, s.container.x) + 40,
      right: Math.min(1800, s.container.x + s.container.width) - 40,
      top: Math.max(0, s.container.y) + 40,
      bottom: Math.min(1200, s.container.y + s.container.height) - 40,
    };
    const minX = Math.min(...visible.map((p) => p.x)),
      maxX = Math.max(...visible.map((p) => p.x)),
      minY = Math.min(...visible.map((p) => p.y)),
      maxY = Math.max(...visible.map((p) => p.y));
    assert.ok(
      maxX - minX < limits.right - limits.left && maxY - minY < limits.bottom - limits.top,
      "chosen points fit at this explicitly tested zoom",
    );
    const dx =
      minX < limits.left ? limits.left - minX : maxX > limits.right ? limits.right - maxX : 0;
    const dy =
      minY < limits.top ? limits.top - minY : maxY > limits.bottom ? limits.bottom - maxY : 0;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      await h.noChange(page, before, "native reveal changes camera only");
      return;
    }
    const start = await h.blank(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: "middle" });
    try {
      await page.mouse.move(
        start.x + Math.max(-80, Math.min(80, dx)),
        start.y + Math.max(-80, Math.min(80, dy)),
        { steps: 6 },
      );
    } finally {
      await page.mouse.up({ button: "middle" });
    }
    await h.settle(page);
  }
  throw new Error("Native pan did not reveal the requested controls");
}

export async function endpoint(h, page, id, side) {
  const state = await h.state(page),
    points = state.edges[id]?.points;
  assert.ok(points);
  await h.chooseEdge(page, id);
  const index = side === "source" ? 0 : points.length - 1;
  if (state.engine === "local") return selectedBendpoint(page, id, index);
  const point = h.screen(state, points[index]);
  await page.mouse.move(point.x, point.y, { steps: 6 });
  await h.settle(page);
  const evidence = await page.evaluate(
    ({ id, index, point }) => {
      const root = document.querySelector(`.djs-bendpoints[data-element-id="${id}"]`),
        controls = [...(root?.querySelectorAll(".djs-bendpoint:not(.floating)") || [])];
      const control = controls[index],
        hit = document.elementFromPoint(point.x, point.y);
      return {
        count: controls.length,
        owned: !!control && (control === hit || control.contains(hit)),
        visible: !!control && getComputedStyle(control).visibility === "visible",
      };
    },
    { id, index, point },
  );
  assert.equal(evidence.count, points.length);
  assert.equal(evidence.visible, true);
  assert.equal(evidence.owned, true, "the actual reference endpoint receives native input");
  return point;
}
export async function redock(
  h,
  page,
  id,
  side,
  targetId,
  targetSide,
  fraction = 0.35,
  { cancel = false } = {},
) {
  const initial = await h.state(page);
  await revealNative(h, page, [
    ...initial.edges[id].points,
    h.side(h.node(initial, targetId), targetSide, fraction),
  ]);
  const from = await endpoint(h, page, id, side),
    before = await h.state(page),
    target = h.node(before, targetId),
    to = h.screen(before, h.side(target, targetSide, fraction));
  assert.ok(
    (await h.hit(page, to)).owners.includes(targetId),
    "the intended target remains in the native hit stack",
  );
  const reference = before.engine === "upstream";
  if (reference) await observeReferenceConnection(page, "bendpoint.move");
  let preview, activation, observation;
  await saveFollowupEvidence(h, page, "reconnect-before", { id, side, targetId, from, to });
  try {
    await h.drag(page, from, to, {
      cancel,
      capture: async () => {
        if (before.engine === "upstream") {
          activation = await page.evaluate(() => {
            const context = window.referenceModeler.get("dragging").context();
            return { active: !!context?.active, prefix: context?.prefix };
          });
          assert.deepEqual(activation, { active: true, prefix: "bendpoint.move" });
          const detached = await h.preview(page);
          assert.ok(detached?.length > 0, "real reference detached preview is visible");
          preview = { start: detached.screenStart, end: detached.screenEnd };
        } else {
          const live = await h.state(page);
          assert.notDeepEqual(
            live.edges[id].points,
            before.edges[id].points,
            "local reconnect preview actually updates the shown route",
          );
          preview = await h.renderEnds(page, id);
          activation = { active: true, changedRoute: true };
        }
        await saveFollowupEvidence(h, page, "reconnect-preview", {
          id,
          side,
          targetId,
          preview,
          activation,
        });
      },
    });
  } finally {
    if (reference) observation = await finishReferenceConnection(page);
  }
  const after = await h.state(page),
    additions = Object.values(after.edges).filter((e) => !before.edges[e.id]),
    edge = after.edges[id] || (reference && additions.length === 1 ? additions[0] : null),
    release = after.input.findLast((e) => e.type === "mouseup");
  await saveFollowupEvidence(h, page, "reconnect-after", {
    id,
    side,
    targetId,
    edge,
    release,
    observation,
  });
  assert.equal(release?.trusted, true);
  if (cancel) {
    await h.noChange(page, before, "cancelled reconnect");
    return { before, after, preview, release, activation, observation };
  }
  assert.ok(edge, "reconnect retains its identity or makes one measured reference replacement");
  if (reference)
    assertReferenceConnectionRoute(
      h,
      edge,
      observation.findLast((e) => e.type === "bendpoint.move.end"),
    );
  const end = side === "source" ? edge.points[0] : edge.points.at(-1),
    expected = reference
      ? observation.findLast((e) => e.type === "bendpoint.move.end").expectedRoute[
          side === "source" ? 0 : edge.points.length - 1
        ]
      : h.projected(target, release.graphPoint),
    rendered = await h.renderEnds(page, edge.id);
  assert.ok(release.graphPoint);
  // Reference native snapping is measured separately; the local precise contract
  // remains exact against the delivered point, not a guessed command coordinate.
  if (after.engine === "local")
    h.near(
      end,
      expected,
      0.05 / after.viewport.zoom,
      "reconnected endpoint is at the chosen delivered perimeter",
    );
  h.near(
    preview.start,
    rendered.start,
    after.engine === "local" ? 0.05 : 1.5,
    "source preview reaches final paint",
  );
  h.near(
    preview.end,
    rendered.end,
    after.engine === "local" ? 0.05 : 1.5,
    "target preview reaches final paint",
  );
  if (!reference)
    assert.deepEqual(
      side === "source" ? edge.points.at(-1) : edge.points[0],
      side === "source" ? before.edges[id].points.at(-1) : before.edges[id].points[0],
    );
  return { before, after, edge, preview, release, expected, rendered, activation, observation };
}
export async function visibleControl(
  page,
  selector,
  { owner, index, indexAttribute = "data-bend-index" } = {},
) {
  const handle = await page.waitForSelector(selector, { visible: true }),
    box = await handle.boundingBox();
  assert.ok(box?.width > 0 && box?.height > 0);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const evidence = await handle.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return {
      ownsHit: element === hit || element.contains(hit),
      owner: element.closest("[data-element-id]")?.getAttribute("data-element-id"),
      index: element.getAttribute("data-bend-index"),
      segment: element.getAttribute("data-segment-index"),
    };
  }, point);
  assert.equal(evidence.ownsHit, true, "visible control receives the native press");
  if (owner !== undefined) assert.equal(evidence.owner, owner);
  if (index !== undefined)
    assert.equal(
      indexAttribute === "data-segment-index" ? evidence.segment : evidence.index,
      String(index),
    );
  return point;
}
export async function nativeText(page, selector, text) {
  await page.click(selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.sendCharacter(text);
  assert.equal(await page.$eval(selector, (e) => e.value ?? e.textContent), text);
}

/** Scoped read-only control collection also works with duplicate IDs in two editors. */
export async function readFollowupPort(page, id, point = null) {
  return page.evaluate(
    ({ id, point }) => {
      const root = document.querySelector("#viewer"),
        handles = [...root.querySelectorAll(".bpmn-xyflow-connect-handle")].filter(
          (e) => e.getAttribute("data-connect-source") === id,
        ),
        group = handles[0],
        port = group?.querySelector(".bpmn-xyflow-connect-port"),
        docking = [...root.querySelectorAll(".bpmn-xyflow-connect-docking")].find(
          (e) => e.getAttribute("data-connect-source") === id,
        ),
        marker = docking?.querySelector(".bpmn-xyflow-connect-docking-point");
      const visible = (e) => {
        if (!e?.isConnected) return false;
        for (let n = e; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0)
            return false;
        }
        return true;
      };
      const coord = (e) =>
          e && { x: Number(e.getAttribute("cx")), y: Number(e.getAttribute("cy")) },
        grab = coord(port),
        matrix = port?.getScreenCTM(),
        native = grab && matrix && new DOMPoint(grab.x, grab.y).matrixTransform(matrix),
        grabScreen = native && { x: native.x, y: native.y },
        probe = point || grabScreen,
        hit = probe && document.elementFromPoint(probe.x, probe.y);
      return {
        count: handles.length,
        anchor: coord(marker),
        grabScreen,
        displaced: docking?.getAttribute("visibility") === "visible",
        owned: !!group && !!hit && (group === hit || group.contains(hit)),
        visible: visible(port),
        markerVisible: visible(marker),
        owner: group?.getAttribute("data-connect-source"),
        delivered: window.anchorInput.findLast((e) => e.type === "mousemove"),
      };
    },
    { id, point },
  );
}

/** Approach without deselecting, clicking, or first leaving the current body. */
export async function continuingPort(h, page, id, side, fraction = 0.5) {
  const before = await h.state(page),
    shape = h.node(before, id),
    desired = h.side(shape, side, fraction),
    requested = h.screen(before, desired);
  await page.mouse.move(requested.x, requested.y, { steps: 6 });
  await h.settle(page);
  await page.waitForSelector(`#viewer .bpmn-xyflow-connect-handle[data-connect-source="${id}"]`, {
    visible: true,
  });
  const initial = await readFollowupPort(page, id);
  assert.equal(initial.count, 1);
  assert.equal(initial.owner, id);
  assert.equal(initial.visible, true);
  assert.equal(initial.owned, true);
  assert.equal(initial.delivered?.trusted, true);
  h.near(
    initial.anchor,
    h.projected(shape, h.graph(before, initial.delivered)),
    1e-7,
    "continuing marker follows the delivered perimeter point",
  );
  const point = { x: Math.round(initial.grabScreen.x), y: Math.round(initial.grabScreen.y) };
  await page.mouse.move(point.x, point.y, { steps: 6 });
  await h.settle(page);
  const reached = await readFollowupPort(page, id, point);
  assert.equal(reached.count, 1);
  assert.equal(reached.owner, id);
  assert.equal(reached.visible, true);
  assert.equal(reached.owned, true);
  assert.equal(reached.delivered?.trusted, true);
  assert.deepEqual({ x: reached.delivered.x, y: reached.delivered.y }, point);
  if (initial.displaced) assert.deepEqual(reached.anchor, initial.anchor);
  else
    h.near(
      reached.anchor,
      h.projected(shape, h.graph(before, point)),
      1e-7,
      "coincident marker follows the final integer native point",
    );
  await h.noChange(page, before, "immediate target-to-source hover");
  assert.deepEqual(
    (await h.raw(page)).selection,
    before.selection,
    "port discovery does not silently switch selection",
  );
  return { point, anchor: reached.anchor, initial, reached };
}

export async function connectNative(
  h,
  page,
  source,
  target,
  {
    side = "right",
    targetSide = "left",
    fraction = 0.35,
    continuing = false,
    expectedType = "bpmn:SequenceFlow",
  } = {},
) {
  const initial = await h.state(page),
    reference = initial.engine === "upstream";
  await saveFollowupEvidence(h, page, "connect-before", {
    source,
    target,
    side,
    targetSide,
    fraction,
    continuing,
  });
  assert.equal(
    reference,
    false,
    "A/C source creation uses local precise docking; reference callers need the explicit shared adapter",
  );
  const port = reference
    ? { point: await h.contextConnect(page, source) }
    : continuing
      ? await continuingPort(h, page, source, side)
      : await h.sourcePort(page, source, side);
  const before = await h.state(page),
    to = h.screen(before, h.side(h.node(before, target), targetSide, fraction));
  assert.ok(
    (await h.hit(page, to)).owners.includes(target),
    "the intended target remains in the native hit stack",
  );
  let preview;
  await h.drag(page, port.point, to, {
    capture: async () => {
      preview = await h.preview(page);
      assert.ok(preview?.length > 0, "visible activated preview");
      await saveFollowupEvidence(h, page, "connect-preview", { source, target, port, preview });
    },
  });
  const after = await h.state(page),
    added = Object.values(after.edges).filter((edge) => !before.edges[edge.id]);
  assert.equal(added.length, 1);
  const edge = added[0],
    release = after.input.findLast((e) => e.type === "mouseup");
  await saveFollowupEvidence(h, page, "connect-after", {
    source,
    target,
    edge,
    port,
    release,
    preview,
  });
  assert.equal(release?.trusted, true);
  assertCreatedConnection(after, edge, source, target, expectedType);
  if (!reference) {
    h.near(edge.points[0], port.anchor, 1e-7, "created source retains the displayed marker");
    h.near(
      edge.points.at(-1),
      h.projected(h.node(before, target), release.graphPoint),
      0.05 / after.viewport.zoom,
      "created target retains the delivered drop",
    );
    assert.equal(after.history.size, before.history.size + 1);
  }
  const rendered = await h.renderEnds(page, edge.id);
  h.near(preview.screenStart, rendered.start, 1.5, "preview source");
  h.near(preview.screenEnd, rendered.end, 1.5, "preview target");
  return { before, after, edge, port, release, preview, rendered };
}
