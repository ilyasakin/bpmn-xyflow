/**
 * Pure connection geometry; the XYFlow modeler owns rendering and transactions.
 *
 * Routing policy verified against bpmn-js 18.30.1 BpmnLayouter. Manhattan repair
 * is delegated to the existing diagram-js 15.14.0 dependency. Segment movement
 * follows its ConnectionSegmentMove algorithm, without event services or pixel
 * rounding. Logical endpoint seeding follows bpmn-js ImportDockingFix 18.30.1.
 * Sources: https://github.com/bpmn-io/bpmn-js/tree/v18.30.1 and
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

import { projectFixedConnectionAnchor, routeFixedConnectionAnchor } from "./ConnectionAnchors";

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
  const center = endpointMid(source), h = annotationHorizontal(source, options.elements);
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

// Match BpmnAutoPlaceUtil's isDirectionHorizontal(source, elementRegistry),
// including its registry fallback for collaboration-owned connections. With no
// Process ancestor, an undefined processRef may match the Collaboration root;
// DiUtil.isHorizontal then returns undefined and autoPlace chooses vertical.
// Keep this annotation policy separate from ordinary Manhattan routing.
function annotationHorizontal(source, elements) {
  const parents = [];
  for (let parent = source.parent; parent; parent = parent.parent) parents.push(parent);
  if (parents.some(parent => is(parent, "Process"))) return true;
  const parent = parents.find(parent => is(parent, "Participant") || is(parent, "Lane"));
  const participant = parent || ((is(source, "Participant") || is(source, "Lane")) && source);
  if (participant) return participant.di?.isHorizontal !== false;
  // The retained moddle uses null for a root parent; the reference uses an
  // absent property. Both represent the same missing Process ancestor.
  let process;
  for (let object = source.businessObject; object; object = object.$parent) {
    if (object.$instanceOf?.("bpmn:Process")) { process = object; break; }
  }
  if (!elements) return true;
  const candidate = elements.find(element => element.businessObject && element.businessObject.processRef === process);
  if (!candidate) return true;
  return is(candidate, "Participant") || is(candidate, "Lane") ? candidate.di?.isHorizontal !== false : undefined;
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
    projected = projectFixedConnectionAnchor(shape, pointer);
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
  // Avoid changing an already-on-outline imported/chosen coordinate merely
  // through a second floating-point projection. This bound scales with the
  // arithmetic's inputs; it is not an input hit radius or a geometric snap.
  const roundoff = Number.EPSILON * 8 * Math.max(1, Math.abs(x), Math.abs(y), w, h, Math.abs(pointer.x), Math.abs(pointer.y));
  const nonAxisOutline = projected.x !== x && projected.x !== x + w && projected.y !== y && projected.y !== y + h;
  return nonAxisOutline && Math.hypot(projected.x - pointer.x, projected.y - pointer.y) <= roundoff
    ? { x: pointer.x, y: pointer.y } : projected;
}

/** Keep both actual and logical docking coordinates relative to original bounds. */
export function remapDocking(p, before, after) {
  if (!point(p)) throw new Error("A finite docking point is required");
  const map = (value) => ({
    ...value,
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

/**
 * Seed the logical endpoints behind an already visible route. This is the
 * center-cross construction from bpmn-js ImportDockingFix (18.30.1), without
 * its integer rounding. The visible coordinates and authored logical points
 * are untouched. Call with PRE-change bounds before moving/resizing a shape.
 *
 * A cropped circle endpoint is not a suitable logical endpoint: a later
 * Manhattan repair can change its rectangular docking side. Keeping an
 * interior point on the terminal line lets cropping choose the new outline
 * intersection rather than double back through the endpoint shapes.
 */
export function normalizeLogicalDocking(waypoints, source, target) {
  if (!Array.isArray(waypoints) || !Array.from(waypoints).every(point))
    unroutable("Logical docking requires dense finite waypoints");
  const result = copy(waypoints);
  if (result.length < 2) return result;
  for (const [shape, index, direction] of [[source, 0, 1], [target, result.length - 1, -1]]) {
    const endpoint = result[index];
    if (endpoint.original != null) {
      if (!point(endpoint.original)) unroutable("Logical docking points must be finite");
      continue;
    }
    if (!shape || connectionEndpoint(shape)) continue;
    if (![shape.x, shape.y, shape.width, shape.height].every(Number.isFinite) || shape.width <= 0 || shape.height <= 0)
      unroutable("Logical docking requires finite positive shape bounds");
    // Imported routes may contain repeated terminal points. Use the first
    // nonzero leg; an entirely zero-length route has no docking direction.
    let adjacent;
    for (let i = index + direction; i >= 0 && i < result.length; i += direction) {
      if (!same(endpoint, result[i])) { adjacent = result[i]; break; }
    }
    if (!adjacent) continue;
    const center = mid(shape), dx = adjacent.x - endpoint.x, dy = adjacent.y - endpoint.y;
    const candidates = [];
    if (dx) candidates.push({ x: center.x, y: endpoint.y + (center.x - endpoint.x) * dy / dx });
    if (dy) candidates.push({ x: endpoint.x + (center.y - endpoint.y) * dx / dy, y: center.y });
    const finite = candidates.filter(point);
    if (!finite.length) unroutable("Logical docking construction is not finite");
    finite.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y));
    endpoint.original = finite[0];
  }
  return result;
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
  // Manhattan layout carries the logical docking in `original` while its
  // visible endpoint may lie on the shape's rectangular bounds. Crop the
  // logical path, as diagram-js DefaultRenderer.getConnectionPath does:
  // a bbox endpoint can otherwise stop before a circle/diamond outline.
  const logical = result.map(p => p.original || p);
  if (!logical.every(point)) unroutable("Logical docking points must be finite");
  const path = logical.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join("");
  for (const [shape, index, first] of [
    [source, 0, true],
    [target, result.length - 1, false],
  ]) {
    if (!shape) continue;
    if (connectionEndpoint(shape)) { connectionRoute(shape); continue; }
    let hits = [];
    for (let i = 1; i < logical.length; i++) {
      const segment = stockIntersections(shape, logical[i - 1], logical[i]);
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
  // A self-loop has one obstacle with two terminal legs. Curved-outline ports
  // may lie inside its bounding rectangle; neither terminal is an interior
  // crossing merely for reaching that exact circle/diamond/rounded outline.
  // Check all legs against the actual outline, retaining rejection of chords
  // through the shape and preserving the two distinct chosen dockings.
  if (source === target && (is(source, "Event") || is(source, "Gateway") || is(source, "Activity")))
    return crossesOutlines(route, source, target);
  return route
    .slice(1)
    .some(
      (p, i) =>
        (i > 0 && entersBounds(route[i], p, source)) ||
        (i < route.length - 2 && entersBounds(route[i], p, target)),
    );
}

// Unlike rectangular Manhattan docking, the rendered circle/diamond/rounded
// task has a smaller interior. Check the actual stock outline, including the
// first and last legs. Intersections partition each leg into intervals on
// which inside/outside cannot change; checking their midpoints also catches a
// very long leg that passes briefly through the opposite endpoint.
function crossesOutlines(route, source, target) {
  const inside = (p, shape) => {
    const c = mid(shape), dx = Math.abs(p.x - c.x), dy = Math.abs(p.y - c.y), epsilon = 1e-8;
    if (is(shape, "Event")) return Math.hypot(dx, dy) < shape.width / 2 - epsilon;
    if (is(shape, "Gateway")) return dx / (shape.width / 2) + dy / (shape.height / 2) < 1 - epsilon;
    if (dx >= shape.width / 2 - epsilon || dy >= shape.height / 2 - epsilon) return false;
    if (!is(shape, "Activity")) return true;
    const radius = Math.min(10, shape.width / 2, shape.height / 2);
    return Math.hypot(Math.max(0, dx - shape.width / 2 + radius), Math.max(0, dy - shape.height / 2 + radius)) < radius - epsilon;
  };
  for (const shape of new Set([source, target])) {
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i], intersections = stockIntersections(shape, a, b);
      // Unknown renderer outlines keep their existing renderer crop contract.
      if (intersections === null) continue;
      const times = [0, ...intersections.map(hit => clamp(hit.t2, 0, 1)), 1].sort((a, b) => a - b);
      for (let j = 1; j < times.length; j++) {
        const t = (times[j - 1] + times[j]) / 2;
        if (inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, shape)) return true;
      }
    }
  }
  return false;
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

// Automatic layout has no user-pinned endpoint to preserve. When partially
// overlapping shapes make its preferred ports inaccessible, choose exposed
// outline ports instead of refusing an otherwise legal semantic connection.
// The explicit preserve-both branch never enters this fallback.
function automaticDetour(source, target, start, end, options) {
  const candidates = (shape, preferred) => {
    const c = mid(shape), result = [preferred, ...[
      { x: shape.x, y: c.y }, { x: c.x, y: shape.y },
      { x: shape.x + shape.width, y: c.y }, { x: c.x, y: shape.y + shape.height },
    ].map(p => projectDocking(shape, p, options))];
    return result.filter((p, i) => result.findIndex(other => same(p, other)) === i);
  };
  let best, score = Infinity;
  for (const from of candidates(source, start)) for (const to of candidates(target, end)) {
    const route = pinnedDetour(source, target, from, to, dockingSide(source, from), dockingSide(target, to));
    if (!route || route.length < 2 || crossesOutlines(route, source, target)) continue;
    const length = route.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - route[i].x, p.y - route[i].y), 0);
    if (length && length < score) { best = route; score = length; }
  }
  return best;
}

/**
 * Pure BpmnLayouter-compatible repair. For gestures set preserveDocking:'both':
 * explicit connectionStart/End are pointer coordinates, projected to outlines
 * and retained exactly. Supplying neither changed endpoint leaves manual bends
 * untouched. For moves/resizes pass the original route plus remapped dockings.
 */
function layoutConnectionRaw(edge, hints = {}, options = {}) {
  const source = hints.source || edge.source,
    target = hints.target || edge.target;
  for (const shape of [source, target]) {
    if (!connectionEndpoint(shape) && (!shape ||
      ![shape.x, shape.y, shape.width, shape.height, shape.x + shape.width, shape.y + shape.height].every(Number.isFinite) ||
      shape.width <= 0 || shape.height <= 0)) unroutable("Routing requires finite positive shape bounds");
  }
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
    // Shape-move hints are interior logical dockings, as in BpmnLayouter.
    // Gesture hints with preserveDocking:'both' are visible pointer positions.
    // Connection endpoints always use their sharp route projection.
    const repairStart = explicitStart && points[0] && !connectionEndpoint(source) && hints.preserveDocking !== "both";
    const repairEnd = explicitEnd && points.at(-1) && !connectionEndpoint(target) && hints.preserveDocking !== "both";
    const endpoint = (shape, current, explicit, pointer, repair) => {
      if (current && !explicit) return clone(current);
      const position = explicit ? repair ? pointer : projectDocking(shape, pointer, options) : endpointMid(shape);
      const result = { ...(current ? clone(current) : {}), ...position };
      if (explicit && result.original) result.original = { ...result.original, ...position };
      if (connectionEndpoint(shape) && !result.original) result.original = { ...position };
      return result;
    };
    start = endpoint(source, points[0], explicitStart, start, repairStart);
    end = endpoint(target, points.at(-1), explicitEnd, end, repairEnd);
    // Existing owner anchors are already logical attachment coordinates.
    // Re-cropping must not slide them onto another nearby segment.
    return cropConnection([start, ...points.slice(1, -1), end],
      repairStart || (!explicitStart && !points[0]) ? source : null,
      repairEnd || (!explicitEnd && !points.at(-1)) ? target : null, options);
  }
  if (hints.preserveDocking === "both") {
    const finish = route => {
      const seeded = normalizeLogicalDocking(route, source, target);
      for (const [index, previous, retainedEndpoint] of [
        [0, points[0], source === edge.source],
        [seeded.length - 1, points.at(-1), target === edge.target],
      ]) {
        if (!previous || !retainedEndpoint) continue;
        const current = seeded[index];
        seeded[index] = { ...clone(previous), ...current };
        if (previous.original && current.original) seeded[index].original = same(previous, current)
          ? clone(previous.original) : { ...previous.original, ...current.original };
      }
      return seeded;
    };
    start = projectDocking(
      source,
      point(hints.connectionStart) ? start : points[0] || start,
      options,
    );
    end = projectDocking(target, point(hints.connectionEnd) ? end : points.at(-1) || end, options);
    if (!orthogonal) return finish([start, ...points.slice(1, -1), end]);
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
      return finish([start, offset(20, 0), offset(20, 40), offset(60, 40), offset(60, 0), end]);
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
    return finish(result);
  }
  if (!orthogonal) {
    const result = [start, ...points.slice(1, -1), end];
    return options.getShapePath ? cropConnection(result, source, target, options) : result;
  }
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
  if (!options.getShapePath) return result;
  result = cropConnection(result, source, target, options);
  if (crossesOutlines(result, source, target)) {
    // Retain manual bends unless their repaired terminal leg now traverses an
    // endpoint. Recompute that unsafe route using the same layouter policy.
    // Deliberate correction: pinned upstream can keep a long manual leg that
    // crosses the opposite circle/diamond after a shape moves past it.
    result = cropConnection(copy(withoutRedundantPoints(repairConnection(source, target, start, end, [], policy))), source, target, options);
    if (crossesOutlines(result, source, target)) {
      const from = result[0], to = result.at(-1);
      const detour = automaticDetour(source, target, from, to, options);
      if (!detour || crossesOutlines(detour, source, target)) unroutable("The repaired route crosses an endpoint interior");
      result = normalizeLogicalDocking(detour, source, target);
    }
  }
  return result;
}

// Preserve authored bends when only a fixed endpoint changes. Rebuilding the
// entire route would also invalidate a live bend gesture's original index.
function repairFixedTerminal(route, shape, anchor, source, target, first, orthogonal) {
  const old = route[first ? 0 : route.length - 1], adjacent = route[first ? 1 : route.length - 2];
  const current = { ...clone(old), ...anchor,
    ...(old.original ? { original: { ...old.original, ...mid(shape) } } : {}) };
  if (!orthogonal) { const result = copy(route); result[first ? 0 : result.length - 1] = current; return result; }
  const side = dockingSide(shape, anchor), normal = side === "t" ? { x: 0, y: -1 } : side === "r" ? { x: 1, y: 0 } : side === "b" ? { x: 0, y: 1 } : { x: -1, y: 0 };
  const shapes = [source, target].filter(s => !connectionEndpoint(s));
  const candidates = [];
  for (const distance of [20, 10, 5, 1]) {
    const lead = { x: anchor.x + normal.x * distance, y: anchor.y + normal.y * distance };
    for (const direction of ["h:h", "h:v", "v:h", "v:v"]) {
      const bridge = withoutRedundantPoints([current, lead, ...connectPoints(lead, adjacent, direction).slice(1)]);
      if (!shapes.some(s => crossesOutlines(bridge, s, s))) candidates.push(bridge);
    }
  }
  candidates.sort((a, b) => a.slice(1).reduce((v,p,i)=>v+Math.hypot(p.x-a[i].x,p.y-a[i].y),0) - b.slice(1).reduce((v,p,i)=>v+Math.hypot(p.x-b[i].x,p.y-b[i].y),0));
  const bridge = candidates[0];
  if (!bridge) unroutable("The gateway vertex cannot reach the retained manual bend without crossing an endpoint");
  // The original adjacent point (including metadata) stays in its original
  // route; only fresh bridge points are inserted before/after it.
  bridge[0] = current;
  return first ? [...bridge.slice(0,-1), ...copy(route.slice(1))] : [...copy(route.slice(0,-1)), ...bridge.slice(0,-1).reverse()];
}

/** Apply editing policy after geometric layout; importing never calls this. */
export function normalizeConnectionAnchors(edge, waypoints, options = {}, automatic = false) {
  if (!Array.isArray(waypoints) || waypoints.length < 2 || !Array.from(waypoints).every(point))
    unroutable("Anchor policy requires a dense finite route");
  const ends = [waypoints[0], waypoints.at(-1)];
  const chosen = [edge.source, edge.target].map((shape, i) => automatic
    ? routeFixedConnectionAnchor(shape, ends[i], i ? waypoints.at(-2) : waypoints[1])
    : projectFixedConnectionAnchor(shape, ends[i]));
  if (chosen.every((p, i) => !p || same(p, ends[i]))) return copy(waypoints);
  if (waypoints.length > 2) {
    let result = copy(waypoints);
    const orthogonal = is(edge, "SequenceFlow") || is(edge, "MessageFlow");
    for (const i of [0, 1]) if (chosen[i] && !same(chosen[i], ends[i]))
      result = repairFixedTerminal(result, i ? edge.target : edge.source, chosen[i], edge.source, edge.target, !i, orthogonal);
    return normalizeLogicalDocking(result, edge.source, edge.target);
  }
  return layoutConnectionRaw({ ...edge, waypoints }, {
    connectionStart: chosen[0] || ends[0], connectionEnd: chosen[1] || ends[1], preserveDocking: "both"
  }, options);
}

export function layoutConnection(edge, hints = {}, options = {}) {
  const old = hints.waypoints || edge.waypoints, source = hints.source || edge.source, target = hints.target || edge.target;
  for (const shape of [source, target]) if (!connectionEndpoint(shape) && (!shape ||
    ![shape.x, shape.y, shape.width, shape.height, shape.x + shape.width, shape.y + shape.height].every(Number.isFinite) || shape.width <= 0 || shape.height <= 0))
    unroutable("Routing requires finite positive shape bounds");
  // A gateway endpoint gesture need not discard an existing nonorthogonal
  // manual route. Repair its terminal bridge when the other end stays fixed.
  if (hints.preserveDocking === "both" && Array.isArray(old) && old.length > 2 && Array.from(old).every(point)) {
    const shapes = [source, target], ends = [old[0], old.at(-1)], pointers = [hints.connectionStart, hints.connectionEnd];
    const fixed = shapes.map((shape, i) => projectFixedConnectionAnchor(shape, point(pointers[i]) ? pointers[i] : ends[i]));
    if (fixed.some(Boolean) && shapes.every((shape, i) => fixed[i] || same(projectDocking(shape, point(pointers[i]) ? pointers[i] : ends[i], options), ends[i]))) {
      try {
        let result = copy(options.seedWaypointProvenance ? options.seedWaypointProvenance(old) : old);
        const orthogonal = is(edge, "SequenceFlow") || is(edge, "MessageFlow");
        for (const i of [0, 1]) if (fixed[i] && !same(fixed[i], ends[i])) result = repairFixedTerminal(result, shapes[i], fixed[i], source, target, !i, orthogonal);
        // A new semantic endpoint may cover an old interior leg. Retaining
        // manual bends is valid only while the complete route stays outside
        // both endpoints, not merely its freshly repaired terminal bridge.
        if (!orthogonal || !crossesOutlines(result, source, target)) return normalizeLogicalDocking(result, source, target);
      } catch (error) {
        if (error.code !== "UNROUTABLE_DOCKING") throw error;
        // The local terminal bridge may be impossible even though a wider
        // detour exists. The ordinary pinned-anchor layouter below preserves
        // both requested dockings and retains safe bends when it can.
      }
    }
  }
  const route = layoutConnectionRaw(edge, hints, options);
  // A layout no-op is not permission to rewrite an imported authored route.
  if ((hints.waypoints || edge.waypoints)?.length && !point(hints.connectionStart) && !point(hints.connectionEnd) && hints.preserveDocking !== "both") return route;
  return normalizeConnectionAnchors({ ...edge, source, target }, options.seedWaypointProvenance ? options.seedWaypointProvenance(route) : route, options, hints.preserveDocking !== "both");
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
  return normalizeConnectionAnchors(edge, cropConnection(withoutRedundantPoints(result), edge.source, edge.target, options), options, true);
}
