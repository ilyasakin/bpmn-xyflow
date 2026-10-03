import assert from "node:assert/strict";
import path from "node:path";
import { continuingPort } from "../helpers/anchor-followup-controls.mjs";

async function allInstances(page) {
  return page.evaluate(async () =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(window.anchorEditors).map(async ([id, modeler]) => [
          id,
          {
            xml: await modeler.getXML(),
            selection: modeler.getSelection(),
            viewport: modeler.getViewport(),
            history: {
              size: modeler.commandStack.size(),
              undo: modeler.canUndo(),
              redo: modeler.canRedo(),
            },
            preview: !!modeler.getContainer().querySelector(".bpmn-xyflow-connect-preview"),
          },
        ]),
      ),
    ),
  );
}
async function activate(h, page, id) {
  await h.clickButton(page, `[data-inspect="${id}"]`);
  assert.equal(
    await page.$eval("#viewer", (element) => element.closest("[data-editor]").dataset.editor),
    id,
  );
}
async function paletteTask(h, page, relative) {
  const before = await h.state(page);
  const button = await page.evaluateHandle(() =>
    [...document.querySelectorAll("#viewer .bpmn-xyflow-palette button")].find(
      (e) => e.textContent === "+ Task",
    ),
  );
  const element = button.asElement();
  assert.ok(element);
  const b = await element.boundingBox();
  assert.ok(b);
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    to = {
      x: before.container.x + before.container.width * relative,
      y: before.container.y + before.container.height * 0.6,
    };
  assert.equal(
    await element.evaluate((e, p) => e.contains(document.elementFromPoint(p.x, p.y)), from),
    true,
  );
  await h.drag(page, from, to);
  const after = await h.state(page);
  const added = after.nodes.filter(
    (n) => n.type === "bpmn:Task" && !before.nodes.some((old) => old.id === n.id),
  );
  assert.equal(added.length, 1);
  return added[0].id;
}
async function connect(h, page, source, target, cancel, key) {
  const before = await h.state(page),
    port = await continuingPort(h, page, source, "right");
  const to = h.screen(before, h.side(h.node(before, target), "left", 0.35));
  let previewOwner;
  await h.drag(page, port.point, to, {
    cancel,
    capture: async () => {
      previewOwner = await page.evaluate(() =>
        [...document.querySelectorAll(".bpmn-xyflow-connect-preview")].map(
          (e) => e.closest("[data-editor]")?.dataset.editor,
        ),
      );
      assert.deepEqual(previewOwner, [
        await page.$eval("#viewer", (e) => e.closest("[data-editor]").dataset.editor),
      ]);
      await page.screenshot({ path: `${h.output}/${key}-active.png`, fullPage: true });
    },
  });
  const after = await h.state(page);
  if (cancel) {
    await h.noChange(page, before, "instance-local Escape");
    return { before, after };
  }
  const added = Object.values(after.edges).filter((e) => !before.edges[e.id]);
  assert.equal(added.length, 1);
  const edge = added[0];
  assert.equal(edge.source, source);
  assert.equal(edge.target, target);
  assert.equal(edge.type, "bpmn:SequenceFlow");
  h.near(edge.points[0], port.anchor, 1e-7, "instance-local source marker");
  const release = after.input.findLast((e) => e.type === "mouseup");
  assert.equal(release.trusted, true);
  h.near(
    edge.points.at(-1),
    h.projected(h.node(before, target), release.graphPoint),
    0.05 / after.viewport.zoom,
    "instance-local target point",
  );
  await h.creationOnly(before, after, edge);
  assert.equal(after.history.size, before.history.size + 1);
  return { before, after, edge };
}
export const anchorInstanceCases = [
  {
    id: "F28",
    name: "two-editors-cancel-create-and-independent-history",
    engine: "local",
    sample: "Empty diagram",
    async run(h, page, key) {
      const url = new URL(page.url());
      url.pathname = `/@fs/${path.resolve("test/anchor-ux/two-editors.html")}`;
      await page.goto(url.href, { waitUntil: "networkidle0" });
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll(".status")].length === 2 &&
          [...document.querySelectorAll(".status")].every((e) =>
            /^(Loaded |Error:)/.test(e.textContent),
          ),
      );
      assert.deepEqual(await page.$$eval(".status", (nodes) => nodes.map((e) => e.textContent)), [
        "Loaded Empty diagram (0 warnings)",
        "Loaded Empty diagram (0 warnings)",
      ]);
      const ids = {};
      for (const id of ["a", "b"]) {
        await activate(h, page, id);
        await h.zoom(page, 0.7);
        ids[id] = [await paletteTask(h, page, 0.45), await paletteTask(h, page, 0.77)];
      }
      const baseline = await allInstances(page);
      await activate(h, page, "a");
      await connect(h, page, ...ids.a, true, key + "-cancel-a");
      let pair = await allInstances(page);
      assert.equal(pair.a.xml, baseline.a.xml);
      assert.deepEqual(pair.a.history, baseline.a.history);
      assert.deepEqual(pair.b, baseline.b);
      await activate(h, page, "b");
      const b = await connect(h, page, ...ids.b, false, key + "-create-b");
      pair = await allInstances(page);
      assert.equal(pair.a.xml, baseline.a.xml);
      assert.deepEqual(pair.a.history, baseline.a.history);
      assert.equal(pair.a.preview, false);
      const committedB = pair.b;
      await activate(h, page, "a");
      const a = await connect(h, page, ...ids.a, false, key + "-create-a");
      pair = await allInstances(page);
      assert.deepEqual(pair.b, committedB);
      for (let i = 0; i < 2; i++) {
        await h.clickButton(page, '[data-undo="a"]');
        pair = await allInstances(page);
        assert.equal(pair.a.xml, a.before.xml);
        assert.deepEqual(pair.b, committedB);
        await h.clickButton(page, '[data-redo="a"]');
        pair = await allInstances(page);
        assert.equal(pair.a.xml, a.after.xml);
        assert.deepEqual(pair.b, committedB);
      }
      const committedA = pair.a;
      await activate(h, page, "b");
      await h.clickButton(page, '[data-undo="b"]');
      pair = await allInstances(page);
      assert.equal(pair.b.xml, b.before.xml);
      assert.deepEqual(pair.a, committedA);
      await h.clickButton(page, '[data-redo="b"]');
      pair = await allInstances(page);
      assert.equal(pair.b.xml, b.after.xml);
      assert.deepEqual(pair.a, committedA);
      return { ids, a: a.edge, b: b.edge, instances: pair };
    },
  },
];
