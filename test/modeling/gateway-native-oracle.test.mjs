import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gatewayVertices, nearestGatewayVertex, assertGatewayVertex } from "../helpers/gateway-native-oracle.mjs";
import { createAnchorHarness } from "../helpers/anchor-ux-browser.mjs";

const shape = Object.freeze({ type: "bpmn:ExclusiveGateway", x: 565, y: 207, width: 50, height: 50 });
const vertices = [{ x: 590, y: 207 }, { x: 615, y: 232 }, { x: 590, y: 257 }, { x: 565, y: 232 }];
const digest = text => createHash("sha256").update(text).digest("hex");

test("native oracle independently fixes all Gateway family choices at exact vertices", () => {
  for (const type of ["Gateway", "ExclusiveGateway", "InclusiveGateway", "ParallelGateway", "ComplexGateway", "EventBasedGateway", "CustomGateway"]) {
    const n = { ...shape, type: `bpmn:${type}` };
    assert.deepEqual(gatewayVertices(n), vertices);
    for (const [pointer, expected] of [
      [{ x: 603, y: 244 }, vertices[1]], // Captured sloped source from actual preview.
      [{ x: 603, y: 220 }, vertices[1]], // Captured incoming sloped drop.
      [{ x: 578, y: 219 }, vertices[0]],
      [{ x: 578, y: 245 }, vertices[2]],
      [{ x: 564, y: 232 }, vertices[3]],
    ]) assert.deepEqual(nearestGatewayVertex(n, pointer), expected);
    for (const p of vertices) assertGatewayVertex(n, p);
    assert.throws(() => assertGatewayVertex(n, { x: 603, y: 244 }), /exact vertex/);
    assert.throws(() => assertGatewayVertex(n, { x: 615 - 1e-10, y: 232 }), /exact vertex/);
  }
});

test("Gateway ties, fractional bounds and malformed input have exact bounded outcomes", () => {
  const square = { type: "bpmn:Gateway", x: 0, y: 0, width: 50, height: 50 };
  for (const p of [{ x: 25, y: 25 }, { x: 37.5, y: 12.5 }, { x: 12.5, y: 12.5 }])
    assert.deepEqual(nearestGatewayVertex(square, p), { x: 25, y: 0 });
  assert.deepEqual(nearestGatewayVertex(square, { x: 37.5, y: 37.5 }), { x: 50, y: 25 });
  assert.deepEqual(nearestGatewayVertex(square, { x: 12.5, y: 37.5 }), { x: 25, y: 50 });
  const fractional = Object.freeze({ type: "bpmn:Gateway", x: 0.125, y: 0.375, width: 43.25, height: 61.5 });
  const pointer = Object.freeze({ x: 50.1, y: 31.2, original: Object.freeze({ x: 52, y: 34 }) });
  assert.deepEqual(nearestGatewayVertex(fractional, pointer), { x: 43.375, y: 31.125 });
  assert.deepEqual(pointer.original, { x: 52, y: 34 });
  for (const n of [{ ...shape, type: "bpmn:Task" }, { ...shape, width: 0 }, { ...shape, y: NaN }])
    assert.throws(() => nearestGatewayVertex(n, { x: 1, y: 2 }));
  assert.throws(() => nearestGatewayVertex(shape, { x: Infinity, y: 0 }));
});

test("the actual shared native harness changes Gateway projection only, retaining free Task/Event input", () => {
  const h = createAnchorHarness({ port: 1, output: "/tmp/no-native-oracle-launch" });
  assert.deepEqual(h.projected(shape, { x: 603, y: 244 }), vertices[1]);
  assert.deepEqual(h.projected(shape, { x: 590, y: 232 }), vertices[0]);
  assert.deepEqual(h.side(shape, "right", 0.74), { x: 603, y: 244 },
    "the sloped native approach remains a real policy challenge, not rewritten setup");
  const task = { type: "bpmn:Task", x: 320, y: 192, width: 100, height: 80 };
  assert.deepEqual(h.projected(task, { x: 419.125, y: 208.75 }), { x: 420, y: 208.75 });
  assert.deepEqual(h.side(task, "right", 0.333), { x: 420, y: 218.64 });
  const circle = { type: "bpmn:IntermediateThrowEvent", x: 312, y: 394, width: 36, height: 36 };
  assert.deepEqual(h.projected(circle, { x: 343, y: 425 }),
    { x: 342.72792206135784, y: 424.72792206135784 });
  assert.equal(h.results.length, 0);
});

test("only the reviewed Gateway oracle additions differ from the accepted native39/factory bodies", async () => {
  const additions = [
    '\nimport { nearestGatewayVertex, assertGatewayVertex } from "../helpers/gateway-native-oracle.mjs";',
    '      input: window.anchorInput.findLast((event) => event.type === "mousemove"),\n',
    `  if (node(before, id).type.endsWith("Gateway")) {
    assert.equal(evidence.input?.trusted, true);
    assert.deepEqual(evidence.anchor,
      nearestGatewayVertex(node(before, id), evidence.input.graphPoint),
      "Gateway marker follows the nearest vertex to the actual delivered pointer");
  } else
`,
    '  if (n.type.endsWith("Gateway")) return nearestGatewayVertex(n, p);\n',
    `  if (before.engine === "local") {
    const sourceNode = node(before, source);
    if (sourceNode.type.endsWith("Gateway")) assertGatewayVertex(sourceNode, edge.points[0]);
    if (targetNode.type.endsWith("Gateway"))
      assert.deepEqual(edge.points.at(-1), expectedTarget,
        "Gateway target is the exact nearest vertex to the delivered release");
  }
`,
  ];
  for (const [file, expected] of [
    ["./browser-anchor-ux.mjs", "d72578ae9c9900367734faaba7ad73ea40bec1df274197d3dde4996ff54a7c23"],
    ["../helpers/anchor-ux-browser.mjs", "c128050f658b7d2a9a2492431dd48b43f0dbdb5694d93213a25fe40d23f07082"],
  ]) {
    let source = await readFile(new URL(file, import.meta.url), "utf8");
    for (const addition of additions) {
      assert.equal(source.split(addition).length, 2, `one exact Gateway delta in ${file}`);
      source = source.replace(addition, "");
    }
    assert.equal(digest(source), expected, "all other native setup, geometry, history and lifecycle bytes retained");
  }
});
