import assert from "node:assert/strict";

/** User interaction contract, independent of the production routing helpers. */
export function gatewayVertices(shape) {
  assert.ok(shape.type?.endsWith("Gateway"), "the fixed-vertex oracle applies only to Gateways");
  assert.ok([shape.x, shape.y, shape.width, shape.height].every(Number.isFinite));
  assert.ok(shape.width > 0 && shape.height > 0);
  const centerX = shape.x + shape.width / 2;
  const centerY = shape.y + shape.height / 2;
  return [
    { x: centerX, y: shape.y },
    { x: shape.x + shape.width, y: centerY },
    { x: centerX, y: shape.y + shape.height },
    { x: shape.x, y: centerY },
  ];
}

export function nearestGatewayVertex(shape, pointer) {
  assert.ok(pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y));
  // Ordered strict comparison defines the requested top/right/bottom/left tie rule.
  let nearest, distance = Infinity;
  for (const vertex of gatewayVertices(shape)) {
    const candidate = (vertex.x - pointer.x) ** 2 + (vertex.y - pointer.y) ** 2;
    if (candidate < distance) {
      nearest = vertex;
      distance = candidate;
    }
  }
  return nearest;
}

export function assertGatewayVertex(shape, actual) {
  assert.ok(actual && gatewayVertices(shape).some(p => p.x === actual.x && p.y === actual.y),
    `edited Gateway endpoint must be an exact vertex: ${JSON.stringify({ shape, actual })}`);
}
