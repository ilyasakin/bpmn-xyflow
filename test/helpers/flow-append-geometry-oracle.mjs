import assert from 'node:assert/strict';

// Only these four authored native fixtures use this oracle. Placement and
// ownership must agree exactly; the explicit precision policy differs only at
// the annotation rectangle: local retains the analytical intersection, while
// pinned CroppingConnectionDocking.getElementLineIntersection rounds it.
export function assertFlowAppendGeometry(outputs, { ownerId, mode }) {
  assert.ok([ 'ApproveFlow', 'OrderMessage' ].includes(ownerId), 'known append owner');
  assert.ok([ 'click', 'drag' ].includes(mode), 'known append action');
  const source = ownerId === 'ApproveFlow' ? { x: 900, y: 348 } : { x: 126.5, y: 225 };
  const owner = ownerId === 'ApproveFlow' ? 'ApprovalProcess' : 'OrderCollaboration';
  const bounds = mode === 'drag' ? { x: 980, y: 720, width: 100, height: 40 }
    : ownerId === 'ApproveFlow' ? { x: 950, y: 270, width: 100, height: 40 }
      : { x: 180, y: 260, width: 100, height: 40 };
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const dx = source.x - center.x, dy = source.y - center.y;
  const scale = Math.min(bounds.width / 2 / Math.abs(dx), bounds.height / 2 / Math.abs(dy));
  assert.ok(scale < 1, 'known fixture has an external source');
  const intersection = { x: center.x + dx * scale, y: center.y + dy * scale };
  const rounded = { x: Math.round(intersection.x), y: Math.round(intersection.y) };
  for (const engine of [ 'local', 'upstream' ]) {
    const output = outputs[engine];
    assert.ok(output, `${engine} append result exists`);
    assert.deepEqual(Object.keys(output).sort(), [ 'bounds', 'owner', 'points' ]);
    assert.equal(output.owner, owner, `${engine} exact semantic owner`);
    assert.deepEqual(output.bounds, bounds, `${engine} exact native placement`);
    assert.equal(output.points.length, 2, `${engine} automatic association has two points`);
    assert.deepEqual(output.points[0], source, `${engine} exact half-path source`);
    const target = output.points[1];
    assert.deepEqual(Object.keys(target).sort(), [ 'x', 'y' ]);
    if (engine === 'upstream') assert.deepEqual(target, rounded, 'upstream exact rounded rectangle crop');
    else for (const axis of [ 'x', 'y' ]) assert.ok(Number.isFinite(target[axis]) && Math.abs(target[axis] - intersection[axis]) < 1e-9,
      `local ${axis} retains the independent analytical intersection: ${target[axis]} vs ${intersection[axis]}`);
  }
  return { intersection, rounded };
}
