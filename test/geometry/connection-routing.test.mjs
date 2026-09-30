import test from "node:test";
import assert from "node:assert/strict";
import { loadRuleModule } from "../helpers/upstream-rules.mjs";
import { BpmnModdle } from "../../lib/bpmn/moddle.js";

const routing = await loadRuleModule("lib/modeling/ConnectionRouting.js");
const { default: Upstream } = await loadRuleModule(
  "node_modules/bpmn-js/lib/features/modeling/BpmnLayouter.js",
);
const { default: Renderer } = await loadRuleModule("lib/draw/BpmnRenderer.js");
const { layoutConnection, planSegmentMove, remapDocking, projectDocking, cropConnection } = routing;
const model = new BpmnModdle();
const shape = (type, x, y, width = 100, height = 80) => ({
  type: "bpmn:" + type,
  x,
  y,
  width,
  height,
  businessObject: model.create("bpmn:" + type),
  di: {},
});
const edge = (source, target, waypoints = [], type = "SequenceFlow") => ({
  type: "bpmn:" + type,
  source,
  target,
  waypoints,
  businessObject: model.create("bpmn:" + type),
});
const xy = (points) => points.map(({ x, y }) => ({ x, y }));
const orthogonal = (points) =>
  points
    .slice(1)
    .every((p, i) => Math.abs(p.x - points[i].x) < 1e-7 || Math.abs(p.y - points[i].y) < 1e-7);
const renderer = { getShapePath: Renderer.prototype.getShapePath };
const close = (a, b, tolerance = 1e-7) =>
  assert.ok(
    Math.hypot(a.x - b.x, a.y - b.y) < tolerance,
    `${JSON.stringify(a)} != ${JSON.stringify(b)}`,
  );

// Oracle is the separately bundled pinned upstream package, not our own helper.
for (const [name, source, target, type] of [
  ["task horizontal", shape("Task", 100, 100), shape("Task", 400, 100), "SequenceFlow"],
  ["task diagonal", shape("Task", 100, 100), shape("Task", 400, 300), "SequenceFlow"],
  [
    "gateway outgoing",
    shape("ExclusiveGateway", 100, 100, 50, 50),
    shape("Task", 400, 300),
    "SequenceFlow",
  ],
  [
    "gateway incoming",
    shape("Task", 100, 100),
    shape("ParallelGateway", 400, 300, 50, 50),
    "SequenceFlow",
  ],
  ["message flow", shape("Task", 100, 100), shape("Task", 400, 300), "MessageFlow"],
  ["association", shape("Task", 100, 100), shape("TextAnnotation", 400, 300), "Association"],
  [
    "expanded subprocess",
    shape("SubProcess", 100, 100, 200, 160),
    shape("Task", 400, 300),
    "SequenceFlow",
  ],
])
  test("upstream layouter oracle: " + name, () => {
    const connection = edge(source, target, [], type),
      oracle = new Upstream({ find: () => undefined });
    assert.deepEqual(xy(layoutConnection(connection)), xy(oracle.layoutConnection(connection)));
  });

test("source and target moves repair adjacent legs and preserve manual interior bends", () => {
  const source = shape("Task", 100, 150),
    target = shape("Task", 500, 300);
  const original = [
    { x: 200, y: 140 },
    { x: 280, y: 140 },
    { x: 280, y: 270 },
    { x: 400, y: 270 },
    { x: 400, y: 340 },
    { x: 500, y: 340 },
  ];
  const connection = edge(source, target, original),
    snapshot = structuredClone(connection.waypoints);
  const hints = { connectionStart: { x: 200, y: 190 } };
  assert.deepEqual(
    xy(layoutConnection(connection, hints)),
    xy(new Upstream({ find: () => undefined }).layoutConnection(connection, hints)),
  );
  const actual = layoutConnection(connection, hints);
  assert.deepEqual(actual[1], { x: 280, y: 190 });
  assert.deepEqual(actual.slice(2), original.slice(2));
  assert.deepEqual(connection.waypoints, snapshot);
  assert.ok(orthogonal(actual));
  const both = layoutConnection(connection, {
    connectionStart: { x: 200, y: 190 },
    connectionEnd: { x: 500, y: 390 },
  });
  assert.ok(orthogonal(both));
  assert.deepEqual(xy(both)[0], { x: 200, y: 190 });
  assert.deepEqual(xy(both).at(-1), { x: 500, y: 390 });
});

test("unchanged imported manual route has no cleanup, precision, or metadata drift", () => {
  const points = [
    { x: 100.125, y: 40.875, original: { x: 60.125, y: 40.875 } },
    { x: 150.625, y: 40.875 },
    { x: 200.25, y: 40.875 },
  ];
  const connection = edge(shape("Task", 0, 0), shape("Task", 200, 0), points);
  const actual = layoutConnection(connection, {}, renderer);
  assert.deepEqual(actual, points);
  assert.notEqual(actual, points);
  assert.notEqual(actual[0], points[0]);
  assert.notEqual(actual[0].original, points[0].original);
});

test("task anchors retain chosen side fractions rather than reset to center", () => {
  const source = shape("Task", 100.25, 100.5),
    target = shape("Task", 430.25, 270.5);
  const start = { x: 124.625, y: 100.5 },
    end = { x: 430.25, y: 331.375 };
  const result = layoutConnection(
    edge(source, target),
    { connectionStart: start, connectionEnd: end, preserveDocking: "both" },
    renderer,
  );
  close(result[0], start);
  close(result.at(-1), end);
  assert.ok(orthogonal(result));
  assert.notEqual(result[0].x, source.x + source.width / 2);
  close(projectDocking(source, { x: start.x, y: start.y + 5 }), start);
});

test("event, gateway, and task-corner explicit anchor coordinates survive routing", () => {
  const event = shape("StartEvent", 100, 100, 36, 36),
    gateway = shape("ExclusiveGateway", 300, 220, 50, 50);
  const start = { x: 118 + 18 / Math.sqrt(2), y: 118 - 18 / Math.sqrt(2) },
    end = { x: 312.5, y: 232.5 };
  const result = layoutConnection(edge(event, gateway), {
    connectionStart: start,
    connectionEnd: end,
    preserveDocking: "both",
  });
  close(result[0], start);
  close(result.at(-1), end);
  assert.ok(orthogonal(result));
  const task = shape("Task", 100, 100),
    corner = projectDocking(task, { x: 100, y: 100 });
  close(corner, { x: 110 - 10 / Math.sqrt(2), y: 110 - 10 / Math.sqrt(2) });
  const custom = projectDocking(event, start, renderer);
  close(custom, start, 0.02); // retained SVG circle is a cubic approximation
});

test("same-shape loop stays outside shape with distinct chosen dockings", () => {
  const task = shape("Task", 100, 100),
    start = { x: 200, y: 140 },
    end = { x: 145, y: 100 };
  const route = layoutConnection(edge(task, task), {
    connectionStart: start,
    connectionEnd: end,
    preserveDocking: "both",
  });
  close(route[0], start);
  close(route.at(-1), end);
  assert.ok(orthogonal(route));
  assert.ok(route.length >= 4);
  assert.ok(route.slice(1, -1).every((p) => p.x >= 200 || p.y <= 100 || p.x <= 100 || p.y >= 180));
});

test("two-point segment slides within shapes and grows a dogleg outside", () => {
  const source = shape("Task", 100, 100),
    target = shape("Task", 400, 100);
  const connection = edge(source, target, [
    { x: 200, y: 140 },
    { x: 400, y: 140 },
  ]);
  const snapshot = structuredClone(connection.waypoints);
  const near = planSegmentMove(connection, 0, { x: 800, y: 15 });
  close(near[0], { x: 200, y: 155 });
  close(near.at(-1), { x: 400, y: 155 });
  assert.equal(near.length, 2);
  const far = planSegmentMove(connection, 0, { x: 0, y: 90 });
  assert.ok(orthogonal(far));
  assert.equal(far.length, 4);
  close(far[0], { x: 150, y: 180 });
  close(far.at(-1), { x: 450, y: 180 });
  assert.equal(far[1].y, 230);
  assert.equal(far[2].y, 230);
  assert.deepEqual(connection.waypoints, snapshot);
});

test("internal segment moves preserve unrelated bends and decimal precision", () => {
  const connection = edge(shape("Task", 100, 100), shape("Task", 500, 200), [
    { x: 200, y: 140 },
    { x: 280.375, y: 140 },
    { x: 280.375, y: 240 },
    { x: 500, y: 240 },
  ]);
  const result = planSegmentMove(connection, 1, { x: 12.125, y: 999 });
  assert.ok(orthogonal(result));
  assert.equal(result[1].x, 292.5);
  assert.equal(result[2].x, 292.5);
  close(result[0], connection.waypoints[0]);
  close(result.at(-1), connection.waypoints.at(-1));
  assert.deepEqual(planSegmentMove(connection, 1, { x: 0, y: 999 }), connection.waypoints);
});

test("resize docking uses original fractional bounds and preserves logical docking metadata", () => {
  const before = { x: 100.25, y: 200.75, width: 100, height: 80 },
    after = { x: 50.25, y: 190.75, width: 175, height: 120 };
  const original = { x: 200.25, y: 220.75, original: { x: 150.25, y: 220.75 } };
  const result = remapDocking(original, before, after);
  assert.deepEqual(result, { x: 225.25, y: 220.75, original: { x: 137.75, y: 220.75 } });
  assert.deepEqual(remapDocking(original, before, before), original);
  for (let i = 0; i < 30; i++) assert.deepEqual(remapDocking(original, before, after), result);
});

test("cropping circle and diamond keeps axis-aligned tangent fraction without integer rounding", () => {
  const source = shape("StartEvent", 100, 100, 36, 36),
    target = shape("ExclusiveGateway", 300, 100, 50, 50);
  const y = 112.25;
  const result = cropConnection(
    [
      { x: 118, y },
      { x: 325, y },
    ],
    source,
    target,
    renderer,
  );
  assert.equal(result[0].y, y);
  assert.equal(result.at(-1).y, y);
  assert.ok(result[0].x > 130 && result[0].x < 136);
  assert.ok(result.at(-1).x > 300 && result.at(-1).x < 325);
  assert.ok(orthogonal(result));
});

test("upstream boundary-event layouts match side/corner, host-loop and vertical pools", () => {
  let cases = 0;
  for (const horizontal of [true, false]) {
    const parent = shape("Participant", 0, 0, 800, 700);
    parent.di.isHorizontal = horizontal;
    const host = shape("Task", 300, 300);
    host.parent = parent;
    for (const [cx, cy] of [
      [300, 300],
      [350, 300],
      [400, 300],
      [400, 340],
      [400, 380],
      [350, 380],
      [300, 380],
      [300, 340],
    ]) {
      const source = shape("BoundaryEvent", cx - 18, cy - 18, 36, 36);
      source.host = host;
      source.parent = parent;
      for (const [tx, ty] of [
        [100, 100],
        [350, 100],
        [600, 100],
        [600, 300],
        [600, 500],
        [350, 500],
        [100, 500],
        [100, 300],
      ]) {
        const target = shape("Task", tx, ty);
        target.parent = parent;
        const connection = edge(source, target),
          oracle = new Upstream({ find: () => undefined });
        assert.deepEqual(
          xy(layoutConnection(connection)),
          xy(oracle.layoutConnection(connection)),
          `${horizontal}/${cx},${cy}/${tx},${ty}`,
        );
        cases++;
      }
      const connection = edge(source, host),
        oracle = new Upstream({ find: () => undefined });
      assert.deepEqual(xy(layoutConnection(connection)), xy(oracle.layoutConnection(connection)));
      cases++;
    }
  }
  assert.equal(cases, 144);
});

test("pinned reconnect preserves unrelated manual bends and opposite pointer docking", () => {
  const source = shape("Task", 100, 100),
    target = shape("Task", 600, 300);
  const points = [
    { x: 200, y: 120 },
    { x: 260, y: 120 },
    { x: 260, y: 240 },
    { x: 520, y: 240 },
    { x: 520, y: 350 },
    { x: 600, y: 350 },
  ];
  const route = layoutConnection(edge(source, target, points), {
    connectionStart: { x: 200, y: 145 },
    connectionEnd: points.at(-1),
    preserveDocking: "both",
  });
  close(route[0], { x: 200, y: 145 });
  close(route.at(-1), points.at(-1));
  assert.deepEqual(route.slice(2), points.slice(2));
  assert.ok(orthogonal(route));
});

test("backwards-side creation keeps both right ports and routes around endpoint shapes", () => {
  const crosses = (a, b, s) =>
    a.x === b.x
      ? a.x > s.x &&
        a.x < s.x + s.width &&
        Math.max(Math.min(a.y, b.y), s.y) < Math.min(Math.max(a.y, b.y), s.y + s.height)
      : a.y > s.y &&
        a.y < s.y + s.height &&
        Math.max(Math.min(a.x, b.x), s.x) < Math.min(Math.max(a.x, b.x), s.x + s.width);
  for (const offset of [0, 15, 80, -80]) {
    const source = shape("Task", 500, 100),
      target = shape("Task", 100, 100 + offset);
    const start = { x: 600, y: 127.75 },
      end = { x: 200, y: 127.75 + offset };
    const result = layoutConnection(
      edge(source, target),
      { connectionStart: start, connectionEnd: end, preserveDocking: "both" },
      renderer,
    );
    close(result[0], start);
    close(result.at(-1), end);
    assert.ok(orthogonal(result));
    assert.ok(result[1].x > start.x);
    assert.ok(result.at(-2).x > end.x);
    for (let i = 1; i < result.length; i++) {
      assert.equal(crosses(result[i - 1], result[i], source), false, JSON.stringify(result));
      assert.equal(crosses(result[i - 1], result[i], target), false, JSON.stringify(result));
    }
  }
});

test("all chosen task side pairs route outside close and separated endpoint rectangles", () => {
  const ports = (s) => [
    { x: s.x, y: s.y + 40 },
    { x: s.x + s.width, y: s.y + 40 },
    { x: s.x + 50, y: s.y },
    { x: s.x + 50, y: s.y + s.height },
  ];
  const intersects = (a, b, s) =>
    a.x === b.x
      ? a.x > s.x &&
        a.x < s.x + s.width &&
        Math.max(Math.min(a.y, b.y), s.y) < Math.min(Math.max(a.y, b.y), s.y + s.height)
      : a.y > s.y &&
        a.y < s.y + s.height &&
        Math.max(Math.min(a.x, b.x), s.x) < Math.min(Math.max(a.x, b.x), s.x + s.width);
  for (const [x, y] of [
    [210, 100],
    [500, 100],
    [500, 350],
    [100, 190],
  ]) {
    const source = shape("Task", 100, 100),
      target = shape("Task", x, y);
    for (const start of ports(source))
      for (const end of ports(target)) {
        const result = layoutConnection(edge(source, target), {
          connectionStart: start,
          connectionEnd: end,
          preserveDocking: "both",
        });
        close(result[0], start);
        close(result.at(-1), end);
        assert.ok(orthogonal(result));
        for (let i = 1; i < result.length; i++)
          for (const s of [source, target])
            assert.equal(
              intersects(result[i - 1], result[i], s),
              false,
              JSON.stringify({ start, end, result }),
            );
      }
  }
});

test("actual upstream layouter plus CroppingConnectionDocking agrees on visible default routes", async () => {
  const { default: Docking } = await loadRuleModule(
    "node_modules/diagram-js/lib/layout/CroppingConnectionDocking.js",
  );
  const docking = new Docking(
    {},
    {
      getShapePath: renderer.getShapePath,
      getConnectionPath: (connection) =>
        connection.waypoints.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(""),
    },
  );
  const oracle = new Upstream({ find: () => undefined });
  for (const type of ["Task", "StartEvent", "ExclusiveGateway"])
    for (const offset of [0, 53, 180]) {
      const size = type === "Task" ? [100, 80] : type === "StartEvent" ? [36, 36] : [50, 50];
      const source = shape(type, 100, 100, ...size),
        target = shape("Task", 400, 100 + offset);
      const connection = edge(source, target),
        raw = oracle.layoutConnection(connection);
      const expected = docking.getCroppedWaypoints({ ...connection, waypoints: raw });
      const actual = layoutConnection(connection, {}, renderer);
      assert.equal(actual.length, expected.length);
      for (let i = 0; i < actual.length; i++)
        close(actual[i], expected[i], i === 0 || i === actual.length - 1 ? 0.8 : 1e-9);
      // Upstream intentionally rounds visible dockings to integer pixels. Our
      // exact outline math is bounded by that rounding, while retaining decimals.
    }
});

test("fractional narrow shapes retain all chosen side pairs without rounding or input mutation", () => {
  const source = shape("Task", 100.125, 100.625, 12, 18),
    target = shape("Task", 112.875, 100.625, 12, 18);
  const ports = (s) => [
    { x: s.x, y: s.y + s.height / 2 },
    { x: s.x + s.width, y: s.y + s.height / 2 },
    { x: s.x + s.width / 2, y: s.y },
    { x: s.x + s.width / 2, y: s.y + s.height },
  ];
  for (const start of ports(source))
    for (const end of ports(target)) {
      const input = edge(source, target);
      const before = JSON.stringify(input);
      const actual = layoutConnection(input, {
        connectionStart: start,
        connectionEnd: end,
        preserveDocking: "both",
      });
      close(actual[0], start);
      close(actual.at(-1), end);
      assert.ok(orthogonal(actual));
      assert.equal(JSON.stringify(input), before);
    }
});

test("same-shape same-port loop has a visible enclosed detour and stable exact docking", () => {
  const source = shape("Task", 100.125, 100.625),
    start = { x: 200.125, y: 140.625 };
  const result = layoutConnection(edge(source, source), {
    connectionStart: start,
    connectionEnd: start,
    preserveDocking: "both",
  });
  close(result[0], start);
  close(result.at(-1), start);
  assert.ok(orthogonal(result));
  assert.ok(new Set(result.map((p) => p.x)).size >= 3);
  assert.ok(new Set(result.map((p) => p.y)).size >= 2);
  assert.deepEqual(
    result,
    layoutConnection(edge(source, source), {
      connectionStart: start,
      connectionEnd: start,
      preserveDocking: "both",
    }),
  );
});

test("stock start/end/boundary non-square events match renderer width-based circle radius", () => {
  for (const type of ["StartEvent", "EndEvent", "BoundaryEvent"]) {
    const source = shape(type, 100.125, 120.375, 36, 60);
    const c = { x: 118.125, y: 150.375 },
      top = { x: c.x, y: c.y - 18 };
    close(projectDocking(source, { x: c.x, y: source.y }, renderer), top);
    const path = renderer.getShapePath(source);
    assert.ok(path.includes("18,18"));
    const actual = cropConnection([c, { x: c.x, y: c.y - 100 }], source, null, renderer);
    close(actual[0], top);
  }
  const task = shape("Task", 100.125, 120.375, 80, 60);
  const corner = projectDocking(task, { x: task.x, y: task.y }, renderer);
  close(corner, { x: task.x + 10 - 10 / Math.sqrt(2), y: task.y + 10 - 10 / Math.sqrt(2) });
});

test("overlapping inaccessible ports reject deterministically without changing inputs", () => {
  const source = shape("Task", 100.125, 100.625),
    target = shape("Task", 150.125, 100.625);
  const input = edge(source, target),
    start = { x: 200.125, y: 140.625 },
    end = { x: 150.125, y: 140.625 };
  const before = JSON.stringify(input);
  for (let i = 0; i < 3; i++)
    assert.throws(
      () =>
        layoutConnection(input, {
          connectionStart: start,
          connectionEnd: end,
          preserveDocking: "both",
        }),
      (error) => error.code === "UNROUTABLE_DOCKING",
    );
  assert.equal(JSON.stringify(input), before);
  // Overlapping bounds do not prohibit exposed ports on the outer perimeter.
  const safe = layoutConnection(input, {
    connectionStart: { x: 100.125, y: 140.625 },
    connectionEnd: { x: 250.125, y: 140.625 },
    preserveDocking: "both",
  });
  close(safe[0], { x: 100.125, y: 140.625 });
  close(safe.at(-1), { x: 250.125, y: 140.625 });
  assert.ok(orthogonal(safe));
});
