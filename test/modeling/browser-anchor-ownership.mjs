/** UI-only stationary-click -> same-pointer drag coverage. Prepared until hosted execution. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createAnchorHarness } from "../helpers/anchor-ux-browser.mjs";
import { withAnchorDeadline } from "../helpers/anchor-case-deadline.mjs";
import { assertOnlyAnchorGeometry } from "../helpers/anchor-model-guard.mjs";
import {
  anchorOwnershipPositions,
  roundedTaskPoint,
  projectRoundedTask,
  dragFromCurrentPointer,
  observeOwnershipInput,
  collectOwnershipControl,
} from "../helpers/anchor-ownership-browser.mjs";

const bounds = (n) => ({ x: n.x, y: n.y, width: n.width, height: n.height });
async function prepare(h, page, selected) {
  const pair = await h.tasks(page, "right");
  // Real selection toggles exercise teardown/recreation before the actual case.
  await h.selectNode(page, pair.source);
  await h.blank(page, { click: true });
  if (selected) await h.selectNode(page, pair.source);
  const state = await h.state(page);
  assert.deepEqual(state.selection, selected ? [pair.source] : []);
  const painted = await page.evaluate((id) => {
    const group = [...document.querySelectorAll(".bpmn-xyflow-shape")].find(
      (e) => e.getAttribute("data-element-id") === id,
    );
    const rect = group?.querySelector(":scope > rect:not([data-bpmn-hit])");
    if (!rect) return null;
    return Object.fromEntries(
      ["x", "y", "width", "height", "rx", "ry"].map((name) => [
        name,
        Number(rect.getAttribute(name)),
      ]),
    );
  }, pair.source);
  assert.ok(painted);
  assert.equal(painted.rx, painted.ry);
  assert.ok(painted.rx > 0);
  assert.deepEqual(
    [painted.x, painted.y, painted.width, painted.height],
    [0, 0, h.node(state, pair.source).width, h.node(state, pair.source).height],
  );
  return { ...pair, state, radius: painted.rx };
}

async function approach(h, page, setup, direction) {
  const shape = h.node(setup.state, setup.source),
    requested = roundedTaskPoint(shape, setup.radius, direction),
    requestedScreen = h.screen(setup.state, requested);
  await page.mouse.move(requestedScreen.x, requestedScreen.y, { steps: 8 });
  await h.settle(page);
  const initial = await collectOwnershipControl(page, setup.source);
  assert.equal(initial.count, 1);
  assert.equal(initial.portVisible, true);
  assert.equal(initial.hitOwner, setup.source);
  assert.equal(initial.hitHandle, true);
  assert.equal(initial.delivered?.trusted, true);
  h.near(
    initial.anchor,
    projectRoundedTask(shape, setup.radius, h.graph(setup.state, initial.delivered)),
    1e-7,
    "the visible marker lies at the delivered point projected onto the painted Task outline",
  );
  const pointer = { x: Math.round(initial.grabScreen.x), y: Math.round(initial.grabScreen.y) };
  await page.mouse.move(pointer.x, pointer.y, { steps: 8 });
  await h.settle(page);
  const reached = await collectOwnershipControl(page, setup.source, pointer);
  assert.equal(reached.count, 1);
  assert.equal(reached.portVisible, true);
  assert.equal(reached.hitOwner, setup.source);
  assert.equal(reached.hitHandle, true);
  assert.deepEqual({ x: reached.delivered.x, y: reached.delivered.y }, pointer);
  if (initial.displaced) assert.deepEqual(reached.anchor, initial.anchor);
  else
    h.near(
      reached.anchor,
      projectRoundedTask(shape, setup.radius, h.graph(setup.state, pointer)),
      1e-7,
    );
  return { pointer, anchor: reached.anchor, requested, initial, reached };
}

async function samePointerCase(h, page, key, direction, selected) {
  const setup = await prepare(h, page, selected),
    source = h.node(setup.state, setup.source),
    control = await approach(h, page, setup, direction),
    before = await h.state(page);
  await page.screenshot({ path: `${h.output}/${key}-source.png`, fullPage: true });
  await observeOwnershipInput(page);
  await page.mouse.down();
  await page.mouse.up();
  await h.settle(page);
  const clicked = await h.state(page),
    retained = await collectOwnershipControl(page, setup.source, control.pointer);
  assert.equal(clicked.xml, before.xml, "stationary source-port click changes no XML");
  assert.deepEqual(
    clicked.history,
    before.history,
    "stationary source-port click creates no command",
  );
  assert.deepEqual(
    clicked.selection,
    before.selection,
    "stationary source-port click preserves selection",
  );
  const target = h.node(clicked, setup.target),
    drop = h.screen(clicked, h.side(target, "left", 0.35));
  let preview;
  // Deliberately no source helper, hover, recenter, click or move between presses.
  await dragFromCurrentPointer(page, drop, async () => {
    await h.settle(page);
    preview = await h.preview(page);
    await page.screenshot({ path: `${h.output}/${key}-repeat-preview.png`, fullPage: true });
  });
  await h.settle(page);
  const after = await h.state(page),
    input = await page.evaluate(() => window.anchorOwnershipInput),
    added = Object.values(after.edges).filter((e) => !before.edges[e.id]);
  const details = {
    selected,
    direction,
    source: setup.source,
    target: setup.target,
    control,
    retained,
    preview,
    input,
    sourceBefore: bounds(source),
    sourceAfter: bounds(h.node(after, setup.source)),
    added,
  };
  await writeFile(`${h.output}/${key}-gesture.json`, JSON.stringify(details, null, 2));
  const presses = input.filter((e) => e.type === "mousedown"),
    releases = input.filter((e) => e.type === "mouseup");
  assert.equal(presses.length, 2);
  assert.equal(releases.length, 2);
  assert.ok(input.every((e) => e.trusted));
  assert.deepEqual(
    input.slice(0, 3).map((e) => e.type),
    ["mousedown", "mouseup", "mousedown"],
    "second press occurs at the current pointer without an intervening move",
  );
  for (const press of presses) assert.deepEqual({ x: press.x, y: press.y }, control.pointer);
  assert.equal(
    retained.hitOwner,
    setup.source,
    "stationary click retains a connection control under the same pointer",
  );
  assert.equal(retained.hitHandle, true);
  assert.equal(retained.resizeDirection, null, "the same point does not silently become Resize");
  assert.equal(retained.portVisible, true);
  assert.deepEqual(retained.anchor, control.anchor);
  assert.equal(presses[1].connectOwner, setup.source);
  assert.equal(presses[1].resizeDirection, null);
  assert.deepEqual(
    bounds(h.node(after, setup.source)),
    bounds(source),
    "immediate repeat must not resize or move the Task",
  );
  assert.equal(added.length, 1);
  const edge = added[0];
  assert.equal(edge.type, "bpmn:SequenceFlow");
  assert.deepEqual([edge.source, edge.target], [setup.source, setup.target]);
  h.near(
    edge.points[0],
    control.anchor,
    1e-7,
    "repeated drag starts at the same visible source marker",
  );
  const released = after.input.findLast((e) => e.type === "mouseup");
  assert.equal(released.trusted, true);
  h.near(
    edge.points.at(-1),
    h.projected(target, released.graphPoint),
    0.05 / after.viewport.zoom,
    "chosen target docking survives the delivered native release",
  );
  assert.ok(preview, "second press and drag has a real connection preview");
  const rendered = await h.renderEnds(page, edge.id);
  h.near(preview.screenStart, rendered.start, 0.1);
  h.near(preview.screenEnd, rendered.end, 0.1);
  h.near(rendered.start, h.screen(after, edge.points[0]), 0.05);
  h.near(rendered.end, h.screen(after, edge.points.at(-1)), 0.05);
  await h.creationOnly(before, after, edge);
  await h.history(page, before, after);
  return details;
}

async function resizeCase(h, page, key, direction) {
  const setup = await prepare(h, page, true),
    before = await h.state(page),
    shape = h.node(before, setup.source);
  const control = await page.waitForSelector(
    `.bpmn-xyflow-resize-handle[data-resize-dir="${direction}"]`,
    { visible: true },
  );
  const box = await control.boundingBox(),
    pointer = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  await page.mouse.move(pointer.x, pointer.y);
  await h.settle(page);
  assert.equal(
    await control.evaluate((e, p) => e === document.elementFromPoint(p.x, p.y), pointer),
    true,
    "the explicit visible resize square remains directly hittable",
  );
  const dx = direction.includes("w") ? -40 : direction.includes("e") ? 40 : 0,
    dy = direction.includes("n") ? -40 : direction.includes("s") ? 40 : 0;
  await observeOwnershipInput(page);
  await dragFromCurrentPointer(page, { x: pointer.x + dx, y: pointer.y + dy });
  await h.settle(page);
  const after = await h.state(page),
    changed = h.node(after, setup.source),
    input = await page.evaluate(() => window.anchorOwnershipInput);
  assert.ok(
    input.every((e) => e.trusted),
    "the explicit resize uses trusted native input",
  );
  assert.equal(input[0].type, "mousedown");
  assert.equal(input[0].resizeDirection, direction);
  assert.equal(input[0].connectOwner, null);
  assert.deepEqual(after.edges, before.edges, "explicit resize creates no connection");
  if (dx) assert.ok(changed.width > shape.width);
  else assert.equal(changed.width, shape.width);
  if (dy) assert.ok(changed.height > shape.height);
  else assert.equal(changed.height, shape.height);
  if (!direction.includes("w")) assert.equal(changed.x, shape.x);
  else assert.ok(changed.x < shape.x);
  if (!direction.includes("n")) assert.equal(changed.y, shape.y);
  else assert.ok(changed.y < shape.y);
  await assertOnlyAnchorGeometry(before.xml, after.xml, { shapeIds: [setup.source] });
  await h.history(page, before, after);
  return { direction, pointer, input, before: bounds(shape), after: bounds(changed) };
}

export const anchorOwnershipCases = [
  ...[false, true].flatMap((selected) =>
    anchorOwnershipPositions.map((direction) => ({
      id: "AO-repeat",
      name: `${selected ? "selected" : "unselected"}-${direction}`,
      direction,
      selected,
      run: (h, page, key) => samePointerCase(h, page, key, direction, selected),
    })),
  ),
  ...anchorOwnershipPositions.map((direction) => ({
    id: "AO-resize",
    name: direction,
    direction,
    run: (h, page, key) => resizeCase(h, page, key, direction),
  })),
];

export async function runAnchorOwnership() {
  const h = createAnchorHarness({
    port: Number(process.env.BPMN_ANCHOR_OWNERSHIP_PORT || 5255),
    output: "test-artifacts/anchor-ownership",
  });
  try {
    await h.start();
    for (const c of anchorOwnershipCases)
      await h.run(c.id, c.name, "local", "Empty diagram", (page, key) =>
        withAnchorDeadline(page, () => c.run(h, page, key), {
          milliseconds: 45000,
          onTimeout: () => h.save(page, key + "-timeout", { status: "timed-out" }),
        }),
      );
    assert.equal(
      h.results.length,
      24,
      "all16 immediate-repeat variants and8 explicit resize cases execute",
    );
    const failed = h.results.filter((r) => r.status === "failed");
    console.log(`Anchor ownership: ${h.results.length - failed.length}/${h.results.length} passed`);
    assert.equal(
      failed.length,
      0,
      `native ownership failures: ${failed.map((c) => c.name).join(", ")}`,
    );
  } finally {
    await h.stop();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runAnchorOwnership();
