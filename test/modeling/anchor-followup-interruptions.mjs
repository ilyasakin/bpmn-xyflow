/** Batch C, UI-only and unrun. The two-instance workflow is registered separately. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { connectNative } from "../helpers/anchor-followup-controls.mjs";
export const anchorInterruptionCases = [];
const add = (id, name, run) =>
  anchorInterruptionCases.push({ id, name, engine: "local", sample: "Empty diagram", run });

add("F26-O", "activated-release-outside-canvas", async (h, page, key) => {
  const { source, target } = await h.tasks(page),
    port = await h.sourcePort(page, source, "top"),
    before = await h.state(page);
  const inside = h.screen(before, h.side(h.node(before, target), "top"));
  await page.mouse.move(port.point.x, port.point.y);
  await page.mouse.down();
  try {
    await page.mouse.move(inside.x, inside.y, { steps: 10 });
    await h.settle(page);
    assert.ok((await h.preview(page))?.length > 0, "real preview is active before leaving");
    await page.screenshot({ path: `${h.output}/${key}-active.png`, fullPage: true });
    const outside = {
      x: before.container.x + before.container.width / 2,
      y: before.container.y - 8,
    };
    assert.ok(outside.y >= 0);
    assert.equal(
      await page.evaluate(
        (p) => document.querySelector("#viewer").contains(document.elementFromPoint(p.x, p.y)),
        outside,
      ),
      false,
    );
    await page.mouse.move(outside.x, outside.y, { steps: 8 });
  } finally {
    await page.mouse.up();
  }
  await h.settle(page);
  await h.noChange(page, before, "outside-canvas release");
  assert.equal(await h.preview(page), null);
  const next = await connectNative(h, page, source, target, { side: "left", targetSide: "top" });
  await h.creationOnly(next.before, next.after, next.edge);
  await h.history(page, next.before, next.after);
  return { next: next.edge };
});

add("F26-R", "sample-switch-after-click-to-arm", async (h, page, key) => {
  const { source, target } = await h.tasks(page),
    button = await h.contextConnect(page, source);
  await page.mouse.click(button.x, button.y);
  const before = await h.state(page),
    to = h.screen(before, h.side(h.node(before, target), "top"));
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await h.settle(page);
  assert.ok(
    (await h.preview(page))?.length > 0,
    "click-to-arm visibly activated before sample selection",
  );
  await page.screenshot({ path: `${h.output}/${key}-active.png`, fullPage: true });
  await h.chooseSample(page, "Conditional flows");
  const loaded = await h.state(page);
  assert.deepEqual(loaded.history, { size: 0, undo: false, redo: false });
  assert.equal(await h.preview(page), null);
  assert.equal(
    loaded.nodes.some((n) => n.id === source || n.id === target),
    false,
  );
  const a = loaded.nodes.find((n) => n.name === "B"),
    b = loaded.nodes.find((n) => n.name === "T1");
  assert.ok(a && b);
  await h.noChange(page, loaded, "old armed source cannot replay into the replacement graph");
  const next = await connectNative(h, page, a.id, b.id, { side: "left", targetSide: "top" });
  await h.creationOnly(next.before, next.after, next.edge);
  await h.history(page, next.before, next.after);
  return { next: next.edge, replacedSource: source };
});

async function panBy(h, page, dx) {
  const before = await h.state(page);
  let remaining = dx;
  for (let count = 0; Math.abs(remaining) > 0.5 && count < 20; count++) {
    const point = await h.blank(page),
      delta = Math.max(-100, Math.min(100, remaining));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down({ button: "middle" });
    try {
      await page.mouse.move(point.x + delta, point.y, { steps: 6 });
    } finally {
      await page.mouse.up({ button: "middle" });
    }
    await h.settle(page);
    const after = await h.raw(page);
    remaining = dx - (after.viewport.x - before.viewport.x);
  }
  assert.ok(Math.abs(remaining) <= 0.5, "native pan reaches its measured screen offset");
  const after = await h.state(page);
  assert.equal(after.xml, before.xml);
  assert.deepEqual(after.history, before.history);
  assert.deepEqual(after.selection, before.selection, "native pan retains the selected source");
}
add("F27", "selected-source-at-canvas-edge-and-pan-recovery", async (h, page, key) => {
  const { source, target } = await h.tasks(page, "left", 1);
  await h.selectNode(page, source);
  let s = await h.state(page),
    anchor = h.side(h.node(s, source), "right");
  const desired = Math.min(1799, s.container.x + s.container.width) - 4;
  await panBy(h, page, desired - h.screen(s, anchor).x);
  s = await h.state(page);
  const point = h.screen(s, anchor);
  await page.mouse.move(point.x, point.y, { steps: 8 });
  await h.settle(page);
  const edgeEvidence = await page.evaluate((id) => {
    const group = document.querySelector(
        `.bpmn-xyflow-connect-handle[data-connect-source="${id}"]`,
      ),
      port = group?.querySelector(".bpmn-xyflow-connect-port"),
      marker = document.querySelector(
        `.bpmn-xyflow-connect-docking[data-connect-source="${id}"] .bpmn-xyflow-connect-docking-point`,
      ),
      rect = document.querySelector("#viewer").getBoundingClientRect();
    const matrix = port?.getScreenCTM(),
      point =
        matrix &&
        new DOMPoint(
          Number(port.getAttribute("cx")),
          Number(port.getAttribute("cy")),
        ).matrixTransform(matrix);
    return {
      delivered: window.anchorInput.findLast((e) => e.type === "mousemove"),
      present: !!port,
      point: point && { x: point.x, y: point.y },
      anchor: marker && {
        x: Number(marker.getAttribute("cx")),
        y: Number(marker.getAttribute("cy")),
      },
      inside:
        !!point &&
        point.x >= Math.max(0, rect.left) &&
        point.x < Math.min(innerWidth, rect.right) &&
        point.y >= rect.top &&
        point.y < Math.min(innerHeight, rect.bottom),
      hittable: !!point && !!group?.contains(document.elementFromPoint(point.x, point.y)),
    };
  }, source);
  await page.screenshot({ path: `${h.output}/${key}-edge-reachability.png`, fullPage: true });
  await writeFile(
    `${h.output}/${key}-edge-reachability.json`,
    JSON.stringify({ requested: point, source, evidence: edgeEvidence }, null, 2),
  );
  await h.noChange(page, s, "edge hover is non-mutating");
  // Always exercise visible recovery and retain its evidence, even if clipping
  // was found. Recovery cannot turn an unreachable initial control into a pass.
  await panBy(h, page, -180);
  const next = await connectNative(h, page, source, target, { side: "right", targetSide: "right" });
  await h.creationOnly(next.before, next.after, next.edge);
  await h.history(page, next.before, next.after);
  assert.equal(edgeEvidence.present, true);
  assert.equal(edgeEvidence.inside, true, "shown source grab remains inside the canvas");
  assert.equal(edgeEvidence.hittable, true, "shown source grab near the edge is reachable");
  assert.equal(edgeEvidence.delivered?.trusted, true);
  h.near(
    edgeEvidence.anchor,
    h.projected(h.node(s, source), h.graph(s, edgeEvidence.delivered)),
    1e-7,
    "viewport-edge accommodation retains the delivered perimeter projection",
  );
  return { edgeEvidence, recovered: next.edge };
});
