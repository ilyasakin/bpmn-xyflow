import assert from "node:assert/strict";

/** Native coordinates are integer CSS pixels; tether anchors do not track. */
export function assertSourcePortApproach({ evidence, reached, pressPoint, projectedPoint }) {
  assert.equal(reached.delivered?.trusted, true);
  assert.deepEqual({ x: reached.delivered.x, y: reached.delivered.y }, pressPoint);
  assert.equal(reached.hit, true, "the delivered integer point hits this source handle");
  assert.deepEqual(pressPoint, {
    x: Math.round(evidence.grabScreen.x),
    y: Math.round(evidence.grabScreen.y),
  });
  if (evidence.dockingVisible) {
    assert.deepEqual(
      reached.anchor,
      evidence.anchor,
      "approaching a displaced tether preserves its exact docking point",
    );
  } else {
    for (const axis of ["x", "y"]) {
      assert.ok(Number.isFinite(projectedPoint[axis]) && Number.isFinite(reached.anchor[axis]));
      assert.ok(
        Math.abs(reached.anchor[axis] - projectedPoint[axis]) <= 1e-7,
        "the coincident marker follows the exact final delivered native point",
      );
    }
  }
}

/** Authored reference case only: two aligned grid-positioned 100x80 Tasks. */
export function referenceTaskTopConnectExpectation(source, target, delivered) {
  for (const shape of [source, target]) {
    assert.equal(shape.type, "bpmn:Task");
    assert.deepEqual([shape.width, shape.height], [100, 80]);
    assert.ok(Number.isFinite(shape.x) && Number.isFinite(shape.y));
    assert.equal(shape.x % 10, 0);
    assert.equal(shape.y % 10, 0);
  }
  assert.equal(source.y, target.y);
  assert.ok(target.x > source.x + source.width);
  assert.deepEqual(
    delivered,
    { x: target.x + target.width / 2, y: target.y },
    "this oracle covers the exact native top-midpoint drop",
  );
  // BpmnConnectSnapping1250: Task padding10, interior x snaps to midpoint;
  // SequenceFlow start resets to source midpoint. Grid1200 changes neither axis.
  return {
    connectionStart: { x: source.x + source.width / 2, y: source.y + source.height / 2 },
    connectionEnd: { x: target.x + target.width / 2, y: target.y + 10 },
  };
}
