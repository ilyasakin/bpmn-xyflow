/** Real Ctrl+resize-handle input; prepared until the hosted browser gate runs. */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createAnchorHarness } from "../helpers/anchor-ux-browser.mjs";
import { withAnchorDeadline } from "../helpers/anchor-case-deadline.mjs";
import { assertLaneSpaceResult } from "../helpers/container-resize-oracle.mjs";
import { collectReferenceLaneTop } from "../helpers/anchor-followup-dom.mjs";
const sample = "Approval, rejection and rework";
export const containerResizeCases = ["local", "upstream"].map((engine) => ({
  id: "D14",
  name: "ctrl-lane-space",
  engine,
  sample,
}));
export async function runContainerResize() {
  const h = createAnchorHarness({
    port: Number(process.env.BPMN_CONTAINER_RESIZE_PORT || 5267),
    output: "test-artifacts/container-resize",
  });
  try {
    await h.start();
    for (const c of containerResizeCases)
      await h.run(c.id, c.name, c.engine, c.sample, (page, key) =>
        withAnchorDeadline(
          page,
          async () => {
            const initial = await h.state(page), lane = h.node(initial, "RequesterLane");
            const selectionGeometry = c.engine === "upstream"
              ? await page.evaluate(collectReferenceLaneTop, { id: lane.id, width: lane.width, height: lane.height }) : null;
            const point = selectionGeometry?.point || h.screen(initial, { x: lane.x + 14, y: lane.y + lane.height / 2 });
            await page.evaluate(() => { window.anchorInput.length = 0; });
            await page.mouse.move(point.x, point.y);
            await h.settle(page);
            const selectionHit = await h.hit(page, point);
            assert.equal(selectionHit.inside, true);
            assert.equal(selectionHit.id, "RequesterLane", "native selection hits the visible lane itself");
            await page.mouse.click(point.x, point.y);
            await h.settle(page);
            const selected = await h.noChange(page, initial, "visible lane selection preserves exact XML/history");
            assert.deepEqual(selected.selection, ["RequesterLane"]);
            const selectionInput = (await h.raw(page)).input;
            const delivered = selectionInput.findLast(e => e.type === "mousemove");
            assert.equal(delivered?.trusted, true, "lane selection uses the observed native approach");
            if (c.engine === "upstream") assert.deepEqual({ x: delivered.x, y: delivered.y }, point);
            for (const type of ["mousedown", "mouseup"]) {
              const event = selectionInput.findLast(e => e.type === type);
              assert.equal(event?.trusted, true, `lane selection has trusted ${type}`);
              assert.deepEqual({ x: event.x, y: event.y }, { x: delivered.x, y: delivered.y });
            }
            await h.save(page, key + "-selection", { selectionGeometry, selectionHit, selectionInput });
            const selector =
              c.engine === "local"
                ? '.bpmn-xyflow-resize-handle[data-resize-dir="s"]'
                : ".djs-resizer-s";
            const control = await page.waitForSelector(selector, { visible: true }),
              box = await control.boundingBox();
            assert.ok(box);
            const start = {
                x: Math.round(box.x + box.width / 2),
                y: Math.round(box.y + box.height / 2),
              },
              before = await h.state(page);
            const end = { x: start.x, y: Math.round(start.y + 30 * before.viewport.zoom) };
            assert.equal(
              Math.round((end.y - start.y) / before.viewport.zoom),
              30,
              "delivered CSS delta resolves to the intended30 graph units",
            );
            await page.mouse.move(start.x, start.y);
            await h.settle(page);
            assert.equal(
              await control.evaluate(
                (e, p) =>
                  e === document.elementFromPoint(p.x, p.y) ||
                  e.contains(document.elementFromPoint(p.x, p.y)),
                start,
              ),
              true,
              "resize handle owns the actual native press",
            );
            await page.evaluate(() => {
              window.anchorInput.length = 0;
            });
            await page.keyboard.down("Control");
            try {
              await page.mouse.down();
              await page.mouse.move(end.x, end.y, { steps: 12 });
              const active = await h.raw(page);
              if (c.engine === "local")
                assert.notEqual(h.node(active, "RequesterLane").height, lane.height);
              else
                assert.equal(
                  await page.evaluate(
                    () => !!window.referenceModeler.get("dragging").context()?.active,
                  ),
                  true,
                );
              await h.save(page, key + "-preview", { start, end, active });
              await page.mouse.up();
            } finally {
              await page.mouse.up().catch(() => {});
              await page.keyboard.up("Control");
            }
            await h.settle(page);
            const after = await h.state(page),
              input = (await h.raw(page)).input;
            assert.ok(
              input.some(
                (e) =>
                  e.type === "mousedown" &&
                  e.trusted &&
                  e.control &&
                  String(e.target).includes("resize"),
              ),
              "trusted Ctrl press starts on a resize control",
            );
            assert.ok(
              input.some(
                (e) =>
                  e.type === "mousemove" &&
                  e.trusted &&
                  e.control &&
                  e.x === end.x &&
                  e.y === end.y,
              ),
            );
            await h.save(page, key + "-after", { before: h.serial(before), input, start, end });
            await assertLaneSpaceResult(before, after);
            if (c.engine === "local") assert.equal(after.history.size, before.history.size + 1);
            for (let cycle = 0; cycle < 3; cycle++) {
              await h.clickButton(page, "#undo-btn");
              const undone = await h.state(page);
              if (c.engine === "local") assert.equal(undone.xml, before.xml);
              else await assertLaneSpaceResult(before, undone, { undo: true });
              await h.clickButton(page, "#redo-btn");
              const redone = await h.state(page);
              assert.equal(
                c.engine === "local" ? redone.xml : redone.canonical,
                c.engine === "local" ? after.xml : after.canonical,
              );
            }
            return {
              status:
                c.engine === "upstream" ? "measured-reference-defect" : "connected-local-geometry",
              delta: 30,
              input,
              start,
              end,
            };
          },
          {
            milliseconds: 60000,
            onTimeout: () => h.save(page, key + "-timeout", { status: "timed-out" }),
          },
        ),
      );
    assert.equal(h.results.length, 2);
    assert.equal(
      h.results.filter((r) => r.status === "failed").length,
      0,
      JSON.stringify(h.results),
    );
  } finally {
    await h.stop();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runContainerResize();
