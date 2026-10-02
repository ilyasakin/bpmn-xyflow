/** Read-only DOM geometry and native actions for immediate same-pointer ownership. */
export const anchorOwnershipPositions = ["n", "e", "s", "w", "nw", "ne", "se", "sw"];

export function roundedTaskPoint(bounds, radius, direction) {
  const { x, y, width: w, height: h } = bounds;
  if (!(radius > 0 && radius <= Math.min(w, h) / 2))
    throw new Error("Painted Task corner radius required");
  if (direction === "n") return { x: x + w / 2, y };
  if (direction === "e") return { x: x + w, y: y + h / 2 };
  if (direction === "s") return { x: x + w / 2, y: y + h };
  if (direction === "w") return { x, y: y + h / 2 };
  if (!["nw", "ne", "se", "sw"].includes(direction))
    throw new Error("Unknown Task perimeter position");
  const east = direction.includes("e"),
    south = direction.includes("s"),
    diagonal = radius / Math.sqrt(2);
  return {
    x: x + (east ? w - radius + diagonal : radius - diagonal),
    y: y + (south ? h - radius + diagonal : radius - diagonal),
  };
}

export function projectRoundedTask(bounds, radius, point) {
  const { x, y, width: w, height: h } = bounds,
    r = radius;
  if (!(r > 0 && r <= Math.min(w, h) / 2)) throw new Error("Painted Task corner radius required");
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const candidates = [
    { x: clamp(point.x, x + r, x + w - r), y },
    { x: x + w, y: clamp(point.y, y + r, y + h - r) },
    { x: clamp(point.x, x + r, x + w - r), y: y + h },
    { x, y: clamp(point.y, y + r, y + h - r) },
  ];
  for (const [cx, cy, start, end] of [
    [x + r, y + r, Math.PI, Math.PI * 1.5],
    [x + w - r, y + r, Math.PI * 1.5, Math.PI * 2],
    [x + w - r, y + h - r, 0, Math.PI / 2],
    [x + r, y + h - r, Math.PI / 2, Math.PI],
  ]) {
    let angle = Math.atan2(point.y - cy, point.x - cx);
    if (angle < 0) angle += Math.PI * 2;
    if (start > Math.PI && angle === 0) angle = Math.PI * 2;
    angle = clamp(angle, start, end);
    candidates.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return candidates.sort(
    (a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y),
  )[0];
}

/** No initial move is permitted: the second press owns the CURRENT native point. */
export async function dragFromCurrentPointer(page, target, capture) {
  await page.mouse.down();
  try {
    await page.mouse.move(target.x, target.y, { steps: 12 });
    if (capture) await capture();
  } finally {
    await page.mouse.up();
  }
}

export async function observeOwnershipInput(page) {
  await page.evaluate(() => {
    window.anchorOwnershipInput = [];
    for (const type of ["mousemove", "mousedown", "mouseup"])
      window.addEventListener(
        type,
        (event) => {
          const target = event.target instanceof Element ? event.target : null;
          window.anchorOwnershipInput.push({
            type,
            trusted: event.isTrusted,
            x: event.clientX,
            y: event.clientY,
            tag: target?.tagName,
            classes: target?.getAttribute("class"),
            connectOwner:
              target?.closest(".bpmn-xyflow-connect-handle")?.getAttribute("data-connect-source") ||
              null,
            resizeDirection:
              target?.closest("[data-resize-dir]")?.getAttribute("data-resize-dir") || null,
            elementId:
              target?.closest("[data-element-id]")?.getAttribute("data-element-id") || null,
          });
        },
        { capture: true, passive: true },
      );
  });
}

export async function collectOwnershipControl(page, id, point = null) {
  return page.evaluate(
    ({ id, point }) => {
      const handles = [...document.querySelectorAll(".bpmn-xyflow-connect-handle")].filter(
          (e) => e.getAttribute("data-connect-source") === id,
        ),
        handle = handles[0],
        port = handle?.querySelector(".bpmn-xyflow-connect-port"),
        docking = [...document.querySelectorAll(".bpmn-xyflow-connect-docking")].find(
          (e) => e.getAttribute("data-connect-source") === id,
        ),
        marker = docking?.querySelector(".bpmn-xyflow-connect-docking-point");
      const xy = (e) => e && { x: Number(e.getAttribute("cx")), y: Number(e.getAttribute("cy")) };
      const visible = (e) => {
        if (!e?.isConnected) return false;
        for (let n = e; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0)
            return false;
        }
        return true;
      };
      const grab = xy(port),
        matrix = port?.getScreenCTM(),
        transformed = grab && matrix && new DOMPoint(grab.x, grab.y).matrixTransform(matrix);
      const grabScreen = transformed && { x: transformed.x, y: transformed.y },
        probe = point || grabScreen,
        hit = probe && document.elementFromPoint(probe.x, probe.y);
      return {
        count: handles.length,
        anchor: xy(marker),
        grab,
        grabScreen,
        portVisible: visible(port),
        displaced: docking?.getAttribute("visibility") === "visible",
        markerVisible: visible(marker),
        hitOwner:
          hit?.closest(".bpmn-xyflow-connect-handle")?.getAttribute("data-connect-source") || null,
        hitHandle: !!handle && !!hit && (hit === handle || handle.contains(hit)),
        hitClasses: hit?.getAttribute("class") || null,
        resizeDirection: hit?.getAttribute("data-resize-dir") || null,
        delivered: window.anchorInput?.findLast((e) => e.type === "mousemove"),
      };
    },
    { id, point },
  );
}
