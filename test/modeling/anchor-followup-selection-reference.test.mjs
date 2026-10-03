/** Installed-handler setup proof. Native acceptance is reported by the separate suites. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { setupDOM } from "../helpers/dom.mjs";
let dom, Upstream, Local;
before(async () => {
  dom = await setupDOM();
  globalThis.MouseEvent = dom.window.MouseEvent;
  ({ default: Upstream } = await dom.loadModule("/node_modules/bpmn-js/lib/Modeler.js"));
  ({ default: Local } = await dom.loadModule("/lib/Modeler.js"));
});
after(async () => {
  delete globalThis.MouseEvent;
  await dom.cleanup();
});
const input = (type, p) =>
  new dom.window.MouseEvent(type, {
    clientX: p.x,
    clientY: p.y,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
    bubbles: true,
    cancelable: true,
  });
test("pinned rejected reconnect restores its selected edge and an extra ordinary click toggles it off", async () => {
  const m = new Upstream({ container: dom.createContainer() });
  try {
    assert.deepEqual(
      (
        await m.importXML(
          await readFile("test/fixtures/scenarios/order-payment-delivery.bpmn", "utf8"),
        )
      ).warnings,
      [],
    );
    const canvas = m.get("canvas");
    Object.defineProperties(canvas._container, {
      clientWidth: { configurable: true, value: 1800 },
      clientHeight: { configurable: true, value: 1158 },
    });
    canvas._container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1800,
      height: 1158,
    });
    canvas._viewport.transform.baseVal.createSVGTransformFromMatrix = (matrix) =>
      canvas._svg.createSVGTransformFromMatrix(matrix);
    canvas.viewbox({ x: 0, y: 0, width: 1800, height: 1158 });
    const registry = m.get("elementRegistry"),
      edge = registry.get("OrderMessage"),
      target = registry.get("FulfillmentFork"),
      selection = m.get("selection"),
      dragging = m.get("dragging");
    const click = () =>
      m
        .get("eventBus")
        .fire("element.click", {
          element: edge,
          gfx: registry.getGraphics(edge),
          originalEvent: input("click", { x: 184, y: 282 }),
        });
    const before = (await m.saveXML({ format: true })).xml;
    click();
    assert.deepEqual(
      selection.get().map((e) => e.id),
      ["OrderMessage"],
    );
    const index = edge.waypoints.length - 1,
      start = edge.waypoints[index],
      drop = { x: target.x + target.width / 2, y: target.y };
    m.get("bendpointMove").start(input("mousedown", start), edge, index, false);
    dragging.move(input("mousemove", { x: start.x + 60, y: start.y + 10 }));
    dragging.hover({ element: target, gfx: registry.getGraphics(target) });
    dragging.move(input("mousemove", drop));
    assert.equal(dragging.context().active, true);
    assert.equal(dragging.context().data.context.allowed, false);
    dragging.end(input("mouseup", drop));
    assert.equal((await m.saveXML({ format: true })).xml, before);
    assert.equal(m.get("commandStack").canUndo(), false);
    assert.deepEqual(
      selection.get().map((e) => e.id),
      ["OrderMessage"],
      "actual Dragging cleanup restores the pre-drag sole selection",
    );
    click();
    assert.deepEqual(selection.get(), [], "the old unconditional chooseEdge click deselects it");
  } finally {
    m.destroy();
  }
});
test("the two recorded B-left midpoint arrivals own the existing connection; a free same-side point exposes B without mutation", async () => {
  const file = await readFile("test/fixtures/bpmn/draw/conditional-flow.bpmn", "utf8");
  for (const scene of [
    {
      viewport: { x: 916.0223799660786, y: 693.732934048067, zoom: 0.5287775944427392 },
      delivered: { x: 1058, y: 810 },
    },
    {
      viewport: { x: 54.07521325459318, y: 110.04862478127734, zoom: 1.4346839457567804 },
      delivered: { x: 441, y: 344 },
    },
  ]) {
    const container = dom.createContainer(1800, 1152);
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 48,
      x: 0,
      y: 48,
      right: 1800,
      bottom: 1200,
      width: 1800,
      height: 1152,
    });
    const m = new Local({ container, fitViewOnInit: false, palette: false, editorActions: false });
    const old = document.elementsFromPoint;
    let hit;
    document.elementsFromPoint = () => [hit];
    try {
      await m.importXML(file);
      m.getSvg().getBoundingClientRect = container.getBoundingClientRect;
      await m.setViewport(scene.viewport);
      const b = m.getGraph().nodes.find((n) => n.businessObject.name === "B"),
        incoming = m.getGraph().edges.find((e) => e.target === b);
      const gfx = (id) => container.querySelector(`[data-element-id="${id}"]`);
      const move = (p, target) => {
        hit = target;
        target.dispatchEvent(
          new dom.window.PointerEvent("pointermove", {
            pointerType: "mouse",
            clientX: p.x,
            clientY: p.y,
            bubbles: true,
          }),
        );
        target.dispatchEvent(input("mousemove", p));
      };
      const before = await m.getXML();
      move(scene.delivered, gfx(incoming.id).querySelector(".bpmn-xyflow-connection-visual"));
      assert.equal(
        container.querySelector(`.bpmn-xyflow-connect-handle[data-connect-source="${b.id}"]`),
        null,
      );
      const free = {
        x: Math.round(scene.viewport.x + b.x * scene.viewport.zoom),
        y: Math.round(48 + scene.viewport.y + (b.y + b.height * 0.25) * scene.viewport.zoom),
      };
      move(free, gfx(b.id).querySelector(".bpmn-xyflow-shape-hit"));
      const marker = container.querySelector(".bpmn-xyflow-connect-docking-point");
      assert.ok(marker);
      assert.equal(Number(marker.getAttribute("cx")), b.x);
      assert.equal(
        Number(marker.getAttribute("cy")),
        (free.y - 48 - scene.viewport.y) / scene.viewport.zoom,
      );
      assert.equal(await m.getXML(), before);
      assert.equal(m.commandStack.size(), 0);
      assert.deepEqual(m.getSelection(), []);
    } finally {
      document.elementsFromPoint = old;
      m.destroy();
    }
  }
});
