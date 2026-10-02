/** Pure resize constraints/plans. Callers own preview mutation and history. */
import { asTRBL } from "diagram-js/lib/layout/LayoutUtil";
import {
  computeChildrenBBox,
  getMinResizeBounds,
  resizeBounds,
} from "diagram-js/lib/features/resize/ResizeUtil";
import { getBBox, getEnclosedElements } from "diagram-js/lib/util/Elements";
import SpaceTool from "diagram-js/lib/features/space-tool/SpaceTool";
import { is } from "../util/ModelUtil";
import { isHorizontal } from "../util/DiUtil";
import { canResize } from "./ContextRules";
import {
  getParticipantResizeConstraints,
  SUB_PROCESS_MIN_DIMENSIONS,
} from "../upstream/modeling/behavior/ResizeBehavior";
import { getLanesRoot, computeLanesResize } from "../upstream/modeling/util/LaneUtil";

const lane = (shape) => is(shape, "bpmn:Lane") || is(shape, "bpmn:Participant");
const rect = (shape) => ({ x: shape.x, y: shape.y, width: shape.width, height: shape.height });
const valid = (shape) =>
  shape &&
  ["x", "y", "width", "height"].every((key) => Number.isFinite(shape[key])) &&
  shape.width > 0 &&
  shape.height > 0;

/** Local lanes own flow nodes; the reference canvas keeps them at the lane root. */
function view(shape, elements) {
  const originals = new Set(elements || []);
  // Include ancestors/children even when the supplied graph already contains shape.
  for (const element of [...originals, shape]) {
    if (!element) continue;
    const seen = new Set();
    for (let parent = element; parent && !seen.has(parent); parent = parent.parent) {
      seen.add(parent);
      originals.add(parent);
    }
  }
  const pending = [...originals];
  for (let i = 0; i < pending.length; i++)
    for (const child of pending[i].children || [])
      if (!originals.has(child)) {
        originals.add(child);
        pending.push(child);
      }
  const copies = new Map(
    [...originals].map((node) => [
      node,
      {
        ...node,
        businessObject: node.businessObject,
        di: node.di,
        type: node.type,
        children: [],
        original: node,
      },
    ]),
  );
  for (const [node, copy] of copies) {
    let parent = node.parent;
    if (!is(node, "bpmn:Lane")) while (is(parent, "bpmn:Lane")) parent = parent.parent;
    copy.parent = copies.get(parent) || parent;
    copy.host = copies.get(node.host) || node.host;
    copy.label = copies.get(node.label) || node.label;
    // diagram-js identifies labels by property presence, not truthiness.
    if (node.labelTarget) copy.labelTarget = copies.get(node.labelTarget) || node.labelTarget;
    else delete copy.labelTarget;
    copy.attachers = (node.attachers || []).map((child) => copies.get(child) || child);
    copy.source = copies.get(node.source) || node.source;
    copy.target = copies.get(node.target) || node.target;
    if (copy.parent && copies.has(parent) && !node.hidden) copy.parent.children.push(copy);
  }
  const target = copies.get(shape),
    root = lane(shape) ? getLanesRoot(target) : target;
  let canvas = root;
  while (canvas.parent) canvas = canvas.parent;
  const all = [],
    seen = new Set();
  const walk = (node) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    all.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return { shape: target, root, canvas, all, copies };
}

export function containerResizeContext(shape, direction, { balanced = true, elements = [] } = {}) {
  if (!lane(shape) && !is(shape, "bpmn:SubProcess")) return null;
  if (!valid(shape) || !/^(n|e|s|w|ne|nw|se|sw)$/.test(direction)) return null;
  const graph = view(shape, elements);
  const constraints = lane(shape)
    ? getParticipantResizeConstraints(graph.shape, direction, balanced)
    : {
        min: asTRBL(
          getMinResizeBounds(
            direction,
            graph.shape,
            SUB_PROCESS_MIN_DIMENSIONS,
            computeChildrenBBox(graph.shape),
          ),
        ),
      };
  return {
    shape,
    direction,
    balanced,
    constraints,
    elements,
    scope: lane(shape)
      ? elements.filter((node) => valid(node) && !node.waypoints)
      : graph.all.filter((node) => valid(node) && !node.waypoints).map((node) => node.original),
  };
}

export function containerResizePlan(context, newBounds) {
  if (!context || !valid(newBounds)) return null;
  const { shape, balanced } = context;
  if (!lane(shape)) return { resizes: [{ node: shape, bounds: rect(newBounds) }], spaces: [] };
  const graph = view(shape, context.elements);
  if (balanced)
    return {
      resizes: [
        { node: shape, bounds: rect(newBounds) },
        ...computeLanesResize(graph.shape, newBounds).map((entry) => ({
          node: entry.shape.original,
          bounds: entry.newBounds,
        })),
      ],
      spaces: [],
    };

  const old = asTRBL(shape),
    next = asTRBL(newBounds),
    changes = {};
  for (const side of ["top", "right", "bottom", "left"]) changes[side] = next[side] - old[side];
  const spaces = [];
  function space(axis, change, coordinate, direction, delta, elements) {
    const spaceRoot = elements[0] === graph.canvas ? null : elements[0];
    const extra = spaceRoot
      ? Object.values(
          getEnclosedElements(
            graph.canvas.children.filter((child) => is(child, "bpmn:Artifact")),
            getBBox(spaceRoot),
          ),
        )
      : [];
    const adjusted = SpaceTool.prototype.calculateAdjustments.call(
      { _rules: { allowed: (_action, { shape }) => canResize(shape) } },
      [...elements, ...extra],
      axis,
      delta,
      coordinate,
    );
    const moving = adjusted.movingShapes;
    const resizing = adjusted.resizingShapes.filter(
      (node) =>
        !is(node, "bpmn:TextAnnotation") &&
        !(
          is(node, "bpmn:Participant") &&
          !node.businessObject.processRef &&
          (axis === "y" ? isHorizontal(node) : !isHorizontal(node))
        ),
    );
    const movingShapes = moving.map((node) => node.original),
      resizingShapes = resizing.map((node) => node.original);
    const vector = axis === "x" ? { x: change, y: 0 } : { x: 0, y: change };
    spaces.push({
      axis,
      direction,
      coordinate,
      delta: vector,
      movingShapes,
      resizingShapes,
      moves: movingShapes.map((node) => ({ node, dx: vector.x, dy: vector.y })),
      resizes: resizing.map((node) => ({
        node: node.original,
        bounds: resizeBounds(node, direction, vector),
      })),
    });
    // A corner can perform vertical then horizontal SpaceTool operations.
    // Advance only the detached geometry so the second plan retains the first.
    for (const node of moving) {
      node.x += vector.x;
      node.y += vector.y;
    }
    for (const entry of spaces.at(-1).resizes)
      Object.assign(graph.copies.get(entry.node), entry.bounds);
  }
  if (changes.bottom || changes.top) {
    const change = changes.bottom || changes.top;
    space(
      "y",
      change,
      shape.y + (changes.bottom ? shape.height - 10 : 10),
      changes.bottom ? "s" : "n",
      changes.top > 0 || changes.bottom < 0 ? -change : change,
      graph.all,
    );
  }
  if (changes.right || changes.left) {
    const change = changes.right || changes.left;
    space(
      "x",
      change,
      shape.x + (changes.right ? shape.width - 10 : 100),
      changes.right ? "e" : "w",
      changes.left > 0 || changes.right < 0 ? -change : change,
      graph.all.filter(lane),
    );
  }
  return { resizes: [], spaces };
}
