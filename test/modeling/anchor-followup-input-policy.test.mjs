import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { BpmnModdle } from "bpmn-moddle";
import { integerPanSteps, panNativeExact } from "../helpers/anchor-followup-input-policy.mjs";
import { chooseFollowupEdge } from "../helpers/anchor-followup-controls.mjs";

test("integer pan setup reaches the nearest deliverable offset without generating click-like corrections", () => {
  for (let requested = -1300; requested <= 1300; requested += 0.25) {
    const steps = integerPanSteps(requested);
    assert.equal(
      steps.reduce((a, b) => a + b, 0),
      Math.round(requested) || 0,
    );
    for (const step of steps) {
      assert.equal(Number.isInteger(step), true);
      assert.ok(Math.abs(step) > 3 && Math.abs(step) <= 100);
    }
    assert.ok(Math.abs(steps.reduce((a, b) => a + b, 0) - requested) <= 0.5);
  }
  const steps = integerPanSteps(842.6397142831895);
  assert.deepEqual(steps, [94, 94, 94, 94, 94, 94, 93, 93, 93]);
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 10001])
    assert.throws(() => integerPanSteps(value));
});
function fixture(fault) {
  const state = {
    xml: "<unchanged/>",
    history: { size: 3, undo: true, redo: false },
    selection: ["Source"],
    viewport: { x: 1177.5051283563844, y: 725.8441792855494, zoom: 1.05701804056138 },
    container: { x: 0, y: 48, width: 1800, height: 1152 },
  };
  const context = vm.createContext({
    window: { anchorInput: Array.from({ length: 300 }, () => ({ type: "old" })) },
  });
  let pointer = { x: 0, y: 0 },
    drag;
  const record = (type, button = 0) => {
    context.window.anchorInput.push({
      type,
      x: pointer.x,
      y: pointer.y,
      button,
      trusted: fault !== "untrusted",
    });
    if (context.window.anchorInput.length > 300) context.window.anchorInput.shift();
  };
  const raw = async () => structuredClone(state);
  const h = {
    state: raw,
    raw,
    blank: async () => ({ x: 1530, y: 1027.2 }),
    settle: async () => {},
  };
  const page = {
    evaluate: async (fn, arg) => {
      context.arg = arg;
      return vm.runInContext(`(${fn.toString()})(arg)`, context);
    },
    mouse: {
      async move(x, y) {
        pointer = { x: Math.trunc(x), y: Math.trunc(y) };
        record("mousemove");
        if (drag)
          state.viewport.x =
            drag.viewportX + pointer.x - drag.pointer.x + (fault === "camera" ? 1 : 0);
      },
      async down() {
        drag = { pointer: { ...pointer }, viewportX: state.viewport.x };
        record("mousedown", 1);
      },
      async up() {
        record("mouseup", 1);
        if (fault === "release") context.window.anchorInput.at(-1).x++;
        if (
          Math.hypot(pointer.x - drag.pointer.x, pointer.y - drag.pointer.y) <= 3 ||
          fault === "selection"
        )
          state.selection = [];
        if (fault === "xml") state.xml = "<changed/>";
        drag = null;
      },
    },
  };
  return { h, page, state };
}
test("actual pan helper uses fresh capped input records and preserves camera, model and selected source", async () => {
  const { h, page, state } = fixture();
  const proof = await panNativeExact(h, page, 842.6397142831895);
  assert.equal(proof.deliveredDelta, 843);
  assert.equal(proof.evidence.length, 9);
  assert.deepEqual(state.selection, ["Source"]);
  assert.deepEqual(proof.expectedViewport, state.viewport);
  const small = await panNativeExact(h, page, -1);
  assert.deepEqual(small.steps, [-10, 9]);
  assert.deepEqual(state.selection, ["Source"]);
});
test("pan setup refuses fabricated input, wrong camera, selection loss and semantic mutation", async () => {
  for (const fault of ["untrusted", "release", "camera", "selection", "xml"]) {
    const { h, page } = fixture(fault);
    await assert.rejects(panNativeExact(h, page, 10), undefined, fault);
  }
});
test("follow-up edge selection reuses exactly one current owner and still natively selects all other states", async () => {
  for (const original of [["Flow"], [], ["Other"], ["Flow", "Other"]]) {
    let selection = [...original],
      clicks = 0;
    const h = {
      raw: async () => ({ selection: [...selection] }),
      chooseEdge: async () => {
        clicks++;
        selection = ["Flow"];
      },
    };
    await chooseFollowupEdge(h, {}, "Flow");
    assert.equal(clicks, original.length === 1 && original[0] === "Flow" ? 0 : 1);
  }
  await assert.rejects(
    chooseFollowupEdge(
      { raw: async () => ({ selection: [] }), chooseEdge: async () => {} },
      {},
      "Flow",
    ),
  );
});
test("Conditional B free left-quarter setup is distinct from its line-owned midpoint", async () => {
  const { rootElement, elementsById, warnings } = await new BpmnModdle().fromXML(
    await readFile("test/fixtures/bpmn/draw/conditional-flow.bpmn", "utf8"),
  );
  assert.deepEqual(warnings, []);
  const b = Object.values(elementsById).find((e) => e.$type === "bpmn:Task" && e.name === "B");
  const plane = rootElement.diagrams[0].plane;
  const shape = plane.planeElement.find((e) => e.bpmnElement === b),
    incoming = plane.planeElement.find((e) => e.waypoint && e.bpmnElement.targetRef === b);
  const midpoint = { x: shape.bounds.x, y: shape.bounds.y + shape.bounds.height / 2 };
  assert.deepEqual({ x: incoming.waypoint.at(-1).x, y: incoming.waypoint.at(-1).y }, midpoint);
  const free = { x: shape.bounds.x, y: shape.bounds.y + shape.bounds.height * 0.25 };
  assert.deepEqual(free, { x: 270, y: 110 });
  assert.equal(midpoint.y - free.y, 20);
});
