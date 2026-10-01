/**
 * Pure connection geometry; the XYFlow modeler owns rendering and transactions.
 *
 * Routing policy verified against bpmn-js 18.30.1 BpmnLayouter. Manhattan repair
 * is delegated to the existing diagram-js 15.14.0 dependency. Segment movement
 * follows its ConnectionSegmentMove algorithm, without event services or pixel
 * rounding. Sources: https://github.com/bpmn-io/bpmn-js/tree/v18.30.1 and
 * https://github.com/bpmn-io/diagram-js/tree/v15.14.0
 *
 * Adapted segment algorithm: Copyright (c) 2014-present Camunda Services GmbH.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import {
  connectPoints,
  repairConnection,
  withoutRedundantPoints,
} from "diagram-js/lib/layout/ManhattanLayout";
import { getIntersections, getOrientation, getConnectionMid } from "diagram-js/lib/layout/LayoutUtil";
import { pointsAligned } from "diagram-js/lib/util/Geometry";
import { getDistancePointLine, perpendicularFoot } from "diagram-js/lib/features/bendpoints/GeometricUtil";
import { findFreePosition, generateGetNextPosition } from "diagram-js/lib/features/auto-place/AutoPlaceUtil";

const point = (value) => value && Number.isFinite(value.x) && Number.isFinite(value.y);
const clone = (p) => ({ ...p, ...(p.original ? { original: { ...p.original } } : {}) });
const copy = (points) => (points || []).map(clone);
const mid = (shape) => ({ x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 });
const is = (shape, name) =>
  shape?.businessObject?.$instanceOf?.("bpmn:" + name) ||
  shape?.type === "bpmn:" + name ||
  (name === "Event" && (shape?.type || "").endsWith("Event")) ||
  (name === "Gateway" && (shape?.type || "").endsWith("Gateway")) ||
  (name === "Activity" && /(?:Task|SubProcess|Transaction|CallActivity)$/.test(shape?.type || ""));
const expanded = (shape) =>
  is(shape, "SubProcess") && shape.di?.isExpanded !== false && !shape.collapsed;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const same = (a, b) => a.x === b.x && a.y === b.y;
const axis = (a, b) => (a.x === b.x ? "x" : a.y === b.y ? "y" : null);

/**
 * Connection endpoints follow bpmn-js18.30.1 + diagram-js15.27.1:
 * LayoutUtil.getConnectionMid, BendpointUtil.getClosestPointOnConnection and
 * BpmnAutoPlaceUtil.getTextAnnotationPosition/GridSnappingAutoPlaceBehavior.
 * The reused runtime AutoPlaceUtil/GeometricUtil algorithms match that pinned
 * version (only import/type suffixes differ). No upstream event engine runs.
 *
 * Shared limitation: native docking uses sharp infinite waypoint lines even
 * when the visible connection has radius5 corners. Do not project onto the
 * rounded paint or clamp a pointer to finite segment ends here.
 */
const connectionEndpoint = shape => !!shape && Object.hasOwn(shape, "waypoints");
function unroutable(message) {
  const error = new Error(message);
  error.code = "UNROUTABLE_DOCKING";
  throw error;
}
function connectionRoute(connection) {
  const route = connection?.waypoints;
  if (!Array.isArray(route) || route.length < 2 || !Array.from(route).every(point) ||
      !route.slice(1).some((p, i) => !same(p, route[i]))) {
    unroutable("A connection endpoint needs a dense, finite, nonzero route");
  }
  return route;
}
export function connectionMidpoint(connection) {
  const route = connectionRoute(connection).filter((p, i, points) => !i || !same(p, points[i - 1]));
  const result = getConnectionMid({ waypoints: route });
  if (!point(result)) unroutable("Connection midpoint is not finite");
  return result;
}
const endpointMid = shape => connectionEndpoint(shape) ? connectionMidpoint(shape) : mid(shape);
function projectConnection(connection, pointer) {
  const route = connectionRoute(connection);
  let best, distance = Infinity;
  for (let i = 1; i < route.length; i++) {
    if (same(route[i - 1], route[i])) continue;
    const segment = [route[i - 1], route[i]], current = getDistancePointLine(pointer, segment);
    if (current < distance) { distance = current; best = segment; }
  }
  if (!best) unroutable("Connection projection is not finite");
  const projected = perpendicularFoot(pointer, best);
  if (!point(projected)) unroutable("Connection projection is not finite");
  return projected;
}

/** Return the annotation center chosen by pinned autoPlace, including grid. */
export function annotationAppendPosition(source, annotation, options = {}) {
  if (!source || !annotation || ![annotation.width, annotation.height].every(value => Number.isFinite(value) && value > 0))
    unroutable("Annotation dimensions must be finite and positive");
  const center = endpointMid(source), h = horizontal(source, options.elements || []);
  if (!point(center)) unroutable("Annotation source has no finite center");
  let position = connectionEndpoint(source)
    ? { x: center.x + 100, y: center.y + (h ? -50 : 50) }
    : { x: source.x + source.width + annotation.width / 2 + (h ? 0 : 50),
        y: h ? source.y - 50 - annotation.height / 2 : source.y + source.height + annotation.height / 2 };
  // GraphEdge does not need diagram-js's eager incoming/outgoing collections.
  // Supply a detached adapter so collision checks cannot mutate graph objects.
  const links = options.edges || [];
  const adapted = { ...source,
    incoming: options.edges ? links.filter(edge => edge.target === source) : source.incoming || [],
    outgoing: options.edges ? links.filter(edge => edge.source === source) : source.outgoing || [] };
  position = findFreePosition(adapted, annotation, position,
    generateGetNextPosition({ [h ? "y" : "x"]: { margin: h ? -30 : 30, minDistance: 20 } }));
  for (const axis of ["x", "y"]) {
    if (position[axis] === center[axis]) continue;
    const offset = -(axis === "x" ? annotation.width : annotation.height) / 2;
    let snapped = Math.round((position[axis] + offset) / 10) * 10;
    if (position[axis]) snapped = position[axis] > center[axis]
      ? Math.max(snapped, Math.ceil((position[axis] + offset) / 10) * 10)
      : Math.min(snapped, Math.floor((position[axis] + offset) / 10) * 10);
    position[axis] = snapped - offset;
  }
  if (!point(position)) unroutable("Annotation placement is not finite");
  return position;
}

/**
 * Same inclusive two-diagram-unit alignment tolerance as diagram-js segment
 * dragging. It is deliberately independent of viewport zoom. Keep this shared
 * by visible handles, line hit behavior, and the actual segment move planner.
 */
export function segmentMoveAxis(a, b) {
  if (!point(a) || !point(b) || same(a, b)) return null;
  const alignment = pointsAligned(a, b);
  return alignment === "v" ? "x" : alignment === "h" ? "y" : null;
}

function shapePath(shape) {
  const { x, y, width: w, height: h } = shape;
  const c = mid(shape);
  if (is(shape, "Event")) {
    const r = w / 2;
    return `M${c.x - r},${c.y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
  if (is(shape, "Gateway")) return `M${c.x},${y}L${x + w},${c.y}L${c.x},${y + h}L${x},${c.y}Z`;
  const r = is(shape, "Activity") ? Math.min(10, w / 2, h / 2) : 0;
  return `M${x + r},${y}H${x + w - r}a${r},${r} 0 0,1 ${r},${r}V${y + h - r}a${r},${r} 0 0,1 ${-r},${r}H${x + r}a${r},${r} 0 0,1 ${-r},${-r}V${y + r}a${r},${r} 0 0,1 ${r},${-r}Z`;
}

function outline(shape, options) {
  return options.getShapePath ? options.getShapePath(shape) : shapePath(shape);
}

/** Nearest outline point. Inputs and output are diagram coordinates, not pixels. */
export function projectDocking(shape, pointer, options = {}) {
  if (!shape || !point(pointer)) throw new Error("A shape and finite docking point are required");
  if (connectionEndpoint(shape)) return projectConnection(shape, pointer);
  const { x, y, width: w, height: h } = shape;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0)
    throw new Error("Shape bounds must be finite and positive");
  const c = mid(shape);
  let dx = pointer.x - c.x,
    dy = pointer.y - c.y;
  if (!dx && !dy) dx = w / 2;
  let projected;
  if (is(shape, "Event")) {
    const length = Math.hypot(dx, dy),
      radius = w / 2;
    projected = { x: c.x + (dx / length) * radius, y: c.y + (dy / length) * radius };
  } else if (is(shape, "Gateway")) {
    // Nearest point on each diamond side, rather than snapping to a vertex.
    const corners = [
      { x: c.x, y },
      { x: x + w, y: c.y },
      { x: c.x, y: y + h },
      { x, y: c.y },
    ];
    projected = corners
      .map((a, i) => {
        const b = corners[(i + 1) % 4],
          vx = b.x - a.x,
          vy = b.y - a.y;
        const t = clamp(
          ((pointer.x - a.x) * vx + (pointer.y - a.y) * vy) / (vx * vx + vy * vy),
          0,
          1,
        );
        return { x: a.x + t * vx, y: a.y + t * vy };
      })
      .sort(
        (a, b) =>
          Math.hypot(a.x - pointer.x, a.y - pointer.y) -
          Math.hypot(b.x - pointer.x, b.y - pointer.y),
      )[0];
  } else {
    const candidates = [
      { x: clamp(pointer.x, x, x + w), y },
      { x: x + w, y: clamp(pointer.y, y, y + h) },
      { x: clamp(pointer.x, x, x + w), y: y + h },
      { x, y: clamp(pointer.y, y, y + h) },
    ];
    projected = candidates.sort(
      (a, b) =>
        Math.hypot(a.x - pointer.x, a.y - pointer.y) - Math.hypot(b.x - pointer.x, b.y - pointer.y),
    )[0];
    // Rounded activity corners: preserve the side fraction, then project only
    // the small corner region to the quarter-circle outline.
    const r = is(shape, "Activity") ? Math.min(10, w / 2, h / 2) : 0;
    if (
      r &&
      (projected.x < x + r || projected.x > x + w - r) &&
      (projected.y < y + r || projected.y > y + h - r)
    ) {
      const corner = {
        x: projected.x < c.x ? x + r : x + w - r,
        y: projected.y < c.y ? y + r : y + h - r,
      };
      const vx = pointer.x - corner.x,
        vy = pointer.y - corner.y,
        length = Math.hypot(vx, vy);
      projected = length
        ? { x: corner.x + (vx / length) * r, y: corner.y + (vy / length) * r }
        : projected;
    }
  }
  if (
    options.getShapePath &&
    !is(shape, "Event") &&
    !is(shape, "Gateway") &&
    !is(shape, "Activity")
  ) {
    // A custom renderer may have a more specific outline. Use its pure path,
    // deliberately avoiding getElementLineIntersection's integer rounding.
    const vx = projected.x - c.x,
      vy = projected.y - c.y;
    const hits = getIntersections(
      outline(shape, options),
      `M${c.x},${c.y}L${c.x + vx * 4},${c.y + vy * 4}`,
    );
    if (hits.length) {
      const hit = hits.sort(
        (a, b) =>
          Math.hypot(a.x - projected.x, a.y - projected.y) -
          Math.hypot(b.x - projected.x, b.y - projected.y),
      )[0];
      projected = { x: hit.x, y: hit.y };
    }
  }
  return projected;
}

/** Keep both actual and logical docking coordinates relative to original bounds. */
export function remapDocking(p, before, after) {
  if (!point(p)) throw new Error("A finite docking point is required");
  const map = (value) => ({
    x:
      before.width === after.width
        ? value.x + after.x - before.x
        : after.x + ((value.x - before.x) / before.width) * after.width,
    y:
      before.height === after.height
        ? value.y + after.y - before.y
        : after.y + ((value.y - before.y) / before.height) * after.height,
  });
  if (["x", "y", "width", "height"].every((key) => before[key] === after[key])) return clone(p);
  return { ...p, ...map(p), ...(p.original ? { original: map(p.original) } : {}) };
}

// Exact intersections for stock BPMN outlines avoid path-intersection's arc
// subdivision error. Renderer path intersection remains available for other
// shapes, whose outline may be supplied by an extension renderer.
function stockIntersections(shape, a, b) {
  const { x, y, width: w, height: h } = shape,
    c = mid(shape),
    hits = [];
  const vx = b.x - a.x,
    vy = b.y - a.y;
  const add = (t) => {
    if (t >= -1e-10 && t <= 1 + 1e-10) hits.push({ x: a.x + t * vx, y: a.y + t * vy, t2: t });
  };
  const line = (p, q) => {
    const ux = q.x - p.x,
      uy = q.y - p.y,
      den = vx * uy - vy * ux;
    if (!den) return;
    const t = ((p.x - a.x) * uy - (p.y - a.y) * ux) / den,
      u = ((p.x - a.x) * vy - (p.y - a.y) * vx) / den;
    if (u >= -1e-10 && u <= 1 + 1e-10) add(t);
  };
  const circle = (cx, cy, r, accept = () => true) => {
    const dx = a.x - cx,
      dy = a.y - cy,
      A = vx * vx + vy * vy,
      B = 2 * (dx * vx + dy * vy),
      C = dx * dx + dy * dy - r * r,
      D = B * B - 4 * A * C;
    if (!A || D < 0) return;
    for (const t of [(-B - Math.sqrt(D)) / (2 * A), (-B + Math.sqrt(D)) / (2 * A)])
      if (accept(a.x + t * vx, a.y + t * vy)) add(t);
  };
  if (is(shape, "Event")) circle(c.x, c.y, w / 2);
  else if (is(shape, "Gateway")) {
    const vertices = [
      { x: c.x, y },
      { x: x + w, y: c.y },
      { x: c.x, y: y + h },
      { x, y: c.y },
    ];
    vertices.forEach((p, i) => line(p, vertices[(i + 1) % 4]));
  } else if (is(shape, "Activity")) {
    const r = Math.min(10, w / 2, h / 2);
    line({ x: x + r, y }, { x: x + w - r, y });
    line({ x: x + w, y: y + r }, { x: x + w, y: y + h - r });
    line({ x: x + r, y: y + h }, { x: x + w - r, y: y + h });
    line({ x, y: y + r }, { x, y: y + h - r });
    circle(x + r, y + r, r, (px, py) => px <= x + r && py <= y + r);
    circle(x + w - r, y + r, r, (px, py) => px >= x + w - r && py <= y + r);
    circle(x + w - r, y + h - r, r, (px, py) => px >= x + w - r && py >= y + h - r);
    circle(x + r, y + h - r, r, (px, py) => px <= x + r && py >= y + h - r);
  } else return null;
  return hits;
}

/** Crop a raw route without rounding or mutating its source snapshot. */
export function cropConnection(waypoints, source, target, options = {}) {
  if (waypoints && (!Array.isArray(waypoints) || !Array.from(waypoints).every(point)))
    unroutable("A cropped route must contain dense finite waypoints");
  const result = copy(waypoints);
  if (result.length < 2) return result;
  const path = result.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join("");
  for (const [shape, index, first] of [
    [source, 0, true],
    [target, result.length - 1, false],
  ]) {
    if (!shape) continue;
    if (connectionEndpoint(shape)) { connectionRoute(shape); continue; }
    let hits = [];
    for (let i = 1; i < result.length; i++) {
      const segment = stockIntersections(shape, result[i - 1], result[i]);
      if (segment === null) {
        hits = getIntersections(outline(shape, options), path);
        break;
      }
      hits.push(...segment.map((hit) => ({ ...hit, segment2: i })));
    }
    hits.sort((a, b) => a.segment2 - b.segment2 || a.t2 - b.t2);
    const hit = first ? hits[0] : hits.at(-1);
    if (hit) {
      const old = result[index];
      const stable = Math.hypot(hit.x - old.x, hit.y - old.y) < 1e-9 ? old : hit;
      result[index] = { ...old, x: stable.x, y: stable.y, original: clone(old.original || old) };
    }
  }
  return result;
}

function horizontal(source, elements) {
  for (let parent = source; parent; parent = parent.parent) {
    if (is(parent, "Process")) return true;
    if (is(parent, "Participant") || is(parent, "Lane")) return parent.di?.isHorizontal !== false;
  }
  let process = source?.businessObject;
  while (process && !process.$instanceOf?.("bpmn:Process")) process = process.$parent;
  const pool = elements.find((shape) => shape.businessObject?.processRef === process && process);
  return pool?.di?.isHorizontal !== false;
}

function dockingSide(shape, p) {
  const c = mid(shape),
    dx = (p.x - c.x) / shape.width,
    dy = (p.y - c.y) / shape.height;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "l" : "r") : dy < 0 ? "t" : "b";
}

function boundaryLayout(source, target, end, h) {
  const attach = getOrientation(mid(source), source.host, -10);
  const targetOrientation = getOrientation(mid(target), mid(source), {
    x: (source.width + target.width) / 2,
    y: (source.height + target.height) / 2,
  });
  const horizontal = (value) => /left|right/.exec(value)?.[0];
  const vertical = (value) => /top|bottom/.exec(value)?.[0];
  const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const direction = { top: "t", right: "r", bottom: "b", left: "l" };
  const onSide = ["top", "right", "bottom", "left"].includes(attach);
  const ah = horizontal(attach),
    av = vertical(attach),
    th = horizontal(targetOrientation),
    tv = vertical(targetOrientation);
  let from, to;
  if (source.host === target) {
    const orientation = onSide ? attach : h ? av : ah;
    from = direction[orientation];
    if (onSide) {
      const isHorizontal = !!ah,
        coordinate = isHorizontal ? "y" : "x",
        size = isHorizontal ? "height" : "width";
      const near = [
        target[coordinate],
        target[coordinate] + target[size],
        mid(source)[coordinate],
      ].some((value) => Math.abs(end[coordinate] - value) < 40);
      to = near ? (isHorizontal ? (h ? "b" : "t") : h ? "l" : "r") : isHorizontal ? "h" : "v";
    } else to = h ? "v" : "h";
  } else {
    if (onSide) from = direction[attach];
    else if (h && (av === tv || opposite[ah] === th)) from = direction[av];
    else if (!h && (ah === th || opposite[av] === tv)) from = direction[ah];
    else from = direction[h ? ah : av];
    if (onSide) {
      if (ah) to = th === opposite[ah] || targetOrientation === attach ? "h" : "v";
      else to = tv === opposite[av] || targetOrientation === attach ? "v" : "h";
    } else if (tv && !th) to = "v";
    else if (th && !tv) to = "h";
    else to = h ? (av === tv ? "h" : "v") : ah === th ? "v" : "h";
  }
  return `${from || "b"}:${to}`;
}

function preferences(edge, source, target, start, end, h) {
  const hv = h ? "h" : "v",
    vh = h ? "v" : "h";
  if (is(edge, "MessageFlow")) {
    const preserve = is(target, "Participant")
      ? "source"
      : is(source, "Participant")
        ? "target"
        : expanded(target)
          ? "source"
          : expanded(source)
            ? "target"
            : is(target, "Event")
              ? "target"
              : is(source, "Event")
                ? "source"
                : undefined;
    return { preferredLayouts: ["straight", `${vh}:${vh}`], preserveDocking: preserve };
  }
  if (source === target) {
    const side = dockingSide(source, edge.waypoints?.[0] || start);
    const next = (h ? { t: "r", r: "b", b: "l", l: "t" } : { t: "l", l: "b", b: "r", r: "t" })[
      side
    ];
    return { preferredLayouts: [`${side}:${next}`] };
  }
  if (is(source, "BoundaryEvent") && source.host) {
    return { preferredLayouts: [boundaryLayout(source, target, end, h)] };
  }
  if (expanded(source) || expanded(target))
    return {
      preferredLayouts: ["straight", `${hv}:${hv}`],
      preserveDocking: expanded(source) ? "target" : "source",
    };
  if (is(source, "Gateway")) return { preferredLayouts: [`${vh}:${hv}`] };
  if (is(target, "Gateway")) return { preferredLayouts: [`${hv}:${vh}`] };
  return { preferredLayouts: [`${hv}:${hv}`] };
}

function entersBounds(a, b, shape) {
  const right = shape.x + shape.width,
    bottom = shape.y + shape.height;
  if (a.x === b.x)
    return (
      a.x > shape.x &&
      a.x < right &&
      Math.max(Math.min(a.y, b.y), shape.y) < Math.min(Math.max(a.y, b.y), bottom)
    );
  if (a.y === b.y)
    return (
      a.y > shape.y &&
      a.y < bottom &&
      Math.max(Math.min(a.x, b.x), shape.x) < Math.min(Math.max(a.x, b.x), right)
    );
  return true;
}

function crossesEndpoints(route, source, target) {
  return route
    .slice(1)
    .some(
      (p, i) =>
        (i > 0 && entersBounds(route[i], p, source)) ||
        (i < route.length - 2 && entersBounds(route[i], p, target)),
    );
}

// connectPoints can double back through the source when both chosen ports face
// away from one another. A small orthogonal visibility graph around just the
// two endpoint bounds supplies the shortest clear detour without flipping ports.
function pinnedDetour(source, target, start, end, sourceSide, targetSide) {
  const pad = 20,
    shapes = [...new Set([source, target])];
  const lead = (shape, p, side) => {
    let gap = pad;
    for (const other of shapes) {
      if (other === shape) continue;
      if ((side === "l" || side === "r") && p.y > other.y && p.y < other.y + other.height) {
        const distance =
          side === "r" ? other.x - (shape.x + shape.width) : shape.x - (other.x + other.width);
        if (distance >= 0) gap = Math.min(gap, distance / 2);
      }
      if ((side === "t" || side === "b") && p.x > other.x && p.x < other.x + other.width) {
        const distance =
          side === "b" ? other.y - (shape.y + shape.height) : shape.y - (other.y + other.height);
        if (distance >= 0) gap = Math.min(gap, distance / 2);
      }
    }
    return {
      x: side === "l" ? shape.x - gap : side === "r" ? shape.x + shape.width + gap : p.x,
      y: side === "t" ? shape.y - gap : side === "b" ? shape.y + shape.height + gap : p.y,
    };
  };
  const a = lead(source, start, sourceSide),
    b = lead(target, end, targetSide);
  const xs = [
    ...new Set([a.x, b.x, ...shapes.flatMap((s) => [s.x - pad, s.x + s.width + pad])]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([a.y, b.y, ...shapes.flatMap((s) => [s.y - pad, s.y + s.height + pad])]),
  ].sort((a, b) => a - b);
  const inside = (p) =>
    shapes.some((s) => p.x > s.x && p.x < s.x + s.width && p.y > s.y && p.y < s.y + s.height);
  const nodes = xs.flatMap((x) => ys.map((y) => ({ x, y }))).filter((p) => !inside(p));
  const from = nodes.findIndex((p) => same(p, a)),
    to = nodes.findIndex((p) => same(p, b));
  if (from < 0 || to < 0) return null;
  const links = nodes.map((p, i) =>
    nodes
      .map((q, j) => ({ q, j, d: axis(p, q) }))
      .filter(({ q, j, d }) => i !== j && d && !shapes.some((s) => entersBounds(p, q, s))),
  );
  const initialAxis = sourceSide === "l" || sourceSide === "r" ? "y" : "x";
  const finalAxis = targetSide === "l" || targetSide === "r" ? "y" : "x";
  const queue = [{ index: from, d: initialAxis, cost: 0, path: [from] }],
    best = new Map();
  let answer = null;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift(),
      key = current.index + ":" + current.d;
    if ((best.get(key) ?? Infinity) <= current.cost) continue;
    best.set(key, current.cost);
    if (current.index === to) {
      const cost = current.cost + (current.d === finalAxis ? 0 : pad);
      if (!answer || cost < answer.cost) answer = { ...current, cost };
      continue;
    }
    for (const { q, j, d } of links[current.index]) {
      const p = nodes[current.index],
        cost =
          current.cost + Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + (d === current.d ? 0 : pad);
      if (cost < (best.get(j + ":" + d) ?? Infinity) && (!answer || cost < answer.cost))
        queue.push({ index: j, d, cost, path: [...current.path, j] });
    }
  }
  return answer ? withoutRedundantPoints([start, ...answer.path.map((i) => nodes[i]), end]) : null;
}

/**
 * Pure BpmnLayouter-compatible repair. For gestures set preserveDocking:'both':
 * explicit connectionStart/End are pointer coordinates, projected to outlines
 * and retained exactly. Supplying neither changed endpoint leaves manual bends
 * untouched. For moves/resizes pass the original route plus remapped dockings.
 */
export function layoutConnection(edge, hints = {}, options = {}) {
  const source = hints.source || edge.source,
    target = hints.target || edge.target;
  const rawPoints = hints.waypoints || edge.waypoints;
  if (rawPoints && (!Array.isArray(rawPoints) || !Array.from(rawPoints).every(point)))
    unroutable("A route must contain dense finite waypoints");
  const points = copy(rawPoints);
  const owned = connectionEndpoint(source) || connectionEndpoint(target);
  if (connectionEndpoint(source)) connectionRoute(source);
  if (connectionEndpoint(target)) connectionRoute(target);
  let start = point(hints.connectionStart)
    ? clone(hints.connectionStart)
    : clone(points[0]?.original || points[0] || endpointMid(source));
  let end = point(hints.connectionEnd)
    ? clone(hints.connectionEnd)
    : clone(points.at(-1)?.original || points.at(-1) || endpointMid(target));
  const changed = point(hints.connectionStart) || point(hints.connectionEnd);
  if (points.length && !changed && hints.preserveDocking !== "both") return points;
  const orthogonal =
    is(edge, "SequenceFlow") ||
    is(edge, "MessageFlow") ||
    (is(source, "BoundaryEvent") && target.businessObject?.isForCompensation);
  if (owned) {
    if (orthogonal) unroutable("Connection-owned endpoints require an association route");
    const explicitStart = point(hints.connectionStart), explicitEnd = point(hints.connectionEnd);
    const endpoint = (shape, current, explicit, pointer) => {
      if (current && !explicit) return clone(current);
      const position = explicit ? projectDocking(shape, pointer, options) : endpointMid(shape);
      const result = { ...(current ? clone(current) : {}), ...position };
      if (explicit && result.original) result.original = { ...result.original, ...position };
      if (connectionEndpoint(shape) && !result.original) result.original = { ...position };
      return result;
    };
    start = endpoint(source, points[0], explicitStart, start);
    end = endpoint(target, points.at(-1), explicitEnd, end);
    // Existing owner anchors are already logical attachment coordinates.
    // Re-cropping must not slide them onto another nearby segment.
    return cropConnection([start, ...points.slice(1, -1), end],
      explicitStart ? null : source, explicitEnd ? null : target, options);
  }
  if (hints.preserveDocking === "both") {
    start = projectDocking(
      source,
      point(hints.connectionStart) ? start : points[0] || start,
      options,
    );
    end = projectDocking(target, point(hints.connectionEnd) ? end : points.at(-1) || end, options);
    if (!orthogonal) return [start, ...points.slice(1, -1), end];
    const sourceSide = dockingSide(source, start),
      targetSide = dockingSide(target, end);
    const directions = `${sourceSide}:${targetSide}`;
    if (source === target && same(start, end)) {
      const normal =
        sourceSide === "r"
          ? { x: 1, y: 0 }
          : sourceSide === "l"
            ? { x: -1, y: 0 }
            : sourceSide === "t"
              ? { x: 0, y: -1 }
              : { x: 0, y: 1 };
      const offset = (out, across) => ({
        x: start.x + normal.x * out - normal.y * across,
        y: start.y + normal.y * out + normal.x * across,
      });
      return [start, offset(20, 0), offset(20, 40), offset(60, 40), offset(60, 0), end];
    }
    let result;
    if (points.length > 2 && points.slice(1).every((p, i) => axis(p, points[i]))) {
      const policy = { preferredLayouts: [directions] };
      result = points;
      if (!same(start, points[0]))
        result = repairConnection(source, target, start, result.at(-1), result, {
          ...policy,
          connectionStart: start,
        });
      if (!same(end, result.at(-1)))
        result = repairConnection(source, target, result[0], end, result, {
          ...policy,
          connectionEnd: end,
        });
      // A short-route fallback may choose a rectangle corner rather than the
      // requested curved-outline point. Rebuild only if the requested dockings
      // cannot be retained by this local repair.
      if (!same(result[0], start) || !same(result.at(-1), end)) result = null;
    }
    result = withoutRedundantPoints(result || connectPoints(start, end, directions));
    result[0] = start;
    result[result.length - 1] = end;
    if (crossesEndpoints(result, source, target)) {
      result = pinnedDetour(source, target, start, end, sourceSide, targetSide);
      if (!result || crossesEndpoints(result, source, target)) {
        const error = new Error(
          "The selected connection anchors cannot be routed outside the endpoint bounds",
        );
        error.code = "UNROUTABLE_DOCKING";
        throw error;
      }
    }
    return copy(result);
  }
  if (!orthogonal) return [start, ...points.slice(1, -1), end];
  const h = hints.isHorizontal ?? horizontal(source, options.elements || []);
  const policy = { ...preferences(edge, source, target, start, end, h), ...hints };
  // Manhattan repair handles one endpoint at a time. Preserve both changed
  // ends by applying each repair in sequence, always to fresh point objects.
  let result = points;
  if (point(hints.connectionStart) && point(hints.connectionEnd) && points.length > 2) {
    result = repairConnection(source, target, start, points.at(-1), result, {
      ...policy,
      connectionEnd: undefined,
    });
    result = repairConnection(source, target, start, end, result, {
      ...policy,
      connectionStart: undefined,
    });
  } else result = repairConnection(source, target, start, end, result, policy);
  result = copy(withoutRedundantPoints(result));
  return options.getShapePath ? cropConnection(result, source, target, options) : result;
}

/**
 * Move one orthogonal segment perpendicular to itself. Endpoint segments slide
 * on a shape while inside it, then grow an elbow once they leave the shape.
 * The edge and every original waypoint remain untouched (cancel/undo exact).
 */
export function planSegmentMove(edge, segmentIndex, delta, options = {}) {
  if (!point(delta)) throw new Error("Segment delta must be finite");
  const original = copy(connectionRoute(edge)),
    last = original.length - 1;
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= last)
    throw new Error("Invalid connection segment");
  const a = original[segmentIndex],
    b = original[segmentIndex + 1],
    moveAxis = segmentMoveAxis(a, b);
  if (!moveAxis || !delta[moveAxis]) return original;
  const docking = (p, shape) =>
    p.original
      ? clone(p.original)
      : connectionEndpoint(shape) ? clone(p)
        : { ...p, [moveAxis === "x" ? "y" : "x"]: mid(shape)[moveAxis === "x" ? "y" : "x"] };
  const start = segmentIndex === 0 ? docking(a, edge.source) : a;
  const end = segmentIndex + 1 === last ? docking(b, edge.target) : b;
  const movedStart = { ...start, [moveAxis]: start[moveAxis] + delta[moveAxis] };
  // Imported nearly aligned coordinates retain their exact source values in
  // the snapshot. A real segment move normalizes only the moved segment onto
  // one shared coordinate, rather than leaving a tiny diagonal or rounding
  // the entire route to integer pixels as upstream's gesture end does.
  const movedEnd = { ...end, [moveAxis]: movedStart[moveAxis] };
  const result = copy(original);
  result[segmentIndex] = movedStart;
  result[segmentIndex + 1] = movedEnd;
  if (segmentIndex < 2) {
    const inside = !connectionEndpoint(edge.source) && getOrientation(edge.source, movedStart) === "intersect";
    if (segmentIndex === 1 && inside) {
      result.shift();
      result[0] = movedStart;
    } else if (segmentIndex === 0 && !inside) result.unshift(start);
  }
  if (segmentIndex + 1 > last - 2) {
    const inside = !connectionEndpoint(edge.target) && getOrientation(edge.target, movedEnd) === "intersect";
    if (segmentIndex + 1 === last - 1 && inside) {
      result.pop();
      result[result.length - 1] = movedEnd;
    } else if (segmentIndex + 1 === last && !inside) result.push(end);
  }
  return cropConnection(withoutRedundantPoints(result), edge.source, edge.target, options);
}
