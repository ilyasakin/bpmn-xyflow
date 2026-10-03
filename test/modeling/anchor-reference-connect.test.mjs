import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { setupDOM } from "../helpers/dom.mjs";
import { observeReferenceConnect } from "../helpers/anchor-reference-connect.mjs";

const require = createRequire(import.meta.url),
  dependency = createRequire(require.resolve("bpmn-js/package.json"));
const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:v="urn:anchor-reference" id="Definitions" targetNamespace="urn:anchor-reference"><bpmn:process id="Process" isExecutable="false"><bpmn:task id="Source" name="Keep source" v:keep="source"/><bpmn:task id="Target" name="Keep target" v:keep="target"/></bpmn:process><bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process"><bpmndi:BPMNShape id="Source_di" bpmnElement="Source"><dc:Bounds x="850" y="570" width="100" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="Target_di" bpmnElement="Target"><dc:Bounds x="1190" y="570" width="100" height="80"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
const xy = (p) => ({ x: p.x, y: p.y });
let dom, Modeler;
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
async function editor() {
  const model = new Modeler({ container: dom.createContainer() });
  assert.deepEqual((await model.importXML(xml)).warnings, []);
  const canvas = model.get("canvas");
  Object.defineProperties(canvas._container, {
    clientWidth: { configurable: true, value: 1800 },
    clientHeight: { configurable: true, value: 1158 },
  });
  canvas._container.getBoundingClientRect = () => ({ left: 0, top: 42, width: 1800, height: 1158 });
  canvas._viewport.transform.baseVal.createSVGTransformFromMatrix = (matrix) =>
    canvas._svg.createSVGTransformFromMatrix(matrix);
  canvas.viewbox({ x: 0, y: 0, width: 1800, height: 1158 });
  model.get("selection").select(model.get("elementRegistry").get("Source"));
  return model;
}
const event = (type, x, y) =>
  new dom.window.MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
    bubbles: true,
    cancelable: true,
  });
const save = async (model) => (await model.saveXML({ format: true })).xml;

// These are registered DOM/service probes, not a claim of native execution.
test("actual ContextPad mousedown only stops propagation; click arms Connect and 0/5 CSS pixels leave it inactive", async () => {
  const model = await editor();
  try {
    const observation = observeReferenceConnect(model),
      dragging = model.get("dragging"),
      stack = model.get("commandStack");
    const button = model
      .get("canvas")
      ._container.querySelector('.djs-context-pad [data-action="connect"]');
    const before = await save(model);
    button.dispatchEvent(event("mousedown", 974, 690));
    assert.equal(!!dragging.context(), false);
    assert.deepEqual(observation.events, []);
    button.dispatchEvent(event("click", 974, 690));
    assert.equal(dragging.context().prefix, "connect");
    assert.equal(!!dragging.context().active, false);
    assert.deepEqual(
      observation.events.map((e) => [e.phase, e.type, e.action]),
      [["context", "click", "connect"]],
    );
    for (const distance of [0, 5]) {
      dragging.move(event("mousemove", 974, 690 + distance));
      assert.equal(!!dragging.context().active, false);
      assert.equal(await save(model), before);
      assert.equal(stack.canUndo(), false);
    }
    dragging.cancel();
    assert.equal(await save(model), before);
    assert.equal(stack.canUndo(), false);
    observation.destroy();
  } finally {
    model.destroy();
  }
});

for (const trigger of ["click", "dragstart"])
  test(`actual ${trigger} Connect matches pre-command snapping/layout/crop without observer mutations`, async () => {
    const model = await editor();
    try {
      const observation = observeReferenceConnect(model),
        dragging = model.get("dragging"),
        stack = model.get("commandStack"),
        bus = model.get("eventBus");
      const registry = model.get("elementRegistry"),
        source = registry.get("Source"),
        target = registry.get("Target");
      const before = await save(model),
        roots = model.getDefinitions().rootElements,
        flowElements = roots[0].flowElements,
        planeElements = model.getDefinitions().diagrams[0].plane.planeElement;
      let reachedAfterObserver = false,
        planeBeforeObserver;
      // saveXML itself rebuilds the reference plane array. Compare identity across
      // the observer's exact synchronous window, after the last export.
      bus.on("connect.end", 1101, () => {
        planeBeforeObserver = model.getDefinitions().diagrams[0].plane.planeElement;
      });
      bus.on("connect.end", 1099, () => {
        reachedAfterObserver = true;
        assert.equal(stack.canUndo(), false);
        assert.equal(model.getDefinitions().rootElements, roots);
        assert.equal(roots[0].flowElements, flowElements);
        assert.deepEqual(
          flowElements.map((e) => e.id),
          ["Source", "Target"],
        );
        assert.equal(model.getDefinitions().diagrams[0].plane.planeElement, planeBeforeObserver);
        assert.deepEqual(
          planeElements.map((e) => e.id),
          ["Source_di", "Target_di"],
        );
        assert.equal(registry.getAll().filter((e) => e.waypoints).length, 0);
        assert.equal(source.businessObject.$attrs["v:keep"], "source");
        assert.equal(target.businessObject.$attrs["v:keep"], "target");
      });
      const button = model
        .get("canvas")
        ._container.querySelector('.djs-context-pad [data-action="connect"]');
      button.dispatchEvent(event(trigger, 974, 690));
      dragging.move(event("mousemove", 1107, 651));
      dragging.hover({ element: target, gfx: registry.getGraphics(target) });
      dragging.move(event("mousemove", 1240, 612));
      assert.equal(await save(model), before, "pre-commit observation leaves full XML unchanged");
      dragging.end(event("mouseup", 1240, 612));
      assert.equal(
        reachedAfterObserver,
        true,
        "void observer allows the lower command handler to run",
      );
      const phases = observation.events.filter((e) => e.type === "connect.end");
      assert.deepEqual(
        phases.map((e) => [e.phase, e.point]),
        [
          ["raw", { x: 1240, y: 570 }],
          ["post-bpmn", { x: 1240, y: 580 }],
          ["post-grid", { x: 1240, y: 580 }],
        ],
      );
      const expected = [
        { x: 950, y: 610 },
        { x: 1070, y: 610 },
        { x: 1070, y: 580 },
        { x: 1190, y: 580 },
      ];
      const snapped = phases.at(-1),
        command = observation.events.find((e) => e.phase === "command");
      assert.equal(snapped.oracleError, undefined);
      assert.deepEqual(snapped.expectedRoute, expected);
      assert.deepEqual(snapped.hints, {
        connectionStart: { x: 900, y: 610 },
        connectionEnd: { x: 1240, y: 580 },
      });
      assert.deepEqual(command.hints, snapped.hints);
      assert.deepEqual([command.source, command.target], ["Source", "Target"]);
      const edge = registry.getAll().find((e) => e.waypoints);
      assert.deepEqual(edge.waypoints.map(xy), expected);
      assert.equal(edge.source, source);
      assert.equal(edge.target, target);
      const after = await save(model);
      stack.undo();
      assert.equal(await save(model), before);
      stack.redo();
      assert.equal(await save(model), after);
      observation.destroy();
    } finally {
      model.destroy();
    }
  });
