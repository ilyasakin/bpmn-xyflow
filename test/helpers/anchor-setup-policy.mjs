/** Read-only setup policy; does not move the viewport or consume a native event. */
export function nativeWheelStepBudget(start, wanted) {
  if (![start, wanted].every((value) => Number.isFinite(value) && value > 0))
    throw new Error("Finite positive zoom required");
  // Installed XYFlow uses deltaY * .002 on Linux. Ctrl accelerates only on Mac.
  // A 60px wheel tick therefore changes log(zoom) by .12 * ln(2).
  return Math.min(64, Math.ceil(Math.abs(Math.log(wanted / start)) / (0.12 * Math.LN2)) + 2);
}

export function collectReferenceClickTrapCount() {
  const bus = window.referenceModeler.get("eventBus");
  let count = 0;
  for (let listener = bus._listeners["element.click"]; listener; listener = listener.next) {
    if (
      listener.priority === 5000 &&
      !listener.callback.__isTomb &&
      listener.callback.__fn?.name === "trap"
    )
      count++;
  }
  return count;
}

/** Exact Conditional fixture case: the moved row crosses T1's rounded corner. */
export function conditionalSegmentExpectation({
  source,
  target,
  originalStart,
  pressY,
  releaseY,
  zoom,
}) {
  const row = originalStart.y + (releaseY - pressY) / zoom;
  const radius = 10,
    corner = { x: source.x + source.width - radius, y: source.y + source.height - radius };
  const bottom = { x: target.x + target.width / 2, y: target.y + target.height };
  if (!(row > corner.y && row < source.y + source.height && row > bottom.y))
    throw new Error(
      "Conditional native setup must place the moved row on T1’s rounded lower-right corner and below the gateway",
    );
  return [
    { x: corner.x + Math.sqrt(radius * radius - (row - corner.y) ** 2), y: row },
    { x: bottom.x, y: row },
    bottom,
  ];
}
