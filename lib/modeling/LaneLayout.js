/** Pure lane layout matching BPMN's 30px nested lane header indentation. */
export function horizontalLane(shape) { return !shape.di || shape.di.isHorizontal !== false; }
export function laneSplitBounds(shape, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('lane count must be a positive integer');
  const horizontal = horizontalLane(shape), total = horizontal ? shape.height : shape.width;
  const unit = Math.round(total / count);
  return Array.from({ length: count }, (_, index) => {
    const size = index === count - 1 ? total - unit * index : unit;
    return horizontal ? { x: shape.x + 30, y: shape.y + unit * index, width: shape.width - 30, height: size }
      : { x: shape.x + unit * index, y: shape.y + 30, width: size, height: shape.height - 30 };
  });
}
export function laneDeletionBounds(lane, siblings) {
  const horizontal = horizontalLane(lane), position = horizontal ? 'y' : 'x', size = horizontal ? 'height' : 'width';
  const before = siblings.filter(sibling => sibling[position] < lane[position]).sort((a, b) => a[position] - b[position]).at(-1);
  const after = siblings.filter(sibling => sibling[position] > lane[position]).sort((a, b) => a[position] - b[position])[0];
  const grow = before && after ? lane[size] / 2 : lane[size];
  const result = [];
  if (before) result.push({ node: before, bounds: { x: before.x, y: before.y, width: before.width, height: before.height, [size]: before[size] + grow } });
  if (after) result.push({ node: after, bounds: { x: after.x, y: after.y, width: after.width, height: after.height, [position]: after[position] - grow, [size]: after[size] + grow } });
  return result;
}
