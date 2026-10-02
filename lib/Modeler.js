/* eslint-env browser */

import {
  append as svgAppend,
  attr as svgAttr,
  create as svgCreate
} from 'tiny-svg';

import { BpmnModdle } from './bpmn/moddle';

import { createLine } from 'diagram-js/lib/util/RenderUtil';
import { getApproxIntersection } from 'diagram-js/lib/util/LineIntersection';

import BpmnXyflowViewer from './Viewer';
import { buildGraph } from './Importer';
import { reconcileGraph } from './util/GraphUtil';
import { layoutImportedLabels } from './util/ImportedLabelLayout';
import { themeToken, inheritTheme } from './util/Theme';
import CommandStack from './modeling/CommandStack';
import installEditorActions from './modeling/EditorActions';
import { getExecutableAppendOptions } from './modeling/AppendOptions';
import { canStartConnection, canResizeShape, canAddLane, laneActions } from './modeling/UIActionPolicy';
import { cloneSemanticGraph } from './modeling/Clipboard';
import { planIOReplacement } from './modeling/IOReplacement';
import { planGroupCategory, planGroupMembership } from './modeling/GroupCategory';
import { getLabel } from './util/LabelUtil';
import { alignmentMoves, distributionMoves, spaceAdjustments } from './modeling/Geometry';
import { horizontalLane, laneSplitBounds, laneDeletionBounds } from './modeling/LaneLayout';
import { externalLabelResizeBounds, layoutExternalLabelBounds, externalLabelOwnerResizeDelta } from './modeling/ExternalLabelResize';
import { getReplacementOptions, getBoundaryEventOptions, isValidTarget, isValidReplacement } from './modeling/ReplaceCatalog';
import { REPLACE_OPTIONS } from './modeling/ReplaceCatalogData';
import * as contextRules from './modeling/ContextRules';
import { layoutConnection, planSegmentMove, segmentMoveAxis, remapDocking, cropConnection, connectionMidpoint, annotationAppendPosition, projectDocking, normalizeLogicalDocking } from './modeling/ConnectionRouting';
import { dependentConnectionClosure, adjustDependentWaypoints } from './modeling/ConnectionDependents';
import { getConnectionType, canReconnect, canAttachBoundary, canBeParent as canBeParentCore, getFlowScope } from './modeling/Rules';

function canBeParent(parent, child) {
  return canBeParentCore(parent, child) || (child?.type === 'bpmn:DataStoreReference' && parent?.type === 'bpmn:Collaboration' && contextRules.canDrop(child, parent));
}

function validEventDefinitionAttrs(attrs) {
  return attrs === undefined || (!!attrs && typeof attrs === 'object' && !Array.isArray(attrs) && Object.entries(attrs).every(([ key, value ]) =>
    key !== 'id' && !key.startsWith('$') && ![ '__proto__', 'prototype', 'constructor' ].includes(key) &&
    (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))));
}

function canHaveCondition(node) {
  return [ 'bpmn:Activity', 'bpmn:ExclusiveGateway', 'bpmn:InclusiveGateway' ].some(type => node?.businessObject?.$instanceOf(type));
}

const DEFAULT_SHAPE_SIZES = {
  'bpmn:Task': { width: 100, height: 80 },
  'bpmn:UserTask': { width: 100, height: 80 },
  'bpmn:ServiceTask': { width: 100, height: 80 },
  'bpmn:StartEvent': { width: 36, height: 36 },
  'bpmn:EndEvent': { width: 36, height: 36 },
  'bpmn:IntermediateThrowEvent': { width: 36, height: 36 },
  'bpmn:IntermediateCatchEvent': { width: 36, height: 36 },
  'bpmn:ExclusiveGateway': { width: 50, height: 50 },
  'bpmn:ParallelGateway': { width: 50, height: 50 },
  'bpmn:InclusiveGateway': { width: 50, height: 50 },
  'bpmn:SubProcess': { width: 350, height: 200 },
  'bpmn:Participant': { width: 600, height: 250 },
  'bpmn:Lane': { width: 570, height: 125 },
  'bpmn:BoundaryEvent': { width: 36, height: 36 },
  'bpmn:TextAnnotation': { width: 100, height: 40 },
  'bpmn:DataObjectReference': { width: 36, height: 50 },
  'bpmn:DataStoreReference': { width: 50, height: 50 },
  'bpmn:Group': { width: 300, height: 300 }
};

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${ prefix }_${ Date.now().toString(36) }_${ idCounter }`;
}

function validConnectionRoute(points) {
  return Array.isArray(points) && points.length >= 2 && Array.from(points).every((point, index) => Object.hasOwn(points, index) && point &&
    Number.isFinite(point.x) && Number.isFinite(point.y) && (!point.original ||
      (Number.isFinite(point.original.x) && Number.isFinite(point.original.y)))) &&
    points.some(point => point.x !== points[0].x || point.y !== points[0].y);
}

function usableConnectionEndpoint(element) {
  return !element?.waypoints || validConnectionRoute(element.waypoints);
}

function getMid(node) {
  if (node.waypoints) return connectionMidpoint(node);
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function connectionMid(edge) {
  return edge.waypoints.reduce((best, point, index, points) => {
    if (!index) return best;
    const previous = points[index - 1], length = Math.hypot(point.x - previous.x, point.y - previous.y);
    return !best || length > best.length ? { x: (point.x + previous.x) / 2, y: (point.y + previous.y) / 2, length } : best;
  }, null);
}

/**
 * Intersect the ray from node's mid to externalPoint with the node's
 * axis-aligned bounding box. Returns the point on the box edge.
 *
 * Used so connections stop at shape boundaries instead of passing
 * through the interior — both for visual correctness and so a click on
 * a shape body doesn't hit the connection's <path> sitting on top.
 */
const EXTERNAL_LABEL_TYPES = [
  'bpmn:StartEvent', 'bpmn:EndEvent',
  'bpmn:IntermediateThrowEvent', 'bpmn:IntermediateCatchEvent',
  'bpmn:BoundaryEvent',
  'bpmn:ExclusiveGateway', 'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway', 'bpmn:EventBasedGateway', 'bpmn:ComplexGateway',
  'bpmn:DataObjectReference', 'bpmn:DataStoreReference',
  'bpmn:DataInput', 'bpmn:DataOutput', 'bpmn:Group'
];

function hasExternalLabel(type) {
  return EXTERNAL_LABEL_TYPES.indexOf(type) !== -1;
}

function intersectBox(node, externalPoint) {
  const mid = getMid(node);
  const dx = externalPoint.x - mid.x;
  const dy = externalPoint.y - mid.y;
  if (dx === 0 && dy === 0) return mid;

  const halfW = (node.width || 0) / 2;
  const halfH = (node.height || 0) / 2;

  const tx = dx === 0 ? Infinity : Math.abs(halfW / dx);
  const ty = dy === 0 ? Infinity : Math.abs(halfH / dy);
  const t = Math.min(tx, ty);

  return { x: mid.x + dx * t, y: mid.y + dy * t };
}

function computeWaypoints(source, target) {
  if (source === target) return [
    { x: source.x + source.width, y: source.y + source.height / 2 },
    { x: source.x + source.width + 40, y: source.y + source.height / 2 },
    { x: source.x + source.width + 40, y: source.y - 40 },
    { x: source.x + source.width / 2, y: source.y - 40 },
    { x: source.x + source.width / 2, y: source.y }
  ];
  const sourceMid = getMid(source);
  const targetMid = getMid(target);
  return [
    intersectBox(source, targetMid),
    intersectBox(target, sourceMid)
  ];
}

/**
 * Crop the first/last waypoint of a connection to the actual shape
 * outline (circle for events, diamond for gateways, rounded rect for
 * activities, etc.) using the BpmnRenderer's per-shape path.
 *
 * Mirrors diagram-js's CroppingConnectionDocking.
 */
function cropWaypoints(waypoints, source, target, bpmnRenderer) {
  return cropConnection(waypoints, source, target, { getShapePath: bpmnRenderer?.getShapePath?.bind(bpmnRenderer), getConnectionPath: bpmnRenderer?.getConnectionPath?.bind(bpmnRenderer) });
}

/**
 * BpmnXyflowModeler
 *
 * Read-only viewer + minimal modeling layer:
 *  - drag shapes to move them
 *  - drag from a shape onto another to create a SequenceFlow
 *  - Delete/Backspace removes selected
 *  - palette buttons add new shapes
 *  - double-click inline-edits a label
 *  - Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z for undo/redo
 *  - getXML() returns the current BPMN serialization
 */
export default function BpmnXyflowModeler(options = {}) {
  const opts = Object.assign({
    palette: true,
    keyboard: true,
    // In modeling mode dblclick opens the inline label editor / drills
    // into a sub-process — both conflict with d3-zoom's default
    // zoom-on-dblclick. Disable unless caller explicitly opts in.
    zoomOnDoubleClick: false
  }, options);

  // delegate to the viewer for rendering, pan/zoom, selection, etc.
  const viewer = new BpmnXyflowViewer(opts);
  const internals = viewer._internals;

  const commands = CommandStack();
  let categoryContext = null;
  let importPending = false, modelImportSequence = 0, historyDefinitions = null;
  const executeCommand = commands.execute;
  // Track successful child commands so rejected/no-op operations never heal
  // unrelated imported category bindings. Nested mutations share one undo step.
  commands.execute = command => {
    const context = viewer.getGraph() && currentDiagramState();
    // Every child of a compound retains its originating graph. Replaying the
    // composite therefore keeps one global chronology without stale closures
    // mutating an inactive diagram's arrays or drawing into the wrong root.
    const rooted = context ? { ...command,
      do: () => { activateHistoryDiagram(context); return command.do(); },
      undo: () => { activateHistoryDiagram(context); return command.undo(); }
    } : command;
    executeCommand(rooted);
    if (categoryContext) categoryContext.changed = true;
  };
  for (const method of [ 'undo', 'redo' ]) {
    const historyCommand = commands[method];
    commands[method] = () => {
      if (navigationPending || importPending || viewer.getDefinitions() !== historyDefinitions) return false;
      cancelActiveGesture(); closeLabelEditor(false);
      return historyCommand();
    };
  }
  let disposeEditorActions = () => {};

  // moddle instance for creating new business objects
  const moddle = viewer.getModdle ? viewer.getModdle() : BpmnModdle(opts.moddleExtensions);

  // Forward viewer surface ////////
  this.viewer = viewer;
  this.commandStack = commands;

  // Refresh the minimap whenever the diagram changes (any command).
  commands.onChange(() => {
    clearHoverControls();
    const selected = viewer.getSelection();
    const live = selected.filter(id => { const el = viewer.getElement(id); return el && !el.hidden; });
    if (live.length !== selected.length) viewer.select(live);
    if (hoveredForConnect) destroyConnectHandle();
    refreshSelectionMarkers();
    refreshResizeHandles();
    repositionContextPad();
    if (internals && typeof internals.refreshMinimap === 'function') {
      internals.refreshMinimap();
    }
  });
  this.on = viewer.on;
  this.off = viewer.off;
  this.fitView = viewer.fitView;
  this.setViewport = viewer.setViewport;
  this.getViewport = viewer.getViewport;
  this.select = viewer.select;
  this.deselect = viewer.deselect;
  this.getSelection = viewer.getSelection;
  this.clearSelection = viewer.clearSelection;
  this.getElement = viewer.getElement;
  this.getGraph = viewer.getGraph;
  this.getDefinitions = viewer.getDefinitions;
  this.getContainer = viewer.getContainer;
  this.getSvg = viewer.getSvg;
  this.setMinimap = viewer.setMinimap;

  this.importXML = function(xml, bpmnDiagramId) {
    const request = ++modelImportSequence;
    importPending = true;
    cancelActiveGesture();
    closeLabelEditor(false);
    emitNavigationState();
    return viewer.importXML(xml, bpmnDiagramId).then(result => {
      assertCurrentGraph(result.graph, result.warnings);
      historyDefinitions = viewer.getDefinitions();
      navStack.length = 0;
      diagramStates.clear();
      clipboard = null;
      currentDiagramId = result.graph.diagram.id;
      emitNavigationState();
      resetModelingOverlays();
      commands.clear();
      ensureGridBackground();
      // wire modeling listeners after the graph is rendered
      attachModeling();
      return result;
    }).finally(() => {
      if (request === modelImportSequence) { importPending = false; emitNavigationState(); }
    });
  };

  this.destroy = function() {
    disposeEditorActions();
    cancelActiveGesture();
    closeLabelEditor(false);
    resetModelingOverlays();
    detachModeling();
    if (palette && palette.parentNode) palette.parentNode.removeChild(palette);
    viewer.destroy();
  };

  function resetModelingOverlays() {
    clearHoverControls();
    viewer.clearSelection();
    hideBendpoints();
    hideResizeHandles();
    for (const group of [ bendpointGroup, resizeGroup, selectionMarkers ]) {
      if (group && group.parentNode) group.parentNode.removeChild(group);
    }
    bendpointGroup = resizeGroup = selectionMarkers = null;
    destroyContextPad();
    destroyReplaceMenu();
    destroyConnectHandle();
    destroyRightClickMenu();
  }

  // Shared modeling helpers ///////
  function getEdgesConnectedTo(node) {
    const graph = viewer.getGraph();
    if (!graph) return [];
    return graph.edges.filter(e => e.source === node || e.target === node);
  }

  function syncEdgeDi(edge, provenance) {
    if (edge.di) {
      const existing = edge.di.waypoint || [];
      const used = new Set(), retained = new Map(), reserved = new Set([ existing[0], existing.at(-1) ]);
      // Reserve surviving interior points before assigning moved points by
      // index. A same-count insert+remove must not move a retained point's
      // vendor metadata onto the newly inserted coordinate.
      edge.waypoints.slice(1, -1).forEach((point, offset) => {
        const match = existing.slice(1, -1).find(candidate => !reserved.has(candidate) && candidate.x === point.x && candidate.y === point.y);
        if (match) { retained.set(offset + 1, match); reserved.add(match); }
      });
      edge.di.waypoint = edge.waypoints.map((p, index) => {
        let point = provenance && provenance[index];
        if (point) { /* A known translation keeps waypoint identity by construction. */ }
        else if (index === 0) point = existing[0];
        else if (index === edge.waypoints.length - 1) point = existing.at(-1);
        else if (retained.has(index)) point = retained.get(index);
        else if (existing.length === edge.waypoints.length && !reserved.has(existing[index])) point = existing[index];
        if (!point || used.has(point)) point = moddle.create('dc:Point');
        used.add(point);
        point.x = p.x; point.y = p.y; point.$parent = edge.di;
        return point;
      });
    }
  }

  function normalizedConnectionRoute(points, source, target) {
    try { return normalizeLogicalDocking(points, source, target); }
    catch (error) { if (error.code === 'UNROUTABLE_DOCKING') return null; throw error; }
  }

  function routeConnection(edge, hints = {}) {
    const renderer = internals.renderer && internals.renderer.bpmnRenderer;
    try {
      return layoutConnection(edge, hints, { elements: viewer.getGraph()?.nodes || [],
        getShapePath: renderer?.getShapePath?.bind(renderer), getConnectionPath: renderer?.getConnectionPath?.bind(renderer) });
    } catch (error) {
      if (error.code === 'UNROUTABLE_DOCKING') return null;
      throw error;
    }
  }

  function connectionGeometry(edge) {
    return { waypoints: edge.waypoints.map(point => ({ ...point, ...(point.original ? { original: { ...point.original } } : {}) })),
      diWaypoints: edge.di?.waypoint?.map(point => ({ point, x: point.x, y: point.y })) };
  }

  function restoreConnectionGeometry(edge, snapshot) {
    edge.waypoints = snapshot.waypoints.map(point => ({ ...point, ...(point.original ? { original: { ...point.original } } : {}) }));
    if (snapshot.diWaypoints && edge.di) {
      edge.di.waypoint = snapshot.diWaypoints.map(({ point, x, y }) => { point.x = x; point.y = y; return point; });
    } else syncEdgeDi(edge);
  }

  function orderedConnections(edges) {
    const included = new Set(edges), seen = new Set(), result = [];
    function visit(edge) {
      if (seen.has(edge)) return;
      seen.add(edge);
      for (const endpoint of [ edge.source, edge.target ]) if (included.has(endpoint)) visit(endpoint);
      result.push(edge);
    }
    edges.forEach(visit);
    return result;
  }

  function connectionSnapshots(roots) {
    const all = [ ...new Set([ ...roots, ...dependentConnectionClosure(roots, viewer.getGraph()?.edges || []) ]) ];
    return orderedConnections(all).map(edge => ({ edge, ...connectionGeometry(edge) }));
  }

  function redrawConnections(entries) {
    entries.forEach(({ edge }) => { if (viewer.getElement(edge.id) === edge) internals.redrawConnection(edge); });
    refreshBendpoints();
  }

  function restoreConnections(entries) {
    entries.forEach(({ edge, ...snapshot }) => restoreConnectionGeometry(edge, snapshot));
    redrawConnections(entries);
  }

  function propagateDependentGeometry(entries, hintsByOwner = new Map(), edited = new Set(), preserveCurrent = false) {
    const before = new Map(entries.map(entry => [ entry.edge, entry ]));
    for (const entry of entries) {
      const { edge } = entry;
      if (edited.has(edge) || !edge.source?.waypoints && !edge.target?.waypoints) continue;
      const provenance = preserveCurrent ? edge.di?.waypoint?.slice() : entry.diWaypoints?.map(value => value.point);
      let points = preserveCurrent ? edge.waypoints.map(point => ({ ...point })) : entry.waypoints;
      for (const side of [ 'source', 'target' ]) {
        const owner = edge[side], previous = before.get(owner);
        if (preserveCurrent && owner?.waypoints) { const index = side === 'source' ? 0 : points.length - 1; points[index] = entry.waypoints[side === 'source' ? 0 : entry.waypoints.length - 1]; }
        if (!previous || sameWaypoints(previous.waypoints, owner.waypoints)) continue;
        points = adjustDependentWaypoints({ ...edge, waypoints: points }, side, previous.waypoints, owner.waypoints, hintsByOwner.get(owner) || {}) || points;
      }
      edge.waypoints = points.map(point => ({ ...point, ...(point.original ? { original: { ...point.original } } : {}) }));
      syncEdgeDi(edge, provenance?.length === points.length ? provenance : undefined);
    }
  }

  function segmentEditHints(edge, before, index, delta, axis) {
    const coordinate = before[index][axis] + delta[axis], other = axis === 'x' ? 'y' : 'x';
    const midpoint = (before[index][other] + before[index + 1][other]) / 2;
    const matches = edge.waypoints.slice(1).flatMap((point, i) => {
      const start = edge.waypoints[i];
      if (Math.abs(start[axis] - coordinate) > 1e-7 || Math.abs(point[axis] - coordinate) > 1e-7) return [];
      const low = Math.min(start[other], point[other]), high = Math.max(start[other], point[other]);
      return [ { index: i, distance: Math.max(low - midpoint, midpoint - high, 0) } ];
    }).sort((a, b) => a.distance - b.distance);
    return matches.length ? { segmentMove: { segmentStartIndex: index, newSegmentStartIndex: matches[0].index } } : {};
  }

  function sameWaypoints(a, b) {
    return a.length === b.length && a.every((point, index) => Math.abs(point.x - b[index].x) < 1e-8 && Math.abs(point.y - b[index].y) < 1e-8);
  }

  function sameGeometry(a, b) {
    return a.shapes.length === b.shapes.length && a.shapes.every((shape, index) =>
      shape.node === b.shapes[index].node && [ 'x', 'y', 'width', 'height' ].every(key => shape[key] === b.shapes[index][key])) &&
      a.edges.length === b.edges.length && a.edges.every((entry, index) => entry.edge === b.edges[index].edge && sameWaypoints(entry.waypoints, b.edges[index].waypoints));
  }

  /**
   * Drop any intermediate waypoint that sits on the line between its
   * immediate neighbours (cross-product = 0 within tolerance). Called
   * after bend / segment edits so the path stays minimal.
   */
  function dropCollinear(waypoints) {
    if (waypoints.length <= 2) return waypoints;
    const out = [ waypoints[0] ];
    for (let i = 1; i < waypoints.length - 1; i++) {
      const a = out[out.length - 1];
      const b = waypoints[i];
      const c = waypoints[i + 1];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const between = (b.x - a.x) * (b.x - c.x) + (b.y - a.y) * (b.y - c.y) <= 1e-8;
      if (Math.abs(cross) > 1e-8 || !between) out.push(b);
    }
    out.push(waypoints[waypoints.length - 1]);
    return out;
  }

  // Bendpoint overlay //////////////
  // When a single connection is selected, render small grab handles at
  // every waypoint. Drag a handle to move that waypoint; mousedown on
  // the connection's line (not on a handle) inserts a new waypoint at
  // the click point and starts dragging it.

  let bendpointEdge = null;
  let bendpointHandles = [];
  let segmentHandles = [];
  let bendpointGroup = null;
  let bendDragState = null;

  function ensureBendpointGroup() {
    if (bendpointGroup) return bendpointGroup;
    bendpointGroup = svgCreate('g', { 'class': 'bpmn-xyflow-bendpoints' });
    // stick it on top of everything inside the viewport so handles
    // pan/zoom with the diagram but always sit above shapes/edges
    svgAppend(internals.viewport, bendpointGroup);
    return bendpointGroup;
  }

  function showBendpoints(edge, retainedHoverGroup) {
    hideBendpoints();
    bendpointEdge = edge;
    if (retainedHoverGroup) {
      // Keep native click/double-click targeting stable across hover selection.
      // Promote the same SVG hit nodes instead of replacing them on first up.
      bendpointGroup?.remove();
      bendpointGroup = retainedHoverGroup;
      retainedHoverGroup.setAttribute('class', 'bpmn-xyflow-bendpoints');
      retainedHoverGroup.removeAttribute('pointer-events'); retainedHoverGroup.removeAttribute('data-element-id');
      svgAttr(retainedHoverGroup, 'pointer-events', '');
      for (const child of retainedHoverGroup.querySelectorAll('.bpmn-xyflow-hover-segment,.bpmn-xyflow-hover-floating')) child.remove();
      for (const entry of retainedHoverGroup.querySelectorAll('.bpmn-xyflow-hover-bendpoint')) {
        const index = Number(entry.getAttribute('data-bend-index')), point = edge.waypoints[index];
        const [handle, hit] = entry.querySelectorAll('circle');
        entry.removeAttribute('transform'); entry.setAttribute('class', 'bpmn-xyflow-bendpoint-entry');
        for (const node of [handle, hit]) {
          svgAttr(node, { cx: point.x, cy: point.y, 'data-element-id': edge.id, 'data-bend-index': String(index) });
          node.style.cursor = 'move';
        }
        handle.setAttribute('class', 'bpmn-xyflow-bendpoint'); handle.removeAttribute('pointer-events');
        svgAttr(handle, { 'stroke-width': 1.5, 'pointer-events': '' });
        hit.setAttribute('class', 'bpmn-xyflow-bendpoint-hit'); hit.setAttribute('r', 10 / viewer.getViewport().zoom);
        bendpointHandles.push({ handle, hit });
      }
      svgAppend(internals.viewport, retainedHoverGroup);
      renderSegmentHandles(edge);
      return;
    }
    const g = ensureBendpointGroup();
    edge.waypoints.forEach((wp, i) => {
      const hit = svgCreate('circle', {
        'class': 'bpmn-xyflow-bendpoint-hit', cx: wp.x, cy: wp.y,
        r: 10 / viewer.getViewport().zoom, fill: 'transparent',
        'data-element-id': edge.id, 'data-bend-index': String(i)
      });
      hit.style.cursor = 'move'; svgAppend(g, hit);
      const handle = svgCreate('circle', {
        'class': 'bpmn-xyflow-bendpoint',
        cx: wp.x, cy: wp.y, r: 4,
        fill: themeToken('surface'),
        stroke: themeToken('canvas-accent'),
        'stroke-width': 1.5,
        // tag with the parent edge so viewer.selection treats a click
        // on the handle as a click on the edge (keeps the edge selected
        // and prevents the handles from being hidden between clicks)
        'data-element-id': edge.id,
        'data-bend-index': String(i)
      });
      handle.style.cursor = 'move';
      svgAppend(g, handle);
      bendpointHandles.push({ handle, hit });
    });
    renderSegmentHandles(edge);
  }

  function renderSegmentHandles(edge) {
    segmentHandles.forEach(handle => handle.remove()); segmentHandles = [];
    const scale = viewer.getViewport().zoom, group = ensureBendpointGroup();
    edge.waypoints.slice(1).forEach((end, index) => {
      const start = edge.waypoints[index], moveAxis = segmentMoveAxis(start, end), horizontal = moveAxis === 'y';
      if (!moveAxis) return;
      if (Math.hypot(end.x - start.x, end.y - start.y) * scale < 24) return;
      const handle = svgCreate('g', { 'class': 'bpmn-xyflow-segment-handle',
        'data-element-id': edge.id, 'data-segment-index': String(index),
        transform: `translate(${(start.x + end.x) / 2},${(start.y + end.y) / 2})` });
      handle.style.cursor = horizontal ? 'ns-resize' : 'ew-resize';
      svgAppend(handle, svgCreate('rect', { x: -10 / scale, y: -10 / scale, width: 20 / scale, height: 20 / scale, fill: 'transparent' }));
      svgAppend(handle, svgCreate('rect', { x: (horizontal ? -8 : -3) / scale, y: (horizontal ? -3 : -8) / scale,
        width: (horizontal ? 16 : 6) / scale, height: (horizontal ? 6 : 16) / scale, rx: 2 / scale,
        fill: themeToken('surface'), stroke: themeToken('canvas-accent'), 'stroke-width': 1 / scale, 'pointer-events': 'none' }));
      svgAppend(group, handle); segmentHandles.push(handle);
    });
  }

  function hideBendpoints() {
    bendpointHandles.forEach(({ handle, hit }) => { handle.remove(); hit.remove(); });
    segmentHandles.forEach(handle => handle.remove()); segmentHandles = [];
    bendpointHandles = [];
    bendpointGroup?.replaceChildren();
    bendpointEdge = null;
  }

  function refreshBendpoints() {
    if (!bendpointEdge) return;
    // if the waypoint count changed, re-render
    if (bendpointHandles.length !== bendpointEdge.waypoints.length) {
      showBendpoints(bendpointEdge);
      return;
    }
    bendpointHandles.forEach(({ handle, hit }, i) => {
      for (const node of [ handle, hit ]) {
        node.setAttribute('cx', bendpointEdge.waypoints[i].x);
        node.setAttribute('cy', bendpointEdge.waypoints[i].y);
      }
      hit.setAttribute('r', 10 / viewer.getViewport().zoom);
    });
    renderSegmentHandles(bendpointEdge);
  }

  // Unselected connection controls follow pinned diagram-js Bendpoints:
  // graph-unit hit geometry, no selection on hover, and a 5 CSS-pixel drag
  // threshold. Selected controls retain their existing screen-sized targets.
  let hoveredConnection = null;
  let hoverControls = null;
  let hoverDragPending = null;
  let hoverControlActive = false;

  function hideHoverControls() {
    hoverControls?.remove();
    hoverControls = null;
    hoveredConnection = null;
  }

  function clearHoverControls() {
    hideHoverControls();
    hoverDragPending = null;
    hoverControlActive = false;
    if (bendpointGroup) bendpointGroup.style.display = '';
  }

  function hoverIntersection(edge, p, altKey = false) {
    const intersection = getApproxIntersection(edge.waypoints, p);
    if (!intersection) return null;
    if (intersection.bendpoint) return { kind: 'bend', index: intersection.index };
    const index = intersection.index - 1, a = edge.waypoints[index], b = edge.waypoints[index + 1];
    if (!a || !b) return null;
    const axis = segmentMoveAxis(a, b), length = axis === 'y' ? b.x - a.x : b.y - a.y;
    const threshold = Math.abs(Math.round(length * 2 / 3)) / 2;
    const middle = axis && Math.abs(intersection.point.x - (a.x + b.x) / 2) <= threshold &&
      Math.abs(intersection.point.y - (a.y + b.y) / 2) <= threshold;
    return { kind: middle && !altKey ? 'segment' : 'insert', index: middle && !altKey ? index : index + 1, point: intersection.point };
  }

  function renderHoverControls(edge) {
    destroyConnectHandle();
    hideHoverControls();
    hoveredConnection = edge;
    const group = hoverControls = svgCreate('g', {
      'class': 'bpmn-xyflow-hover-controls', 'data-element-id': edge.id,
      'pointer-events': 'none'
    });
    // Keep existing selected controls above the transient set.
    internals.viewport.insertBefore(group, bendpointGroup || null);
    edge.waypoints.forEach((point, index) => {
      const handle = svgCreate('g', { 'class': 'bpmn-xyflow-hover-bendpoint',
        'data-element-id': edge.id, 'data-bend-index': String(index),
        transform: `translate(${point.x},${point.y})` });
      handle.style.cursor = 'move';
      svgAppend(handle, svgCreate('circle', { r: 4, fill: themeToken('surface'),
        stroke: themeToken('canvas-accent'), 'stroke-width': 1, 'pointer-events': 'none' }));
      svgAppend(handle, svgCreate('circle', { 'class': 'bpmn-xyflow-hover-bendpoint-hit',
        r: 10, fill: 'transparent', 'pointer-events': 'all' }));
      svgAppend(group, handle);
    });
    edge.waypoints.slice(1).forEach((end, index) => {
      const start = edge.waypoints[index], axis = segmentMoveAxis(start, end);
      if (!axis) return;
      const horizontal = axis === 'y', length = horizontal ? end.x - start.x : end.y - start.y;
      const width = Math.abs(Math.round(length * 2 / 3));
      if (!width) return;
      const handle = svgCreate('g', { 'class': 'bpmn-xyflow-hover-segment',
        'data-element-id': edge.id, 'data-segment-index': String(index),
        transform: `translate(${(start.x + end.x) / 2},${(start.y + end.y) / 2})` });
      handle.style.cursor = horizontal ? 'ns-resize' : 'ew-resize';
      svgAppend(handle, svgCreate('rect', { 'class': 'bpmn-xyflow-hover-segment-hit',
        x: horizontal ? -width / 2 : -8.5, y: horizontal ? -8.5 : -width / 2,
        width: horizontal ? width : 17, height: horizontal ? 17 : width,
        fill: 'transparent', 'pointer-events': 'all' }));
      svgAppend(handle, svgCreate('rect', { 'class': 'bpmn-xyflow-hover-segment-visual',
        x: horizontal ? -9 : -3, y: horizontal ? -3 : -9,
        width: horizontal ? 18 : 6, height: horizontal ? 6 : 18, rx: 3,
        fill: themeToken('surface'), stroke: themeToken('canvas-accent'),
        'stroke-width': 1, 'pointer-events': 'none', visibility: 'hidden' }));
      svgAppend(group, handle);
    });
    svgAppend(group, svgCreate('circle', { 'class': 'bpmn-xyflow-hover-floating', r: 4,
      fill: themeToken('surface'), stroke: themeToken('canvas-accent'), 'stroke-width': 1,
      'pointer-events': 'none', visibility: 'hidden' }));
  }

  function updateHoverControls(event) {
    if (event.pointerType === 'touch' || hoverDragPending) return;
    const busy = hoverControlActive || dragState || connectState || bendDragState || segmentDragState ||
      resizeDragState || lassoState || labelDragState || labelNodeDragState || paletteGesture;
    // Global move events may target Window (including programmatic events),
    // or arrive outside this SVG while an existing drag is still active.
    // Only DOM nodes can be passed to contains; hover absence must not stop
    // the remaining move/resize/reconnect handlers from processing the event.
    const target = event.target;
    const id = target?.nodeType && viewer.getSvg().contains(target) && internals.findElementId(target);
    const edge = id && viewer.getElement(id), selection = viewer.getSelection();
    if (busy || selection.length > 1 || !edge?.waypoints || edge.hidden || selection.includes(id) ||
        closestWithAttr(event.target, 'data-connection-label')) { hideHoverControls(); return; }
    if (hoveredConnection !== edge || !hoverControls?.isConnected) renderHoverControls(edge);
    const p = internals.toGraph(event.clientX, event.clientY), intersection = getApproxIntersection(edge.waypoints, p);
    for (const visual of hoverControls.querySelectorAll('.bpmn-xyflow-hover-segment-visual')) visual.setAttribute('visibility', 'hidden');
    const floating = hoverControls.querySelector('.bpmn-xyflow-hover-floating');
    floating.setAttribute('visibility', 'hidden');
    if (!intersection) return;
    if (!intersection.bendpoint) {
      floating.setAttribute('cx', intersection.point.x); floating.setAttribute('cy', intersection.point.y);
      floating.setAttribute('visibility', 'visible');
      const hitTarget = document.elementFromPoint?.(event.clientX, event.clientY) || event.target;
      const segment = closestWithAttr(hitTarget, 'data-segment-index');
      if (segment?.closest('.bpmn-xyflow-hover-controls') === hoverControls) {
        const index = Number(segment.getAttribute('data-segment-index')), a = edge.waypoints[index], b = edge.waypoints[index + 1];
        const visual = segment.querySelector('.bpmn-xyflow-hover-segment-visual');
        visual.setAttribute('transform', `translate(${intersection.point.x - (a.x + b.x) / 2},${intersection.point.y - (a.y + b.y) / 2})`);
        visual.setAttribute('visibility', 'visible');
      }
    }
  }

  function armHoverDrag(edge, event) {
    const startPoint = internals.toGraph(event.clientX, event.clientY), descriptor = hoverIntersection(edge, startPoint, event.altKey);
    if (!descriptor) return false;
    hoverDragPending = { edge, descriptor, startPoint, client: { x: event.clientX, y: event.clientY }, selection: viewer.getSelection() };
    destroyConnectHandle();
    event.stopPropagation(); event.preventDefault();
    return true;
  }

  function activateHoverDrag(event) {
    const pending = hoverDragPending;
    if (!pending) return false;
    if (viewer.getElement(pending.edge.id) !== pending.edge) { clearHoverControls(); return false; }
    if (Math.hypot(event.clientX - pending.client.x, event.clientY - pending.client.y) <= 5) return true;
    const { edge, descriptor, startPoint } = pending;
    hoverDragPending = null; hoverControlActive = true;
    hideHoverControls();
    if (bendpointGroup) bendpointGroup.style.display = 'none';
    if (descriptor.kind === 'segment') startSegmentDrag(edge, descriptor.index, startPoint);
    else {
      const original = edge.waypoints.slice(), geometry = connectionGeometry(edge), inserted = descriptor.kind === 'insert';
      if (inserted) {
        edge.waypoints.splice(descriptor.index, 0, { ...descriptor.point });
        syncEdgeDi(edge); internals.redrawConnection(edge);
      }
      startBendDrag(edge, descriptor.index, original, inserted, geometry, startPoint);
    }
    return false;
  }

  // perpendicular distance from p to segment ab (graph coords)
  function pointToSegmentDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function startBendDrag(edge, wpIndex, originalWaypoints, inserted, originalGeometry = connectionGeometry(edge), startPoint) {
    destroyConnectHandle();
    const bundle = connectionSnapshots([ edge ]);
    Object.assign(bundle.find(entry => entry.edge === edge), originalGeometry, { waypoints: originalWaypoints.map(point => ({ ...point })) });
    bendDragState = {
      edge, bundle,
      wpIndex,
      originalWaypoints, // the waypoints array prior to this drag (for undo)
      originalGeometry,
      startPoint,
      inserted,          // true if we inserted a fresh waypoint at drag start
      moved: false
    };
  }

  function updateBendDrag(p, event) {
    if (!bendDragState) return;
    bendDragState.lastPoint = p;
    const { edge, wpIndex, originalWaypoints, inserted } = bendDragState;
    const endpoint = !inserted && (wpIndex === 0 || wpIndex === originalWaypoints.length - 1);
    if (endpoint) {
      const side = wpIndex === 0 ? 'source' : 'target';
      const candidate = event && elementAtPoint(event.clientX, event.clientY, { skip: edge, acceptEdge: candidate => !!canReconnect(edge, side, candidate) });
      if (candidate && canReconnect(edge, side, candidate)) {
        const source = side === 'source' ? candidate : edge.source, target = side === 'target' ? candidate : edge.target;
        edge.waypoints = routeConnection(edge, { source, target, waypoints: originalWaypoints,
          connectionStart: side === 'source' ? p : originalWaypoints[0],
          connectionEnd: side === 'target' ? p : originalWaypoints.at(-1), preserveDocking: 'both' }) || originalWaypoints.map(point => ({ ...point }));
      } else {
        edge.waypoints = originalWaypoints.map(point => ({ ...point }));
        edge.waypoints[wpIndex] = { ...p };
      }
    } else {
      const wp = edge.waypoints[wpIndex];
      if (wp.x === p.x && wp.y === p.y) return;
      edge.waypoints[wpIndex] = { x: p.x, y: p.y };
    }
    bendDragState.moved = true;
    syncEdgeDi(edge);
    const hints = endpoint ? { [wpIndex === 0 ? 'connectionStart' : 'connectionEnd']: true } : { bendpointMove: { insert: !!inserted, bendpointIndex: wpIndex } };
    propagateDependentGeometry(bendDragState.bundle, new Map([ [ edge, hints ] ]), new Set([ edge ]));
    redrawConnections(bendDragState.bundle);
  }

  // Segment perpendicular drag /////
  let segmentDragState = null;

  function startSegmentDrag(edge, segIdx, startPoint) {
    destroyConnectHandle();
    const a = edge.waypoints[segIdx], b = edge.waypoints[segIdx + 1];
    if (!a || !b || (a.x === b.x && a.y === b.y)) return;
    const moveAxis = segmentMoveAxis(a, b);
    if (!moveAxis) return;
    segmentDragState = { edge, segIdx, startPoint, axis: moveAxis,
      originalWaypoints: edge.waypoints.map(point => ({ ...point })), originalGeometry: connectionGeometry(edge), bundle: connectionSnapshots([ edge ]), moved: false };
  }

  function updateSegmentDrag(p) {
    if (!segmentDragState) return;
    segmentDragState.lastPoint = p;
    const { edge, segIdx, startPoint, originalWaypoints } = segmentDragState;
    const renderer = internals.renderer && internals.renderer.bpmnRenderer;
    const next = planSegmentMove({ ...edge, waypoints: originalWaypoints }, segIdx,
      { x: p.x - startPoint.x, y: p.y - startPoint.y }, { getShapePath: renderer?.getShapePath?.bind(renderer), getConnectionPath: renderer?.getConnectionPath?.bind(renderer) });
    if (JSON.stringify(next) === JSON.stringify(edge.waypoints)) return;
    edge.waypoints = next;
    syncEdgeDi(edge);
    segmentDragState.hints = segmentEditHints(edge, originalWaypoints, segIdx, { x: p.x - startPoint.x, y: p.y - startPoint.y }, segmentDragState.axis);
    propagateDependentGeometry(segmentDragState.bundle, new Map([ [ edge, segmentDragState.hints ] ]), new Set([ edge ]));
    redrawConnections(segmentDragState.bundle);
    segmentDragState.moved = true;
  }

  function endSegmentDrag() {
    if (!segmentDragState) return;
    const { edge, originalWaypoints, bundle, segIdx, moved, startPoint, lastPoint, axis } = segmentDragState;
    segmentDragState = null;
    if (!moved) return;
    if (lastPoint && Math.abs(lastPoint[axis] - startPoint[axis]) < 1e-8) {
      restoreConnections(bundle); return;
    }
    const finalWaypoints = dropCollinear(edge.waypoints);
    const hints = segmentEditHints({ waypoints: finalWaypoints }, originalWaypoints, segIdx, { x: lastPoint.x - startPoint.x, y: lastPoint.y - startPoint.y }, axis);
    restoreConnections(bundle);
    updateWaypoints(edge, finalWaypoints, hints);
  }

  function endBendDrag(evt) {
    if (!bendDragState) return;
    const { edge, wpIndex, originalWaypoints, bundle, moved, inserted, startPoint, lastPoint } = bendDragState;
    bendDragState = null;
    if (!moved || (startPoint && lastPoint && Math.hypot(lastPoint.x - startPoint.x, lastPoint.y - startPoint.y) < 1e-8)) {
      restoreConnections(bundle); return;
    }
    const endpoint = !inserted && (wpIndex === 0 || wpIndex === originalWaypoints.length - 1);
    const final = dropCollinear(edge.waypoints).map(p => ({ ...p }));
    restoreConnections(bundle);
    if (endpoint) {
      const side = wpIndex === 0 ? 'source' : 'target';
      const candidate = evt && elementAtPoint(evt.clientX, evt.clientY, { skip: edge, acceptEdge: candidate => !!canReconnect(edge, side, candidate) });
      if (candidate && canReconnect(edge, side, candidate)) {
        const source = side === 'source' ? candidate : edge.source, target = side === 'target' ? candidate : edge.target;
        const position = internals.toGraph(evt.clientX, evt.clientY);
        const points = routeConnection(edge, { source, target, waypoints: originalWaypoints,
          connectionStart: side === 'source' ? position : originalWaypoints[0],
          connectionEnd: side === 'target' ? position : originalWaypoints.at(-1), preserveDocking: 'both' });
        if (points) {
          if (candidate === edge[side]) updateWaypoints(edge, points, { [side === 'source' ? 'connectionStart' : 'connectionEnd']: true });
          else reconnectConnection(edge, side, candidate, points);
        }
      }
      // Empty canvas / invalid endpoint is a cancelled reconnect.
      internals.redrawConnection(edge);
      refreshBendpoints();
      return;
    }
    const renderer = internals.renderer && internals.renderer.bpmnRenderer;
    const points = cropWaypoints(final, edge.source, edge.target, renderer);
    const hints = points.length === originalWaypoints.length + (inserted ? 1 : 0) ? { bendpointMove: { insert: !!inserted, bendpointIndex: wpIndex } } : {};
    updateWaypoints(edge, points, hints);
  }

  // Context pad ////////////////////
  // Floating action menu rendered next to a selected element. Mirrors
  // bpmn-js's signature UI: delete, append-task, connect, change-type.

  let contextPad = null;

  function destroyContextPad() {
    if (contextPad && contextPad.parentNode) contextPad.parentNode.removeChild(contextPad);
    contextPad = null;
  }

  function makePadButton(label, title, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    Object.assign(b.style, {
      width: '24px', height: '24px',
      border: `1px solid ${ themeToken('border') }`, background: themeToken('surface-overlay'), borderRadius: themeToken('radius-md'),
      cursor: 'pointer', font: '13px/1 -apple-system, BlinkMacSystemFont, sans-serif',
      padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    b.addEventListener('mouseenter', () => { b.style.background = themeToken('surface-medium'); b.style.borderColor = themeToken('canvas-accent'); });
    b.addEventListener('mouseleave', () => { b.style.background = themeToken('surface-overlay'); b.style.borderColor = themeToken('border'); });
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return b;
  }

  function showContextPad(element) {
    destroyContextPad();
    if (!element || element.type === 'label' || element.hidden) return;

    const container = viewer.getContainer();
    const containerRect = container.getBoundingClientRect();
    const gfx = internals.elementGfx(element.id);
    if (!gfx) return;
    const elRect = gfx.getBoundingClientRect();

    contextPad = document.createElement('div');
    contextPad.className = 'bpmn-xyflow-context-pad';
    Object.assign(contextPad.style, {
      position: 'absolute',
      left: (elRect.right - containerRect.left + 6) + 'px',
      top: (elRect.top - containerRect.top - 6) + 'px',
      display: 'grid',
      gridTemplateColumns: 'repeat(2, auto)',
      gap: '4px',
      padding: '4px',
      background: themeToken('surface'),
      border: `1px solid ${ themeToken('border') }`,
      borderRadius: themeToken('radius-lg'),
      boxShadow: `0 2px 6px ${ themeToken('shadow-subtle') }`,
      zIndex: 6
    });

    contextPad.appendChild(makePadButton('×', 'Delete', () => {
      deleteModelElement(element);
      destroyContextPad();
    }));

    const connectButton = makePadButton('→', 'Connect — drag to a target shape', () => {
      // A short press arms click-to-target. A press-drag has already begun
      // through the mousedown transition and must not start a second flow.
      if (!connectState || connectState.source !== element) {
        cancelActiveGesture();
        startConnect(element, element.x + element.width, element.y + element.height / 2);
      }
      destroyContextPad();
    });
    connectButton.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); cancelActiveGesture();
      startConnect(element, element.x + element.width, element.y + element.height / 2);
      Object.assign(connectState, { originButton: connectButton, startClient: { x: event.clientX, y: event.clientY }, moved: false });
    });
    if (canStartConnection(element)) contextPad.appendChild(connectButton);

    for (const entry of getExecutableAppendOptions(element)) {
      const icon = entry.target.type === 'bpmn:TextAnnotation' ? '≡' : entry.target.type === 'bpmn:ExclusiveGateway' ? '◇' : entry.target.type.endsWith('Event') ? '○' : '▭';
      const button = makePadButton(icon, entry.label, event => {
        if (button._suppressClick && event.detail !== 0) { button._suppressClick = false; return; }
        button._suppressClick = false;
        appendShape(element, entry);
      });
      button.dataset.action = entry.actionName;
      button.setAttribute('aria-label', entry.label);
      button.addEventListener('mousedown', event => startAppendDrag(event, element, entry, button));
      contextPad.appendChild(button);
    }

    if (replacementMenuEntries(element).length) contextPad.appendChild(makePadButton('⇆', 'Change type — opens a quick replace menu', (e) => {
      openReplaceMenu(element, e.clientX, e.clientY);
    }));
    if (getBoundaryEventOptions(element).length) contextPad.appendChild(makePadButton('◷', 'Attach boundary event', e => openReplaceMenu(element, e.clientX, e.clientY, 'boundary')));
    if (hasSubProcessContents(element.businessObject)) contextPad.appendChild(makePadButton('!', 'Replace and remove contents', e => openReplaceMenu(element, e.clientX, e.clientY, 'remove-contents')));

    for (const action of laneActions(element)) contextPad.appendChild(makePadButton(action.action === 'split' ? '÷' : action.action === 'before' ? '↑+' : '↓+',
      action.label, () => action.action === 'split' ? splitLane(element, action.count) : addLane(element, action.action)));

    container.appendChild(contextPad);

    // Flip / clamp so the pad stays inside the container.
    const padRect = contextPad.getBoundingClientRect();
    if (element.waypoints) {
      // A connection pad belongs above its longest segment, not over the
      // target shape where it would intercept redocking and ordinary clicks.
      const middle = connectionMid(element), viewport = viewer.getViewport();
      contextPad.style.left = (middle.x * viewport.zoom + viewport.x - padRect.width / 2) + 'px';
      contextPad.style.top = (middle.y * viewport.zoom + viewport.y - padRect.height - 12) + 'px';
    }
    let leftPx = parseFloat(contextPad.style.left);
    let topPx = parseFloat(contextPad.style.top);
    const overflowRight = (leftPx + padRect.width) - containerRect.width;
    if (overflowRight > 0) {
      // place to the left of the shape instead
      leftPx = (elRect.left - containerRect.left) - padRect.width - 6;
      if (leftPx < 4) leftPx = 4;
      contextPad.style.left = leftPx + 'px';
    }
    const overflowBottom = (topPx + padRect.height) - containerRect.height;
    if (overflowBottom > 0) {
      topPx = Math.max(4, topPx - overflowBottom - 4);
      contextPad.style.top = topPx + 'px';
    }
    if (topPx < 0) contextPad.style.top = '4px';
  }

  function repositionContextPad() {
    if (!contextPad) return;
    const ids = viewer.getSelection();
    if (ids.length !== 1) { destroyContextPad(); return; }
    const el = viewer.getElement(ids[0]);
    if (el && !el.hidden) showContextPad(el);
    else destroyContextPad();
  }

  // Replace menu ///////////////////
  let replaceMenu = null;
  let replaceMenuOff = null;

  function destroyReplaceMenu() {
    if (replaceMenuOff) window.removeEventListener('mousedown', replaceMenuOff, true);
    replaceMenuOff = null;
    if (replaceMenu && replaceMenu.parentNode) replaceMenu.parentNode.removeChild(replaceMenu);
    replaceMenu = null;
  }

  function openReplaceMenu(element, clientX, clientY, mode) {
    destroyReplaceMenu();
    const candidates = mode === 'boundary' ? getBoundaryEventOptions(element) : mode === 'remove-contents'
      ? REPLACE_OPTIONS.TASK.filter(entry => /Task$|CallActivity$/.test(entry.target?.type))
      : replacementMenuEntries(element);
    const items = candidates.map(entry => mode !== 'boundary' && entry.target &&
      !replaceShape(element, entry.target, {}, { removeContents: true, removeIncompatibleData: true }, undefined, true)
      ? { ...entry, disabled: true } : entry);
    if (!items.length) return;

    const container = viewer.getContainer();
    const containerRect = container.getBoundingClientRect();

    replaceMenu = document.createElement('div');
    replaceMenu.className = 'bpmn-xyflow-replace-menu';
    Object.assign(replaceMenu.style, {
      position: 'absolute',
      left: (clientX - containerRect.left) + 'px',
      top: (clientY - containerRect.top + 8) + 'px',
      background: themeToken('surface-overlay'),
      border: `1px solid ${ themeToken('border') }`,
      borderRadius: themeToken('radius-lg'),
      boxShadow: `0 4px 12px ${ themeToken('shadow') }`,
      padding: '4px 0',
      minWidth: '160px',
      zIndex: 8,
      font: '12px -apple-system, BlinkMacSystemFont, sans-serif'
    });

    items.forEach(entry => {
      const { label, target } = entry;
      const item = document.createElement('div');
      item.textContent = label;
      item.setAttribute('role', entry.header ? 'menuitemcheckbox' : 'menuitem');
      if (entry.header) item.setAttribute('aria-checked', String(entry.active));
      if (entry.disabled) {
        item.setAttribute('aria-disabled', 'true');
        item.title = 'Unavailable: existing contents, attached events or IO references cannot be preserved safely';
        item.style.opacity = '0.5';
      }
      item.dataset.action = entry.actionName;
      item.tabIndex = entry.disabled ? -1 : 0;
      Object.assign(item.style, {
        padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap'
      });
      item.addEventListener('mouseenter', () => { item.style.background = themeToken('surface-medium'); });
      item.addEventListener('mouseleave', () => { item.style.background = themeToken('surface-overlay'); });
      item.addEventListener('mousedown', e => e.stopPropagation());
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (entry.disabled) return;
        const finish = options => {
          if (mode === 'boundary') {
            const boundary = addShape('bpmn:BoundaryEvent', { x: element.x + element.width, y: element.y + element.height }, { host: element, ...target });
            // The new boundary occupies the host's bottom-right resize
            // handle. Select it, just like a palette drop, so the host's
            // stale handle cannot intercept the next event-center click.
            if (boundary) viewer.select(boundary.id);
          }
          else applyReplacementAction(element, entry, options);
          destroyReplaceMenu();
          repositionContextPad();
        };
        const removeData = mode !== 'boundary' && target && replacementIOPlan(element, target)?.required;
        const removeContents = mode !== 'boundary' && target && ((element.businessObject.$instanceOf('bpmn:SubProcess') &&
            (hasSubProcessContents(element.businessObject) || (element.attachers || []).length) && !moddle.create(target.type).$instanceOf('bpmn:SubProcess')) ||
            (element.type === 'bpmn:Participant' && target.isExpanded === false && element.businessObject.processRef && hasContainerContents(element.businessObject.processRef)));
        if (removeData || removeContents) {
          const title = removeContents ? `Replace and remove contents${ removeData ? ' and incompatible data' : '' }` : 'Replace and remove incompatible data';
          replaceMenu.replaceChildren();
          replaceMenu.setAttribute('role', 'dialog');
          replaceMenu.setAttribute('aria-label', title);
          const description = document.createElement('p');
          description.textContent = `Replace with ${ label } and remove ${ removeContents ? 'all contained elements and incompatible attached boundary events' : '' }${ removeContents && removeData ? ', plus ' : '' }${ removeData ? 'incompatible data items, sets and associations, including their diagram entries' : '' }? Undo restores them.`;
          Object.assign(description.style, { padding: '0 12px', maxWidth: '260px', whiteSpace: 'normal' });
          const confirm = document.createElement('button');
          confirm.type = 'button'; confirm.textContent = title;
          confirm.addEventListener('mousedown', event => event.stopPropagation());
          confirm.addEventListener('click', event => { event.stopPropagation(); finish({ removeContents: !!removeContents, removeIncompatibleData: !!removeData }); });
          const cancel = document.createElement('button');
          cancel.type = 'button'; cancel.textContent = 'Cancel';
          for (const button of [ confirm, cancel ]) Object.assign(button.style, {
            margin: '4px', padding: '6px 8px', cursor: 'pointer', color: themeToken('text'),
            background: themeToken('surface'), border: `1px solid ${ themeToken('border') }`, borderRadius: themeToken('radius-md')
          });
          cancel.addEventListener('mousedown', event => event.stopPropagation());
          cancel.addEventListener('click', event => { event.stopPropagation(); destroyReplaceMenu(); });
          replaceMenu.append(description, confirm, cancel);
          cancel.focus();
        } else finish();
      });
      item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); } });
      replaceMenu.appendChild(item);
    });

    container.appendChild(replaceMenu);

    // Always remove this listener on cancel, confirm, import and destroy.
    replaceMenuOff = ev => {
      if (!replaceMenu || !replaceMenu.contains(ev.target)) destroyReplaceMenu();
    };
    window.addEventListener('mousedown', replaceMenuOff, true);
  }

  // Rubber-band selection //////////
  // Drag from empty canvas (no shape under cursor) → draws a marquee
  // rectangle and selects every shape that intersects it on release.

  let lassoState = null;
  let lassoRect = null;

  function startLasso(graphPoint) {
    destroyConnectHandle();
    lassoState = { start: graphPoint, current: graphPoint };
    lassoRect = svgCreate('rect', {
      'class': 'bpmn-xyflow-lasso',
      x: graphPoint.x, y: graphPoint.y, width: 0, height: 0,
      fill: `color-mix(in srgb, ${ themeToken('canvas-accent') } 15%, transparent)`,
      stroke: themeToken('canvas-accent'),
      'stroke-width': 1,
      'stroke-dasharray': '4,3',
      'pointer-events': 'none'
    });
    svgAppend(internals.viewport, lassoRect);
  }

  function updateLasso(graphPoint) {
    if (!lassoState) return;
    lassoState.current = graphPoint;
    const a = lassoState.start, b = graphPoint;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    lassoRect.setAttribute('x', x);
    lassoRect.setAttribute('y', y);
    lassoRect.setAttribute('width', w);
    lassoRect.setAttribute('height', h);
  }

  function endLasso(additive) {
    if (!lassoState) return;
    const a = lassoState.start, b = lassoState.current;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (lassoRect && lassoRect.parentNode) lassoRect.parentNode.removeChild(lassoRect);
    lassoRect = null;
    lassoState = null;

    if (w < 3 && h < 3) {
      // tiny lasso → treat as plain canvas click
      if (!additive) viewer.clearSelection();
      return;
    }

    const graph = viewer.getGraph();
    if (!graph) return;
    const lasso = { x, y, width: w, height: h };
    const hit = graph.nodes.filter(n =>
      !n.waypoints && !n.hidden && n.type !== 'label' &&
      n.x !== undefined &&
      n.x + n.width >= lasso.x &&
      n.x <= lasso.x + lasso.width &&
      n.y + n.height >= lasso.y &&
      n.y <= lasso.y + lasso.height
    ).map(n => n.id);

    if (additive) {
      const cur = new Set(viewer.getSelection());
      hit.forEach(id => cur.add(id));
      viewer.select([ ...cur ]);
    } else {
      viewer.select(hit);
    }
  }

  // Selection marker overlay ///////
  // A dashed-outline rectangle drawn around every selected shape.
  // Mirrors bpmn-js's "djs-outline" visual; sits in its own group
  // above the connection layer so it isn't hidden by edges.

  let selectionMarkers = null;

  function ensureSelectionMarkers() {
    if (selectionMarkers) return selectionMarkers;
    selectionMarkers = svgCreate('g', { 'class': 'bpmn-xyflow-selection-markers' });
    svgAppend(internals.viewport, selectionMarkers);
    return selectionMarkers;
  }

  function refreshSelectionMarkers() {
    const g = ensureSelectionMarkers();
    while (g.firstChild) g.removeChild(g.firstChild);
    const ids = viewer.getSelection();
    ids.forEach(id => {
      const el = viewer.getElement(id);
      if (!el || el.type === 'label' || el.hidden) return;

      // Edge: bbox around its waypoints
      if (el.waypoints && el.waypoints.length) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        el.waypoints.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        });
        const PAD = 4;
        const rect = svgCreate('rect', {
          x: minX - PAD, y: minY - PAD,
          width: (maxX - minX) + 2 * PAD,
          height: (maxY - minY) + 2 * PAD,
          rx: 4, ry: 4,
          fill: 'none',
          stroke: themeToken('canvas-accent'),
          'stroke-width': 1,
          'stroke-dasharray': '4,3',
          'pointer-events': 'none'
        });
        svgAppend(g, rect);
        return;
      }

      // Shape: bbox around the shape body
      const PAD = 6;
      const rect = svgCreate('rect', {
        x: el.x - PAD, y: el.y - PAD,
        width: el.width + 2 * PAD,
        height: el.height + 2 * PAD,
        rx: 6, ry: 6,
        fill: 'none',
        stroke: themeToken('canvas-accent'),
        'stroke-width': 1,
        'stroke-dasharray': '4,3',
        'pointer-events': 'none'
      });
      svgAppend(g, rect);
    });
  }

  viewer.on('selection.change', () => refreshSelectionMarkers());

  // External label NODE drag ///////
  // Lets the user drag the standalone label gfx (events / gateways /
  // data objects) to a custom position. Persists via the host's
  // di.label.bounds so the position survives export/import.

  let labelNodeDragState = null;

  function updateLabelNodeDrag(evt) {
    if (!labelNodeDragState) return;
    const p = internals.toGraph(evt.clientX, evt.clientY);
    const newX = Math.round(p.x - labelNodeDragState.offset.x);
    const newY = Math.round(p.y - labelNodeDragState.offset.y);
    if (newX === labelNodeDragState.node.x && newY === labelNodeDragState.node.y) return;
    const n = labelNodeDragState.node;
    n.x = newX; n.y = newY;
    const g = internals.elementGfx(n.id);
    if (g) g.setAttribute('transform', `translate(${ newX }, ${ newY })`);
    labelNodeDragState.moved = true;
  }

  function endLabelNodeDrag() {
    if (!labelNodeDragState) return;
    const { node, origin, moved } = labelNodeDragState;
    labelNodeDragState = null;
    if (!moved) return;
    const final = { x: node.x, y: node.y };
    const host = node.labelTarget, hostDi = host && host.di;
    const oldLabel = hostDi && hostDi.label, oldNodeDi = node.di;
    const nextLabel = oldLabel ? cloneSemanticObjects([ oldLabel ], false).get(oldLabel) : moddle.create('bpmndi:BPMNLabel');
    nextLabel.bounds = moddle.create('dc:Bounds', { ...final, width: node.width, height: node.height });
    nextLabel.bounds.$parent = nextLabel; nextLabel.$parent = hostDi;
    const apply = (position, labelDi, nodeDi) => {
      node.x = position.x; node.y = position.y; node.di = nodeDi;
      if (hostDi) { if (labelDi) hostDi.label = labelDi; else delete hostDi.label; }
      const gfx = internals.elementGfx(node.id);
      if (gfx) gfx.setAttribute('transform', `translate(${ node.x }, ${ node.y })`);
    };
    commands.execute({ name: 'move-external-label', do: () => apply(final, nextLabel, nextLabel), undo: () => apply(origin, oldLabel, oldNodeDi) });
  }

  // Connection label drag //////////
  let labelDragState = null;

  function closestWithAttr(node, attr) {
    let n = node;
    while (n && n !== document) {
      if (n.getAttribute && n.getAttribute(attr)) return n;
      n = n.parentNode;
    }
    return null;
  }

  function startConnectionLabelDrag(edge, host, evt) {
    destroyConnectHandle();
    const transform = host.getAttribute('transform') || '';
    const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(transform);
    const startPos = m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
    const p = internals.toGraph(evt.clientX, evt.clientY);
    labelDragState = {
      edge, host,
      origin: startPos,
      offset: { x: p.x - startPos.x, y: p.y - startPos.y },
      moved: false
    };
  }

  function updateConnectionLabelDrag(evt) {
    if (!labelDragState) return;
    const p = internals.toGraph(evt.clientX, evt.clientY);
    const newX = Math.round(p.x - labelDragState.offset.x);
    const newY = Math.round(p.y - labelDragState.offset.y);
    labelDragState.host.setAttribute('transform', `translate(${ newX }, ${ newY })`);
    labelDragState.current = { x: newX, y: newY };
    labelDragState.moved = true;
  }

  function endConnectionLabelDrag() {
    if (!labelDragState) return;
    const { edge, current, moved } = labelDragState;
    labelDragState = null;
    if (!moved) return;
    const finalPos = current;
    const beforeLabel = edge.di && edge.di.label;
    const before = beforeLabel && beforeLabel.bounds
      ? { x: beforeLabel.bounds.x, y: beforeLabel.bounds.y, width: beforeLabel.bounds.width, height: beforeLabel.bounds.height }
      : null;
    commands.execute({
      name: 'move-connection-label',
      do: () => {
        const bounds = (edge.di.label && edge.di.label.bounds) || moddle.create('dc:Bounds', { x: 0, y: 0, width: 90, height: 20 });
        bounds.x = finalPos.x;
        bounds.y = finalPos.y;
        bounds.width = before ? before.width : 90;
        bounds.height = before ? before.height : 20;
        if (!edge.di.label) {
          edge.di.label = moddle.create('bpmndi:BPMNLabel', { bounds });
        } else {
          edge.di.label.bounds = bounds;
        }
        internals.redrawConnection(edge);
        if (bendpointEdge === edge) refreshBendpoints();
      },
      undo: () => {
        if (before) {
          edge.di.label.bounds = moddle.create('dc:Bounds', before);
        } else {
          edge.di.label = null;
        }
        internals.redrawConnection(edge);
        if (bendpointEdge === edge) refreshBendpoints();
      }
    });
  }

  // Snap engine /////////////////////
  // Snaps a moving anchor (top-left of the dragged "anchor" shape) to:
  //   1. alignment lines with sibling shapes (their left/centre/right
  //      and top/middle/bottom)
  //   2. a 5px grid (only if no shape-snap caught the cursor)
  // Returns the snapped { x, y } and the guide segments to draw.

  const SNAP_THRESHOLD = 6;   // pixels in graph coords
  const GRID_SIZE = 5;

  function computeSnap(anchor, x, y, draggingNodes) {
    if (opts.snap === false) return { x, y, guides: [] };
    const graph = viewer.getGraph();
    if (!graph) return { x, y, guides: [] };
    const moving = new Set(draggingNodes);
    const others = graph.nodes.filter(n =>
      !moving.has(n) && !n.waypoints && n.type !== 'label' &&
      typeof n.x === 'number' && !n.hidden &&
      // skip lanes/pools — they're containers, not alignment targets
      !(n.businessObject && n.businessObject.$instanceOf &&
        (n.businessObject.$instanceOf('bpmn:Lane') || n.businessObject.$instanceOf('bpmn:Participant')))
    );

    // Candidate alignment values (X) and (Y) from sibling shapes, plus
    // labels for the guide-drawer.
    const xLines = [];
    const yLines = [];
    others.forEach(n => {
      const cx = n.x + n.width / 2;
      const cy = n.y + n.height / 2;
      xLines.push({ value: n.x,                kind: 'left',   span: [n.y, n.y + n.height] });
      xLines.push({ value: cx,                 kind: 'centre', span: [n.y, n.y + n.height] });
      xLines.push({ value: n.x + n.width,      kind: 'right',  span: [n.y, n.y + n.height] });
      yLines.push({ value: n.y,                kind: 'top',    span: [n.x, n.x + n.width] });
      yLines.push({ value: cy,                 kind: 'middle', span: [n.x, n.x + n.width] });
      yLines.push({ value: n.y + n.height,     kind: 'bottom', span: [n.x, n.x + n.width] });
    });

    const aw = anchor.width;
    const ah = anchor.height;
    // anchor positions to test against each X line: left, centre, right
    const xCandidates = [
      { name: 'left',   offset: 0      },
      { name: 'centre', offset: aw / 2 },
      { name: 'right',  offset: aw     }
    ];
    const yCandidates = [
      { name: 'top',    offset: 0      },
      { name: 'middle', offset: ah / 2 },
      { name: 'bottom', offset: ah     }
    ];

    const guides = [];
    let snappedX = null, snappedY = null;

    for (const cand of xCandidates) {
      for (const line of xLines) {
        if (Math.abs(x + cand.offset - line.value) <= SNAP_THRESHOLD) {
          if (snappedX === null || Math.abs(x + cand.offset - line.value) < Math.abs(snappedX - line.value)) {
            snappedX = line.value - cand.offset;
            const top = Math.min(line.span[0], y);
            const bottom = Math.max(line.span[1], y + ah);
            guides.push({ orient: 'v', x: line.value, y1: top, y2: bottom });
          }
        }
      }
    }
    for (const cand of yCandidates) {
      for (const line of yLines) {
        if (Math.abs(y + cand.offset - line.value) <= SNAP_THRESHOLD) {
          if (snappedY === null || Math.abs(y + cand.offset - line.value) < Math.abs(snappedY - line.value)) {
            snappedY = line.value - cand.offset;
            const left = Math.min(line.span[0], x);
            const right = Math.max(line.span[1], x + aw);
            guides.push({ orient: 'h', y: line.value, x1: left, x2: right });
          }
        }
      }
    }

    // Fallback: grid snap when no shape lined up
    if (snappedX === null) snappedX = Math.round(x / GRID_SIZE) * GRID_SIZE;
    if (snappedY === null) snappedY = Math.round(y / GRID_SIZE) * GRID_SIZE;

    return { x: snappedX, y: snappedY, guides };
  }

  // Alignment-guide overlay ////////
  let guidesGroup = null;
  function drawAlignmentGuides(segments) {
    if (!guidesGroup) {
      guidesGroup = svgCreate('g', { 'class': 'bpmn-xyflow-guides' });
      svgAppend(internals.viewport, guidesGroup);
    }
    while (guidesGroup.firstChild) guidesGroup.removeChild(guidesGroup.firstChild);
    segments.forEach(g => {
      const line = svgCreate('line', g.orient === 'v'
        ? { x1: g.x, x2: g.x, y1: g.y1, y2: g.y2 }
        : { x1: g.x1, x2: g.x2, y1: g.y, y2: g.y });
      svgAttr(line, {
        stroke: `color-mix(in srgb, ${ themeToken('canvas-accent') } 30%, transparent)`, 'stroke-width': 1, 'stroke-dasharray': '4,3', 'pointer-events': 'none'
      });
      svgAppend(guidesGroup, line);
    });
  }
  function clearAlignmentGuides() {
    if (guidesGroup) {
      while (guidesGroup.firstChild) guidesGroup.removeChild(guidesGroup.firstChild);
    }
  }

  // Grid background ////////////////
  function ensureGridBackground() {
    const svg = viewer.getSvg();
    let defs = svg.querySelector(':scope > defs');
    if (!defs) { defs = svgCreate('defs'); svgAppend(svg, defs); }
    if (defs.querySelector('#bpmn-xyflow-grid')) return;

    const pattern = svgCreate('pattern', {
      id: 'bpmn-xyflow-grid', x: 0, y: 0, width: 50, height: 50,
      patternUnits: 'userSpaceOnUse'
    });
    const dot = svgCreate('circle', { cx: 1, cy: 1, r: 0.6, fill: `color-mix(in srgb, ${ themeToken('text') } 18%, transparent)` });
    svgAppend(pattern, dot);
    svgAppend(defs, pattern);

    const bg = svgCreate('rect', {
      'class': 'bpmn-xyflow-grid-bg',
      x: -1e5, y: -1e5, width: 2e5, height: 2e5,
      fill: 'url(#bpmn-xyflow-grid)',
      'pointer-events': 'none'
    });
    // insert as the first child of viewport so grid sits behind everything
    internals.viewport.insertBefore(bg, internals.viewport.firstChild);
  }

  // Resize handles /////////////////
  let resizeHandles = [];
  let resizeGroup = null;
  let resizeDragState = null;

  const RESIZE_DIRS = [
    { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
    { id: 'n',  x: 0.5, y: 0, cursor: 'ns-resize' },
    { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
    { id: 'e',  x: 1, y: 0.5, cursor: 'ew-resize' },
    { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
    { id: 's',  x: 0.5, y: 1, cursor: 'ns-resize' },
    { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
    { id: 'w',  x: 0, y: 0.5, cursor: 'ew-resize' }
  ];

  function showResizeHandles(node) {
    hideResizeHandles();
    if (!node || node.waypoints || !canResizeShape(node, undefined, undefined, opts.taskResize !== false)) return;

    resizeGroup = svgCreate('g', { 'class': 'bpmn-xyflow-resize-handles' });
    svgAppend(internals.viewport, resizeGroup);

    RESIZE_DIRS.forEach(dir => {
      if (!canResizeShape(node, undefined, dir.id, opts.taskResize !== false)) return;
      const cx = node.x + node.width * dir.x;
      const cy = node.y + node.height * dir.y;
      const r = svgCreate('rect', {
        'class': 'bpmn-xyflow-resize-handle',
        'data-resize-dir': dir.id,
        x: cx - 4, y: cy - 4, width: 8, height: 8,
        fill: themeToken('surface'), stroke: themeToken('canvas-accent'), 'stroke-width': 1.5
      });
      r.style.cursor = dir.cursor;
      svgAppend(resizeGroup, r);
      resizeHandles.push({ gfx: r, dir });
    });
  }

  function hideResizeHandles() {
    if (resizeGroup && resizeGroup.parentNode) resizeGroup.parentNode.removeChild(resizeGroup);
    resizeGroup = null;
    resizeHandles = [];
  }

  function refreshResizeHandles() {
    if (!resizeGroup) return;
    const ids = viewer.getSelection();
    if (ids.length !== 1) return;
    const node = viewer.getElement(ids[0]);
    if (!node) return;
    resizeHandles.forEach(({ gfx, dir }) => {
      const cx = node.x + node.width * dir.x;
      const cy = node.y + node.height * dir.y;
      gfx.setAttribute('x', cx - 4);
      gfx.setAttribute('y', cy - 4);
    });
  }

  function labelResizeSnapshot(node) {
    const hostDi = node.labelTarget.di;
    return { node, bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
      hostDi, hadLabel: Object.hasOwn(hostDi, 'label'), label: hostDi.label, nodeDi: node.di };
  }

  function restoreLabelResize(snapshot) {
    const { node, bounds, hostDi, hadLabel, label, nodeDi } = snapshot;
    Object.assign(node, bounds);
    if (hadLabel) hostDi.label = label; else delete hostDi.label;
    retextExternalLabelNode(node, node.text || '');
    // Imported labels may alias owner shape DI rather than BPMNLabel DI.
    // Rendering must never replace that old reference or resize its bounds.
    node.di = nodeDi;
    refreshResizeHandles();
  }

  function makeLabelResizeSnapshot(node, before, bounds, labelDi) {
    if (!bounds) return null;
    const fitted = layoutExternalLabelBounds({ ...node, ...before.bounds }, bounds, internals.renderer.textRenderer);
    if (!fitted) return null;
    const label = labelDi || (before.label ? cloneSemanticObjects([ before.label ], false).get(before.label) : moddle.create('bpmndi:BPMNLabel'));
    label.$parent = before.hostDi;
    label.bounds ||= moddle.create('dc:Bounds');
    Object.assign(label.bounds, fitted); label.bounds.$parent = label;
    return { node, bounds: fitted, hostDi: before.hostDi, hadLabel: true, label, nodeDi: label };
  }

  function commitLabelResize(node, before, bounds) {
    if ([ 'x', 'y', 'width', 'height' ].every(key => bounds[key] === before.bounds[key])) return node;
    const after = makeLabelResizeSnapshot(node, before, bounds);
    if (!after) return false;
    commands.execute({ name: 'resize-external-label', do: () => restoreLabelResize(after), undo: () => restoreLabelResize(before) });
    return node;
  }

  function startResize(node, dir, evt) {
    if (!canResizeShape(node, undefined, dir.id, opts.taskResize !== false)) return;
    destroyConnectHandle();
    const p = internals.toGraph(evt.clientX, evt.clientY);
    if (node.type === 'label') {
      resizeDragState = { kind: 'label', node, dir, start: p, before: labelResizeSnapshot(node), lastDelta: 0, moved: false,
        snapTargets: (node.parent?.children || []).filter(other => other !== node && other.host !== node) };
      return;
    }

    // Capture every connected edge's docked-endpoint relative position
    // ONCE, against the drag-start bounds. Every tick of the resize
    // re-derives the new endpoint from this fixed rel position, so
    // resizing the shape out and back to its original size returns the
    // anchor to its exact original coordinates (no per-tick drift, no
    // re-crop).
    const edges = getEdgesConnectedTo(node);
    const anchors = edges.map(edge => {
      const sourceIs = edge.source === node;
      const targetIs = edge.target === node;
      const safeRel = wp => ({
        rx: node.width === 0 ? 0 : (wp.x - node.x) / node.width,
        ry: node.height === 0 ? 0 : (wp.y - node.y) / node.height
      });
      return {
        edge,
        originalWaypoints: edge.waypoints.slice(),
        sourceRel: sourceIs ? safeRel(edge.waypoints[0]) : null,
        targetRel: targetIs ? safeRel(edge.waypoints[edge.waypoints.length - 1]) : null
      };
    });

    // If `node` is a container (Lane / Participant / SubProcess /
    // Process), capture every descendant's pre-resize position so we
    // can translate them by the moved corner's delta during the
    // resize and restore them on undo.
    const containerChildren = isContainer(node) ? collectAllDescendants(node) : [];
    const childOrigins = containerChildren.map(c => ({
      node: c, x: c.x, y: c.y,
      // capture each child's connected-edge waypoints so undo restores
      // them exactly (without this, edges to child shapes would drift
      // through cropping/translation cycles)
      edges: getEdgesConnectedTo(c).map(e => ({ edge: e, wp: e.waypoints.map(p => ({ ...p })) }))
    }));

    // Attached BoundaryEvents stick to the host's perimeter. Capture
    // each one's relative position (rx, ry) within the host bbox at
    // drag start; on every tick we re-place them at (newX + rx*newW,
    // newY + ry*newH) so they slide along the new boundary.
    const attachers = (node.attachers || []).slice();
    const attacherOrigins = attachers.map(a => ({
      node: a,
      origin: { x: a.x, y: a.y },
      rx: node.width === 0 ? 0 : ((a.x + a.width / 2) - node.x) / node.width,
      ry: node.height === 0 ? 0 : ((a.y + a.height / 2) - node.y) / node.height,
      edges: getEdgesConnectedTo(a).map(e => ({ edge: e, wp: e.waypoints.map(p => ({ ...p })) }))
    }));

    resizeDragState = {
      node, dir,
      origin: { x: node.x, y: node.y, w: node.width, h: node.height },
      start: p,
      anchors,
      containerChildren,
      childOrigins,
      attachers,
      attacherOrigins,
      moved: false,
      snapshot: geometrySnapshot([ node ])
    };
  }

  function isContainer(n) {
    if (!n || !n.businessObject || !n.businessObject.$instanceOf) return false;
    return n.businessObject.$instanceOf('bpmn:Lane') ||
           n.businessObject.$instanceOf('bpmn:Participant') ||
           n.businessObject.$instanceOf('bpmn:SubProcess');
  }

  function collectAllDescendants(root) {
    const out = [];
    const seen = new Set([ root ]);
    function walk(n) {
      (n.children || []).forEach(c => {
        if (seen.has(c) || c.waypoints || c.type === 'label') return;
        seen.add(c);
        out.push(c);
        walk(c);
      });
    }
    walk(root);
    return out;
  }

  function updateResize(evt) {
    if (!resizeDragState) return;
    const { node, dir, origin, start } = resizeDragState;
    const p = internals.toGraph(evt.clientX, evt.clientY);
    if (resizeDragState.kind === 'label') {
      const state = resizeDragState, delta = p.x - start.x;
      state.lastDelta = delta;
      state.snap = opts.snap !== false && !((evt.ctrlKey || evt.metaKey) && !evt.altKey);
      if (Math.abs(delta) < 1e-8) { restoreLabelResize(state.before); return; }
      const bounds = externalLabelResizeBounds(state.before.bounds, dir.id, delta, { round: false, snap: state.snap, snapTargets: state.snapTargets });
      const planned = makeLabelResizeSnapshot(node, state.before, bounds, state.labelDi);
      if (planned) { state.labelDi = planned.label; restoreLabelResize(planned); state.moved = true; }
      return;
    }
    let dx = p.x - start.x, dy = p.y - start.y;

    let nx = origin.x, ny = origin.y, nw = origin.w, nh = origin.h;

    if (dir.id.includes('w')) {
      nx = origin.x + dx; nw = origin.w - dx;
    } else if (dir.id.includes('e')) {
      nw = origin.w + dx;
    }
    if (dir.id.includes('n')) {
      ny = origin.y + dy; nh = origin.h - dy;
    } else if (dir.id.includes('s')) {
      nh = origin.h + dy;
    }

    const minSize = 20;
    if (nw < minSize) {
      if (dir.id.includes('w')) nx -= (minSize - nw);
      nw = minSize;
    }
    if (nh < minSize) {
      if (dir.id.includes('n')) ny -= (minSize - nh);
      nh = minSize;
    }

    // Snap the edge that's actually moving to neighbouring shape
    // alignment lines, falling back to the 5px grid.
    const snapped = snapResize(dir, nx, ny, nw, nh, node);
    nx = snapped.x; ny = snapped.y; nw = snapped.w; nh = snapped.h;

    nx = Math.round(nx); ny = Math.round(ny); nw = Math.round(nw); nh = Math.round(nh);
    if (nx === node.x && ny === node.y && nw === node.width && nh === node.height) return;

    if (!canResizeShape(node, { x: nx, y: ny, width: nw, height: nh }, dir.id, opts.taskResize !== false)) return;
    if (applyResize(node, nx, ny, nw, nh, resizeDragState.anchors) !== false) resizeDragState.moved = true;
  }

  /**
   * Snap the edge(s) being resized to nearby sibling-shape alignment
   * lines or to the grid. Only the dragged edge moves; the opposite
   * edge stays fixed.
   */
  function snapResize(dir, nx, ny, nw, nh, node) {
    if (opts.snap === false) return { x: nx, y: ny, w: nw, h: nh };
    const graph = viewer.getGraph();
    if (!graph) return { x: nx, y: ny, w: nw, h: nh };

    const others = graph.nodes.filter(n =>
      n !== node && !n.waypoints && n.type !== 'label' &&
      typeof n.x === 'number' && !n.hidden &&
      !(n.businessObject && n.businessObject.$instanceOf &&
        (n.businessObject.$instanceOf('bpmn:Lane') || n.businessObject.$instanceOf('bpmn:Participant')))
    );
    const xCands = [];
    const yCands = [];
    others.forEach(n => {
      xCands.push(n.x, n.x + n.width / 2, n.x + n.width);
      yCands.push(n.y, n.y + n.height / 2, n.y + n.height);
    });

    function snap1D(value, candidates) {
      let best = null, bestDist = SNAP_THRESHOLD + 1;
      candidates.forEach(c => {
        const d = Math.abs(value - c);
        if (d < bestDist) { bestDist = d; best = c; }
      });
      return best !== null
        ? best
        : Math.round(value / GRID_SIZE) * GRID_SIZE;
    }

    if (dir.id.includes('w')) {
      const newLeft = snap1D(nx, xCands);
      const dx = newLeft - nx;
      nx += dx; nw -= dx;
    } else if (dir.id.includes('e')) {
      const newRight = snap1D(nx + nw, xCands);
      nw = newRight - nx;
    }
    if (dir.id.includes('n')) {
      const newTop = snap1D(ny, yCands);
      const dy = newTop - ny;
      ny += dy; nh -= dy;
    } else if (dir.id.includes('s')) {
      const newBottom = snap1D(ny + nh, yCands);
      nh = newBottom - ny;
    }

    const minSize = 20;
    if (nw < minSize) nw = minSize;
    if (nh < minSize) nh = minSize;
    return { x: nx, y: ny, w: nw, h: nh };
  }

  /**
   * Apply new bounds to `node` and reposition every docked edge endpoint.
   *
   * Endpoints are placed using their drag-start relative positions
   * (`anchors`), which makes the gesture exactly reversible: resizing
   * out and back to the original size returns each anchor to its
   * original coordinates with no floating-point drift.
   *
   * If `anchors` is omitted (e.g. an undo from outside the drag),
   * we fall back to capturing rel positions from the current bounds.
   */
  function applyResize(node, x, y, w, h) {
    // Every preview is derived from the drag-start snapshot. Repeated resize
    // moves must not accumulate cropped-endpoint or fractional-DI drift.
    const snapshot = resizeDragState?.snapshot || geometrySnapshot([ node ]);
    if (resizeDragState) restoreGeometry(snapshot);

    node.x = x; node.y = y; node.width = w; node.height = h;
    if (node.di && node.di.bounds) {
      node.di.bounds.x = x; node.di.bounds.y = y;
      node.di.bounds.width = w; node.di.bounds.height = h;
    }
    internals.redrawShape(node);


    // Container children: when resizing a Lane / Pool / SubProcess
    // by its W/N edge (the top-left corner moves), descendants must
    // translate by the same delta so they keep their relative position
    // inside the container. For E/S edges the top-left stays put,
    // so children don't move.
    if (resizeDragState && resizeDragState.containerChildren && resizeDragState.containerChildren.length) {
      const dxOrigin = x - resizeDragState.origin.x;
      const dyOrigin = y - resizeDragState.origin.y;
      {
        resizeDragState.childOrigins.forEach(co => {
          // re-place each descendant relative to its captured origin
          setNodePositionInternal(co.node, co.x + dxOrigin, co.y + dyOrigin, false);
        });
      }
    }

    // Boundary attachers slide along the host's perimeter as it
    // resizes. Each attacher's centre stays at the same relative
    // position (rx, ry) on the host bbox.
    if (resizeDragState && resizeDragState.attacherOrigins && resizeDragState.attacherOrigins.length) {
      resizeDragState.attacherOrigins.forEach(ao => {
        const cx = x + ao.rx * w;
        const cy = y + ao.ry * h;
        const newX = Math.round(cx - ao.node.width / 2);
        const newY = Math.round(cy - ao.node.height / 2);
        setNodePositionInternal(ao.node, newX, newY, false);
      });
    }

    resizeOwnerLabel(node, snapshot);
    if (repairGeometryEdges(snapshot) === false) return false;
    refreshResizeHandles();
    repositionContextPad();
    refreshSelectionMarkers();
  }

  function resizeOwnerLabel(node, snapshot) {
    const original = snapshot.shapes.find(entry => entry.node === node);
    const originalLabel = snapshot.shapes.find(entry => entry.node === node.label);
    if (original && originalLabel && hasExternalLabel(node.type)) {
      const delta = externalLabelOwnerResizeDelta(originalLabel, original, node);
      if (delta) {
        const label = node.label;
        Object.assign(label, { x: originalLabel.x + delta.x, y: originalLabel.y + delta.y, width: originalLabel.width, height: originalLabel.height });
        node.di.label ||= moddle.create('bpmndi:BPMNLabel');
        const labelDi = node.di.label; labelDi.$parent = node.di;
        labelDi.bounds ||= moddle.create('dc:Bounds'); labelDi.bounds.$parent = labelDi;
        Object.assign(labelDi.bounds, { x: label.x, y: label.y, width: label.width, height: label.height });
        label.di = labelDi;
        retextExternalLabelNode(label, label.text || getLabel(node) || '');
      }
    }
  }

  function geometryLabelState(node) {
    const hostDi = node.labelTarget?.di || node.di;
    if (!hostDi) return null;
    const label = hostDi.label, bounds = label?.bounds;
    return { hostDi, hadLabel: Object.hasOwn(hostDi, 'label'), label, nodeDi: node.di,
      hadBounds: !!label && Object.hasOwn(label, 'bounds'), bounds,
      values: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null };
  }

  function restoreGeometryLabel(node, state) {
    if (!state) return;
    if (state.hadLabel) state.hostDi.label = state.label; else delete state.hostDi.label;
    if (state.label) {
      if (state.hadBounds) state.label.bounds = state.bounds; else delete state.label.bounds;
      if (state.bounds && state.values) Object.assign(state.bounds, state.values);
    }
    node.di = state.nodeDi;
  }

  function geometrySnapshot(nodes) {
    const moving = movableClosure(nodes);
    const shapes = new Set(moving);
    moving.forEach(node => { if (node.label) shapes.add(node.label); });
    const graph = viewer.getGraph();
    (graph && graph.edges || []).forEach(edge => { if (edge.label && (moving.has(edge.source) || moving.has(edge.target))) shapes.add(edge.label); });
    return {
      shapes: [ ...shapes ].map(node => ({ node, x: node.x, y: node.y, width: node.width, height: node.height, labelState: geometryLabelState(node),
        diBounds: node.di && node.di.bounds ? { ...node.di.bounds } : null,
        labelBounds: node.di && node.di.label && node.di.label.bounds ? { ...node.di.label.bounds } : null })),
      edges: connectionSnapshots((graph && graph.edges || []).filter(edge => moving.has(edge.source) || moving.has(edge.target))).map(entry => ({
        ...entry,
        labelBounds: entry.edge.di && entry.edge.di.label && entry.edge.di.label.bounds ? { ...entry.edge.di.label.bounds } : null
      }))
    };
  }

  function restoreGeometry(snapshot) {
    snapshot.shapes.forEach(({ node, x, y, width, height, diBounds, labelBounds, labelState }) => {
      restoreGeometryLabel(node, labelState);
      Object.assign(node, { x, y, width, height });
      if (node.di && node.di.bounds && (node.type !== 'label' || !node.labelTarget || node.di !== node.labelTarget.di)) Object.assign(node.di.bounds, diBounds || { x, y, width, height });
      if (labelBounds && node.di?.label?.bounds) Object.assign(node.di.label.bounds, labelBounds);
      if (node.type === 'label') {
        const gfx = internals.elementGfx(node.id);
        if (gfx) gfx.setAttribute('transform', `translate(${ x }, ${ y })`);
      } else internals.redrawShape(node);
    });
    snapshot.edges.forEach(({ edge, waypoints, diWaypoints, labelBounds }) => {
      restoreConnectionGeometry(edge, { waypoints, diWaypoints });
      if (labelBounds && edge.di && edge.di.label) Object.assign(edge.di.label.bounds, labelBounds);
      internals.redrawConnection(edge);
    });
    refreshBendpoints(); refreshResizeHandles(); refreshSelectionMarkers(); repositionContextPad();
  }

  function endResize() {
    return categoryMutation(resizeDragState?.node ? categoryGeometryElements([ resizeDragState.node ]) : [], () => {
      return endResizeCore();
    });
  }

  function endResizeCore() {
    if (!resizeDragState) return;
    const state = resizeDragState;
    const { node, snapshot, moved } = state;
    resizeDragState = null;
    if (state.kind === 'label') {
      restoreLabelResize(state.before);
      if (!moved || Math.abs(state.lastDelta) < 1e-8) return;
      commitLabelResize(node, state.before, externalLabelResizeBounds(state.before.bounds, state.dir.id, state.lastDelta, { snap: state.snap, snapTargets: state.snapTargets }));
      return;
    }
    if (!moved) return;
    const final = geometrySnapshot([ node ]);
    if (sameGeometry(snapshot, final)) { restoreGeometry(snapshot); return; }
    commands.execute({ name: 'resize', do: () => restoreGeometry(final), undo: () => restoreGeometry(snapshot) });
  }

  function resizeShape(node, bounds) {
    if (!node || node.waypoints || viewer.getElement(node.id) !== node || !bounds ||
        [ 'x', 'y', 'width', 'height' ].some(key => !Number.isFinite(bounds[key]))) return false;
    if (node.type === 'label') {
      if (!node.labelTarget || bounds.width < 10 || bounds.height < 0 || !canResizeShape(node)) return false;
      cancelActiveGesture();
      const before = labelResizeSnapshot(node);
      if ([ 'x', 'y', 'width', 'height' ].every(key => bounds[key] === before.bounds[key])) return node;
      return commitLabelResize(node, before, Object.fromEntries([ 'x', 'y', 'width', 'height' ].map(key => [ key, Math.round(bounds[key]) ])));
    }
    if (bounds.width < 20 || bounds.height < 20) return false;
    if (!canResizeShape(node, bounds, undefined, opts.taskResize !== false)) return false;
    cancelActiveGesture();
    startResize(node, RESIZE_DIRS.find(dir => canResizeShape(node, bounds, dir.id, opts.taskResize !== false)), { clientX: 0, clientY: 0 });
    if (applyResize(node, bounds.x, bounds.y, bounds.width, bounds.height, resizeDragState.anchors) === false) {
      resizeDragState = null;
      return false;
    }
    resizeDragState.moved = true;
    endResize();
    return node;
  }

  // Perimeter connect affordance //////////
  // The outline is only a visual cue. A single visible port follows the nearest
  // outline point, leaving the shape body and existing editing controls intact.
  let connectHandle = null;
  let connectOutline = null;
  let connectDockingMarker = null;
  let hoveredForConnect = null;
  let connectPort = null;
  let connectGrab = null;
  let connectApproach = null;
  const CONNECT_HIT_RADIUS = 8;

  function destroyConnectHandle() {
    connectHandle?.remove(); connectOutline?.remove(); connectDockingMarker?.remove();
    connectHandle = null; connectOutline = null; connectDockingMarker = null;
    hoveredForConnect = null; connectPort = null; connectGrab = null; connectApproach = null;
  }

  function connectDocking(node, point) {
    const renderer = internals.renderer?.bpmnRenderer;
    return projectDocking(node, point, { getShapePath: renderer?.getShapePath?.bind(renderer) });
  }

  function connectControlRegions() {
    const scale = viewer.getViewport().zoom, regions = [];
    for (const [edge, hover] of [[bendpointEdge, false], [hoveredConnection, true]]) {
      if (!edge) continue;
      for (const point of edge.waypoints) regions.push({ ...point, radius: hover ? 10 : 10 / scale });
      for (let i = 1; i < edge.waypoints.length; i++) {
        const a = edge.waypoints[i - 1], b = edge.waypoints[i], axis = segmentMoveAxis(a, b);
        if (!axis || (!hover && Math.hypot(b.x - a.x, b.y - a.y) * scale < 24)) continue;
        const along = hover ? Math.abs(Math.round((axis === 'y' ? b.x - a.x : b.y - a.y) * 2 / 3)) / 2 : 10 / scale;
        const across = hover ? 8.5 : 10 / scale;
        regions.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
          halfWidth: axis === 'y' ? along : across, halfHeight: axis === 'y' ? across : along });
      }
    }
    const selected = viewer.getSelection(), node = selected.length === 1 && viewer.getElement(selected[0]);
    if (node && resizeGroup) for (const { dir } of resizeHandles) regions.push({
      x: node.x + node.width * dir.x, y: node.y + node.height * dir.y, halfWidth: 4, halfHeight: 4 });
    return regions;
  }

  function portInsideRegion(point, region, padding = 0) {
    return region.radius !== undefined ? Math.hypot(point.x - region.x, point.y - region.y) <= region.radius + padding :
      Math.abs(point.x - region.x) <= region.halfWidth + padding && Math.abs(point.y - region.y) <= region.halfHeight + padding;
  }

  function outwardPortDirection(node, port) {
    const center = getMid(node), dx = port.x - center.x, dy = port.y - center.y;
    let normal;
    if (node.businessObject.$instanceOf('bpmn:Event')) normal = { x: dx, y: dy };
    else if (node.businessObject.$instanceOf('bpmn:Gateway')) normal = { x: Math.sign(dx) / node.width, y: Math.sign(dy) / node.height };
    else {
      const r = node.businessObject.$instanceOf('bpmn:Activity') ? Math.min(10, node.width / 2, node.height / 2) : 0;
      if (r && (port.x < node.x + r || port.x > node.x + node.width - r) && (port.y < node.y + r || port.y > node.y + node.height - r)) {
        normal = { x: port.x - (dx < 0 ? node.x + r : node.x + node.width - r),
          y: port.y - (dy < 0 ? node.y + r : node.y + node.height - r) };
      } else {
        const sides = [{ distance: Math.abs(port.x - node.x), x: -1, y: 0 },
          { distance: Math.abs(port.x - node.x - node.width), x: 1, y: 0 },
          { distance: Math.abs(port.y - node.y), x: 0, y: -1 },
          { distance: Math.abs(port.y - node.y - node.height), x: 0, y: 1 }];
        const minimum = Math.min(...sides.map(side => side.distance));
        normal = sides.filter(side => Math.abs(side.distance - minimum) < 1e-8).reduce((sum, side) => ({ x: sum.x + side.x, y: sum.y + side.y }), { x: 0, y: 0 });
      }
    }
    const length = Math.hypot(normal.x, normal.y);
    return length ? { x: normal.x / length, y: normal.y / length } : { x: 1, y: 0 };
  }

  function connectGrabPosition(node, port) {
    const scale = viewer.getViewport().zoom, regions = connectControlRegions();
    const label = node.label;
    if (label && !label.hidden) {
      const hit = internals.elementGfx(label.id)?.querySelector('.bpmn-xyflow-shape-hit');
      const padding = Math.max(0, Number(hit?.getAttribute('stroke-width')) || 0) / 2;
      regions.push({ x: label.x + label.width / 2, y: label.y + label.height / 2,
        halfWidth: label.width / 2 + padding, halfHeight: label.height / 2 + padding });
    }
    // Reserve a central body region for ordinary shape dragging. A fixed CSS
    // hit disc must not swallow a small event/gateway at reduced zoom.
    regions.push({ ...getMid(node), radius: Math.min(node.width, node.height) / 4, body: true });
    if (!regions.some(region => portInsideRegion(port, region, region.body ? CONNECT_HIT_RADIUS / scale : 0))) return port;
    const normal = outwardPortDirection(node, port);
    // Keep the existing HTML context-pad usable too. A long tether may pass
    // behind it, but the grab itself must be outside its actual screen box.
    const rect = contextPad?.getBoundingClientRect();
    if (rect?.width > 0 && rect.height > 0) {
      const a = internals.toGraph(rect.left, rect.top), b = internals.toGraph(rect.right, rect.bottom);
      regions.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, halfWidth: (b.x - a.x) / 2, halfHeight: (b.y - a.y) / 2 });
    }
    const padding = (CONNECT_HIT_RADIUS + 2) / scale;
    // Displaced controls must reveal both painted circles and a tether between
    // them: 12 CSS px exceeds their 5.75 + 3 px outer stroke radii.
    let distance = 12 / scale;
    for (let i = 0; i <= regions.length; i++) {
      const grab = { x: port.x + normal.x * distance, y: port.y + normal.y * distance };
      const collisions = regions.filter(region => portInsideRegion(grab, region, padding));
      if (!collisions.length) return grab;
      let step = 0;
      for (const region of collisions) {
        if (region.radius !== undefined) {
          const dx = grab.x - region.x, dy = grab.y - region.y, dot = dx * normal.x + dy * normal.y;
          step = Math.max(step, -dot + Math.sqrt(Math.max(0, dot * dot + (region.radius + padding) ** 2 - dx * dx - dy * dy)));
        } else {
          const exits = [];
          if (normal.x) exits.push((region.x + Math.sign(normal.x) * (region.halfWidth + padding) - grab.x) / normal.x);
          if (normal.y) exits.push((region.y + Math.sign(normal.y) * (region.halfHeight + padding) - grab.y) / normal.y);
          step = Math.max(step, Math.min(...exits));
        }
      }
      distance += step + .01 / scale;
    }
    return { x: port.x + normal.x * distance, y: port.y + normal.y * distance };
  }

  function showConnectHandle(node, position) {
    if (!node || node.hidden || node.waypoints || node.type === 'label' || viewer.getElement(node.id) !== node || !canStartConnection(node)) return;
    const port = connectDocking(node, position || { x: node.x + node.width, y: node.y + node.height / 2 });
    const grab = connectGrabPosition(node, port);
    if (hoveredForConnect !== node || !connectHandle) {
      destroyConnectHandle();
      hoveredForConnect = node;
      const renderer = internals.renderer?.bpmnRenderer;
      const path = renderer?.getShapePath?.(node);
      if (path) {
        connectOutline = svgCreate('path', { 'class': 'bpmn-xyflow-connect-outline', d: path,
          fill: 'none', stroke: themeToken('canvas-accent'), opacity: .55,
          'stroke-width': 1 / viewer.getViewport().zoom, 'pointer-events': 'none' });
        svgAppend(internals.viewport, connectOutline);
      }
      connectDockingMarker = svgCreate('g', { 'class': 'bpmn-xyflow-connect-docking', 'data-connect-source': node.id, 'pointer-events': 'none' });
      svgAppend(connectDockingMarker, svgCreate('line', { 'class': 'bpmn-xyflow-connect-tether', stroke: themeToken('canvas-accent'), 'pointer-events': 'none' }));
      svgAppend(connectDockingMarker, svgCreate('circle', { 'class': 'bpmn-xyflow-connect-docking-point', fill: themeToken('surface'), stroke: themeToken('canvas-accent'), 'pointer-events': 'none' }));
      const handle = connectHandle = svgCreate('g', { 'class': 'bpmn-xyflow-connect-handle', 'data-connect-source': node.id });
      const title = svgCreate('title'); title.textContent = 'Drag to connect from this point'; svgAppend(handle, title);
      svgAppend(handle, svgCreate('circle', { 'class': 'bpmn-xyflow-connect-port', fill: themeToken('canvas-accent'),
        stroke: themeToken('surface'), 'pointer-events': 'none' }));
      svgAppend(handle, svgCreate('circle', { 'class': 'bpmn-xyflow-connect-hit', fill: 'transparent', 'pointer-events': 'all' }));
      handle.style.cursor = 'crosshair';
      const overlay = [...internals.viewport.children].find(child => [bendpointGroup, hoverControls, resizeGroup].includes(child));
      internals.viewport.insertBefore(connectDockingMarker, overlay || null);
      internals.viewport.insertBefore(handle, overlay || null);
      handle.addEventListener('mousedown', event => {
        if (event.button !== 0 || !connectPort) return;
        event.stopPropagation(); event.preventDefault();
        const start = { ...connectPort };
        startConnect(node, start.x, start.y, event);
      });
    }
    connectPort = port; connectGrab = grab;
    const scale = viewer.getViewport().zoom, displaced = Math.hypot(grab.x - port.x, grab.y - port.y) > 1e-8;
    // Body hover projects an origin onto the outline, but does not yet claim
    // that origin. Acquire it only at the outline (allowing native pixel
    // rounding), then distinguish outward grab travel from perimeter choice.
    connectApproach = { point: position || port,
      acquired: Math.hypot((position || port).x - port.x, (position || port).y - port.y) * scale <= 1.5,
      travelling: false };
    svgAttr(connectDockingMarker.querySelector('line'), { x1: port.x, y1: port.y, x2: grab.x, y2: grab.y, 'stroke-width': 1 / scale });
    svgAttr(connectDockingMarker.querySelector('circle'), { cx: port.x, cy: port.y, r: 2.5 / scale, 'stroke-width': 1 / scale });
    connectDockingMarker.setAttribute('visibility', displaced ? 'visible' : 'hidden');
    connectHandle.querySelector('title').textContent = displaced ? 'Drag to connect from the marked outline point' : 'Drag to connect from this point';
    for (const circle of connectHandle.querySelectorAll('circle')) svgAttr(circle, { cx: grab.x, cy: grab.y });
    svgAttr(connectHandle.querySelector('.bpmn-xyflow-connect-port'), { r: 5 / scale, 'stroke-width': 1.5 / scale });
    svgAttr(connectHandle.querySelector('.bpmn-xyflow-connect-hit'), { r: CONNECT_HIT_RADIUS / scale });
  }

  function onConnectTether(point, target) {
    if (!connectPort || !connectGrab || !connectApproach) return false;
    const vx = connectGrab.x - connectPort.x, vy = connectGrab.y - connectPort.y, length = Math.hypot(vx, vy);
    if (length <= 1e-8) return false;
    // An actual hit on the displayed grab claims it even when approached
    // directly from the body, without visiting the small outline marker.
    const grabbed = target?.nodeType && connectHandle?.contains(target);
    const nx = vx / length, ny = vy / length, scale = viewer.getViewport().zoom;
    const outward = (point.x - connectPort.x) * nx + (point.y - connectPort.y) * ny;
    const dx = point.x - connectApproach.point.x, dy = point.y - connectApproach.point.y;
    const progress = dx * nx + dy * ny, tangent = Math.abs(dx * ny - dy * nx);
    const continuing = connectApproach.travelling && (outward * scale > 1.5 || Math.hypot(dx, dy) < 1e-8);
    const approaching = connectApproach.acquired && outward > 1e-8 &&
      pointToSegmentDist(point, connectPort, connectGrab) <= CONNECT_HIT_RADIUS / scale &&
      (continuing || progress > tangent + 1e-8);
    if (!grabbed && !approaching) return false;
    connectApproach = { point, acquired: true, travelling: true };
    return true;
  }

  function updateConnectHandle(event) {
    if (event.pointerType === 'touch' || dragState || connectState || bendDragState || segmentDragState || resizeDragState ||
        hoverDragPending || hoverControlActive || lassoState || labelDragState || labelNodeDragState || paletteGesture) return;
    const target = event.target;
    if (connectHandle && target?.nodeType && contextPad?.contains(target)) return;
    if (!target?.nodeType || !viewer.getSvg().contains(target)) { destroyConnectHandle(); return; }
    const point = internals.toGraph(event.clientX, event.clientY);
    // Preserve an existing displaced grab before resolving an overlapping label,
    // host or container. The tether is pointer-inert; their presses remain intact.
    // Coincident unpressed ports continue following the nearest outline point.
    if (onConnectTether(point, target)) return;
    const resizeControl = target.closest?.('.bpmn-xyflow-resize-handle');
    const selection = viewer.getSelection();
    if (resizeControl && selection.length === 1) {
      const node = viewer.getElement(selection[0]);
      if (canStartConnection(node)) { showConnectHandle(node, point); return; }
    }
    const id = internals.findElementId(target), element = id && viewer.getElement(id);
    if (element) {
      if (!element.waypoints && element.type !== 'label' && canStartConnection(element)) showConnectHandle(element, point);
      else if (element.type === 'label' && element.labelTarget) {
        const host = element.labelTarget;
        const insideText = point.x >= element.x && point.x <= element.x + element.width &&
          point.y >= element.y && point.y <= element.y + element.height;
        const docking = !insideText && canStartConnection(host) && connectDocking(host, point);
        // A label's transparent hit padding can cover the painted owner ring.
        // Resolve only that outline, allowing native pixel rounding, while the
        // visible text rectangle keeps normal label selection and dragging.
        if (docking && Math.hypot(point.x - docking.x, point.y - docking.y) * viewer.getViewport().zoom <= 1.5) showConnectHandle(host, point);
        else destroyConnectHandle();
      }
      else destroyConnectHandle();
      return;
    }
    const node = hoveredForConnect, pad = 24 / viewer.getViewport().zoom;
    if (node && point.x >= node.x - pad && point.x <= node.x + node.width + pad &&
        point.y >= node.y - pad && point.y <= node.y + node.height + pad) showConnectHandle(node, point);
    else destroyConnectHandle();
  }

  viewer.on('element.hover', ({ element, event }) => {
    if (!dragState && !connectState && !bendDragState && !segmentDragState && !resizeDragState && !hoverDragPending && !hoverControlActive &&
        element && !element.waypoints && element.type !== 'label' && event?.pointerType !== 'touch') {
      const point = event && internals.toGraph(event.clientX, event.clientY);
      if (!point || !onConnectTether(point, event?.target)) showConnectHandle(element, point);
    }
  });

  // wire show/hide to selection
  viewer.on('selection.change', ({ ids }) => {
    const promoted = ids.length === 1 && hoveredConnection?.id === ids[0] && !hoverControlActive ? hoverControls : null;
    if (promoted) { hoverControls = null; hoveredConnection = null; }
    if (hoverDragPending || hoverControlActive) cancelActiveGesture();
    clearHoverControls();
    destroyConnectHandle();
    destroyContextPad();
    destroyReplaceMenu();
    hideResizeHandles();
    if (ids.length === 1) {
      const el = viewer.getElement(ids[0]);
      if (el && el.waypoints) {
        showBendpoints(el, promoted);
        showContextPad(el);
        return;
      }
      if (el) {
        hideBendpoints();
        showContextPad(el);
        showResizeHandles(el);
        return;
      }
    }
    promoted?.remove();
    hideBendpoints();
  });

  // re-position the pad when the user pans/zooms or the shape moves
  viewer.on('viewport.change', () => {
    repositionContextPad();
    refreshBendpoints();
    destroyConnectHandle();
  });

  // Right-click context menu //////
  let rightClickMenu = null;

  function destroyRightClickMenu() {
    if (rightClickMenu && rightClickMenu.parentNode) rightClickMenu.parentNode.removeChild(rightClickMenu);
    rightClickMenu = null;
  }

  function openRightClickMenu(items, clientX, clientY) {
    destroyRightClickMenu();
    if (!items.length) return;

    const container = viewer.getContainer();
    const containerRect = container.getBoundingClientRect();

    rightClickMenu = document.createElement('div');
    rightClickMenu.className = 'bpmn-xyflow-context-menu';
    Object.assign(rightClickMenu.style, {
      position: 'absolute',
      left: (clientX - containerRect.left) + 'px',
      top: (clientY - containerRect.top) + 'px',
      background: themeToken('surface-overlay'),
      border: `1px solid ${ themeToken('border') }`,
      borderRadius: themeToken('radius-lg'),
      boxShadow: `0 4px 12px ${ themeToken('shadow') }`,
      padding: '4px 0',
      minWidth: '160px',
      zIndex: 9,
      font: '12px -apple-system, BlinkMacSystemFont, sans-serif'
    });

    items.forEach(item => {
      if (item.divider) {
        const d = document.createElement('div');
        Object.assign(d.style, { height: '1px', background: themeToken('border-disabled'), margin: '4px 0' });
        rightClickMenu.appendChild(d);
        return;
      }
      const row = document.createElement('div');
      row.textContent = item.label;
      Object.assign(row.style, {
        padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
        opacity: item.disabled ? '0.5' : '1'
      });
      if (!item.disabled) {
        row.addEventListener('mouseenter', () => { row.style.background = themeToken('surface-medium'); });
        row.addEventListener('mouseleave', () => { row.style.background = themeToken('surface-overlay'); });
        row.addEventListener('mousedown', e => e.stopPropagation());
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          destroyRightClickMenu();
          item.action();
        });
      }
      rightClickMenu.appendChild(row);
    });

    container.appendChild(rightClickMenu);

    // dismiss on outside click
    setTimeout(() => {
      const off = (ev) => {
        if (rightClickMenu && !rightClickMenu.contains(ev.target)) {
          destroyRightClickMenu();
          window.removeEventListener('mousedown', off, true);
        }
      };
      window.addEventListener('mousedown', off, true);
    }, 0);
  }

  function onContextMenu(evt) {
    evt.preventDefault();
    const id = internals.findElementId(evt.target);
    const el = id ? viewer.getElement(id) : null;

    if (!el) {
      openRightClickMenu([
        { label: 'Paste', disabled: !clipboard, action: () => pasteAtPoint(evt.clientX, evt.clientY) },
        { divider: true },
        { label: 'Fit view', action: () => viewer.fitView() },
        { label: 'Reset zoom', action: () => viewer.setViewport({ x: 0, y: 0, zoom: 1 }) }
      ], evt.clientX, evt.clientY);
      return;
    }

    const isEdge = !!el.waypoints;
    const items = [];

    if (!isEdge) {
      if (editableLabel(el)) items.push({ label: 'Rename…', action: () => openLabelEditor(el, null) });
      for (const entry of getExecutableAppendOptions(el)) items.push({ label: entry.label, action: () => appendShape(el, entry) });
      if (replacementMenuEntries(el).length) items.push({ label: 'Change type…', action: () => openReplaceMenu(el, evt.clientX, evt.clientY) });

      const isActivity = el.businessObject && el.businessObject.$instanceOf && el.businessObject.$instanceOf('bpmn:Activity');
      if (isActivity && !el.businessObject.triggeredByEvent) {
        items.push({ label: 'Toggle loop',          action: () => toggleActivityMarker(el, 'loop') });
        items.push({ label: 'Toggle parallel-MI',   action: () => toggleActivityMarker(el, 'parallelMI') });
        items.push({ label: 'Toggle sequential-MI', action: () => toggleActivityMarker(el, 'sequentialMI') });
        items.push({ label: 'Toggle compensation',  action: () => requestCompensationToggle(el, evt.clientX, evt.clientY) });
      }

      const isSubProcess = el.businessObject && el.businessObject.$instanceOf && el.businessObject.$instanceOf('bpmn:SubProcess');
      if (isSubProcess) {
        if (isValidTarget({ type: el.type, triggeredByEvent: !!el.businessObject.triggeredByEvent, isExpanded: el.di.isExpanded !== true }, { parent: el.parent })) items.push({ label: 'Toggle expanded / collapsed', action: () => toggleSubProcessExpanded(el) });
        items.push({ label: 'Drill into sub-process',      action: () => drillInto(el) });
      }

      items.push({ divider: true });
      items.push({ label: 'Copy', action: () => copySelection() });
      items.push({ label: 'Paste', disabled: !clipboard, action: () => pasteAtPoint(evt.clientX, evt.clientY) });
      items.push({ divider: true });
    } else {
      for (const entry of getExecutableAppendOptions(el)) items.push({ label: entry.label, action: () => appendShape(el, entry) });
      if (replacementMenuEntries(el).length) items.push({ label: 'Change type…', action: () => openReplaceMenu(el, evt.clientX, evt.clientY) });
      items.push({ divider: true });
    }

    items.push({ label: 'Delete', action: () => { deleteModelElement(el); viewer.clearSelection(); } });

    if (!viewer.getSelection().includes(el.id)) viewer.select(el.id);
    openRightClickMenu(items, evt.clientX, evt.clientY);
  }

  /**
   * Move the docked endpoint(s) of `edge` by (dx, dy).
   *
   * Matches bpmn-js's behaviour: when a shape moves, only the
   * waypoint(s) attached to that shape translate; intermediate bends
   * stay put. This preserves orthogonal/manual routing across edits.
   */
  /**
   * Translate the docked endpoint(s) of `edge` by (dx, dy).
   *
   * A shape move is pure translation — the docked endpoint stays at
   * the same point on the (translated) shape boundary, so we do not
   * re-crop. Cropping during translation introduces non-reversible
   * drift over many ticks of a drag and breaks undo round-trips.
   */
  function shiftEdgeEndpoints(edge, movedNode, dx, dy) {
    if (edge.source === movedNode) {
      const wp = edge.waypoints[0];
      edge.waypoints[0] = { x: wp.x + dx, y: wp.y + dy };
    }
    if (edge.target === movedNode) {
      const i = edge.waypoints.length - 1;
      const wp = edge.waypoints[i];
      edge.waypoints[i] = { x: wp.x + dx, y: wp.y + dy };
    }
    syncEdgeDi(edge);
    internals.redrawConnection(edge);
    if (bendpointEdge === edge) refreshBendpoints();
  }

  /**
   * Move a node without touching connected edges.
   * Used by undoable commands that manage waypoints themselves.
   *
   * Also translates di.label.bounds when the node has an external
   * label so the label DI follows the host across export/import.
   */
  /**
   * Move every BoundaryEvent attached to `node` by the same delta —
   * boundaries are pinned to their host activity in BPMN semantics,
   * so dragging the host should drag them too.
   */

  /**
   * Internal recursion-guard version of setNodePosition for cascading
   * follower moves (attachers). Avoids re-translating the host's own
   * attachers (the recursion goes one level for boundaries).
   */
  function setNodePositionInternal(node, x, y, updateEdges = true) {
    const dx = x - node.x;
    const dy = y - node.y;
    if (dx === 0 && dy === 0) return;
    node.x = x; node.y = y;
    if (node.di && node.di.bounds) {
      node.di.bounds.x = x;
      node.di.bounds.y = y;
    }
    if (node.di && node.di.label && node.di.label.bounds) {
      node.di.label.bounds.x += dx;
      node.di.label.bounds.y += dy;
    }
    const gfx = internals.elementGfx(node.id);
    if (gfx) gfx.setAttribute('transform', `translate(${ x }, ${ y })`);
    translateLabelOf(node, dx, dy);
    if (updateEdges) getEdgesConnectedTo(node).forEach(edge => shiftEdgeEndpoints(edge, node, dx, dy));
  }

  /**
   * Move the host node's separate external-label graph node (added by
   * the Importer for events / gateways / data objects) and its gfx by
   * (dx, dy) so it stays attached to the host across drags and undo.
   */
  function translateLabelOf(node, dx, dy) {
    const label = node && node.label;
    if (!label) return;
    label.x += dx;
    label.y += dy;
    if (label.di && label.di !== node.di && label.di.bounds && (!node.di || !node.di.label || label.di.bounds !== node.di.label.bounds)) {
      label.di.bounds.x += dx;
      label.di.bounds.y += dy;
    }
    const lgfx = internals.elementGfx(label.id);
    if (lgfx) lgfx.setAttribute('transform', `translate(${ label.x }, ${ label.y })`);
  }

  function movableClosure(nodes) {
    const result = new Set();
    function visit(node) {
      if (!node || result.has(node) || node.waypoints || node.type === 'label') return;
      result.add(node);
      if (isContainer(node)) (node.children || []).forEach(visit);
      (node.attachers || []).forEach(visit);
    }
    nodes.forEach(visit);
    return result;
  }

  function topLevelNodes(nodes) {
    const selected = new Set(nodes);
    return nodes.filter(node => {
      if (node.host && selected.has(node.host)) return false;
      const seen = new Set();
      let parent = node.parent;
      while (parent && !seen.has(parent)) {
        if (selected.has(parent)) return false;
        seen.add(parent);
        parent = parent.parent;
      }
      return true;
    });
  }

  function translateWaypoints(points, dx, dy) {
    return points.map(point => ({ ...point, x: point.x + dx, y: point.y + dy,
      ...(point.original ? { original: { ...point.original, x: point.original.x + dx, y: point.original.y + dy } } : {}) }));
  }

  function repairGeometryEdges(snapshot) {
    const bounds = new Map(snapshot.shapes.map(({ node, x, y, width, height }) => [ node, { x, y, width, height } ]));
    const oldEdges = new Map(snapshot.edges.map(entry => [ entry.edge, entry ]));
    const changed = (node, before) => before && [ 'x', 'y', 'width', 'height' ].some(key => node[key] !== before[key]);
    const hintsByOwner = new Map(), translated = new Set();
    const translation = endpoint => {
      if (endpoint.waypoints) {
        const old = oldEdges.get(endpoint)?.waypoints;
        if (!old) return { x: 0, y: 0 };
        if (old.length !== endpoint.waypoints.length) return null;
        const delta = { x: endpoint.waypoints[0].x - old[0].x, y: endpoint.waypoints[0].y - old[0].y };
        return old.every((point, index) => Math.abs(point.x + delta.x - endpoint.waypoints[index].x) < 1e-8 && Math.abs(point.y + delta.y - endpoint.waypoints[index].y) < 1e-8) ? delta : null;
      }
      const before = bounds.get(endpoint);
      if (!before) return { x: 0, y: 0 };
      return before.width === endpoint.width && before.height === endpoint.height ? { x: endpoint.x - before.x, y: endpoint.y - before.y } : null;
    };
    for (const entry of snapshot.edges) {
      const { edge, waypoints, diWaypoints } = entry;
      let provenance;
      const source = bounds.get(edge.source), target = bounds.get(edge.target);
      const sourceChanged = changed(edge.source, source), targetChanged = changed(edge.target, target);
      const sourceDelta = translation(edge.source), targetDelta = translation(edge.target);
      if (sourceDelta && targetDelta && (sourceDelta.x || sourceDelta.y) && sourceDelta.x === targetDelta.x && sourceDelta.y === targetDelta.y) {
        edge.waypoints = translateWaypoints(waypoints, sourceDelta.x, sourceDelta.y);
        provenance = diWaypoints?.map(value => value.point);
        hintsByOwner.set(edge, { moveDelta: sourceDelta }); translated.add(edge);
      } else if (!sourceChanged && !targetChanged) {
        restoreConnectionGeometry(edge, entry);
        continue;
      } else {
        const routePoints = normalizedConnectionRoute(waypoints, { ...edge.source, ...source }, { ...edge.target, ...target });
        if (!routePoints) { restoreGeometry(snapshot); return false; }
        const hints = { waypoints: routePoints };
        const sourceDocking = sourceChanged ? remapDocking(routePoints[0], source, edge.source) : routePoints[0];
        const targetDocking = targetChanged ? remapDocking(routePoints.at(-1), target, edge.target) : routePoints.at(-1);
        const taskResize = (sourceChanged && edge.source.businessObject?.$instanceOf('bpmn:Task') &&
          (source.width !== edge.source.width || source.height !== edge.source.height)) ||
          (targetChanged && edge.target.businessObject?.$instanceOf('bpmn:Task') &&
          (target.width !== edge.target.width || target.height !== edge.target.height));
        if (taskResize) {
          hints.preserveDocking = 'both';
          hints.connectionStart = { x: sourceDocking.x, y: sourceDocking.y };
          hints.connectionEnd = { x: targetDocking.x, y: targetDocking.y };
        } else {
          if (sourceChanged) hints.connectionStart = sourceDocking.original || sourceDocking;
          if (targetChanged) hints.connectionEnd = targetDocking.original || targetDocking;
        }
        const planned = routeConnection(edge, hints);
        if (!planned) { restoreGeometry(snapshot); return false; }
        edge.waypoints = planned;
        hintsByOwner.set(edge, { ...(sourceChanged ? { connectionStart: true } : {}), ...(targetChanged ? { connectionEnd: true } : {}) });
      }
      syncEdgeDi(edge, provenance);
    }
    propagateDependentGeometry(snapshot.edges, hintsByOwner, translated, true);
    redrawConnections(snapshot.edges);
  }

  function moveNodeSet(nodes, dx, dy, updateEdges, initialGeometry) {
    if (!dx && !dy) return;
    const snapshot = updateEdges && (initialGeometry || geometrySnapshot(nodes));
    const moving = movableClosure(nodes);
    moving.forEach(node => {
      node.x += dx; node.y += dy;
      if (node.di && node.di.bounds) { node.di.bounds.x = node.x; node.di.bounds.y = node.y; }
      if (node.di && node.di.label && node.di.label.bounds) {
        node.di.label.bounds.x += dx; node.di.label.bounds.y += dy;
      }
      const gfx = internals.elementGfx(node.id);
      if (gfx) gfx.setAttribute('transform', `translate(${ node.x }, ${ node.y })`);
      translateLabelOf(node, dx, dy);
    });
    if (snapshot && repairGeometryEdges(snapshot) === false) return false;
  }

  function moveShapes(shapes, delta, parent) {
    return categoryMutation(categoryGeometryElements(shapes), () => {
      return moveShapesCore(shapes, delta, parent);
    });
  }

  function moveShapesCore(shapes, delta, parent) {
    const nodes = topLevelNodes((Array.isArray(shapes) ? shapes : [ shapes ])
      .filter(node => node && viewer.getElement(node.id) === node && !node.waypoints && node.type !== 'label'));
    if (!nodes.length || !delta || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return false;
    if (!contextRules.canMove(nodes, parent)) return false;
    if (parent && nodes.some(node => !canBeParent(parent, node))) return false;
    if (parent && nodes.some(node => node.host && parent !== node.host.parent)) return false;
    const replacements = parent ? contextRules.dropReplacements(nodes, parent)?.replacements || [] : [];
    if (parent && nodes.some(node => node.businessObject.$instanceOf('bpmn:Event') && !replacements.some(change => change.oldElementId === node.id) &&
      !isValidTarget({ type: node.type, eventDefinitionType: node.businessObject.eventDefinitions?.[0]?.$type,
        ...(Object.hasOwn(node.businessObject, 'isInterrupting') ? { isInterrupting: node.businessObject.isInterrupting } : {}) }, { parent, host: node.host }))) return false;
    const before = geometrySnapshot(nodes);
    const changes = parent ? nodes.filter(node => node.parent !== parent).map(node => ({ node, oldParent: node.parent, newParent: parent })) : [];
    if (moveNodeSet(nodes, delta.x, delta.y, true) === false) return false;
    const after = geometrySnapshot(nodes);
    restoreGeometry(before);
    commands.compound('move', () => {
      commands.execute({
        name: 'move',
        do: () => { restoreGeometry(after); changes.forEach(applyReparent); },
        undo: () => { changes.slice().reverse().forEach(undoReparent); restoreGeometry(before); }
      });
      replacements.forEach(change => replaceShape(viewer.getElement(change.oldElementId), { type: change.newElementType, ...(change.newElementType === 'bpmn:StartEvent' ? { isInterrupting: true } : {}) }));
      pruneInvalidConnections(nodes);
    });
    return true;
  }

  function findRootContainer() {
    const graph = viewer.getGraph();
    return graph && (graph.roots[0] || null);
  }

  function findOwningProcess() {
    const defs = viewer.getDefinitions();
    if (!defs) return null;

    // Prefer a Collaboration's first participant's processRef, else first Process
    for (const root of defs.rootElements || []) {
      if (root.$type === 'bpmn:Collaboration') {
        const p = (root.participants || []).find(x => x.processRef);
        if (p) return p.processRef;
      }
    }
    return (defs.rootElements || []).find(r => r.$type === 'bpmn:Process') || null;
  }

  /**
   * Returns the flowElements-owning bo for the *currently rendered*
   * diagram. When the user has drilled into a SubProcess, this is
   * that SubProcess; otherwise it walks back to a Process (or the
   * Collaboration's first participant's processRef). Falls back to
   * findOwningProcess() if no rendered root is suitable.
   */
  function findCurrentContainer() {
    const root = findRootContainer();
    const bo = root && root.businessObject;
    if (bo && bo.$instanceOf) {
      if (bo.$instanceOf('bpmn:SubProcess') || bo.$instanceOf('bpmn:Process')) return bo;
      if (bo.$instanceOf('bpmn:Participant') && bo.processRef) return bo.processRef;
      if (bo.$instanceOf('bpmn:Collaboration')) {
        const p = (bo.participants || []).find(x => x.processRef);
        if (p) return p.processRef;
      }
    }
    return findOwningProcess();
  }

  /**
   * Returns the BPMNPlane that's currently rendered. After drillInto,
   * this is the SubProcess's plane, not the root diagram's plane.
   */
  function findCurrentPlane() {
    const defs = viewer.getDefinitions();
    if (!defs || !Array.isArray(defs.diagrams)) return null;
    const graph = viewer.getGraph();
    if (graph && graph.diagram && graph.diagram.plane) return graph.diagram.plane;
    const rootBo = findRootContainer() && findRootContainer().businessObject;
    if (rootBo) {
      const d = defs.diagrams.find(diag => diag.plane && diag.plane.bpmnElement === rootBo);
      if (d) return d.plane;
    }
    return defs.diagrams[0] && defs.diagrams[0].plane;
  }

  // Move ///////////////////////////
  // We listen to mousedown (the same event d3-zoom hooks via XYPanZoom).
  // A capture-phase stopPropagation on mousedown is the only way to win
  // the gesture from d3-zoom; pointerdown alone is not enough because
  // browsers dispatch a parallel mousedown that d3-zoom would still see.
  let dragState = null;

  function onMouseDown(evt) {
    if (evt.button !== 0) return;
    if (connectState || dragState || bendDragState || resizeDragState || segmentDragState) return;
    // The visible create control owns its bubble-phase press, including Shift.
    // It has no element ID and must not be mistaken for empty-canvas lasso.
    if (connectHandle?.contains(evt.target)) return;

    // 0a. handle mousedown on a connection label → drag the label
    //     (test the target and its ancestors for the data attribute)
    const labelHost = closestWithAttr(evt.target, 'data-connection-label');
    if (labelHost) {
      const id = labelHost.getAttribute('data-element-id');
      const edge = id ? viewer.getElement(id) : null;
      if (edge && edge.waypoints) {
        startConnectionLabelDrag(edge, labelHost, evt);
        evt.stopPropagation();
        evt.preventDefault();
        return;
      }
    }

    // 0. handle click on a resize handle → start resize
    if (evt.target && evt.target.classList && evt.target.classList.contains('bpmn-xyflow-resize-handle')) {
      const ids = viewer.getSelection();
      if (ids.length === 1) {
        const node = viewer.getElement(ids[0]);
        const dir = RESIZE_DIRS.find(d => d.id === evt.target.getAttribute('data-resize-dir'));
        if (node && dir) {
          startResize(node, dir, evt);
          evt.stopPropagation();
          evt.preventDefault();
          return;
        }
      }
    }

    // Hover controls own their edge independently of the selected control set.
    const hoveredId = internals.findElementId(evt.target), hoveredEdge = hoveredId && viewer.getElement(hoveredId);
    if (hoveredEdge === hoveredConnection && hoveredEdge?.waypoints && !viewer.getSelection().includes(hoveredId) &&
        armHoverDrag(hoveredEdge, evt)) return;

    // 1. handle click on a bendpoint handle → drag waypoint
    const bendHandle = closestWithAttr(evt.target, 'data-bend-index');
    if (bendHandle) {
      const idx = Number(bendHandle.getAttribute('data-bend-index'));
      if (bendpointEdge && Number.isFinite(idx)) {
        startBendDrag(bendpointEdge, idx, bendpointEdge.waypoints.slice(), false, undefined, internals.toGraph(evt.clientX, evt.clientY));
        evt.stopPropagation();
        evt.preventDefault();
        return;
      }
    }

    const segmentHandle = closestWithAttr(evt.target, 'data-segment-index');
    if (segmentHandle && bendpointEdge) {
      startSegmentDrag(bendpointEdge, Number(segmentHandle.getAttribute('data-segment-index')), internals.toGraph(evt.clientX, evt.clientY));
      evt.stopPropagation(); evt.preventDefault(); return;
    }

    const id = internals.findElementId(evt.target);
    const el = id ? viewer.getElement(id) : null;
    if (!el) {
      // empty canvas: shift+drag → lasso; plain drag falls through to panZoom
      if (evt.shiftKey) {
        const p = internals.toGraph(evt.clientX, evt.clientY);
        startLasso(p);
        evt.stopPropagation();
        evt.preventDefault();
      }
      return;
    }
    // External label NODE — drag the label independently of its host.
    // Stays inside the modeler's "drag" pipeline so undo/redo and
    // alignment guides come for free.
    if (el.type === 'label') {
      destroyConnectHandle();
      const p = internals.toGraph(evt.clientX, evt.clientY);
      labelNodeDragState = {
        node: el,
        origin: { x: el.x, y: el.y },
        offset: { x: p.x - el.x, y: p.y - el.y },
        moved: false
      };
      evt.stopPropagation();
      evt.preventDefault();
      return;
    }

    // 2. mousedown on a selected connection's line:
    //    - alt+drag  → insert a new free-form bendpoint at click, drag it
    //    - plain drag → perpendicular segment slide (matches bpmn-js)
    if (el.waypoints) {
      if (bendpointEdge !== el) viewer.select(el.id);
      const p = internals.toGraph(evt.clientX, evt.clientY);

      // find the nearest segment
      let bestIdx = 1, bestDist = Infinity;
      for (let i = 0; i < el.waypoints.length - 1; i++) {
        const d = pointToSegmentDist(p, el.waypoints[i], el.waypoints[i + 1]);
        if (d < bestDist) { bestDist = d; bestIdx = i + 1; }
      }

      const a = el.waypoints[bestIdx - 1], b = el.waypoints[bestIdx];
      if (evt.altKey || !segmentMoveAxis(a, b)) {
        const original = el.waypoints.slice();
        const geometry = connectionGeometry(el);
        el.waypoints.splice(bestIdx, 0, { x: p.x, y: p.y });
        syncEdgeDi(el);
        internals.redrawConnection(el);
        refreshBendpoints();
        startBendDrag(el, bestIdx, original, true, geometry, p);
      } else {
        startSegmentDrag(el, bestIdx - 1, p);
      }

      evt.stopPropagation();
      evt.preventDefault();
      return;
    }

    // 3. shape mousedown
    if (!('x' in el)) return;
    const p = internals.toGraph(evt.clientX, evt.clientY);

    if (evt.shiftKey) {
      startConnect(el, p.x, p.y, evt);
      evt.stopPropagation();
      evt.preventDefault();
      return;
    }

    // when multiple shapes are selected and the user grabs one of them,
    // drag the whole group; if they grabbed an unselected shape, drag
    // just that one (and pin selection to it on mouseup)
    const selected = viewer.getSelection();
    const rawNodes = selected.includes(el.id)
      ? selected.map(i => viewer.getElement(i)).filter(n => n && !n.waypoints && 'x' in n)
      : [ el ];

    // Dedupe: if any selected node is a BoundaryEvent whose host is
    // ALSO selected, exclude the boundary — translateAttachersOf will
    // move it via the host so we don't apply (dx, dy) twice.
    const draggedNodes = topLevelNodes(rawNodes);
    if (!contextRules.canMove(draggedNodes)) return;

    dragState = {
      nodes: draggedNodes,
      origins: draggedNodes.map(n => ({ x: n.x, y: n.y })),
      anchor: el,
      startAnchor: { x: el.x, y: el.y },
      offset: { x: p.x - el.x, y: p.y - el.y },
      initialGeometry: geometrySnapshot(draggedNodes),
      moved: false
    };

    // The hover-edge connect handle is rooted at the drag-start
    // position; let it go now so it doesn't float in space while the
    // shape moves. It will reappear next time the cursor hovers a
    // shape's edge band.
    destroyConnectHandle();

    evt.stopPropagation();
    evt.preventDefault();
  }

  function onMouseMove(evt) {
    if (activateHoverDrag(evt)) return;
    updateHoverControls(evt);
    updateConnectHandle(evt);
    if (connectState) {
      if (!connectState.active) {
        if (Math.hypot(evt.clientX - connectState.press.x, evt.clientY - connectState.press.y) <= 5) return;
        connectState.active = true;
        internals.cancelPointerClicks();
        renderConnectPreview();
        destroyContextPad();
      }
      if (connectState.startClient && Math.hypot(evt.clientX - connectState.startClient.x, evt.clientY - connectState.startClient.y) > 3) {
        connectState.moved = true; destroyContextPad();
      }
      const p = internals.toGraph(evt.clientX, evt.clientY);
      const hovered = elementAtPoint(evt.clientX, evt.clientY, { acceptEdge: candidate => !!getConnectionType(connectState.source, candidate) });
      updateConnectPreview(p.x, p.y, hovered);
      return;
    }
    if (bendDragState) {
      const p = internals.toGraph(evt.clientX, evt.clientY);
      updateBendDrag(p, evt);
      return;
    }
    if (segmentDragState) {
      const p = internals.toGraph(evt.clientX, evt.clientY);
      updateSegmentDrag(p);
      return;
    }
    if (resizeDragState) {
      updateResize(evt);
      return;
    }
    if (lassoState) {
      const p = internals.toGraph(evt.clientX, evt.clientY);
      updateLasso(p);
      return;
    }
    if (labelDragState) {
      updateConnectionLabelDrag(evt);
      return;
    }
    if (labelNodeDragState) {
      updateLabelNodeDrag(evt);
      return;
    }
    if (!dragState) return;
    const p = internals.toGraph(evt.clientX, evt.clientY);
    const anchor = dragState.anchor;
    let newAnchorX = Math.round(p.x - dragState.offset.x);
    let newAnchorY = Math.round(p.y - dragState.offset.y);

    // Shift = constrain to dominant axis relative to drag origin
    if (evt.shiftKey) {
      const dxFromOrigin = newAnchorX - dragState.startAnchor.x;
      const dyFromOrigin = newAnchorY - dragState.startAnchor.y;
      if (Math.abs(dxFromOrigin) > Math.abs(dyFromOrigin)) {
        newAnchorY = dragState.startAnchor.y;
      } else {
        newAnchorX = dragState.startAnchor.x;
      }
    }

    // Snap: alignment with sibling shapes' edges & centres, then grid.
    // Boundary placement follows the grabbed point. General sibling/grid
    // snapping can displace its centre off the chosen host perimeter.
    const snap = anchor.type === 'bpmn:BoundaryEvent'
      ? { x: newAnchorX, y: newAnchorY, guides: [] }
      : computeSnap(anchor, newAnchorX, newAnchorY, dragState.nodes);
    newAnchorX = snap.x;
    newAnchorY = snap.y;
    drawAlignmentGuides(snap.guides);

    const dx = newAnchorX - anchor.x;
    const dy = newAnchorY - anchor.y;
    if (dx === 0 && dy === 0) return;
    if (moveNodeSet(dragState.nodes, dx, dy, true, dragState.initialGeometry) === false) {
      dragState.moved = false;
      clearAlignmentGuides();
      return;
    }
    internals.refreshSelection();
    refreshResizeHandles();
    refreshSelectionMarkers();
    repositionContextPad();
    dragState.moved = true;
  }

  function elementAtPoint(clientX, clientY, opts = {}) {
    // Walk through the stack from topmost to lowest; skip:
    //   - bendpoint / resize / connect handles
    //   - the dragged element itself (if provided)
    //   - connection edges (when opts.shapesOnly)
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [ document.elementFromPoint(clientX, clientY) ].filter(Boolean);

    for (const target of stack) {
      if (!target || !viewer.getSvg().contains(target)) continue;
      // skip overlay handles
      if (closestWithAttr(target, 'data-bend-index') || closestWithAttr(target, 'data-segment-index') || target.classList && (
        target.classList.contains('bpmn-xyflow-bendpoint') ||
        target.classList.contains('bpmn-xyflow-resize-handle') ||
        target.classList.contains('bpmn-xyflow-connect-handle')
      )) continue;
      const id = internals.findElementId(target);
      if (!id) continue;
      const el = viewer.getElement(id);
      if (!el) continue;
      if (opts.skip && el === opts.skip) continue;
      if (el.waypoints && (opts.shapesOnly || (opts.acceptEdge && !opts.acceptEdge(el)))) continue;
      // An ineligible edge's hit corridor must not occlude a valid shape
      // beneath it. Shapes still stop lookup, even when their rule rejects
      // the drop, so invalid gateways cannot fall through to a parent pool.
      return el;
    }
    return null;
  }

  function onMouseUp(evt) {
    if (hoverDragPending) {
      const pending = hoverDragPending;
      hoverDragPending = null;
      if (internals.findElementId(evt.target) === pending.edge.id && viewer.getElement(pending.edge.id) === pending.edge) {
        const next = new Set(pending.selection);
        if (evt.shiftKey || evt.ctrlKey || evt.metaKey) { if (next.has(pending.edge.id)) next.delete(pending.edge.id); else next.add(pending.edge.id); }
        else { next.clear(); next.add(pending.edge.id); }
        viewer.select([ ...next ]);
      }
      clearHoverControls();
      return;
    }
    if (hoverControlActive) {
      try { if (bendDragState) endBendDrag(evt); else if (segmentDragState) endSegmentDrag(); }
      finally { clearHoverControls(); }
      return;
    }
    if (connectState) {
      if (connectState.originButton?.contains(evt.target) && !connectState.moved) return;
      const node = elementAtPoint(evt.clientX, evt.clientY, { acceptEdge: candidate => !!getConnectionType(connectState.source, candidate) });
      endConnect(node, internals.toGraph(evt.clientX, evt.clientY));
      return;
    }
    if (bendDragState) {
      endBendDrag(evt);
      return;
    }
    if (segmentDragState) {
      endSegmentDrag();
      return;
    }
    if (resizeDragState) {
      endResize();
      return;
    }
    if (lassoState) {
      endLasso(evt.ctrlKey || evt.metaKey);
      return;
    }
    if (labelDragState) {
      endConnectionLabelDrag();
      return;
    }
    if (labelNodeDragState) {
      endLabelNodeDrag();
      return;
    }
    if (!dragState) return;
    const { nodes, initialGeometry, moved } = dragState;
    const insertTarget = nodes.length === 1 ? elementAtPoint(evt.clientX, evt.clientY, { skip: nodes[0] }) : null;
    dragState = null;
    clearAlignmentGuides();
    if (!moved) return;

    const finalGeometry = geometrySnapshot(nodes);
    if (sameGeometry(initialGeometry, finalGeometry)) { restoreGeometry(initialGeometry); return; }
    // Dropping into a black-box participant or collapsed subprocess is a
    // rejected containment gesture, not a visual move with the old owner.
    if (nodes.some(node => !node.host && viewer.getGraph().nodes.some(container =>
      container !== node && container !== node.parent && !container.hidden &&
      (container.type === 'bpmn:Participant' || container.businessObject?.$instanceOf('bpmn:SubProcess')) &&
      getMid(node).x > container.x && getMid(node).x < container.x + container.width &&
      getMid(node).y > container.y && getMid(node).y < container.y + container.height && !canBeParent(container, node)))) {
      restoreGeometry(initialGeometry); return;
    }
    if (nodes.length === 1 && nodes[0].businessObject.$instanceOf('bpmn:Event')) {
      const node = nodes[0], position = getMid(node);
      const host = viewer.getGraph().nodes.filter(candidate => candidate !== node && nearBoundaryHost(candidate, position) && contextRules.canAttach(node, candidate, position))
        .sort((a, b) => (a === insertTarget ? -1 : b === insertTarget ? 1 : a.width * a.height - b.width * b.height))[0];
      if (host) { restoreGeometry(initialGeometry); attachBoundary(node, host, position); return; }
      if (node.type === 'bpmn:BoundaryEvent') { restoreGeometry(initialGeometry); return; }
    }

    // Boundary-event attach: for any boundary event in the drag set,
    // detect whether its centre is now over an activity and update
    // host / attachedToRef accordingly.
    const boundaryUpdates = nodes
      .map(n => detectBoundaryAttach(n))
      .filter(Boolean);

    // Reparent: detect new parent container per moved node.
    const reparents = nodes
      .map(n => detectReparent(n))
      .filter(Boolean);
    const dropChanges = reparents.flatMap(change => contextRules.dropReplacements([ change.node ], change.newParent)?.replacements || []);
    if (reparents.some(change => !contextRules.canMove([ change.node ], change.newParent) ||
      (change.node.businessObject.$instanceOf('bpmn:Event') && !dropChanges.some(replacement => replacement.oldElementId === change.node.id) &&
       !isValidTarget({ type: change.node.type, eventDefinitionType: change.node.businessObject.eventDefinitions?.[0]?.$type,
         ...(Object.hasOwn(change.node.businessObject, 'isInterrupting') ? { isInterrupting: change.node.businessObject.isInterrupting } : {}) }, { parent: change.newParent, host: change.node.host })))) {
      restoreGeometry(initialGeometry); return;
    }
    if (boundaryUpdates.some(change => !change.newHost)) {
      restoreGeometry(initialGeometry);
      refreshResizeHandles(); refreshSelectionMarkers();
      return;
    }

    categoryMutation(categoryGeometryElements(nodes), () => commands.compound('move', () => {
    commands.execute({
      name: 'move',
      do: () => {
        restoreGeometry(finalGeometry);
        boundaryUpdates.forEach(applyBoundaryAttach);
        reparents.forEach(applyReparent);
        internals.refreshSelection();
        repositionContextPad();
        refreshResizeHandles();
      },
      undo: () => {
        boundaryUpdates.forEach(undoBoundaryAttach);
        reparents.forEach(undoReparent);
        restoreGeometry(initialGeometry);
        internals.refreshSelection();
        repositionContextPad();
        refreshResizeHandles();
      }
    });
      dropChanges.forEach(change => replaceShape(viewer.getElement(change.oldElementId), { type: change.newElementType, ...(change.newElementType === 'bpmn:StartEvent' ? { isInterrupting: true } : {}) }));
      pruneInvalidConnections(nodes);
      if (insertTarget && insertTarget.type === 'bpmn:SequenceFlow' && viewer.getElement(insertTarget.id) === insertTarget) insertShape(nodes[0], insertTarget, getMid(nodes[0]));
    }));
  }

  // Boundary-event attach detection ////
  function detectBoundaryAttach(node) {
    if (!node || !node.businessObject || !node.businessObject.$instanceOf) return null;
    if (!node.businessObject.$instanceOf('bpmn:BoundaryEvent')) return null;

    const graph = viewer.getGraph();
    if (!graph) return null;

    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;

    // find the activity whose bounds contain the boundary centre, or
    // whose perimeter is within ~6px of it
    let host = null;
    for (const cand of graph.nodes) {
      if (cand === node || cand.waypoints || cand.type === 'label') continue;
      if (!cand.businessObject || !cand.businessObject.$instanceOf) continue;
      if (!canAttachBoundary(node, cand) || !contextRules.canAttach(node, cand, { x: cx, y: cy })) continue;
      const inside = cx >= cand.x && cx <= cand.x + cand.width &&
                     cy >= cand.y && cy <= cand.y + cand.height;
      const nearEdge =
        cx >= cand.x - 8 && cx <= cand.x + cand.width + 8 &&
        cy >= cand.y - 8 && cy <= cand.y + cand.height + 8;
      if (inside || nearEdge) { host = cand; break; }
    }

    const oldHost = node.host || null;
    if (host === oldHost) return null;
    return { node, oldHost, newHost: host };
  }

  function applyBoundaryAttach({ node, newHost }) {
    if (node.host) {
      const index = (node.host.attachers || []).indexOf(node);
      if (index !== -1) node.host.attachers.splice(index, 1);
    }
    node.host = newHost || null;
    node.businessObject.attachedToRef = newHost ? newHost.businessObject : undefined;
    if (newHost) {
      newHost.attachers = newHost.attachers || [];
      if (!newHost.attachers.includes(node)) newHost.attachers.push(node);
    }
  }

  function undoBoundaryAttach({ node, oldHost }) {
    applyBoundaryAttach({ node, newHost: oldHost });
  }

  function nearBoundaryHost(host, position) {
    return position.x >= host.x - 20 && position.x <= host.x + host.width + 20 &&
      position.y >= host.y - 20 && position.y <= host.y + host.height + 20;
  }

  function attachBoundary(element, host, position) {
    if (!element || !host || viewer.getElement(element.id) !== element || viewer.getElement(host.id) !== host || element.waypoints) return null;
    if (element.businessObject.$instanceOf('bpmn:ThrowEvent') && [ 'dataInputs', 'dataInputAssociations' ].some(key => (element.businessObject[key] || []).length)) return null;
    position = position || { x: host.x + host.width, y: host.y + host.height };
    if (![ position.x, position.y ].every(Number.isFinite) || !nearBoundaryHost(host, position) || !contextRules.canAttach(element, host, position)) return null;
    const oldHost = element.host, oldParent = element.parent;
    const conversion = contextRules.dropReplacements([ element ], host, position)?.replacements?.some(change => change.oldElementId === element.id);
    const definition = conversion ? undefined : element.businessObject.eventDefinitions?.[0]?.$type;
    const target = { type: 'bpmn:BoundaryEvent', ...(definition ? { eventDefinitionType: definition } : {}), cancelActivity: element.type === 'bpmn:BoundaryEvent' ? element.businessObject.cancelActivity : true };
    const allowBlank = !definition && (element.type === 'bpmn:IntermediateThrowEvent' || element.type === 'bpmn:BoundaryEvent');
    if (!allowBlank && !isValidTarget(target, { parent: host.parent, host })) return null;
    const lists = [ ...new Set([ oldHost?.attachers, host.attachers ].filter(Array.isArray)) ].map(array => ({ array, values: array.slice() }));
    try { commands.compound('attach-boundary', () => {
      commands.execute({ name: 'boundary-host', do: () => {
        if (element.host?.attachers?.includes(element)) element.host.attachers.splice(element.host.attachers.indexOf(element), 1);
        element.host = host; host.attachers ||= []; if (!host.attachers.includes(element)) host.attachers.push(element);
      }, undo: () => {
        if (host.attachers?.includes(element)) host.attachers.splice(host.attachers.indexOf(element), 1);
        lists.forEach(({ array, values }) => array.splice(0, array.length, ...values)); element.host = oldHost;
      } });
      if (!replaceShape(element, target, {}, {}, { host, allowBlank })) throw new Error('cannot attach this event');
      if (oldParent !== host.parent) {
        const change = { node: element, oldParent, newParent: host.parent };
        commands.execute({ name: 'boundary-parent', do: () => applyReparent(change), undo: () => undoReparent(change) });
      }
      if (geometryCommand('boundary-position', () => moveNodeSet([ element ], position.x - element.width / 2 - element.x, position.y - element.height / 2 - element.y, true)) === false) {
        const error = new Error('The boundary position cannot preserve its connection docking');
        error.code = 'UNROUTABLE_DOCKING'; throw error;
      }
      pruneInvalidConnections([ element ]);
    }); } catch (error) { if (error.code === 'UNROUTABLE_DOCKING') return null; throw error; }
    return element;
  }

  // Reparent detection /////////////////
  function detectReparent(node) {
    if (!node || !node.businessObject || !node.businessObject.$instanceOf) return null;
    // skip non-flow nodes and connections
    if (node.waypoints || node.type === 'label') return null;
    if (!node.businessObject.$instanceOf('bpmn:FlowNode') &&
        !node.businessObject.$instanceOf('bpmn:DataObjectReference') &&
        !node.businessObject.$instanceOf('bpmn:DataStoreReference')) return null;

    const graph = viewer.getGraph();
    if (!graph) return null;

    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;

    // find the smallest container under the centre (Lane > Participant > SubProcess)
    let bestParent = null;
    let bestArea = Infinity;
    for (const cand of graph.nodes) {
      if (cand === node || cand.waypoints || cand.type === 'label') continue;
      if (!canBeParent(cand, node)) continue;
      const inside = cx >= cand.x && cx <= cand.x + cand.width &&
                     cy >= cand.y && cy <= cand.y + cand.height;
      if (!inside) continue;
      const area = cand.width * cand.height;
      if (area < bestArea) { bestParent = cand; bestArea = area; }
    }

    if (node.host) bestParent = node.host.parent;
    if (!bestParent && canBeParent(findRootContainer(), node)) bestParent = findRootContainer();
    const oldParent = node.parent || null;
    if (!bestParent || bestParent === oldParent) return null;
    return { node, oldParent, newParent: bestParent };
  }

  function applyReparent(change) {
    const { node, newParent } = change;
    if (!newParent) return;
    if (!change.before) {
      const arrays = new Set([ node.parent && node.parent.children, newParent.children,
        node.businessObject.$parent && node.businessObject.$parent.flowElements,
        node.businessObject.$parent && node.businessObject.$parent.artifacts,
        semanticContainer(newParent) && semanticContainer(newParent).flowElements,
        semanticContainer(newParent) && semanticContainer(newParent).artifacts ]);
      viewer.getGraph().nodes.forEach(other => { if (other.businessObject && other.businessObject.flowNodeRef) arrays.add(other.businessObject.flowNodeRef); });
      change.before = { owner: node.businessObject.$parent, arrays: [ ...arrays ].filter(Array.isArray).map(array => ({ array, values: array.slice() })) };
    }
    const oldParent = node.parent;
    if (oldParent) {
      const index = (oldParent.children || []).indexOf(node);
      if (index !== -1) oldParent.children.splice(index, 1);
    }
    node.parent = newParent;
    newParent.children = newParent.children || [];
    if (!newParent.children.includes(node)) newParent.children.push(node);

    const bo = node.businessObject;

    // Detach from any previous lanes' flowNodeRef arrays so the BPMN
    // doesn't end up referencing the same node from two lanes.
    const graph = viewer.getGraph();
    if (graph) {
      graph.nodes.forEach(other => {
        if (!other.businessObject || !other.businessObject.$instanceOf) return;
        if (!other.businessObject.$instanceOf('bpmn:Lane')) return;
        if (other === newParent) return;
        const refs = other.businessObject.flowNodeRef;
        if (Array.isArray(refs)) {
          const i = refs.indexOf(bo);
          if (i >= 0) refs.splice(i, 1);
        }
      });
    }

    // Resolve the eventual flowElements-owning container.
    const oldOwnerBo = bo.$parent;
    let newOwnerBo = newParent.businessObject;
    if (newOwnerBo && newOwnerBo.$instanceOf && newOwnerBo.$instanceOf('bpmn:Participant')) {
      newOwnerBo = newOwnerBo.processRef;
    }
    if (newOwnerBo && newOwnerBo.$instanceOf && newOwnerBo.$instanceOf('bpmn:Lane')) {
      // wire flowNodeRef on the new lane and walk up to the owning Process
      newOwnerBo.flowNodeRef = newOwnerBo.flowNodeRef || [];
      if (!newOwnerBo.flowNodeRef.includes(bo)) newOwnerBo.flowNodeRef.push(bo);
      let p = newOwnerBo.$parent;
      while (p && !isFlowElementsContainer(p)) p = p.$parent;
      newOwnerBo = p;
    }
    if (newOwnerBo?.$instanceOf('bpmn:Collaboration') && bo.$instanceOf('bpmn:DataStoreReference')) newOwnerBo = findOwningProcess();
    const key = bo.$instanceOf('bpmn:Artifact') ? 'artifacts' : 'flowElements';
    if (oldOwnerBo && newOwnerBo && oldOwnerBo !== newOwnerBo &&
        Array.isArray(oldOwnerBo[key]) && oldOwnerBo[key].includes(bo)) {
      oldOwnerBo[key].splice(oldOwnerBo[key].indexOf(bo), 1);
      newOwnerBo[key] = newOwnerBo[key] || [];
      if (!newOwnerBo[key].includes(bo)) newOwnerBo[key].push(bo);
      bo.$parent = newOwnerBo;
    }
  }

  function undoReparent(change) {
    applyReparent({ node: change.node, newParent: change.oldParent });
    if (change.before) {
      change.before.arrays.forEach(({ array, values }) => array.splice(0, array.length, ...values));
      change.node.businessObject.$parent = change.before.owner;
    }
  }

  // Connect ////////////////////////
  let connectState = null;

  // an SVG <g> living in viewport that previews the in-flight connection
  let connectPreview = null;

  function startConnect(node, x, y, event) {
    const restorePort = !!(event && connectHandle?.contains(event.target));
    // A source control owns its press even below the drag threshold. A pending
    // Shift-body press retains ordinary multi-selection until Connect activates.
    if (restorePort) internals.cancelPointerClicks();
    destroyConnectHandle();
    connectState = { source: node, start: { x, y }, active: !event, restorePort,
      press: event ? { x: event.clientX, y: event.clientY } : null };
    if (!event) renderConnectPreview();
  }

  function renderConnectPreview() {
    const { x, y } = connectState.start;
    connectPreview = svgCreate('g', { 'class': 'bpmn-xyflow-connect-preview', 'pointer-events': 'none' });
    const line = svgCreate('path', {
      d: `M${x},${y} L${x},${y}`,
      stroke: themeToken('canvas-accent'), 'stroke-width': 2, 'stroke-dasharray': '5,3', fill: 'none',
      'pointer-events': 'none'
    });
    svgAppend(connectPreview, line);
    svgAppend(connectPreview, svgCreate('circle', { 'class': 'bpmn-xyflow-connect-target',
      fill: themeToken('surface'), stroke: themeToken('canvas-accent'), visibility: 'hidden', 'pointer-events': 'none' }));
    svgAppend(internals.viewport, connectPreview);
  }

  function updateConnectPreview(x, y, hoveredTarget) {
    if (!connectPreview) return;
    const line = connectPreview.firstChild;
    // Colour the preview based on whether the cursor is over a valid
    // drop target. Bare cursor over empty canvas → neutral blue;
    // valid target → theme accent; invalid target → theme danger.
    let stroke = themeToken('canvas-accent'), validTarget = false;
    let points = [ connectState.start, { x, y } ];
    if (hoveredTarget) {
      const inferred = getConnectionType(connectState.source, hoveredTarget);
      stroke = inferred ? themeToken('canvas-accent') : themeToken('danger');
      if (inferred) {
        const planned = routeConnection({ source: connectState.source, target: hoveredTarget, type: inferred,
          businessObject: moddle.create(inferred) }, { connectionStart: connectState.start, connectionEnd: { x, y }, preserveDocking: 'both' });
        if (planned) { points = planned; validTarget = true; } else stroke = themeToken('danger');
      }
    }
    line.setAttribute('d', createLine(points, {}, 5).getAttribute('d'));
    line.setAttribute('stroke', stroke);
    const target = connectPreview.querySelector('.bpmn-xyflow-connect-target');
    target.setAttribute('visibility', validTarget ? 'visible' : 'hidden');
    if (validTarget) svgAttr(target, { cx: points.at(-1).x, cy: points.at(-1).y,
      r: 4 / viewer.getViewport().zoom, 'stroke-width': 1.5 / viewer.getViewport().zoom });
  }

  function endConnect(targetNode, position) {
    if (!connectState) return;
    const { source, start, active, press, restorePort } = connectState;
    connectState = null;

    if (connectPreview && connectPreview.parentNode) {
      connectPreview.parentNode.removeChild(connectPreview);
    }
    connectPreview = null;

    if (viewer.getElement(source.id) !== source) return;
    if (!active) {
      if (restorePort) showConnectHandle(source, start);
      return;
    }
    if (!targetNode || targetNode.type === 'label') return;
    // The viewer may select the source on pointerup after an out-and-back.
    // Keep a deliberately created loop visible rather than covering it again.
    if (press) destroyContextPad();

    // createConnection runs the rules; null means rejected
    createConnection(source, targetNode, { connectionStart: start, connectionEnd: position });
  }

  function connectionParent(type, source, target) {
    if (type === 'bpmn:MessageFlow') return findRootContainer();
    if (type !== 'bpmn:Association') return source.parent;
    // TextAnnotationBehavior chooses the annotation's visual parent. This
    // preserves imported notes nested below the active canvas root.
    if (target.type === 'bpmn:TextAnnotation') return target.parent;
    if (source.type === 'bpmn:TextAnnotation') return source.parent;
    const ancestors = new Set();
    for (let parent = source.parent; parent && !ancestors.has(parent); parent = parent.parent) ancestors.add(parent);
    let parent = target.parent; const seen = new Set();
    while (parent && !ancestors.has(parent) && !seen.has(parent)) { seen.add(parent); parent = parent.parent; }
    while (parent && !parent.businessObject?.$instanceOf('bpmn:Participant') && !parent.businessObject?.$instanceOf('bpmn:Collaboration') && !isFlowElementsContainer(parent.businessObject)) parent = parent.parent;
    return parent || findRootContainer();
  }

  function ownerForConnection(connType, source, target) {
    if (connType === 'bpmn:Association') return semanticContainer(connectionParent(connType, source, target));
    if (connType === 'bpmn:DataInputAssociation') return target.businessObject;
    if (connType === 'bpmn:DataOutputAssociation') return source.businessObject;
    const defs = viewer.getDefinitions();
    if (connType === 'bpmn:MessageFlow') return (defs.rootElements || []).find(root => root.$instanceOf('bpmn:Collaboration'));
    return getFlowScope(source) || getFlowScope(target) || findCurrentContainer();
  }

  function isFlowElementsContainer(bo) {
    return !!bo && (bo.$instanceOf('bpmn:Process') || bo.$instanceOf('bpmn:SubProcess'));
  }

  function ownerKeyForType(type) {
    return ({ 'bpmn:MessageFlow': 'messageFlows', 'bpmn:Association': 'artifacts',
      'bpmn:DataInputAssociation': 'dataInputAssociations', 'bpmn:DataOutputAssociation': 'dataOutputAssociations' })[type] || 'flowElements';
  }

  function connectionSemantics(type, source, target, businessObject, existingOwner) {
    const owner = existingOwner || ownerForConnection(type, source, target);
    if (!owner) return null;
    const key = ownerKeyForType(type);
    const compensation = type === 'bpmn:Association' && source.businessObject.$instanceOf('bpmn:BoundaryEvent') &&
      (source.businessObject.eventDefinitions || []).some(definition => definition.$instanceOf('bpmn:CompensateEventDefinition'));
    const previousCompensation = target.businessObject.isForCompensation;
    if (compensation) businessObject.associationDirection = 'One';
    businessObject.$parent = owner;
    const input = type === 'bpmn:DataInputAssociation', output = type === 'bpmn:DataOutputAssociation';
    const hadAssociations = Object.hasOwn(owner, key), associations = owner[key] || [];
    let placeholder = null, createdPlaceholder = false;
    const hadProperties = Object.hasOwn(owner, 'properties'), properties = owner.properties || [];
    if (input) {
      // Retain a genuine authored input binding when the visual owner stays
      // the same. Fresh inputs use the reference editor's reusable Property;
      // reconnecting an external source must never allocate IO specifications.
      const current = businessObject.targetRef;
      const currentOwner = current?.$parent?.$instanceOf?.('bpmn:InputOutputSpecification') ? current.$parent.$parent : current?.$parent;
      if (current && currentOwner === owner) placeholder = current;
      else {
        placeholder = properties.find(property => property?.$instanceOf?.('bpmn:Property') && property.name === '__targetRef_placeholder');
        if (!placeholder) {
          placeholder = moddle.create('bpmn:Property', { id: nextId('Property'), name: '__targetRef_placeholder' });
          placeholder.$parent = owner; createdPlaceholder = true;
        }
      }
      businessObject.sourceRef = [ source.businessObject, ...(businessObject.sourceRef || []).slice(1) ];
      businessObject.targetRef = placeholder;
    } else if (output) {
      // sourceRef is optional. Preserve authored sources, including references
      // to retained IO on an old owner, exactly as the reference updater does.
      businessObject.targetRef = target.businessObject;
    } else {
      businessObject.sourceRef = source.businessObject;
      businessObject.targetRef = target.businessObject;
    }
    const add = (object, property, value) => {
      object[property] = object[property] || [];
      if (!object[property].includes(value)) object[property].push(value);
    };
    const remove = (object, property, value) => {
      const array = object[property];
      if (array && array.includes(value)) array.splice(array.indexOf(value), 1);
    };
    return {
      owner, key,
      attach() {
        if (compensation) { target.businessObject.isForCompensation = true; internals.redrawShape(target); }
        if (input || output) owner[key] = associations;
        add(owner, key, businessObject);
        if (type === 'bpmn:SequenceFlow') {
          add(source.businessObject, 'outgoing', businessObject);
          add(target.businessObject, 'incoming', businessObject);
        }
        if (createdPlaceholder) {
          owner.properties = properties;
          if (!properties.includes(placeholder)) properties.push(placeholder);
        }
      },
      detach() {
        if (compensation) { target.businessObject.isForCompensation = previousCompensation; internals.redrawShape(target); }
        remove(owner, key, businessObject);
        if ((input || output) && !hadAssociations && !associations.length) delete owner[key];
        if (type === 'bpmn:SequenceFlow') {
          remove(source.businessObject, 'outgoing', businessObject);
          remove(target.businessObject, 'incoming', businessObject);
        }
        if (createdPlaceholder) {
          remove(owner, 'properties', placeholder);
          if (!hadProperties && !properties.length) delete owner.properties;
        }
      }
    };
  }

  function createConnection(source, target, options = {}) {
    return categoryMutation([], () => {
      const edge = createConnectionCore(source, target, options);
      recordCategoryElements([ edge ]);
      return edge;
    });
  }

  function createConnectionCore(source, target, options = {}) {
    const graph = viewer.getGraph(), defs = viewer.getDefinitions();
    if (!graph || !defs || !source || !target || viewer.getElement(source.id) !== source || viewer.getElement(target.id) !== target) return null;
    if (!options || typeof options !== 'object' || !usableConnectionEndpoint(source) || !usableConnectionEndpoint(target)) return null;
    if (options.waypoints !== undefined && !validConnectionRoute(options.waypoints)) return null;
    if ([ options.connectionStart, options.connectionEnd ].some(point => point !== undefined &&
      (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)))) return null;
    const inferred = getConnectionType(source, target);
    const connType = options.type || inferred;
    if (!inferred || connType !== inferred) return null;
    const id = options.businessObject && options.businessObject.id || nextId(connType.split(':')[1]);
    const businessObject = options.businessObject || moddle.create(connType, { id });
    const waypoints = options.waypoints ? normalizedConnectionRoute(options.waypoints, source, target) : routeConnection({ source, target, type: connType, businessObject }, {
      connectionStart: options.connectionStart, connectionEnd: options.connectionEnd,
      ...(options.connectionStart || options.connectionEnd ? { preserveDocking: 'both' } : {})
    });
    if (!waypoints) return null;
    const semantics = connectionSemantics(connType, source, target, businessObject);
    if (!semantics) return null;
    const plane = findCurrentPlane();
    const di = options.di || moddle.create('bpmndi:BPMNEdge', { id: id + '_di', bpmnElement: businessObject });
    di.bpmnElement = businessObject;
    di.$parent = plane;
    const edge = { id, type: connType, businessObject, di, source, target, waypoints,
      parent: connectionParent(connType, source, target), hidden: false };
    syncEdgeDi(edge);
    const mirrors = mirroredRepresentations(di, businessObject);
    commands.execute({
      name: 'connect',
      do: () => {
        semantics.attach();
        mirrors.forEach(({ plane: destination, di: mirror }) => { if (!destination.planeElement.includes(mirror)) destination.planeElement.push(mirror); });
        if (!graph.edges.includes(edge)) graph.edges.push(edge);
        graph.elementsById.set(id, edge);
        if (plane) { plane.planeElement = plane.planeElement || []; if (!plane.planeElement.includes(di)) plane.planeElement.push(di); }
        internals.redrawConnection(edge);
      },
      undo: () => {
        semantics.detach();
        mirrors.forEach(({ plane: destination, di: mirror }) => { const index = destination.planeElement.indexOf(mirror); if (index !== -1) destination.planeElement.splice(index, 1); });
        const index = graph.edges.indexOf(edge);
        if (index !== -1) graph.edges.splice(index, 1);
        graph.elementsById.delete(id);
        if (plane && plane.planeElement.includes(di)) plane.planeElement.splice(plane.planeElement.indexOf(di), 1);
        internals.removeElementGfx(id);
        viewer.deselect(id);
      }
    });
    return edge;
  }

  function updateWaypoints(edge, waypoints, hints = {}) {
    return categoryMutation(edge ? [ edge, ...dependentConnectionClosure([ edge ], viewer.getGraph()?.edges || []) ] : [], () => {
      return updateWaypointsCore(edge, waypoints, hints);
    });
  }

  function updateWaypointsCore(edge, waypoints, hints = {}) {
    if (!edge || !edge.waypoints || viewer.getElement(edge.id) !== edge || !validConnectionRoute(waypoints)) return false;
    if (sameWaypoints(edge.waypoints, waypoints)) return edge;
    const points = normalizedConnectionRoute(waypoints, edge.source, edge.target);
    if (!points) return false;
    const before = connectionSnapshots([ edge ]);
    if (!Object.keys(hints).length && edge.waypoints.length === points.length) {
      const delta = { x: points[0].x - edge.waypoints[0].x, y: points[0].y - edge.waypoints[0].y };
      if (edge.waypoints.every((point, index) => Math.abs(point.x + delta.x - points[index].x) < 1e-8 && Math.abs(point.y + delta.y - points[index].y) < 1e-8)) hints = { moveDelta: delta };
    }
    let after;
    commands.execute({ name: 'update-waypoints', do: () => {
      if (after) restoreConnections(after);
      else {
        edge.waypoints = points.map(point => ({ ...point })); syncEdgeDi(edge);
        propagateDependentGeometry(before, new Map([ [ edge, hints ] ]), new Set([ edge ]));
        after = before.map(({ edge }) => ({ edge, ...connectionGeometry(edge) })); redrawConnections(after);
      }
    }, undo: () => restoreConnections(before) });
    return edge;
  }

  function reconnectConnection(edge, side, endpoint, points) {
    return categoryMutation(edge ? [ edge, ...dependentConnectionClosure([ edge ], viewer.getGraph()?.edges || []) ] : [], () => {
      const result = reconnectConnectionCore(edge, side, endpoint, points);
      recordCategoryElements([ edge ]);
      return result;
    });
  }

  function reconnectConnectionCore(edge, side, endpoint, points) {
    if (!edge || !edge.waypoints || viewer.getElement(edge.id) !== edge || !endpoint || viewer.getElement(endpoint.id) !== endpoint) return null;
    if (points !== undefined && !validConnectionRoute(points)) return null;
    if (!usableConnectionEndpoint(endpoint) || !usableConnectionEndpoint(side === 'source' ? edge.target : edge.source)) return null;
    const newType = canReconnect(edge, side, endpoint);
    if (!newType) return null;
    const oldSource = edge.source, oldTarget = edge.target, oldBo = edge.businessObject, oldType = edge.type, oldParent = edge.parent;
    const newSource = side === 'source' ? endpoint : oldSource, newTarget = side === 'target' ? endpoint : oldTarget;
    const oldMembership = semanticMembership(oldBo);
    const copies = new Map(), newBo = compatibleSemanticClone(oldBo, newType, copies);
    if (newType === 'bpmn:SequenceFlow' && !canHaveCondition(newSource)) delete newBo.conditionExpression;
    const beforeBundle = connectionSnapshots([ edge ]), before = beforeBundle.find(entry => entry.edge === edge);
    const after = points ? normalizedConnectionRoute(points, newSource, newTarget) : routeConnection({ ...edge, type: newType, businessObject: newBo }, { source: newSource, target: newTarget,
      [side === 'source' ? 'connectionStart' : 'connectionEnd']: getMid(endpoint) });
    if (!after) return null;
    const newOwned = ownedSemantics(newBo), oldOwned = ownedSemantics(oldBo);
    const replacementRefs = new Map([ [ oldBo, newBo ] ]);
    copies.forEach((clone, original) => { if (original !== oldBo && newOwned.has(clone)) replacementRefs.set(original, clone); });
    const referenceFields = [];
    ownedSemantics(viewer.getDefinitions()).forEach(object => (object.$descriptor?.properties || []).filter(property => property.isReference && !property.isVirtual)
      .forEach(property => referenceFields.push({ object, key: property.name })));
    // Refuse removal of a condition/owned item still referenced from elsewhere.
    if (referenceFields.some(({ object, key }) => !oldOwned.has(object) && (Array.isArray(object[key]) ? object[key] : [ object[key] ])
      .some(value => oldOwned.has(value) && !replacementRefs.has(value)))) return null;
    const remapReferences = mapping => referenceFields.forEach(({ object, key }) => {
      if (Array.isArray(object[key])) object[key].forEach((value, index) => { if (mapping.has(value)) object[key][index] = mapping.get(value); });
      else if (mapping.has(object[key])) object[key] = mapping.get(object[key]);
    });
    const reverseRefs = new Map([ ...replacementRefs ].map(([ original, replacement ]) => [ replacement, original ]));
    const ownerCopy = copies.get(oldBo);
    newOwned.forEach(object => (object.$descriptor?.properties || []).filter(property => property.isReference && !property.isVirtual).forEach(property => {
      const value = object[property.name];
      if (Array.isArray(value)) value.forEach((entry, index) => { if (entry === ownerCopy) value[index] = newBo; });
      else if (value === ownerCopy) object[property.name] = newBo;
    }));
    const retainAssociationParent = oldType === 'bpmn:Association' && newType === oldType;
    const semantics = connectionSemantics(newType, newSource, newTarget, newBo, retainAssociationParent && oldMembership?.owner);
    if (!semantics) return null;
    let afterBundle;
    const wasDefault = oldSource.businessObject.default === oldBo;
    const oldIndex = oldMembership && oldMembership.index;
    const outgoingIndex = (oldSource.businessObject.outgoing || []).indexOf(oldBo);
    const incomingIndex = (oldTarget.businessObject.incoming || []).indexOf(oldBo);
    const restoreOrder = (array, value, index) => {
      if (!array || index < 0) return;
      const current = array.indexOf(value);
      if (current !== -1) array.splice(current, 1);
      array.splice(index, 0, value);
    };
    const detachOld = () => {
      if (oldMembership) { const list = oldMembership.owner[oldMembership.key]; const i = list.indexOf(oldBo); if (i >= 0) list.splice(i, 1); }
      for (const list of [ oldSource.businessObject.outgoing, oldTarget.businessObject.incoming ]) {
        if (list && list.includes(oldBo)) list.splice(list.indexOf(oldBo), 1);
      }
      if (wasDefault) delete oldSource.businessObject.default;
    };
    const attachOld = () => {
      if (oldMembership) { const list = oldMembership.owner[oldMembership.key]; if (!list.includes(oldBo)) list.splice(oldIndex, 0, oldBo); }
      if (oldType === 'bpmn:SequenceFlow') {
        oldSource.businessObject.outgoing = oldSource.businessObject.outgoing || [];
        oldTarget.businessObject.incoming = oldTarget.businessObject.incoming || [];
        if (!oldSource.businessObject.outgoing.includes(oldBo)) oldSource.businessObject.outgoing.push(oldBo);
        if (!oldTarget.businessObject.incoming.includes(oldBo)) oldTarget.businessObject.incoming.push(oldBo);
        restoreOrder(oldSource.businessObject.outgoing, oldBo, outgoingIndex);
        restoreOrder(oldTarget.businessObject.incoming, oldBo, incomingIndex);
      }
      if (wasDefault) oldSource.businessObject.default = oldBo;
    };
    const apply = (source, target, bo, type, waypoints, geometry) => {
      Object.assign(edge, { source, target, businessObject: bo, type, parent: bo === oldBo || retainAssociationParent ? oldParent : connectionParent(type, source, target), waypoints: waypoints.map(p => ({ ...p })) });
      edge.di.bpmnElement = bo;
      if (edge.label) edge.label.businessObject = bo;
      if (geometry) restoreConnectionGeometry(edge, geometry); else syncEdgeDi(edge);
      internals.redrawConnection(edge);
      refreshBendpoints();
    };
    commands.compound('reconnect', () => {
    commands.execute({
      name: 'reconnect',
      do: () => { detachOld(); semantics.attach();
        if (oldType === newType && oldMembership?.owner === semantics.owner && oldMembership.key === semantics.key) {
          restoreOrder(semantics.owner[semantics.key], newBo, oldIndex);
        }
        if (newType === 'bpmn:SequenceFlow' && newSource === oldSource) restoreOrder(newSource.businessObject.outgoing, newBo, outgoingIndex);
        if (newType === 'bpmn:SequenceFlow' && newTarget === oldTarget) restoreOrder(newTarget.businessObject.incoming, newBo, incomingIndex);
        if (wasDefault && newType === 'bpmn:SequenceFlow' && newSource === oldSource) oldSource.businessObject.default = newBo;
        apply(newSource, newTarget, newBo, newType, after); remapReferences(replacementRefs);
        if (afterBundle) restoreConnections(afterBundle);
        else {
          propagateDependentGeometry(beforeBundle, new Map([ [ edge, { [side === 'source' ? 'connectionStart' : 'connectionEnd']: true } ] ]), new Set([ edge ]));
          afterBundle = beforeBundle.map(({ edge }) => ({ edge, ...connectionGeometry(edge) })); redrawConnections(afterBundle);
        }
      },
      undo: () => { semantics.detach(); if (newSource.businessObject.default === newBo) delete newSource.businessObject.default; attachOld(); remapReferences(reverseRefs); apply(oldSource, oldTarget, oldBo, oldType, before.waypoints, before); restoreConnections(beforeBundle); }
    });
      if (oldType === 'bpmn:DataInputAssociation') cleanupDataInputPlaceholders([ oldBo.targetRef ]);
    });
    return edge;
  }

  function pruneInvalidConnections(nodes) {
    const moving = movableClosure(nodes);
    const graph = viewer.getGraph();
    (graph && graph.edges || []).slice().forEach(edge => {
      if (!moving.has(edge.source) && !moving.has(edge.target)) return;
      const inferred = getConnectionType(edge.source, edge.target);
      if (!inferred || inferred !== edge.type) deleteElement(edge);
      else {
        if (edge.type === 'bpmn:SequenceFlow' && edge.businessObject.conditionExpression && !canHaveCondition(edge.source)) {
          changeOwnedProperties(edge, edge.businessObject, { conditionExpression: undefined }, 'clear-incompatible-condition');
        }
        const newOwner = ownerForConnection(edge.type, edge.source, edge.target);
        const newParent = connectionParent(edge.type, edge.source, edge.target), oldParent = edge.parent;
        const old = semanticMembership(edge.businessObject);
        if (newOwner && old && old.owner !== newOwner) {
          const key = ownerKeyForType(edge.type), bo = edge.businessObject;
          const hadNewArray = Object.hasOwn(newOwner, key);
          commands.execute({ name: 'reparent-connection', do: () => {
            const oldArray = old.owner[old.key]; if (oldArray.includes(bo)) oldArray.splice(oldArray.indexOf(bo), 1);
            newOwner[key] = newOwner[key] || []; if (!newOwner[key].includes(bo)) newOwner[key].push(bo); bo.$parent = newOwner;
            edge.parent = newParent;
          }, undo: () => {
            const array = newOwner[key]; if (array.includes(bo)) array.splice(array.indexOf(bo), 1);
            if (!hadNewArray && !array.length) delete newOwner[key];
            old.owner[old.key].splice(old.index, 0, bo); bo.$parent = old.owner;
            edge.parent = oldParent;
          } });
        }
      }
    });
  }

  function insertShape(nodeOrType, connection, position) {
    if (!connection || connection.type !== 'bpmn:SequenceFlow' || viewer.getElement(connection.id) !== connection) return null;
    const isNew = typeof nodeOrType === 'string';
    const source = connection.source, target = connection.target;
    if (!isNew && (!nodeOrType || viewer.getElement(nodeOrType.id) !== nodeOrType || nodeOrType.waypoints ||
      nodeOrType === source || nodeOrType === target || nodeOrType.type === 'label')) return null;
    const original = connection.waypoints.map(point => ({ ...point }));
    if (!position) {
      const lengths = original.slice(1).map((point, index) => Math.hypot(point.x - original[index].x, point.y - original[index].y));
      let remaining = lengths.reduce((total, length) => total + length, 0) / 2;
      for (let index = 0; index < lengths.length; index++) {
        if (remaining <= lengths[index] || index === lengths.length - 1) {
          const ratio = lengths[index] ? remaining / lengths[index] : 0;
          position = { x: original[index].x + ratio * (original[index + 1].x - original[index].x),
            y: original[index].y + ratio * (original[index + 1].y - original[index].y) };
          break;
        }
        remaining -= lengths[index];
      }
    }
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
    let candidate = nodeOrType;
    if (isNew) {
      const bo = moddle.create(nodeOrType); bo.$parent = getFlowScope(source);
      candidate = { type: nodeOrType, businessObject: bo, parent: source.parent };
    }
    // Validate the prospective scope before mutating an existing shape.
    const probe = { ...candidate, parent: source.parent, businessObject: compatibleSemanticClone(candidate.businessObject, candidate.businessObject.$type) };
    probe.businessObject.$parent = getFlowScope(source);
    if (!contextRules.canInsert(probe, connection, position)) return null;
    if (getConnectionType(source, probe) !== 'bpmn:SequenceFlow' || getConnectionType(probe, target) !== 'bpmn:SequenceFlow') return null;
    let result;
    commands.compound('insert-shape', () => {
      const preferred = parentAt(position, probe);
      const parent = preferred && semanticContainer(preferred) === getFlowScope(source) ? preferred : source.parent;
      result = isNew ? addShape(nodeOrType, position, { parent }) : nodeOrType;
      if (!result) throw new Error('cannot insert flow node');
      if (!isNew) {
        const delta = { x: position.x - getMid(result).x, y: position.y - getMid(result).y };
        if (!moveShapes([ result ], delta, parent)) throw new Error('cannot move inserted flow node');
      }
      let segment = 0, distance = Infinity;
      original.slice(1).forEach((point, index) => {
        const current = pointToSegmentDist(position, original[index], point);
        if (current < distance) { distance = current; segment = index; }
      });
      const midpoint = getMid(result);
      const before = [ ...original.slice(0, segment + 1), midpoint ];
      const after = [ midpoint, ...original.slice(segment + 1) ];
      const renderer = internals.renderer && internals.renderer.bpmnRenderer;
      const incoming = renderer ? cropWaypoints(before, source, result, renderer) : computeWaypoints(source, result);
      const outgoing = renderer ? cropWaypoints(after, result, target, renderer) : computeWaypoints(result, target);
      if (!reconnectConnection(connection, 'target', result, incoming)) throw new Error('cannot reconnect inserted flow node');
      if (!createConnection(result, target, { waypoints: outgoing })) throw new Error('cannot finish inserted flow node');
    });
    return result;
  }

  function cleanupDataInputPlaceholders(candidates) {
    const definitions = viewer.getDefinitions(), live = ownedSemantics(definitions);
    for (const property of new Set(candidates)) {
      if (!property?.$instanceOf?.('bpmn:Property') || property.name !== '__targetRef_placeholder') continue;
      const owner = property.$parent, array = owner?.properties, index = array?.indexOf(property);
      if (!live.has(owner) || index === undefined || index < 0) continue;
      // An authored placeholder may carry meaningful metadata. It is retained
      // even when no association currently uses it; opaque values are not refs.
      if (Object.keys(property.$attrs || {}).length || property.$xmlBody ||
          Object.keys(property.$xml?.namespaces || {}).length ||
          property.$xml?.content?.some(token => token.kind === 'raw') ||
          Object.getOwnPropertyNames(property).some(key => ![ '$type', '$descriptor', '$model', '$attrs', '$xml', '$parent', 'id', 'name' ].includes(key) &&
            !([ '$instanceOf', 'get', 'set' ].includes(key) && typeof property[key] === 'function' && !Object.getOwnPropertyDescriptor(property, key).enumerable) &&
            (Array.isArray(property[key]) ? property[key].length : property[key] != null))) continue;
      const referenced = [ ...live ].some(object => (object.$descriptor?.properties || []).some(descriptor =>
        descriptor.isReference && !descriptor.isVirtual &&
        (Array.isArray(object[descriptor.name]) ? object[descriptor.name] : [ object[descriptor.name] ]).includes(property)));
      if (referenced) continue;
      const parent = property.$parent;
      commands.execute({ name: 'remove-unused-data-placeholder', do: () => {
        const current = array.indexOf(property); if (current !== -1) array.splice(current, 1); property.$parent = null;
      }, undo: () => { if (!array.includes(property)) array.splice(index, 0, property); property.$parent = parent; } });
      live.delete(property);
    }
  }

  // Delete /////////////////////////
  /**
   * Remove the external-label graph node that the Importer created
   * for events / gateways / data objects. Pushed as its own command
   * so it joins the parent compound undo step.
   */
  /**
   * Build a fresh external-label graph node for `host` and render its
   * gfx in the labelLayer. If `existing` is supplied, reuse the same
   * label object (used by the rename undo path so the same node
   * identity comes back).
   */
  function createExternalLabelNode(host, text, boundsOrigin, existing) {
    const graph = viewer.getGraph();
    if (!graph) return null;
    const bounds = boundsOrigin
      ? { x: boundsOrigin.x, y: boundsOrigin.y, width: boundsOrigin.width, height: boundsOrigin.height }
      : { x: host.x + host.width / 2 - 45, y: host.type === 'bpmn:Group' ? host.y : host.y + host.height + 5, width: 90, height: 20 };
    const labelNode = existing || {
      id: host.id + '_label',
      type: 'label',
      businessObject: host.businessObject,
      di: host.di && host.di.label
        ? host.di.label
        : moddle.create('bpmndi:BPMNLabel', { bounds: moddle.create('dc:Bounds', bounds) }),
      labelTarget: host,
      hidden: false,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      parent: host.parent,
      text
    };
    labelNode.text = text;
    labelNode.hidden = !!host.hidden;
    labelNode.businessObject = host.businessObject;
    labelNode.di = host.di.label;
    Object.assign(labelNode, bounds);
    if (!graph.nodes.includes(labelNode)) graph.nodes.push(labelNode);
    graph.elementsById.set(labelNode.id, labelNode);
    host.label = labelNode;

    // render gfx
    if (labelNode.hidden) return labelNode;
    const layer = internals.svg.querySelector('.bpmn-xyflow-labels');
    if (layer) {
      const lgfx = svgCreate('g', {
        'class': 'bpmn-xyflow-label',
        'data-element-id': labelNode.id,
        transform: `translate(${ labelNode.x }, ${ labelNode.y })`
      });
      const tn = internals.renderer.textRenderer.createText(text || '', {
        box: { width: labelNode.width, height: labelNode.height },
        align: 'center-top',
        padding: 0,
        style: internals.renderer.getExternalLabelStyle ? internals.renderer.getExternalLabelStyle(host) : internals.renderer.textRenderer.getExternalStyle()
      });
      svgAppend(lgfx, tn);
      internals.addShapeHit?.(lgfx, labelNode);
      svgAppend(layer, lgfx);
    }
    return labelNode;
  }

  function removeExternalLabelNode(host, label) {
    const graph = viewer.getGraph();
    if (!graph) return;
    const i = graph.nodes.indexOf(label);
    if (i >= 0) graph.nodes.splice(i, 1);
    graph.elementsById.delete(label.id);
    host.label = null;
    internals.removeElementGfx(label.id);
  }

  function retextExternalLabelNode(label, text, boundsOrigin) {
    label.text = text;
    if (label.labelTarget && label.labelTarget.di) label.di = label.labelTarget.di.label;
    if (boundsOrigin) {
      label.x = Math.round(boundsOrigin.x);
      label.y = Math.round(boundsOrigin.y);
      label.width = Math.round(boundsOrigin.width);
      label.height = Math.round(boundsOrigin.height);
    }
    // re-render the gfx with the new text
    internals.removeElementGfx(label.id);
    if (label.hidden) return;
    const layer = internals.svg.querySelector('.bpmn-xyflow-labels');
    if (layer) {
      const lgfx = svgCreate('g', {
        'class': 'bpmn-xyflow-label',
        'data-element-id': label.id,
        transform: `translate(${ label.x }, ${ label.y })`
      });
      const tn = internals.renderer.textRenderer.createText(text || '', {
        box: { width: label.width, height: label.height },
        align: 'center-top',
        padding: 0,
        style: internals.renderer.getExternalLabelStyle ? internals.renderer.getExternalLabelStyle(label.labelTarget || label) : internals.renderer.textRenderer.getExternalStyle()
      });
      svgAppend(lgfx, tn);
      internals.addShapeHit?.(lgfx, label);
      svgAppend(layer, lgfx);
    }
  }

  function deleteLabelNode(label) {
    const graph = viewer.getGraph();
    if (!graph || !label) return;
    const idx = graph.nodes.indexOf(label);
    if (idx < 0) return;
    const host = label.labelTarget;
    commands.execute({
      name: 'delete-label-node',
      do: () => {
        const i = graph.nodes.indexOf(label);
        if (i >= 0) graph.nodes.splice(i, 1);
        graph.elementsById.delete(label.id);
        if (host) host.label = null;
        internals.removeElementGfx(label.id);
      },
      undo: () => {
        graph.nodes.splice(idx, 0, label);
        graph.elementsById.set(label.id, label);
        if (host) host.label = label;
        if (host && host.waypoints && viewer.getElement(host.id) === host) internals.redrawConnection(host);
        // Re-create the label gfx by mirroring how renderGraph draws labels
        const text = label.text || getLabel(label.labelTarget || label) || '';
        const lgfx = svgCreate('g', {
          'class': 'bpmn-xyflow-label',
          'data-element-id': label.id,
          transform: `translate(${ label.x }, ${ label.y })`
        });
        const layer = internals.svg.querySelector('.bpmn-xyflow-labels');
        if (layer) {
          svgAppend(layer, lgfx);
          const tn = internals.renderer.textRenderer.createText(text, {
            box: { width: label.width, height: label.height },
            align: 'center-top',
            padding: 0,
            style: internals.renderer.getExternalLabelStyle ? internals.renderer.getExternalLabelStyle(label.labelTarget || label) : internals.renderer.textRenderer.getExternalStyle()
          });
          svgAppend(lgfx, tn);
          internals.addShapeHit?.(lgfx, label);
        }
      }
    });
  }

  function ownedSemantics(root) {
    const result = new Set();
    const visit = object => {
      if (!object || typeof object !== 'object' || result.has(object)) return;
      result.add(object);
      (object.$descriptor && object.$descriptor.properties || []).forEach(property => {
        if (property.isReference || property.isVirtual || property.isAttr) return;
        const value = object[property.name];
        (Array.isArray(value) ? value : [ value ]).forEach(visit);
      });
      for (const key of [ '$children', '__extras' ]) {
        const value = object[key]; (Array.isArray(value) ? value : [ value ]).forEach(visit);
      }
    };
    visit(root);
    if (root && root.$instanceOf('bpmn:Participant') && root.processRef) visit(root.processRef);
    return result;
  }

  function diagramEntriesFor(semantics) {
    const ids = new Set([ ...semantics ].map(bo => bo.id).filter(Boolean));
    const entries = [];
    (viewer.getDefinitions().diagrams || []).forEach(diagram => {
      (diagram.plane && diagram.plane.planeElement || []).forEach((di, index) => {
        if (di.bpmnElement && ids.has(di.bpmnElement.id)) entries.push({ array: diagram.plane.planeElement, value: di, index });
      });
    });
    return entries;
  }

  function removeInvisibleConnections(semantics, filter = () => true) {
    const all = ownedSemantics(viewer.getDefinitions());
    const connections = [ ...all ].filter(bo => bo.$instanceOf && [ 'bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataAssociation' ].some(type => bo.$instanceOf(type)));
    const closure = new Set(semantics), selected = new Set(), pending = [];
    let changed;
    do {
      changed = false;
      for (const bo of connections) {
        if (selected.has(bo) || !filter(bo)) continue;
        if ([ ...(Array.isArray(bo.sourceRef) ? bo.sourceRef : [ bo.sourceRef ]), bo.targetRef ].some(endpoint => closure.has(endpoint))) {
          selected.add(bo); closure.add(bo); pending.push(bo); changed = true;
        }
      }
    } while (changed);
    // Dependents disappear before their owners; cycle guards in deleteElement
    // and this identity closure also make malformed cyclic imports finite.
    pending.reverse().forEach(bo => {
        const visible = viewer.getElement(bo.id);
        if (visible && visible.waypoints) { deleteElement(visible); return; }
        const member = semanticMembership(bo);
        if (!member) return;
        const entries = [ { array: member.owner[member.key], value: bo, index: member.index }, ...diagramEntriesFor(new Set([ bo ])) ];
        for (const endpoint of [ bo.sourceRef, bo.targetRef ]) {
          if (!endpoint || Array.isArray(endpoint)) continue;
          for (const key of [ 'incoming', 'outgoing' ]) if (Array.isArray(endpoint[key]) && endpoint[key].includes(bo)) entries.push({ array: endpoint[key], value: bo, index: endpoint[key].indexOf(bo) });
        }
        const defaults = [ ...all ].filter(element => element.default === bo);
        commands.execute({ name: 'delete-hidden-connection', do: () => {
          entries.forEach(({ array, value }) => { const index = array.indexOf(value); if (index !== -1) array.splice(index, 1); });
          defaults.forEach(element => { delete element.default; });
        }, undo: () => {
          entries.forEach(({ array, value, index }) => { if (!array.includes(value)) array.splice(index, 0, value); });
          defaults.forEach(element => { element.default = bo; });
        } });
        if (bo.$instanceOf('bpmn:DataInputAssociation')) cleanupDataInputPlaceholders([ bo.targetRef ]);
      });
  }

  function pruneInvisibleConnections(semantics) {
    const all = ownedSemantics(viewer.getDefinitions()), nodes = new Map(), invalid = new Set();
    const shape = bo => {
      if (!bo) return null;
      const visible = viewer.getElement(bo.id);
      if (visible?.businessObject === bo) return visible;
      if (nodes.has(bo)) return nodes.get(bo);
      const node = { id: bo.id, type: bo.$type, businessObject: bo };
      nodes.set(bo, node); node.parent = shape(bo.$parent); node.host = shape(bo.attachedToRef);
      return node;
    };
    for (const bo of all) {
      if (!bo.$instanceOf || ![ 'bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataAssociation' ].some(type => bo.$instanceOf(type)) || viewer.getElement(bo.id)?.waypoints) continue;
      const source = shape(bo.$instanceOf('bpmn:DataOutputAssociation') ? bo.$parent : Array.isArray(bo.sourceRef) ? bo.sourceRef[0] : bo.sourceRef);
      const target = shape(bo.$instanceOf('bpmn:DataInputAssociation') ? bo.$parent : bo.targetRef);
      if (!source || !target || (!semantics.has(source.businessObject) && !semantics.has(target.businessObject))) continue;
      if (getConnectionType(source, target, { type: bo.$type, businessObject: bo }) !== bo.$type) invalid.add(bo);
      else if (bo.$type === 'bpmn:SequenceFlow' && bo.conditionExpression && !canHaveCondition(source)) changeOwnedProperties({ id: bo.id, waypoints: [] }, bo, { conditionExpression: undefined }, 'clear-hidden-condition');
    }
    removeInvisibleConnections(semantics, bo => invalid.has(bo));
  }

  function cleanupDeletedReferences(previous) {
    const live = ownedSemantics(viewer.getDefinitions());
    const removed = new Set([ ...previous ].filter(object => !live.has(object)));
    if (!removed.size) return;
    // Relationship.source and target are required. Remove only standard
    // relationships made invalid by this deletion, not arbitrary containers.
    let removedRelationship;
    do {
      removedRelationship = false;
      for (const object of [ ...live ]) {
        if (!object.$instanceOf?.('bpmn:Relationship')) continue;
        const source = object.source || [], target = object.target || [];
        if (!source.length || !target.length || (source.some(value => !removed.has(value)) && target.some(value => !removed.has(value)))) continue;
        const array = object.$parent?.relationships, index = array?.indexOf(object);
        if (index === undefined || index < 0) continue;
        commands.execute({ name: 'delete-invalid-relationship', do: () => { const current = array.indexOf(object); if (current !== -1) array.splice(current, 1); },
          undo: () => { if (!array.includes(object)) array.splice(index, 0, object); } });
        ownedSemantics(object).forEach(value => { live.delete(value); removed.add(value); });
        removedRelationship = true;
      }
    } while (removedRelationship);
    const changes = [];
    for (const object of live) for (const property of object.$descriptor?.properties || []) {
      if (!property.isReference || property.isVirtual) continue;
      const key = property.name, value = object[key];
      if (Array.isArray(value) ? value.some(item => removed.has(item)) : removed.has(value)) changes.push({ object, key, value, own: Object.hasOwn(object, key), entries: Array.isArray(value) ? value.slice() : null });
    }
    if (changes.length) commands.execute({ name: 'clear-deleted-references', do: () => {
      changes.forEach(({ object, key, value, entries }) => { if (entries) value.splice(0, value.length, ...entries.filter(item => !removed.has(item))); else delete object[key]; });
    }, undo: () => {
      changes.forEach(({ object, key, value, own, entries }) => { if (entries) value.splice(0, value.length, ...entries); if (own) object[key] = value; else delete object[key]; });
    } });
  }

  let deleteDepth = 0;
  function deleteElement(element) {
    return categoryMutation(categoryGeometryElements([ element ]), () => {
      return deleteElementWithReferences(element);
    });
  }

  function deleteElementWithReferences(element) {
    if (!element || element.isRoot || viewer.getElement(element.id) !== element) return;
    if (deleteDepth) return deleteElementCore(element);
    const previous = ownedSemantics(viewer.getDefinitions());
    let result;
    commands.compound('delete-elements', () => {
      deleteDepth++;
      try { result = deleteElementCore(element); }
      finally { deleteDepth--; }
      cleanupDataInputPlaceholders([ ...previous ].filter(object => object.$instanceOf?.('bpmn:DataInputAssociation')).map(object => object.targetRef));
      cleanupDeletedReferences(previous);
    });
    return result;
  }

  const deletingEdges = new Set();
  function deleteElementCore(element) {
    const graph = viewer.getGraph();
    const defs = viewer.getDefinitions();
    if (!graph || !defs || !element || element.isRoot || graph.elementsById.get(element.id) !== element) return;
    if (element.type === 'label') { updateLabel(element.labelTarget, ''); return; }

    const isEdge = !!element.waypoints;

    if (isEdge) {
      if (deletingEdges.has(element)) return;
      const bo = element.businessObject;
      const owner = bo.$parent;

      // Find the owner array regardless of connection type. We try
      // every well-known property name in turn.
      const ownerKeys = [ 'flowElements', 'messageFlows', 'artifacts', 'dataInputAssociations', 'dataOutputAssociations' ];
      let oldOwnerKey = null;
      let oldOwnerIndex = -1;
      if (owner) {
        for (const k of ownerKeys) {
          const arr = owner[k];
          if (Array.isArray(arr)) {
            const i = arr.indexOf(bo);
            if (i >= 0) { oldOwnerKey = k; oldOwnerIndex = i; break; }
          }
        }
      }
      const diEntries = diagramEntriesFor(new Set([ bo ]));
      const oldEdgesIndex = graph.edges.indexOf(element);
      const sourceOutgoing = element.source.businessObject.outgoing;
      const targetIncoming = element.target.businessObject.incoming;
      const oldOutIndex = Array.isArray(sourceOutgoing) ? sourceOutgoing.indexOf(bo) : -1;
      const oldInIndex = Array.isArray(targetIncoming) ? targetIncoming.indexOf(bo) : -1;
      const wasDefault = element.source.businessObject.default === bo;

      deletingEdges.add(element);
      try { commands.compound('delete-edge', () => {
        removeInvisibleConnections(new Set([ bo ]), candidate => !deletingEdges.has(viewer.getElement(candidate.id)));
        if (element.label) deleteLabelNode(element.label);
      commands.execute({
        name: 'delete-edge',
        do: () => {
          if (wasDefault) delete element.source.businessObject.default;
          if (oldOwnerKey && oldOwnerIndex >= 0) {
            const i = owner[oldOwnerKey].indexOf(bo);
            if (i >= 0) owner[oldOwnerKey].splice(i, 1);
          }
          diEntries.forEach(({ array, value }) => { const i = array.indexOf(value); if (i !== -1) array.splice(i, 1); });
          if (oldEdgesIndex >= 0) {
            const i = graph.edges.indexOf(element);
            if (i >= 0) graph.edges.splice(i, 1);
          }
          graph.elementsById.delete(element.id);
          if (Array.isArray(sourceOutgoing)) {
            const i = sourceOutgoing.indexOf(bo);
            if (i >= 0) sourceOutgoing.splice(i, 1);
          }
          if (Array.isArray(targetIncoming)) {
            const i = targetIncoming.indexOf(bo);
            if (i >= 0) targetIncoming.splice(i, 1);
          }
          internals.removeElementGfx(element.id);
          // Drop the deleted element from the active selection so its
          // overlays (selection marker, bendpoints, context pad,
          // resize handles) are torn down.
          viewer.deselect(element.id);
          // Connect handle is hover-bound, not selection-bound — kill
          // it explicitly if it was tracking this element so it
          // doesn't linger until the next mousemove.
          if (hoveredForConnect === element) destroyConnectHandle();
        },
        undo: () => {
          if (wasDefault) element.source.businessObject.default = bo;
          if (oldOwnerKey && oldOwnerIndex >= 0 && owner[oldOwnerKey] && !owner[oldOwnerKey].includes(bo)) {
            owner[oldOwnerKey].splice(oldOwnerIndex, 0, bo);
          }
          diEntries.forEach(({ array, value, index }) => { if (!array.includes(value)) array.splice(index, 0, value); });
          if (oldEdgesIndex >= 0 && !graph.edges.includes(element)) {
            graph.edges.splice(oldEdgesIndex, 0, element);
          }
          graph.elementsById.set(element.id, element);
          if (Array.isArray(sourceOutgoing) && oldOutIndex >= 0 && !sourceOutgoing.includes(bo)) {
            sourceOutgoing.splice(oldOutIndex, 0, bo);
          }
          if (Array.isArray(targetIncoming) && oldInIndex >= 0 && !targetIncoming.includes(bo)) {
            targetIncoming.splice(oldInIndex, 0, bo);
          }
          internals.redrawConnection(element);
        }
      });
      }); } finally { deletingEdges.delete(element); }
      return;
    }

    // shape: cascade-delete connected edges, attached boundary events,
    // any external label node that belongs to this shape, and — when
    // the shape is a container (Lane / Participant / SubProcess) —
    // all of its descendants. All collapsed into one composite undo.
    const connected = getEdgesConnectedTo(element);
    const attachers = (element.attachers || []).slice();
    const labelNode = element.label || null;
    const containerKids = isContainer(element)
      ? (element.children || []).filter(c => c !== element && c.type !== 'label').slice()
      : [];

    commands.compound('delete-shape', () => {
      const semantics = ownedSemantics(element.businessObject);
      removeInvisibleConnections(semantics);
      // delete container children first (depth-first via recursion)
      containerKids.forEach(c => deleteElement(c));
      connected.forEach(deleteElement);
      attachers.forEach(deleteElement);
      if (labelNode) deleteLabelNode(labelNode);

      const bo = element.businessObject;
      const membership = semanticMembership(bo);
      const lists = [];
      const remember = (array, value) => {
        if (Array.isArray(array) && array.includes(value)) lists.push({ array, value, index: array.indexOf(value) });
      };
      if (membership) remember(membership.owner[membership.key], bo);
      diagramEntriesFor(semantics).forEach(entry => lists.push(entry));
      (defs.diagrams || []).slice().forEach(diagram => { if (diagram.plane && semantics.has(diagram.plane.bpmnElement)) remember(defs.diagrams, diagram); });
      remember(graph.nodes, element);
      remember(element.parent && element.parent.children, element);
      remember(element.host && element.host.attachers, element);
      graph.nodes.filter(node => node.businessObject && node.businessObject.$instanceOf('bpmn:Lane'))
        .forEach(lane => remember(lane.businessObject.flowNodeRef, bo));
      if (bo.$instanceOf('bpmn:Participant') && bo.processRef &&
          !(bo.$parent.participants || []).some(other => other !== bo && other.processRef === bo.processRef)) {
        remember(defs.rootElements, bo.processRef);
      }
      commands.execute({
        name: 'delete-shape',
        do: () => {
          lists.forEach(({ array, value }) => { const i = array.indexOf(value); if (i !== -1) array.splice(i, 1); });
          graph.elementsById.delete(element.id);
          internals.removeElementGfx(element.id);
          viewer.deselect(element.id);
          if (hoveredForConnect === element) destroyConnectHandle();
        },
        undo: () => {
          lists.forEach(({ array, value, index }) => { if (!array.includes(value)) array.splice(index, 0, value); });
          graph.elementsById.set(element.id, element);
          internals.redrawShape(element);
        }
      });
    });
  }

  // Add ////////////////////////////
  function mirroredRepresentations(di, businessObject) {
    const sourcePlane = findCurrentPlane(), definitions = viewer.getDefinitions();
    const sourceRoot = sourcePlane && sourcePlane.bpmnElement;
    if (!sourceRoot) return [];
    const ancestry = [];
    let owner = businessObject.$parent;
    while (owner) { ancestry.push(owner); owner = owner.$parent; }
    const process = ancestry.find(bo => bo.$instanceOf && bo.$instanceOf('bpmn:Process'));
    const mirrors = [];
    (definitions.diagrams || []).forEach(diagram => {
      const plane = diagram.plane, root = plane && plane.bpmnElement;
      if (!root || plane === sourcePlane || (!sourceRoot.$instanceOf('bpmn:SubProcess') && !root.$instanceOf('bpmn:SubProcess'))) return;
      if ((plane.planeElement || []).some(other => other.bpmnElement && other.bpmnElement.id === businessObject.id)) return;
      let scopeIndex = ancestry.indexOf(root);
      if (root.$instanceOf('bpmn:Collaboration')) {
        const participant = (root.participants || []).find(candidate => candidate.processRef === process);
        if (!participant || !(plane.planeElement || []).some(other => other.bpmnElement === participant)) return;
        scopeIndex = ancestry.indexOf(process);
      }
      if (scopeIndex < 0) return;
      const subProcesses = ancestry.slice(0, scopeIndex).filter(bo => bo.$instanceOf && bo.$instanceOf('bpmn:SubProcess'));
      if (subProcesses.some(bo => !(plane.planeElement || []).some(other => other.bpmnElement === bo && other.isExpanded === true))) return;
      let dx = 0, dy = 0;
      const counterpart = (sourcePlane.planeElement || []).find(item => item !== di && item.bounds &&
        (plane.planeElement || []).some(other => other.bounds && other.bpmnElement === item.bpmnElement));
      if (counterpart) {
        const destination = plane.planeElement.find(other => other.bounds && other.bpmnElement === counterpart.bpmnElement);
        dx = destination.bounds.x - counterpart.bounds.x; dy = destination.bounds.y - counterpart.bounds.y;
      } else if (sourceRoot.$instanceOf('bpmn:SubProcess') && di.bounds) {
        const container = (plane.planeElement || []).find(other => other.bpmnElement === sourceRoot && other.bounds);
        if (container) { dx = container.bounds.x + 30 - di.bounds.x; dy = container.bounds.y + 50 - di.bounds.y; }
      }
      const mirror = translatedDi(di, dx, dy); mirror.$parent = plane;
      mirrors.push({ plane, di: mirror });
    });
    return mirrors;
  }

  function semanticContainer(parent) {
    let bo = parent && parent.businessObject;
    if (bo && bo.$instanceOf('bpmn:Participant')) return bo.processRef;
    while (bo && !isFlowElementsContainer(bo) && !bo.$instanceOf('bpmn:Collaboration')) bo = bo.$parent;
    return bo || findCurrentContainer();
  }

  function parentAt(position, child) {
    const graph = viewer.getGraph();
    const candidates = graph.nodes.filter(node => node.type !== 'label' && canBeParent(node, child) &&
      position.x >= node.x && position.x <= node.x + node.width &&
      position.y >= node.y && position.y <= node.y + node.height);
    candidates.sort((a, b) => a.width * a.height - b.width * b.height);
    return candidates[0] || (canBeParent(findRootContainer(), child) ? findRootContainer() : null);
  }

  function semanticMembership(bo) {
    const owner = bo && bo.$parent;
    if (!owner) return null;
    for (const key of [ 'flowElements', 'artifacts', 'participants', 'lanes', 'messageFlows', 'dataInputAssociations', 'dataOutputAssociations' ]) {
      if (Array.isArray(owner[key]) && owner[key].includes(bo)) return { owner, key, index: owner[key].indexOf(bo) };
    }
    return null;
  }

  function addShape(type, position, options = {}) {
    return categoryMutation([], () => {
      const node = addShapeCore(type, position, options);
      recordCategoryElements([ node ]);
      return node;
    });
  }

  function addShapeCore(type, position, options = {}) {
    const graph = viewer.getGraph();
    const defs = viewer.getDefinitions();
    if (!graph || !defs || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
    if (!options || typeof options !== 'object' || !validEventDefinitionAttrs(options.eventDefinitionAttrs) || (options.type !== undefined && options.type !== type)) return null;
    let businessObject;
    try { businessObject = options.businessObject || moddle.create(type, { id: nextId(type.replace('bpmn:', '')) }); } catch { return null; }
    if (!options.businessObject) {
      for (const key of [ 'cancelActivity', 'isInterrupting', 'triggeredByEvent', 'instantiate', 'eventGatewayType' ]) if (options[key] !== undefined) businessObject.set(key, options[key]);
      const definitionType = options.eventDefinitionType || ([ 'bpmn:BoundaryEvent', 'bpmn:IntermediateCatchEvent' ].includes(type) ? 'bpmn:TimerEventDefinition' : null);
      if (definitionType) {
        try {
          const definition = moddle.create(definitionType, options.eventDefinitionAttrs || {});
          definition.$parent = businessObject; businessObject.eventDefinitions = [ definition ];
        } catch { return null; }
      }
      if (type === 'bpmn:DataObjectReference') businessObject.dataObjectRef = moddle.create('bpmn:DataObject', { id: nextId('DataObject') });
    }
    const id = businessObject.id;
    if (!id || graph.elementsById.has(id)) return null;
    let ownedSemantic = false;
    if (options.businessObject) {
      const seen = new Set();
      const containsId = object => {
        if (!object || typeof object !== 'object' || seen.has(object)) return false;
        seen.add(object);
        if (object.id === id) {
          if (object === businessObject) { ownedSemantic = true; return false; }
          return true;
        }
        return (object.$descriptor && object.$descriptor.properties || []).some(property => {
          if (property.isReference || property.isVirtual || property.isAttr) return false;
          const value = object[property.name];
          return (Array.isArray(value) ? value : [ value ]).some(containsId);
        });
      };
      if (containsId(defs)) return null;
    }
    if ([ options.width, options.height ].some(value => value !== undefined && (!Number.isFinite(value) || value < 20))) return null;
    const size = { ...(DEFAULT_SHAPE_SIZES[type] ||
      (businessObject.$instanceOf('bpmn:Event') ? { width: 36, height: 36 } :
       businessObject.$instanceOf('bpmn:Gateway') ? { width: 50, height: 50 } : { width: 100, height: 80 })),
      ...(options.width ? { width: options.width } : {}), ...(options.height ? { height: options.height } : {}) };
    const x = Math.round(position.x - size.width / 2), y = Math.round(position.y - size.height / 2);
    const node = { id, type, businessObject, x, y, ...size, children: [], hidden: false };
    const root = findRootContainer();
    let parent = options.parent || parentAt(position, node);
    if (type === 'bpmn:TextAnnotation' && !options.businessObject) parent = root;
    const isPool = businessObject.$instanceOf('bpmn:Participant');
    const isLane = businessObject.$instanceOf('bpmn:Lane');
    let host = options.host || null;
    if ((options.parent && viewer.getElement(options.parent.id) !== options.parent) || (host && viewer.getElement(host.id) !== host)) return null;
    if (businessObject.$instanceOf('bpmn:BoundaryEvent')) {
      host = host || graph.nodes.find(candidate => canAttachBoundary(node, candidate) &&
        position.x >= candidate.x - 10 && position.x <= candidate.x + candidate.width + 10 &&
        position.y >= candidate.y - 10 && position.y <= candidate.y + candidate.height + 10);
      if (!host || !canAttachBoundary(node, host) || !contextRules.canAttach(node, host, position)) return null;
      parent = host.parent;
      if (!isValidTarget({ type, eventDefinitionType: businessObject.eventDefinitions?.[0]?.$type, cancelActivity: businessObject.cancelActivity }, { parent, host })) return null;
      node.host = host;
      businessObject.attachedToRef = host.businessObject;
    }
    if (isPool) parent = root;
    if (isLane && !parent) parent = graph.nodes.find(candidate => candidate.type === 'bpmn:Participant') || null;
    if (!parent || (!host && !canBeParent(parent, node))) return null;
    if (!host && !(isLane && parent.type === 'bpmn:Process') && !contextRules.canCreate(node, parent, undefined, position)) return null;
    if (!options.businessObject && (businessObject.$instanceOf('bpmn:Event') || businessObject.$instanceOf('bpmn:SubProcess') ||
        [ 'cancelActivity', 'isInterrupting', 'triggeredByEvent', 'isExpanded', 'instantiate', 'eventGatewayType', 'eventDefinitionType', 'eventDefinitionAttrs' ].some(key => Object.hasOwn(options, key)))) {
      const target = { type, eventDefinitionType: businessObject.eventDefinitions?.[0]?.$type };
      for (const key of [ 'cancelActivity', 'isInterrupting', 'triggeredByEvent', 'isExpanded', 'instantiate', 'eventGatewayType', 'eventDefinitionAttrs' ]) if (options[key] !== undefined) target[key] = options[key];
      if (!isValidTarget(target, { parent, host })) return null;
    }
    node.parent = parent;
    let owner = semanticContainer(parent), ownerKey = businessObject.$instanceOf('bpmn:Artifact') ? 'artifacts' : 'flowElements';
    if (type === 'bpmn:DataStoreReference' && owner?.$instanceOf('bpmn:Collaboration')) owner = findOwningProcess();
    const plane = findCurrentPlane();
    const extraRoots = [];
    let conversion = null, createdLaneSet = null;
    if (isPool) {
      let collaboration = root.businessObject;
      if (!collaboration.$instanceOf('bpmn:Collaboration')) {
        if (!collaboration.$instanceOf('bpmn:Process')) return null;
        if (options.isExpanded === false) return null;
        conversion = { oldBo: collaboration, oldId: root.id, children: (root.children || []).slice(), planeElement: plane && plane.bpmnElement };
        collaboration = moddle.create('bpmn:Collaboration', { id: nextId('Collaboration'), participants: [] });
        collaboration.$parent = defs;
        extraRoots.push(collaboration);
        businessObject.processRef = conversion.oldBo;
      } else if (!businessObject.processRef && options.isExpanded !== false) {
        const process = moddle.create('bpmn:Process', { id: nextId('Process'), flowElements: [] });
        process.$parent = defs;
        extraRoots.push(process);
        businessObject.processRef = process;
      }
      if (businessObject.processRef && !(defs.rootElements || []).includes(businessObject.processRef) && !extraRoots.includes(businessObject.processRef)) { businessObject.processRef.$parent = defs; extraRoots.push(businessObject.processRef); }
      owner = collaboration; ownerKey = 'participants';
    } else if (isLane) {
      if (parent.businessObject.$instanceOf('bpmn:Lane')) {
        owner = parent.businessObject.childLaneSet;
        if (!owner) {
          owner = moddle.create('bpmn:LaneSet', { id: nextId('LaneSet'), lanes: [] });
          owner.$parent = parent.businessObject;
          createdLaneSet = { owner: parent.businessObject, key: 'childLaneSet', value: owner, many: false };
        }
      } else {
        const container = semanticContainer(parent);
        owner = container && (container.laneSets || [])[0];
        if (!owner && container) {
          owner = moddle.create('bpmn:LaneSet', { id: nextId('LaneSet'), lanes: [] });
          owner.$parent = container;
          createdLaneSet = { owner: container, key: 'laneSets', value: owner, many: true };
        }
      }
      ownerKey = 'lanes';
      businessObject.flowNodeRef = businessObject.flowNodeRef || [];
    }
    if (!owner || (ownedSemantic && businessObject.$parent !== owner)) return null;
    businessObject.$parent = owner;
    node.di = options.di || moddle.create('bpmndi:BPMNShape', {
      id: id + '_di', bpmnElement: businessObject,
      bounds: moddle.create('dc:Bounds', { x, y, ...size })
    });
    node.di.id = node.di.id || id + '_di';
    node.di.bpmnElement = businessObject;
    node.di.bounds = moddle.create('dc:Bounds', { x, y, ...size });
    if (plane) node.di.$parent = plane;
    if (businessObject.$instanceOf('bpmn:SubProcess') && node.di.isExpanded === undefined) node.di.isExpanded = true;
    if (businessObject.$instanceOf('bpmn:SubProcess') && options.isExpanded !== undefined) node.di.isExpanded = options.isExpanded;
    if (isPool) node.di.isHorizontal = true;
    node.collapsed = businessObject.$instanceOf('bpmn:SubProcess') && node.di.isExpanded === false;
    if (hasExternalLabel(type) && !node.di.label && (type !== 'bpmn:Group' || String(getLabel(node) || '').trim())) {
      node.di.label = moddle.create('bpmndi:BPMNLabel', { bounds: moddle.create('dc:Bounds', {
        x: x + size.width / 2 - 45, y: type === 'bpmn:Group' ? y : y + size.height + 5, width: 90, height: 20
      }) });
    }
    if (node.di.label) node.di.label.$parent = node.di;
    const dataObject = businessObject.dataObjectRef;
    const addDataObject = dataObject && !(owner.flowElements || []).includes(dataObject);
    if (addDataObject) dataObject.$parent = owner;
    const groupBinding = type === 'bpmn:Group' ? groupCategoryBinding(businessObject) : null;
    if (type === 'bpmn:Group' && !groupBinding) return null;
    if (groupBinding && groupBinding.changed) commands.execute({ name: 'bind-group-category', do: groupBinding.do, undo: groupBinding.undo });
    const mirrors = mirroredRepresentations(node.di, businessObject);
    let label = null;
    commands.execute({
      name: 'add-shape',
      do: () => {
        defs.rootElements = defs.rootElements || [];
        extraRoots.forEach(bo => { if (!defs.rootElements.includes(bo)) defs.rootElements.push(bo); });
        if (conversion) {
          graph.elementsById.delete(root.id);
          root.id = owner.id; root.type = owner.$type; root.businessObject = owner;
          graph.elementsById.set(root.id, root);
          if (plane) plane.bpmnElement = owner;
          root.children = [];
          node.children = conversion.children.slice();
          node.children.forEach(child => { child.parent = node; });
        }
        if (createdLaneSet) {
          const { owner: laneOwner, key, value, many } = createdLaneSet;
          if (many) { laneOwner[key] = laneOwner[key] || []; if (!laneOwner[key].includes(value)) laneOwner[key].push(value); }
          else laneOwner[key] = value;
        }
        if (addDataObject) { owner.flowElements = owner.flowElements || []; if (!owner.flowElements.includes(dataObject)) owner.flowElements.push(dataObject); }
        owner[ownerKey] = owner[ownerKey] || [];
        if (!owner[ownerKey].includes(businessObject)) owner[ownerKey].push(businessObject);
        parent.children = parent.children || [];
        if (!parent.children.includes(node)) parent.children.push(node);
        if (parent.businessObject.$instanceOf('bpmn:Lane') && businessObject.$instanceOf('bpmn:FlowNode')) {
          parent.businessObject.flowNodeRef = parent.businessObject.flowNodeRef || [];
          if (!parent.businessObject.flowNodeRef.includes(businessObject)) parent.businessObject.flowNodeRef.push(businessObject);
        }
        if (host) { host.attachers = host.attachers || []; if (!host.attachers.includes(node)) host.attachers.push(node); }
        if (plane) { plane.planeElement = plane.planeElement || []; if (!plane.planeElement.includes(node.di)) plane.planeElement.push(node.di); }
        mirrors.forEach(({ plane: destination, di: mirror }) => { if (!destination.planeElement.includes(mirror)) destination.planeElement.push(mirror); });
        if (!graph.nodes.includes(node)) graph.nodes.push(node);
        graph.elementsById.set(id, node);
        internals.redrawShape(node);
        if (hasExternalLabel(type) && String(getLabel(node) || '').trim()) label = createExternalLabelNode(node, getLabel(node), node.di.label.bounds, label);
      },
      undo: () => {
        if (label) removeExternalLabelNode(node, label);
        mirrors.forEach(({ plane: destination, di: mirror }) => { const index = destination.planeElement.indexOf(mirror); if (index !== -1) destination.planeElement.splice(index, 1); });
        if (addDataObject && owner.flowElements.includes(dataObject)) owner.flowElements.splice(owner.flowElements.indexOf(dataObject), 1);
        for (const [ array, value ] of [ [ owner[ownerKey], businessObject ], [ parent.children, node ],
          [ parent.businessObject.flowNodeRef, businessObject ], [ host && host.attachers, node ],
          [ plane && plane.planeElement, node.di ], [ graph.nodes, node ] ]) {
          if (array && array.includes(value)) array.splice(array.indexOf(value), 1);
        }
        if (createdLaneSet) {
          const { owner: laneOwner, key, value, many } = createdLaneSet;
          if (many) laneOwner[key] = laneOwner[key].filter(v => v !== value);
          else delete laneOwner[key];
        }
        if (conversion) {
          graph.elementsById.delete(root.id);
          root.id = conversion.oldId; root.type = conversion.oldBo.$type; root.businessObject = conversion.oldBo;
          graph.elementsById.set(root.id, root);
          root.children = conversion.children.slice();
          root.children.forEach(child => { child.parent = root; });
          node.children = [];
          if (plane) plane.bpmnElement = conversion.planeElement;
        }
        extraRoots.forEach(bo => { const index = defs.rootElements.indexOf(bo); if (index !== -1) defs.rootElements.splice(index, 1); });
        graph.elementsById.delete(id);
        internals.removeElementGfx(id);
        viewer.deselect(id);
      }
    });
    return node;
  }

  // Label edit /////////////////////
  let labelEditor = null;
  let labelEditorActions = null;

  /**
   * Compute the screen region the rename editor should occupy and
   * the font that matches the renderer for this element type.
   *
   * Three cases:
   *   1. Connection — over the rendered connection-name label gfx
   *      (or the longest-segment midpoint as fallback).
   *   2. External-label shape (event, gateway, data) — over the
   *      external label NODE if it exists, else just below the
   *      shape (where the label will appear once committed).
   *   3. Inline-label shape (Activity, Participant, …) — inside
   *      the shape body with the same padding as the renderer.
   */
  function computeLabelRegion(node) {
    const zoom = (viewer.getViewport && viewer.getViewport().zoom) || 1;
    const isEdge = !!node.waypoints;
    const isExternal = hasExternalLabel(node.type);
    const FONT = 'Arial, sans-serif';

    if (isEdge) {
      const gfx = internals.elementGfx(node.id);
      const lgfx = node.label ? internals.elementGfx(node.label.id) : gfx && gfx.querySelector('[data-connection-label]');
      if (lgfx) {
        const r = lgfx.getBoundingClientRect();
        return { left: r.left, top: r.top, width: Math.max(60, r.width), height: Math.max(20, r.height),
                 fontSize: Math.max(8, Math.round(11 * zoom)), fontFamily: FONT, lineHeight: 1.2, textAlign: 'center' };
      }
      // fallback: longest-segment midpoint at default size
      const wp = node.waypoints || [];
      let bestLen = -1, mid = { x: 0, y: 0 };
      for (let i = 0; i < wp.length - 1; i++) {
        const a = wp[i], b = wp[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > bestLen) { bestLen = len; mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
      }
      const svgRect = viewer.getSvg().getBoundingClientRect();
      const v = viewer.getViewport();
      const cx = svgRect.left + (mid.x * v.zoom + v.x);
      const cy = svgRect.top + (mid.y * v.zoom + v.y);
      const w = 90 * zoom, h = 20 * zoom;
      return { left: cx - w / 2, top: cy - h / 2, width: w, height: h,
               fontSize: Math.max(8, Math.round(11 * zoom)), fontFamily: FONT, lineHeight: 1.2, textAlign: 'center' };
    }

    if (isExternal) {
      const labelNode = node.label;
      if (labelNode) {
        const lgfx = internals.elementGfx(labelNode.id);
        if (lgfx) {
          const r = lgfx.getBoundingClientRect();
          return { left: r.left, top: r.top, width: Math.max(80, r.width), height: Math.max(20, r.height),
                   fontSize: Math.max(8, Math.round(11 * zoom)), fontFamily: FONT, lineHeight: 1.2, textAlign: 'center' };
        }
      }
      // No label gfx yet — open just below the shape where it will land
      const gfx = internals.elementGfx(node.id);
      const r = gfx.getBoundingClientRect();
      const w = 90 * zoom;
      return { left: r.left + r.width / 2 - w / 2, top: node.type === 'bpmn:Group' ? r.top : r.bottom + 5 * zoom,
               width: w, height: 20 * zoom,
               fontSize: Math.max(8, Math.round(11 * zoom)), fontFamily: FONT, lineHeight: 1.2, textAlign: 'center' };
    }

    // Inline-label shape: editor sits inside the body with the same
    // 7px padding and 12px font the renderer uses.
    const gfx = internals.elementGfx(node.id);
    const r = gfx.getBoundingClientRect();
    const padPx = 7 * zoom;
    return {
      left: r.left + padPx,
      top: r.top + padPx,
      width: Math.max(20, r.width - 2 * padPx),
      height: Math.max(16, r.height - 2 * padPx),
      fontSize: Math.max(8, Math.round(12 * zoom)),
      fontFamily: FONT,
      lineHeight: 1.2,
      textAlign: 'center'
    };
  }

  /**
   * Hide the rendered SVG text or label gfx that sits at the same
   * place as the editor, so users don't see the original AND the
   * editor on top of each other. Returns a `restore` callback the
   * caller invokes on commit/cancel.
   */
  function hideRenderedLabel(node) {
    const gfx = internals.elementGfx(node.id);
    if (!gfx) return null;
    const isEdge = !!node.waypoints;
    const isExternal = hasExternalLabel(node.type);

    const hide = (el) => {
      if (!el) return null;
      const prev = el.style.display;
      el.style.display = 'none';
      return () => { el.style.display = prev; };
    };

    if (isEdge) {
      return hide(node.label ? internals.elementGfx(node.label.id) : gfx.querySelector('[data-connection-label]'));
    }
    if (isExternal) {
      const labelNode = node.label;
      const lgfx = labelNode && internals.elementGfx(labelNode.id);
      return hide(lgfx);
    }
    // inline label: hide the <text class="djs-label"> inside the shape body
    return hide(gfx.querySelector('text.djs-label, text'));
  }

  function propertyState(object, key) {
    return { object, key, own: Object.hasOwn(object, key), value: object[key], values: Array.isArray(object[key]) ? object[key].slice() : null };
  }

  function restoreProperty(state) {
    if (state.values) state.value.splice(0, state.value.length, ...state.values);
    if (state.own) state.object[state.key] = state.value; else delete state.object[state.key];
  }

  function groupCategoryBinding(bo, suppliedValue) {
    const probe = suppliedValue ? Object.assign(Object.create(bo), { categoryValueRef: suppliedValue }) : bo;
    const definitions = viewer.getDefinitions(), plan = planGroupCategory(probe, definitions, moddle, nextId);
    if (!plan) return null;
    const { value, category } = plan;
    const states = [ propertyState(bo, 'categoryValueRef'), propertyState(definitions, 'rootElements'),
      propertyState(category, 'categoryValue'), propertyState(value, '$parent'), propertyState(category, '$parent') ];
    const roots = definitions.rootElements || [], values = category.categoryValue || [];
    return { value, category, changed: bo.categoryValueRef !== value || plan.needsRootMembership || plan.needsValueMembership ||
      value.$parent !== category || category.$parent !== definitions,
      do() {
        definitions.rootElements = roots; category.categoryValue = values;
        if (!roots.includes(category)) roots.push(category);
        if (!values.includes(value)) values.push(value);
        value.$parent = category; category.$parent = definitions; bo.categoryValueRef = value;
      },
      undo() { states.forEach(restoreProperty); }
    };
  }

  function ensureGroupCategory(node) {
    const binding = groupCategoryBinding(node.businessObject);
    if (!binding) return false;
    if (binding.changed) commands.execute({ name: 'bind-group-category', do: binding.do, undo: binding.undo });
    return binding;
  }

  function copyGroupCategory(source, copy, copiedElements) {
    const value = source.categoryValueRef;
    if (value == null) return [];
    if (!value.$instanceOf?.('bpmn:CategoryValue')) return null;
    const category = value.$parent?.$instanceOf?.('bpmn:Category') ? value.$parent : null;
    const roots = category ? [ category ] : [ value ];
    const copies = cloneSemanticObjects(roots, false);
    const remap = new Map([ ...copiedElements, ...copies ]);
    const objects = new Set([ ...ownedSemantics(copy), ...roots.flatMap(root => [ ...ownedSemantics(copies.get(root)) ]) ]);
    for (const object of objects) for (const property of object.$descriptor?.properties || []) {
      if (!property.isReference || property.isVirtual) continue;
      const current = object[property.name];
      if (Array.isArray(current)) current.forEach((item, index) => { if (remap.has(item)) current[index] = remap.get(item); });
      else if (remap.has(current)) object[property.name] = remap.get(current);
    }
    copy.categoryValueRef = copies.get(value);
    return roots.map(root => copies.get(root));
  }

  function recordCategoryElements(elements) {
    if (!categoryContext) return;
    for (const element of elements || []) {
      if (!element || element.isRoot || element.type === 'label') continue;
      if (element.businessObject?.$instanceOf('bpmn:FlowElement')) categoryContext.flows.add(element);
      if (element.type === 'bpmn:Group' && !categoryContext.groups.has(element)) categoryContext.groups.set(element,
        { groupShape: element, categoryValue: element.businessObject.categoryValueRef });
    }
  }

  function categoryGeometryElements(nodes) {
    const shapes = movableClosure((Array.isArray(nodes) ? nodes : [ nodes ]).filter(Boolean));
    const edges = (viewer.getGraph()?.edges || []).filter(edge => shapes.has(edge.source) || shapes.has(edge.target));
    return [ ...shapes, ...edges, ...dependentConnectionClosure(edges, viewer.getGraph()?.edges || []) ];
  }

  function cleanupGroupCategories(entries) {
    const definitions = viewer.getDefinitions();
    const referenced = target => [ ...ownedSemantics(definitions) ].some(object => (object.$descriptor?.properties || []).some(property =>
      property.isReference && !property.isVirtual && (Array.isArray(object[property.name]) ? object[property.name] : [ object[property.name] ]).includes(target)));
    new Set(entries.map(entry => entry.categoryValue).filter(value => value?.$instanceOf?.('bpmn:CategoryValue'))).forEach(value => {
      const category = value.$parent;
      if (!category?.$instanceOf('bpmn:Category') || referenced(value)) return;
      const values = category.categoryValue || [], index = values.indexOf(value), parent = propertyState(value, '$parent');
      if (index !== -1) commands.execute({ name: 'unlink-group-value', do: () => {
        const current = values.indexOf(value); if (current !== -1) values.splice(current, 1); value.$parent = null;
      }, undo: () => { if (!values.includes(value)) values.splice(index, 0, value); restoreProperty(parent); } });
      const roots = definitions.rootElements || [], rootIndex = roots.indexOf(category), categoryParent = propertyState(category, '$parent');
      if (!values.length && rootIndex !== -1 && !referenced(category)) commands.execute({ name: 'unlink-group-category', do: () => {
        const current = roots.indexOf(category); if (current !== -1) roots.splice(current, 1); category.$parent = null;
      }, undo: () => { if (!roots.includes(category)) roots.splice(rootIndex, 0, category); restoreProperty(categoryParent); } });
    });
  }

  function commitCategoryMembership(context) {
    const graph = viewer.getGraph();
    if (!graph || !context.flows.size && !context.groups.size) return;
    context.groups.forEach(({ groupShape }) => { if (viewer.getElement(groupShape.id) === groupShape) ensureGroupCategory(groupShape); });
    const plan = planGroupMembership([ ...context.flows ].filter(element => viewer.getElement(element.id) === element),
      [ ...context.groups.values() ], [ ...graph.nodes, ...graph.edges ], moddle, nextId);
    plan.groups.forEach(({ groupShape, categoryValue }) => {
      const binding = groupCategoryBinding(groupShape.businessObject, categoryValue);
      if (binding?.changed) commands.execute({ name: 'heal-group-category', do: binding.do, undo: binding.undo });
    });
    const changes = plan.flowElements.map(({ businessObject, categoryValuesToAdd, categoryValuesToRemove }) => {
      const state = propertyState(businessObject, 'categoryValueRef'), array = state.value || [], before = array.slice();
      const after = before.filter(value => !categoryValuesToRemove.includes(value));
      categoryValuesToAdd.forEach(value => { if (!after.includes(value)) after.push(value); });
      return { businessObject, state, array, before, after };
    }).filter(change => change.before.length !== change.after.length || change.before.some((value, index) => change.after[index] !== value));
    if (changes.length) commands.execute({ name: 'update-group-membership', do: () => changes.forEach(change => {
      change.array.splice(0, change.array.length, ...change.after); change.businessObject.categoryValueRef = change.array;
    }), undo: () => changes.forEach(change => restoreProperty(change.state)) });
    cleanupGroupCategories([ ...context.groups.values() ].filter(({ groupShape, categoryValue }) =>
      viewer.getElement(groupShape.id) !== groupShape || groupShape.businessObject.categoryValueRef !== categoryValue));
  }

  function categoryMutation(elements, action) {
    if (categoryContext) { recordCategoryElements(elements); return action(); }
    const context = categoryContext = { flows: new Set(), groups: new Map(), changed: false };
    recordCategoryElements(elements);
    try { return commands.compound('model', () => {
      const result = action(); if (context.changed) commitCategoryMembership(context); return result;
    }); } finally { categoryContext = null; }
  }

  function editableLabel(node) {
    node = node?.labelTarget || node;
    return !!node?.businessObject && getLabel(node) !== undefined &&
      (node.type !== 'bpmn:Group' || node.businessObject.categoryValueRef == null ||
       !!node.businessObject.categoryValueRef.$instanceOf?.('bpmn:CategoryValue'));
  }

  function updateLabel(node, newName) {
    node = node?.labelTarget || node;
    if (!editableLabel(node) || viewer.getElement(node.id) !== node) return false;
    return categoryMutation(node.type === 'bpmn:Group' && !node.label && String(newName ?? '').trim() ? [ node ] : [], () => {
      newName = String(newName ?? '');
      if (newName === getLabel(node)) return node;
      let owner = node.businessObject, key = node.type === 'bpmn:TextAnnotation' ? 'text' : 'name';
      if (node.type === 'bpmn:Group') {
        if (!ensureGroupCategory(node)) return false;
        owner = owner.categoryValueRef; key = 'value';
      }
      const own = Object.hasOwn(owner, key), previous = owner[key];
      const peers = node.type === 'bpmn:Group'
        ? viewer.getGraph().nodes.filter(other => other.type === 'bpmn:Group' && other.businessObject.categoryValueRef === owner)
        : [ node ];
      const labels = peers.map(host => prepareLabelChange(host, newName));
      commands.execute({ name: 'rename', do: () => {
        owner[key] = newName; labels.forEach(change => change.do());
      }, undo: () => {
        if (own) owner[key] = previous; else delete owner[key];
        labels.forEach(change => change.undo());
      } });
      return node;
    });
  }

  function prepareLabelChange(node, text) {
    const di = node.di, oldText = getLabel(node) || '', labelBefore = node.label || null;
    const oldNodeDi = labelBefore?.di, oldLabel = di?.label, hadLabel = !!di && Object.hasOwn(di, 'label');
    const oldBounds = labelBefore ? { x: labelBefore.x, y: labelBefore.y, width: labelBefore.width, height: labelBefore.height } : null;
    const external = hasExternalLabel(node.type) || !!node.waypoints, hasText = !!text.trim();
    let nextLabel = oldLabel, nextBounds = null, created = null;
    if (external && hasText) {
      const mid = node.waypoints ? node.waypoints[Math.floor(node.waypoints.length / 2)] : getMid(node);
      const base = oldLabel?.bounds || oldBounds || { x: mid.x - 45,
        y: node.waypoints ? mid.y - 25 : node.type === 'bpmn:Group' ? node.y + 7 : node.y + node.height + 5, width: 90, height: 20 };
      const fitted = internals.renderer.textRenderer.getExternalLabelBounds({ ...base }, text);
      nextBounds = Object.fromEntries([ 'x', 'y', 'width', 'height' ].map(key => [ key, Math.round(fitted[key]) ]));
      nextLabel = oldLabel ? cloneSemanticObjects([ oldLabel ], false).get(oldLabel) : moddle.create('bpmndi:BPMNLabel');
      nextLabel.bounds ||= moddle.create('dc:Bounds');
      Object.assign(nextLabel.bounds, nextBounds);
      nextLabel.bounds.$parent = nextLabel; nextLabel.$parent = di;
    }
    const redraw = () => node.waypoints ? internals.redrawConnection(node) : internals.redrawShape(node);
    return {
      do() {
        if (external && di && hasText) di.label = nextLabel;
        if (external && hasText) {
          if (labelBefore) retextExternalLabelNode(labelBefore, text, nextBounds);
          else created = createExternalLabelNode(node, text, nextBounds, created);
        } else if (labelBefore) removeExternalLabelNode(node, labelBefore);
        redraw();
      },
      undo() {
        if (external && di) { if (hadLabel) di.label = oldLabel; else delete di.label; }
        if (labelBefore) {
          if (!node.label) createExternalLabelNode(node, oldText, oldBounds, labelBefore);
          else retextExternalLabelNode(labelBefore, oldText, oldBounds);
          labelBefore.di = oldNodeDi;
        } else if (node.label) removeExternalLabelNode(node, node.label);
        redraw();
      }
    };
  }

  function openLabelEditor(node, evt) {
    if (node && node.type === 'label') node = node.labelTarget;
    if (!editableLabel(node)) return;
    if (labelEditor) closeLabelEditor(true);

    const oldName = getLabel(node) || '';

    const region = computeLabelRegion(node);
    const restoreRendered = hideRenderedLabel(node);

    const editor = document.createElement('div');
    // plaintext-only avoids users pasting rich HTML into a label
    editor.contentEditable = 'plaintext-only';
    if (editor.contentEditable !== 'plaintext-only') editor.contentEditable = 'true';
    editor.spellcheck = false;
    editor.textContent = oldName;
    // Truly seamless: no border, no shadow, no background. The
    // rendered SVG text underneath is hidden so the editor is the
    // ONLY thing the user sees in this region. Font + color match
    // the renderer; only the blinking caret + the user's typing
    // give visual feedback that editing is active.
    Object.assign(editor.style, {
      position: 'fixed',
      left: region.left + 'px',
      top: region.top + 'px',
      width: region.width + 'px',
      minHeight: region.height + 'px',
      background: 'transparent',
      border: 'none',
      borderRadius: '0',
      padding: '0',
      margin: '0',
      boxShadow: 'none',
      font: `${ region.fontSize }px ${ region.fontFamily }`,
      lineHeight: String(region.lineHeight),
      color: themeToken('text'),
      textAlign: region.textAlign,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'visible',
      cursor: 'text',
      zIndex: 11,
      outline: 'none',
      caretColor: themeToken('focus'),
      // vertical centring for inline-label shapes (Task body etc.);
      // for external labels and connection labels the renderer uses
      // top-aligned text inside a small box, so flex still works.
      display: 'flex',
      alignItems: region.textAlign === 'center' ? 'center' : 'flex-start',
      justifyContent: region.textAlign === 'center' ? 'center' : 'flex-start',
      flexDirection: 'column'
    });
    inheritTheme(viewer.getContainer(), editor);
    document.body.appendChild(editor);

    // place caret at end (less surprising than full select-all when
    // the user is just adding more text); Cmd/Ctrl+A still works.
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let committed = false;

    // Re-anchor the editor to the underlying shape on every viewport
    // change so panning or zooming during a rename keeps the editor
    // glued to its element with the right font scale.
    function reanchor() {
      if (committed || !editor.parentNode) return;
      const r = computeLabelRegion(node);
      editor.style.left = r.left + 'px';
      editor.style.top = r.top + 'px';
      editor.style.width = r.width + 'px';
      editor.style.minHeight = r.height + 'px';
      editor.style.font = `${ r.fontSize }px ${ r.fontFamily }`;
      editor.style.lineHeight = String(r.lineHeight);
    }
    const offViewport = viewer.on('viewport.change', reanchor);

    function commit() {
      if (committed) return;
      committed = true;
      const newName = editor.textContent;
      cleanup();
      if (newName === oldName) return;

      updateLabel(node, newName);
    }

    function cancel() {
      if (committed) return;
      committed = true;
      cleanup();
    }

    function cleanup() {
      if (offViewport) offViewport();
      if (restoreRendered) restoreRendered();
      if (editor.parentNode) editor.parentNode.removeChild(editor);
      labelEditor = null;
      labelEditorActions = null;
    }

    editor.addEventListener('blur', commit);
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      else if (e.key === 'Tab') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        // explicit Cmd/Ctrl+A → select all in the editor
        e.preventDefault();
        const r = document.createRange();
        r.selectNodeContents(editor);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
    });

    labelEditor = editor;
    labelEditorActions = { commit, cancel };
    if (evt) evt.preventDefault();
  }

  function closeLabelEditor(commit) {
    // Use the same transitions as blur / Escape without creating a DOM
    // event. Import, undo and interrupted gestures can safely cancel even
    // when the browser has already moved focus away from the editor.
    if (labelEditorActions) labelEditorActions[commit ? 'commit' : 'cancel']();
  }

  // Palette ////////////////////////
  let palette = null;
  let paletteGesture = null;

  function appendShape(source, selectedEntry, dropPosition) {
    if (!source || viewer.getElement(source.id) !== source) return null;
    const entry = getExecutableAppendOptions(source).find(option => option.actionName === selectedEntry.actionName);
    if (!entry) return null;
    const { type, eventDefinitionType, ...attributes } = entry.target;
    const businessObject = moddle.create(type, { id: nextId(type.replace('bpmn:', '')), ...attributes });
    if (eventDefinitionType) {
      const definition = moddle.create(eventDefinitionType); definition.$parent = businessObject;
      businessObject.eventDefinitions = [ definition ];
    }
    const size = DEFAULT_SHAPE_SIZES[type] || (businessObject.$instanceOf('bpmn:Event') ? { width: 36, height: 36 } : { width: 100, height: 80 });
    let position = dropPosition;
    if (!position) {
      if (type === 'bpmn:TextAnnotation' && source.waypoints) {
        try { position = annotationAppendPosition(source, { type, businessObject, ...size }, { elements: viewer.getGraph().nodes, edges: viewer.getGraph().edges }); }
        catch (error) { if (error.code === 'UNROUTABLE_DOCKING') return null; throw error; }
      } else position = { x: source.x + source.width + 80, y: source.y + source.height / 2 };
    }
    if (!position || ![ position.x, position.y ].every(Number.isFinite)) return null;
    const candidate = { type, businessObject, ...size, x: Math.round(position.x - size.width / 2), y: Math.round(position.y - size.height / 2) };
    const parent = type === 'bpmn:TextAnnotation' ? findRootContainer() : dropPosition ? parentAt(position, candidate) : source.parent;
    if (!parent || viewer.getElement(parent.id) !== parent) return null;
    candidate.parent = parent; businessObject.$parent = semanticContainer(parent);
    const connectionType = getConnectionType(source, candidate);
    const expectedType = type === 'bpmn:TextAnnotation' || attributes.isForCompensation ? 'bpmn:Association' : 'bpmn:SequenceFlow';
    if (connectionType !== expectedType || !contextRules.canCreate(candidate, parent, source, position)) return null;
    const waypoints = routeConnection({ source, target: candidate, type: connectionType, businessObject: moddle.create(connectionType) });
    if (!waypoints) return null;
    const abort = new Error('append rejected');
    let node;
    try {
      commands.compound('append-shape', () => {
        node = addShape(type, position, { parent, businessObject });
        if (!node || !createConnection(source, node, { waypoints })) throw abort;
      });
    } catch (error) {
      if (error === abort) return null;
      throw error;
    }
    viewer.select(node.id);
    if (!dropPosition) internals.ensureElementVisible?.(node);
    return node;
  }

  function startAppendDrag(event, source, entry, button) {
    if (event.button !== 0 || viewer.getElement(source.id) !== source ||
      !getExecutableAppendOptions(source).some(option => option.actionName === entry.actionName)) return;
    event.preventDefault(); event.stopPropagation(); cancelActiveGesture();
    button._suppressClick = false;
    let dragged = false;
    const ghost = document.createElement('div'); ghost.className = 'bpmn-xyflow-append-ghost'; ghost.textContent = entry.label;
    Object.assign(ghost.style, { position: 'fixed', left: event.clientX + 'px', top: event.clientY + 'px',
      padding: '4px 8px', background: themeToken('surface'), color: themeToken('text'),
      border: `1px dashed ${themeToken('canvas-accent')}`, pointerEvents: 'none', zIndex: 100 });
    inheritTheme(viewer.getContainer(), ghost); document.body.appendChild(ghost);
    function move(current) {
      if (Math.hypot(current.clientX - event.clientX, current.clientY - event.clientY) > 3) dragged = true;
      ghost.style.left = current.clientX + 'px'; ghost.style.top = current.clientY + 'px';
    }
    function cleanup(cancelled = true) {
      window.removeEventListener('mousemove', move, true); window.removeEventListener('mouseup', up, true);
      ghost.remove(); paletteGesture = null;
      if (cancelled || dragged) button._suppressClick = true;
    }
    function up(current) {
      cleanup(false);
      if (!dragged) return;
      const bounds = viewer.getSvg().getBoundingClientRect();
      if (current.clientX < bounds.left || current.clientX > bounds.right || current.clientY < bounds.top || current.clientY > bounds.bottom) return;
      appendShape(source, entry, internals.toGraph(current.clientX, current.clientY));
    }
    paletteGesture = cleanup;
    window.addEventListener('mousemove', move, true); window.addEventListener('mouseup', up, true);
  }

  function buildPalette() {
    if (!opts.palette) return;
    const container = viewer.getContainer();

    palette = document.createElement('div');
    palette.className = 'bpmn-xyflow-palette';
    Object.assign(palette.style, {
      position: 'absolute',
      top: '10px',
      left: '10px',
      background: themeToken('surface-subtle'),
      border: `1px solid ${ themeToken('border') }`,
      borderRadius: themeToken('radius-lg'),
      padding: '6px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      zIndex: 5,
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    });

    const items = [
      { type: 'bpmn:StartEvent', label: 'Start' },
      { type: 'bpmn:Task', label: 'Task' },
      { type: 'bpmn:UserTask', label: 'User Task' },
      { type: 'bpmn:ServiceTask', label: 'Service Task' },
      { type: 'bpmn:ExclusiveGateway', label: 'Gateway' },
      { type: 'bpmn:EndEvent', label: 'End' },
      { type: 'bpmn:IntermediateThrowEvent', label: 'Intermediate' },
      { type: 'bpmn:BoundaryEvent', label: 'Boundary' },
      { type: 'bpmn:SubProcess', label: 'Subprocess' },
      { type: 'bpmn:Participant', label: 'Pool' },
      { type: 'bpmn:Lane', label: 'Lane' },
      { type: 'bpmn:DataObjectReference', label: 'Data object' },
      { type: 'bpmn:DataStoreReference', label: 'Data store' },
      { type: 'bpmn:TextAnnotation', label: 'Annotation' },
      { type: 'bpmn:Group', label: 'Group' }
    ];
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.textContent = '+ ' + item.label;
      btn.title = 'Click to add at viewport centre, or drag onto the canvas';
      if (item.type === 'bpmn:BoundaryEvent') btn.title = 'Select an activity and click to choose a boundary event, or drag onto its border';
      Object.assign(btn.style, {
        padding: '4px 8px',
        textAlign: 'left',
        cursor: 'grab',
        border: `1px solid ${ themeToken('border') }`,
        borderRadius: themeToken('radius-md'),
        background: themeToken('surface-overlay'),
        font: 'inherit'
      });

      btn.addEventListener('click', () => {
        if (btn._suppressClick) { btn._suppressClick = false; return; }
        if (item.type === 'bpmn:BoundaryEvent') {
          const host = viewer.getElement(viewer.getSelection()[0]);
          if (host && getBoundaryEventOptions(host).length) { const bounds = btn.getBoundingClientRect(); openReplaceMenu(host, bounds.right, bounds.top, 'boundary'); }
          return;
        }
        const v = viewer.getViewport();
        const rect = viewer.getContainer().getBoundingClientRect();
        const center = {
          x: (rect.width / 2 - v.x) / v.zoom,
          y: (rect.height / 2 - v.y) / v.zoom
        };
        center.x += (Math.random() - 0.5) * 80;
        center.y += (Math.random() - 0.5) * 60;
        const node = addShape(item.type, center);
        if (node) viewer.select(node.id);
      });

      // drag-to-canvas: a transparent ghost follows the pointer; on
      // mouseup over the canvas, we addShape at the drop point. The
      // ghost is rendered in the container (HTML) so it can sit above
      // the SVG without fighting the panZoom drag.
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        cancelActiveGesture();
        let dragged = false;
        const ghost = document.createElement('div');
        ghost.className = 'bpmn-xyflow-palette-ghost';
        ghost.textContent = item.label;
        Object.assign(ghost.style, {
          position: 'fixed',
          left: e.clientX + 'px',
          top: e.clientY + 'px',
          padding: '4px 8px',
          background: themeToken('surface-subtle'),
          border: `1px dashed ${ themeToken('canvas-accent') }`,
          borderRadius: themeToken('radius-md'),
          font: '12px -apple-system, BlinkMacSystemFont, sans-serif',
          color: themeToken('canvas-accent'),
          pointerEvents: 'none',
          zIndex: 100
        });
        inheritTheme(viewer.getContainer(), ghost);
        document.body.appendChild(ghost);

        function move(ev) {
          dragged = true;
          ghost.style.left = ev.clientX + 'px';
          ghost.style.top = ev.clientY + 'px';
        }
        function cleanup() {
          window.removeEventListener('mousemove', move, true);
          window.removeEventListener('mouseup', up, true);
          ghost.remove();
          paletteGesture = null;
        }
        paletteGesture = cleanup;
        function up(ev) {
          cleanup();
          if (dragged) { btn._suppressClick = true; setTimeout(() => { btn._suppressClick = false; }, 0); }
          if (!dragged) return; // plain click handler covers no-drag case
          // only drop if release is over the viewer
          const containerRect = viewer.getContainer().getBoundingClientRect();
          if (ev.clientX < containerRect.left || ev.clientX > containerRect.right ||
              ev.clientY < containerRect.top || ev.clientY > containerRect.bottom) return;
          const p = internals.toGraph(ev.clientX, ev.clientY);
          const target = elementAtPoint(ev.clientX, ev.clientY);
          let node;
          const intermediate = item.type === 'bpmn:IntermediateThrowEvent' && { type: item.type, businessObject: moddle.create(item.type) };
          if (intermediate && target && contextRules.canAttach(intermediate, target, p)) {
            commands.compound('create-attached-event', () => {
              node = addShape(item.type, p, { parent: target.parent });
              if (!node || !attachBoundary(node, target, p)) throw new Error('cannot create attached intermediate event');
            });
          } else node = target && target.type === 'bpmn:SequenceFlow' ? insertShape(item.type, target, p) : addShape(item.type, p);
          if (node) viewer.select(node.id);
        }
        window.addEventListener('mousemove', move, true);
        window.addEventListener('mouseup', up, true);
      });

      palette.appendChild(btn);
    });

    container.appendChild(palette);
  }

  // Wiring /////////////////////////
  let attached = false;
  function attachModeling() {
    if (attached) return;
    attached = true;

    const svg = viewer.getSvg();

    // capture-phase mousedown wins the gesture from d3-zoom (XYPanZoom)
    svg.addEventListener('mousedown', onMouseDown, true);
    svg.addEventListener('pointerleave', onHoverLeave);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('blur', onWindowBlur);

    // Dblclick listens in CAPTURE so it beats d3-zoom's bubble-phase
    // dblclick.zoom listener. We also disable zoomOnDoubleClick on
    // the underlying XYPanZoom by default, but capture-phase + the
    // explicit stopPropagation in onDblClick is belt-and-braces.
    svg.addEventListener('dblclick', onDblClick, true);
    viewer.getContainer().addEventListener('keydown', onKeyDown);
    svg.addEventListener('contextmenu', onContextMenu);
  }

  function detachModeling() {
    if (!attached) return;
    attached = false;
    const svg = viewer.getSvg();
    svg.removeEventListener('mousedown', onMouseDown, true);
    svg.removeEventListener('pointerleave', onHoverLeave);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
    window.removeEventListener('keydown', onWindowKeyDown);
    window.removeEventListener('blur', onWindowBlur);
    svg.removeEventListener('dblclick', onDblClick, true);
    viewer.getContainer().removeEventListener('keydown', onKeyDown);
    svg.removeEventListener('contextmenu', onContextMenu);
  }

  function onWindowBlur() { cancelActiveGesture(); clearHoverControls(); destroyConnectHandle(); }
  function onHoverLeave(event) { if (!hoverDragPending && !hoverControlActive) hideHoverControls(); if (!connectHandle || !contextPad?.contains(event?.relatedTarget)) destroyConnectHandle(); }
  function onWindowKeyDown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || labelEditor) return;
    if (cancelActiveGesture()) event.preventDefault();
    destroyReplaceMenu(); destroyRightClickMenu();
  }

  function onDblClick(evt) {
    // double-click on a bendpoint handle → delete that waypoint
    const bendHandle = closestWithAttr(evt.target, 'data-bend-index');
    if (bendHandle) {
      const idx = Number(bendHandle.getAttribute('data-bend-index'));
      const owner = viewer.getElement(internals.findElementId(bendHandle));
      if (owner?.waypoints && Number.isInteger(idx)) {
        deleteBendpoint(owner, idx);
        evt.stopPropagation();
        evt.preventDefault();
      }
      return;
    }

    const id = internals.findElementId(evt.target);
    const node = id ? viewer.getElement(id) : null;
    if (!node) return;
    // Stop d3-zoom's dblclick.zoom from running on the same event.
    // openLabelEditor calls preventDefault for us, but the bubble
    // phase still fires unless we stop propagation here.
    evt.stopPropagation();
    evt.preventDefault();
    // Allow renaming connection labels too
    openLabelEditor(node, evt);
  }

  function deleteBendpoint(edge, wpIndex) {
    // can't delete source/target endpoints — those are docked to shapes
    if (wpIndex <= 0 || wpIndex >= edge.waypoints.length - 1) return;
    // a connection must have at least 2 waypoints
    if (edge.waypoints.length <= 2) return;

    const next = edge.waypoints.slice(0, wpIndex).concat(edge.waypoints.slice(wpIndex + 1));
    updateWaypoints(edge, next, { bendpointMove: { insert: false, bendpointIndex: wpIndex } });
  }

  /**
   * Abort whatever drag-style gesture is currently in flight, restoring
   * pre-drag state without pushing a command. Returns true if it
   * cancelled something — caller should preventDefault in that case.
   */
  function cancelActiveGesture() {
    destroyConnectHandle();
    const hoverPending = !!hoverDragPending;
    clearHoverControls();
    if (hoverPending) return true;
    if (paletteGesture) { paletteGesture(); return true; }
    if (dragState) {
      // restore each node and its connected edges to pre-drag state
      const { initialGeometry } = dragState;
      dragState = null;
      restoreGeometry(initialGeometry);
      clearAlignmentGuides();
      refreshSelectionMarkers();
      refreshResizeHandles();
      repositionContextPad();
      return true;
    }
    if (resizeDragState) {
      const state = resizeDragState;
      resizeDragState = null;
      if (state.kind === 'label') restoreLabelResize(state.before);
      else restoreGeometry(state.snapshot);
      return true;
    }

    if (bendDragState) {
      restoreConnections(bendDragState.bundle);
      bendDragState = null;
      return true;
    }
    if (segmentDragState) {
      restoreConnections(segmentDragState.bundle);
      segmentDragState = null;
      return true;
    }
    if (connectState) {
      // no command pushed yet; just tear down the preview
      if (connectPreview && connectPreview.parentNode) connectPreview.parentNode.removeChild(connectPreview);
      connectPreview = null;
      connectState = null;
      return true;
    }
    if (labelDragState) {
      // restore the label gfx position
      labelDragState.host.setAttribute('transform', `translate(${ labelDragState.origin.x }, ${ labelDragState.origin.y })`);
      labelDragState = null;
      return true;
    }
    if (labelNodeDragState) {
      const n = labelNodeDragState.node;
      n.x = labelNodeDragState.origin.x;
      n.y = labelNodeDragState.origin.y;
      const g = internals.elementGfx(n.id);
      if (g) g.setAttribute('transform', `translate(${ n.x }, ${ n.y })`);
      labelNodeDragState = null;
      return true;
    }
    if (lassoState) {
      if (lassoRect && lassoRect.parentNode) lassoRect.parentNode.removeChild(lassoRect);
      lassoRect = null;
      lassoState = null;
      return true;
    }
    return false;
  }

  function onKeyDown(evt) {
    if (!opts.keyboard) return;
    if (evt.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;

    // Don't capture keys when typing in the label editor
    if (labelEditor && labelEditor.contains(evt.target)) return;

    // Escape during an active gesture aborts and restores state.
    if (evt.key === 'Escape') {
      if (cancelActiveGesture()) {
        evt.preventDefault();
        return;
      }
    }

    const isCtrl = evt.ctrlKey || evt.metaKey;
    if (isCtrl && evt.key.toLowerCase() === 'z') {
      cancelActiveGesture();
      if (evt.shiftKey) commands.redo();
      else commands.undo();
      evt.preventDefault();
      return;
    }
    if (isCtrl && evt.key.toLowerCase() === 'y') {
      cancelActiveGesture();
      commands.redo();
      evt.preventDefault();
      return;
    }
    if (isCtrl && evt.key.toLowerCase() === 'c') {
      copySelection();
      evt.preventDefault();
      return;
    }
    if (isCtrl && evt.key.toLowerCase() === 'v') {
      const rect = viewer.getContainer().getBoundingClientRect();
      pasteAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      evt.preventDefault();
      return;
    }
    if (isCtrl && evt.key.toLowerCase() === 'd') {
      // duplicate in place
      copySelection();
      const rect = viewer.getContainer().getBoundingClientRect();
      pasteAtPoint(rect.left + rect.width / 2 + 30, rect.top + rect.height / 2 + 30);
      evt.preventDefault();
      return;
    }
    if (isCtrl && evt.key.toLowerCase() === 'a') {
      const graph = viewer.getGraph();
      if (!graph) return;
      const ids = [
        ...graph.nodes.filter(n => !n.hidden && n.type !== 'label' && 'x' in n).map(n => n.id),
        ...graph.edges.filter(e => !e.hidden).map(e => e.id)
      ];
      viewer.select(ids);
      evt.preventDefault();
      return;
    }
    if (evt.key === 'Delete' || evt.key === 'Backspace') {
      const ids = viewer.getSelection();
      if (!ids.length) return;
      // collapse multi-element delete into a single undo step
      commands.compound('delete-multi', () => {
        topLevelNodes(ids.map(id => viewer.getElement(id)).filter(Boolean)).forEach(deleteModelElement);
      });
      viewer.clearSelection();
      evt.preventDefault();
      return;
    }
    // arrow keys: move selected shape by 10px (with shift: 1px)
    if (evt.key.startsWith('Arrow')) {
      const ids = viewer.getSelection();
      const nodes = ids.map(id => viewer.getElement(id)).filter(Boolean).filter(e => !e.waypoints);
      if (!nodes.length) return;
      if (isCtrl) return;
      const step = evt.shiftKey ? 10 : 1;
      const dx = evt.key === 'ArrowLeft' ? -step : evt.key === 'ArrowRight' ? step : 0;
      const dy = evt.key === 'ArrowUp' ? -step : evt.key === 'ArrowDown' ? step : 0;

      moveShapes(nodes, { x: dx, y: dy });
      evt.preventDefault();
      return;
    }
    // Tab cycles selection through shapes
    if (evt.key === 'Tab') {
      const graph = viewer.getGraph();
      if (!graph) return;
      const shapes = graph.nodes.filter(n => !n.waypoints && n.type !== 'label' && !n.hidden && n.type && n.type !== 'bpmn:Process');
      if (!shapes.length) return;
      const cur = viewer.getSelection()[0];
      const idx = shapes.findIndex(n => n.id === cur);
      const next = shapes[(idx + (evt.shiftKey ? -1 : 1) + shapes.length) % shapes.length];
      viewer.select(next.id);
      evt.preventDefault();
    }
  }

  // build palette once mounted (container already exists at this point)
  buildPalette();

  // Copy / Paste ///////////////////
  let clipboard = null;

  // counter so a sequence of Cmd+V keypresses doesn't pile every paste
  // onto identical coords
  let pastesSinceCopy = 0;

  function cloneSemanticObjects(roots, regenerateIds = true) {
    return cloneSemanticGraph(moddle, roots, { newId: regenerateIds ? type => nextId(type.replace(/^.*:/, '')) : null });
  }

  function copySelection(shapes) {
    pastesSinceCopy = 0;
    const selected = shapes || viewer.getSelection().map(id => viewer.getElement(id));
    const closure = movableClosure(selected.filter(node => node && viewer.getElement(node.id) === node && contextRules.canCopy(selected, node)));
    const nodes = [ ...closure ].filter(node => viewer.getElement(node.id) === node && (!node.host || closure.has(node.host)) && contextRules.canCopy([ ...closure ], node));
    if (!nodes.length) { clipboard = null; return null; }
    const graph = viewer.getGraph(), definitions = viewer.getDefinitions();
    const nodeSet = new Set(nodes);
    const participantOf = element => {
      let current = element;
      while (current && current.type !== 'bpmn:Participant') current = current.parent;
      return current;
    };
    const copied = new Set(nodes), eligibleEdges = [];
    let added;
    do {
      added = false;
      for (const edge of graph.edges) {
        if (copied.has(edge) || !copied.has(edge.source) || !copied.has(edge.target) || !contextRules.canCopy([ ...copied ], edge) ||
          (edge.type === 'bpmn:MessageFlow' && (!nodeSet.has(participantOf(edge.source)) || !nodeSet.has(participantOf(edge.target))))) continue;
        copied.add(edge); eligibleEdges.push(edge); added = true;
      }
    } while (added);
    const edges = orderedConnections(eligibleEdges);
    const roots = nodes.flatMap(node => [ node.businessObject, node.di ]).concat(edges.flatMap(edge => [ edge.businessObject, edge.di ]));
    nodes.forEach(node => {
      if (node.businessObject.processRef && node.type === 'bpmn:Participant') roots.push(node.businessObject.processRef);
      if (node.businessObject.dataObjectRef) roots.push(node.businessObject.dataObjectRef);
    });
    // Collapsed subprocess contents can live in a separate DI plane.
    const semanticRoots = new Set();
    const collectOwned = bo => {
      if (!bo || semanticRoots.has(bo)) return;
      semanticRoots.add(bo);
      (bo.flowElements || []).forEach(collectOwned);
    };
    nodes.forEach(node => collectOwned(node.businessObject));
    const diagrams = (definitions.diagrams || []).filter(diagram => diagram.plane && semanticRoots.has(diagram.plane.bpmnElement));
    roots.push(...diagrams);
    const snapshots = cloneSemanticObjects(roots, false), groupRoots = [];
    for (const node of nodes.filter(node => node.type === 'bpmn:Group')) {
      const clonedRoots = copyGroupCategory(node.businessObject, snapshots.get(node.businessObject), snapshots);
      if (!clonedRoots) { clipboard = null; return null; }
      groupRoots.push(...clonedRoots);
      // Copy the displayed external label rectangle as the reference does,
      // while retaining the copied BPMNLabel/Bounds metadata and raw tokens.
      if (node.label) {
        const di = snapshots.get(node.di);
        di.label ||= moddle.create('bpmndi:BPMNLabel'); di.label.$parent = di;
        di.label.bounds ||= moddle.create('dc:Bounds'); di.label.bounds.$parent = di.label;
        Object.assign(di.label.bounds, { x: node.label.x, y: node.label.y, width: node.label.width, height: node.label.height });
      }
    }
    const selectedGroupValues = new Set(nodes.filter(node => node.type === 'bpmn:Group').map(node => node.businessObject.categoryValueRef).filter(Boolean));
    nodes.concat(edges).forEach(element => { const copy = snapshots.get(element.businessObject); if (copy.$instanceOf('bpmn:FlowElement') && copy.categoryValueRef) copy.categoryValueRef = copy.categoryValueRef.filter(value => !selectedGroupValues.has(value)); });
    const copiedEdges = new Set(edges.map(edge => snapshots.get(edge.businessObject)));
    const copiedNodes = new Set(nodes.map(node => snapshots.get(node.businessObject)));
    nodes.forEach(node => {
      const copy = snapshots.get(node.businessObject);
      for (const key of [ 'incoming', 'outgoing' ]) if (copy[key]) copy[key] = copy[key].filter(edge => copiedEdges.has(edge));
      if (copy.default && !copiedEdges.has(copy.default)) delete copy.default;
      if (copy.flowNodeRef) copy.flowNodeRef = copy.flowNodeRef.filter(child => copiedNodes.has(child));
    });
    clipboard = {
      nodes: nodes.map(node => ({ id: node.id, type: node.type, x: node.x, y: node.y, width: node.width, height: node.height,
        parentId: node.parent && nodeSet.has(node.parent) ? node.parent.id : null,
        hostId: node.host && nodeSet.has(node.host) ? node.host.id : null,
        businessObject: snapshots.get(node.businessObject), di: snapshots.get(node.di) })),
      edges: edges.map(edge => ({ id: edge.id, sourceId: edge.source.id, targetId: edge.target.id, type: edge.type,
        businessObject: snapshots.get(edge.businessObject), di: snapshots.get(edge.di), waypoints: edge.waypoints.map(point => ({ ...point })) })),
      roots: [ ...roots.map(root => snapshots.get(root)), ...groupRoots ], diagrams: diagrams.map(diagram => snapshots.get(diagram))
    };
    return clipboard;
  }

  function pasteAtPoint(clientX, clientY) {
    return pasteElements(internals.toGraph(clientX, clientY));
  }

  function pasteElements(position, parent) {
    return categoryMutation([], () => {
      return pasteElementsCore(position, parent);
    });
  }

  function pasteElementsCore(position, parent) {
    if (!clipboard || !clipboard.nodes.length || !position) return [];
    const copies = cloneSemanticObjects(clipboard.roots);
    const minX = Math.min(...clipboard.nodes.map(node => node.x)), minY = Math.min(...clipboard.nodes.map(node => node.y));
    const maxX = Math.max(...clipboard.nodes.map(node => node.x + node.width)), maxY = Math.max(...clipboard.nodes.map(node => node.y + node.height));
    const incr = pastesSinceCopy++ * 20;
    const dx = position.x - (minX + maxX) / 2 + incr, dy = position.y - (minY + maxY) / 2 + incr;
    const idMap = new Map(), newNodes = [];
    const translateDi = di => {
      if (!di) return;
      if (di.label && di.label.bounds) { di.label.bounds.x += dx; di.label.bounds.y += dy; }
    };
    commands.compound('paste', () => {
      // Original traversal is parent-first; boundary events may precede
      // their host in imported diagrams, so defer them until hosts exist.
      const pending = clipboard.nodes.slice();
      while (pending.length) {
        const index = pending.findIndex(node => (!node.parentId || idMap.has(node.parentId)) && (!node.hostId || idMap.has(node.hostId)));
        if (index < 0) throw new Error('cannot paste cyclic hierarchy');
        const source = pending.splice(index, 1)[0];
        const bo = copies.get(source.businessObject), di = copies.get(source.di);
        translateDi(di);
        if (source.type === 'bpmn:Group' && di?.label?.bounds) {
          di.label.bounds.x = Math.round(di.label.bounds.x); di.label.bounds.y = Math.round(di.label.bounds.y);
        }
        const node = addShape(source.type, { x: source.x + source.width / 2 + dx, y: source.y + source.height / 2 + dy }, {
          businessObject: bo, di, width: source.width, height: source.height,
          parent: source.parentId ? idMap.get(source.parentId) : source.type === 'bpmn:TextAnnotation' ? findRootContainer() : parent,
          host: source.hostId ? idMap.get(source.hostId) : null
        });
        if (!node) throw new Error('cannot paste ' + source.type + ' in this container');
        idMap.set(source.id, node); newNodes.push(node);
      }
      clipboard.edges.forEach(source => {
        const bo = copies.get(source.businessObject), di = copies.get(source.di);
        // The copied owner already contains the semantic connection. The
        // command now owns insertion/removal and any IO items it requires.
        const membership = semanticMembership(bo);
        if (membership) membership.owner[membership.key].splice(membership.index, 1);
        translateDi(di);
        const edge = createConnection(idMap.get(source.sourceId), idMap.get(source.targetId), {
          type: source.type, businessObject: bo, di,
          waypoints: translateWaypoints(source.waypoints, dx, dy)
        });
        if (!edge) throw new Error('cannot paste connection ' + source.type);
        idMap.set(source.id, edge);
      });
      const definitions = viewer.getDefinitions();
      const diagrams = clipboard.diagrams.map(diagram => copies.get(diagram));
      if (diagrams.length) commands.execute({ name: 'paste-diagrams', do: () => {
        diagrams.forEach(diagram => { diagram.$parent = definitions; if (!definitions.diagrams.includes(diagram)) definitions.diagrams.push(diagram); });
      }, undo: () => { diagrams.forEach(diagram => { const index = definitions.diagrams.indexOf(diagram); if (index !== -1) definitions.diagrams.splice(index, 1); }); } });
    });
    viewer.select(topLevelNodes(newNodes).map(node => node.id));
    return newNodes;
  }

  // Replace ////////////////////////
  // Morph an element to another BPMN type while preserving its id,
  // bounds, name, position, and connection topology. New properties
  // specific to the target type (e.g. eventDefinitions) are not
  // synthesised here; consumers can pass them in attrs.
  function compatibleSemanticClone(original, type, clonedObjects) {
    const clones = cloneSemanticObjects([ original ], false);
    if (clonedObjects) clones.forEach((value, key) => clonedObjects.set(key, value));
    const clone = clones.get(original);
    if (original.$type === type) return clone;
    const result = moddle.create(type);
    const allowed = new Set((result.$descriptor.properties || []).map(property => property.name));
    Object.entries(clone).forEach(([ key, value ]) => {
      if (!allowed.has(key) && key !== '__extras') return;
      result[key] = value;
      (Array.isArray(value) ? value : [ value ]).forEach(child => {
        if (child && child.$parent === clone) child.$parent = result;
      });
    });
    Object.assign(result.$attrs, clone.$attrs || {});
    if (clone.$xml) Object.defineProperty(result, '$xml', { value: clone.$xml, writable: true, configurable: true });
    if (clone.$xmlBody !== undefined) Object.defineProperty(result, '$xmlBody', { value: clone.$xmlBody, writable: true, configurable: true });
    result.$parent = original.$parent;
    return result;
  }

  function replacementIOPlan(element, target) {
    try { return planIOReplacement(element.businessObject, moddle.create(target.type), viewer.getDefinitions()); }
    catch { return null; }
  }

  function replacementMenuEntries(element) {
    const entries = getReplacementOptions(element), headers = [], bo = element.businessObject;
    if (bo.$instanceOf('bpmn:Activity') && !bo.triggeredByEvent) {
      const loop = bo.loopCharacteristics, multi = loop?.$instanceOf('bpmn:MultiInstanceLoopCharacteristics');
      headers.push({ label: 'Parallel multi-instance', actionName: 'toggle-parallel-mi', active: !!multi && !loop.isSequential },
        { label: 'Sequential multi-instance', actionName: 'toggle-sequential-mi', active: !!multi && !!loop.isSequential },
        { label: 'Loop', actionName: 'toggle-loop', active: !!loop?.$instanceOf('bpmn:StandardLoopCharacteristics') });
    }
    if (bo.dataObjectRef) headers.push({ label: 'Collection', actionName: 'toggle-is-collection', active: !!bo.dataObjectRef.isCollection });
    if (element.type === 'bpmn:Participant') headers.push({ label: 'Participant multiplicity', actionName: 'toggle-participant-multiplicity', active: !!bo.participantMultiplicity });
    const key = element.type === 'bpmn:BoundaryEvent' ? 'cancelActivity' : element.type === 'bpmn:StartEvent' ? 'isInterrupting' : null;
    if (key && isValidReplacement(element, { type: element.type, eventDefinitionType: bo.eventDefinitions?.[0]?.$type, [key]: !bo[key] })) headers.push({ label: 'Toggle non-interrupting', actionName: 'toggle-non-interrupting', active: bo[key] === false });
    return headers.map(entry => ({ ...entry, header: true })).concat(entries);
  }

  function changeOwnedProperties(element, object, properties, name) {
    const previous = Object.entries(properties).map(([ key ]) => ({ key, own: Object.hasOwn(object, key), value: object[key] }));
    const apply = entries => {
      entries.forEach(({ key, value, own = value !== undefined }) => {
        if (own) object[key] = value; else delete object[key];
        if (value?.$type && !object.$descriptor?.propertiesByName[key]?.isReference) value.$parent = object;
      });
      if (viewer.getElement(element.id) === element) {
        if (element.waypoints) internals.redrawConnection(element); else internals.redrawShape(element);
      }
      if (object.$instanceOf('bpmn:DataObject')) viewer.getGraph().nodes.filter(node => node !== element && node.businessObject.dataObjectRef === object && !node.hidden).forEach(node => internals.redrawShape(node));
      getEdgesConnectedTo(element).forEach(edge => internals.redrawConnection(edge));
    };
    commands.execute({ name, do: () => apply(Object.entries(properties).map(([ key, value ]) => ({ key, value }))), undo: () => apply(previous) });
  }

  function toggleCollection(element) {
    if (!element || viewer.getElement(element.id) !== element || !element.businessObject.dataObjectRef) return false;
    const object = element.businessObject.dataObjectRef;
    changeOwnedProperties(element, object, { isCollection: !object.isCollection }, 'toggle-collection');
    return element;
  }

  function toggleParticipantMultiplicity(element) {
    if (!element || viewer.getElement(element.id) !== element || element.type !== 'bpmn:Participant') return false;
    changeOwnedProperties(element, element.businessObject, { participantMultiplicity: element.businessObject.participantMultiplicity ? undefined : moddle.create('bpmn:ParticipantMultiplicity') }, 'toggle-participant-multiplicity');
    return element;
  }

  function setSequenceFlowType(edge, type, condition) {
    if (!edge || viewer.getElement(edge.id) !== edge || edge.type !== 'bpmn:SequenceFlow' || ![ 'normal', 'default', 'conditional' ].includes(type) || (condition !== undefined && typeof condition !== 'string')) return null;
    const bo = edge.businessObject, source = edge.source, sourceBo = source.businessObject;
    const defaultSource = sourceBo.$instanceOf('bpmn:Activity') || [ 'bpmn:ExclusiveGateway', 'bpmn:InclusiveGateway', 'bpmn:ComplexGateway' ].some(kind => sourceBo.$instanceOf(kind));
    if ((type === 'default' && !defaultSource) || (type === 'conditional' && !sourceBo.$instanceOf('bpmn:Activity'))) return null;
    commands.compound('set-sequence-flow-type', () => {
      if (type === 'default') changeOwnedProperties(source, sourceBo, { default: bo }, 'set-default-flow');
      else if (sourceBo.default === bo) changeOwnedProperties(source, sourceBo, { default: undefined }, 'clear-default-flow');
      const expression = type === 'conditional' ? moddle.create('bpmn:FormalExpression', { body: condition ?? bo.conditionExpression?.body ?? '' }) : undefined;
      changeOwnedProperties(edge, bo, { conditionExpression: expression }, 'set-condition');
    });
    return edge;
  }

  function applyReplacementAction(element, entry, options) {
    if (entry.target) return replaceShape(element, entry.target, {}, options);
    if (entry.actionName === 'toggle-non-interrupting') return toggleEventInterrupting(element);
    const marker = { 'toggle-parallel-mi': 'parallelMI', 'toggle-sequential-mi': 'sequentialMI', 'toggle-loop': 'loop' }[entry.actionName];
    if (marker) return toggleActivityMarker(element, marker);
    if (entry.actionName === 'toggle-is-collection') return toggleCollection(element);
    if (entry.actionName === 'toggle-participant-multiplicity') return toggleParticipantMultiplicity(element);
    return setSequenceFlowType(element, ({ 'replace-with-sequence-flow': 'normal', 'replace-with-default-flow': 'default', 'replace-with-conditional-flow': 'conditional' })[entry.actionName]);
  }

  function hasContainerContents(bo) {
    return [ 'flowElements', 'artifacts', 'laneSets' ].some(key => (bo[key] || []).length);
  }

  function hasSubProcessContents(bo) {
    return bo.$instanceOf('bpmn:SubProcess') && hasContainerContents(bo);
  }

  // Keep the complete original containment objects and DI in the command
  // history. Hidden children and separate drill-in planes must be removed
  // as well as the elements currently visible on the canvas.
  function removeSubProcessContents(element) {
    const bo = element.businessObject, definitions = viewer.getDefinitions();
    const keys = [ 'flowElements', 'artifacts', 'laneSets' ];
    const semantics = new Set();
    keys.forEach(key => (bo[key] || []).forEach(child => ownedSemantics(child).forEach(value => semantics.add(value))));
    removeInvisibleConnections(semantics);
    topLevelNodes(viewer.getGraph().nodes.filter(node => node.type !== 'label' && semantics.has(node.businessObject))).forEach(deleteElement);
    const entries = diagramEntriesFor(semantics);
    keys.forEach(key => (bo[key] || []).forEach((value, index) => entries.push({ array: bo[key], value, index })));
    (definitions.diagrams || []).forEach((diagram, index) => {
      if (diagram.plane && (diagram.plane.bpmnElement === bo || semantics.has(diagram.plane.bpmnElement))) entries.push({ array: definitions.diagrams, value: diagram, index });
    });
    commands.execute({ name: 'remove-subprocess-contents', do: () => {
      entries.forEach(({ array, value }) => { const index = array.indexOf(value); if (index !== -1) array.splice(index, 1); });
    }, undo: () => {
      entries.forEach(({ array, value, index }) => { if (!array.includes(value)) array.splice(index, 0, value); });
    } });
  }

  function replaceParticipant(element, target, options, preview = false) {
    if (target.type !== 'bpmn:Participant' || !isValidReplacement(element, target) || typeof target.isExpanded !== 'boolean') return null;
    const bo = element.businessObject, previous = bo.processRef, definitions = viewer.getDefinitions();
    if (!!previous === target.isExpanded) return element;
    if (previous && hasContainerContents(previous) && options.removeContents !== true) return null;
    if (previous && (bo.$parent.participants || []).some(other => other !== bo && other.processRef === previous)) return null;
    if (preview) return element;
    const process = target.isExpanded ? moddle.create('bpmn:Process', { id: nextId('Process'), flowElements: [] }) : null;
    if (process) process.$parent = definitions;
    const index = previous ? definitions.rootElements.indexOf(previous) : -1;
    commands.compound('replace-participant', () => {
      if (previous) removeSubProcessContents({ businessObject: previous });
      commands.execute({ name: 'replace-participant', do: () => {
        if (previous && definitions.rootElements.includes(previous)) definitions.rootElements.splice(definitions.rootElements.indexOf(previous), 1);
        if (process) { bo.processRef = process; if (!definitions.rootElements.includes(process)) definitions.rootElements.push(process); }
        else delete bo.processRef;
        internals.redrawShape(element);
      }, undo: () => {
        if (process && definitions.rootElements.includes(process)) definitions.rootElements.splice(definitions.rootElements.indexOf(process), 1);
        if (previous) { bo.processRef = previous; if (!definitions.rootElements.includes(previous)) definitions.rootElements.splice(index, 0, previous); }
        else delete bo.processRef;
        internals.redrawShape(element);
      } });
    });
    return element;
  }

  function replaceShape(element, newType, attrs = {}, options = {}, attachment, preview = false) {
    return categoryMutation(categoryGeometryElements([ element ]), () => {
      const result = replaceShapeCore(element, newType, attrs, options, attachment, preview);
      recordCategoryElements(categoryGeometryElements([ element ]));
      return result;
    });
  }

  function replaceShapeCore(element, newType, attrs = {}, options = {}, attachment, preview = false) {
    const graph = viewer.getGraph();
    if (!graph || !element || element.isRoot || element.waypoints || element.type === 'label' || viewer.getElement(element.id) !== element) return null;
    if (!attrs || typeof attrs !== 'object' || !options || typeof options !== 'object') return null;
    const oldBo = element.businessObject, oldType = element.type, oldDi = element.di;
    const descriptorTarget = typeof newType === 'object' && newType;
    if (descriptorTarget) { attrs = { ...descriptorTarget, ...attrs }; newType = descriptorTarget.type; delete attrs.type; }
    if (typeof newType !== 'string' || !validEventDefinitionAttrs(attrs.eventDefinitionAttrs) ||
        [ 'removeContents', 'removeIncompatibleData' ].some(key => options[key] !== undefined && typeof options[key] !== 'boolean')) return null;
    if (('id' in attrs && attrs.id !== element.id) || Object.keys(attrs).some(key => key.startsWith('$')) ||
        [ 'flowElements', 'laneSets', 'artifacts', 'incoming', 'outgoing', 'attachedToRef', 'sourceRef', 'targetRef',
          'ioSpecification', 'properties', 'dataInputAssociations', 'dataOutputAssociations' ].some(key => key in attrs)) return null;
    if (oldType === 'bpmn:Participant') return replaceParticipant(element, { type: newType, ...attrs }, options, preview);
    const requestedExpanded = attrs.isExpanded;
    const eventDefType = Object.hasOwn(attrs, 'eventDefinitionType') ? attrs.eventDefinitionType :
      Object.hasOwn(attrs, '__eventDefinition') ? attrs.__eventDefinition : descriptorTarget && newType.endsWith('Event') ? null : undefined;
    if (oldType === newType && eventDefType === undefined && !Object.keys(attrs).length) return element;
    let newBo;
    const clonedObjects = new Map();
    try { newBo = compatibleSemanticClone(oldBo, newType, clonedObjects); } catch { return null; }
    const dataType = bo => bo.$instanceOf('bpmn:DataObjectReference') || bo.$instanceOf('bpmn:DataStoreReference');
    if (!newBo.$instanceOf('bpmn:FlowNode') && !newBo.$instanceOf('bpmn:Artifact') && !dataType(newBo)) return null;
    if (dataType(oldBo) !== dataType(newBo)) return null;
    if (oldBo.$instanceOf('bpmn:Artifact') !== newBo.$instanceOf('bpmn:Artifact')) return null;
    const ioPlan = planIOReplacement(oldBo, newBo, viewer.getDefinitions());
    if (ioPlan.required && (options.removeIncompatibleData !== true || ioPlan.blockedReferences.length)) return null;
    ioPlan.keys.forEach(key => { delete newBo[key]; });
    // Keep compatible owned item identities. References inside the cloned
    // metadata must point back to those retained originals, and self refs to
    // the actual replacement rather than the discarded root clone.
    const retainedKeys = [ 'ioSpecification', 'properties', 'dataInputs', 'dataOutputs', 'inputSet', 'outputSet',
      'dataInputAssociations', 'dataOutputAssociations' ].filter(key =>
      !ioPlan.keys.includes(key) && newBo.$descriptor.propertiesByName[key] && oldBo[key]);
    const retainedReferences = new Map([ [ clonedObjects.get(oldBo), newBo ] ]);
    for (const key of retainedKeys) {
      for (const child of Array.isArray(oldBo[key]) ? oldBo[key] : [ oldBo[key] ]) {
        for (const original of ownedSemantics(child)) if (clonedObjects.has(original)) retainedReferences.set(clonedObjects.get(original), original);
      }
    }
    for (const object of new Set([ newBo, ...clonedObjects.values() ])) {
      for (const property of object.$descriptor?.properties || []) {
        if (!property.isReference || property.isVirtual) continue;
        const value = object[property.name];
        if (Array.isArray(value)) value.forEach((item, index) => { if (retainedReferences.has(item)) value[index] = retainedReferences.get(item); });
        else if (retainedReferences.has(value)) object[property.name] = retainedReferences.get(value);
      }
    }
    const removeContents = oldBo.$instanceOf('bpmn:SubProcess') && !newBo.$instanceOf('bpmn:SubProcess');
    if (removeContents && hasSubProcessContents(oldBo) && options.removeContents !== true) return null;
    try {
      Object.entries(attrs).forEach(([ key, value ]) => { if (![ '__eventDefinition', 'eventDefinitionType', 'eventDefinitionAttrs', 'isExpanded' ].includes(key)) newBo.set(key, value); });
      if (descriptorTarget && newBo.$instanceOf('bpmn:SubProcess')) newBo.triggeredByEvent = !!attrs.triggeredByEvent;
      if (newBo.triggeredByEvent) { delete newBo.loopCharacteristics; delete newBo.isForCompensation; }
      if (eventDefType !== undefined) {
        if (!newBo.$instanceOf('bpmn:Event')) return null;
        const existing = newBo.eventDefinitions?.find(definition => definition.$type === eventDefType);
        newBo.eventDefinitions = eventDefType == null ? [] : [ existing || moddle.create(eventDefType) ];
        if (attrs.eventDefinitionAttrs && newBo.eventDefinitions[0]) Object.entries(attrs.eventDefinitionAttrs).forEach(([ key, value ]) => newBo.eventDefinitions[0].set(key, value));
        if (newBo.eventDefinitions.some(definition => !definition.$instanceOf('bpmn:EventDefinition'))) return null;
        newBo.eventDefinitions.forEach(definition => { definition.$parent = newBo; });
      }
    } catch { return null; }
    if (attachment) newBo.attachedToRef = attachment.host.businessObject;
    const target = { type: newType, eventDefinitionType: newBo.eventDefinitions?.[0]?.$type };
    for (const key of [ 'isInterrupting', 'cancelActivity', 'triggeredByEvent', 'instantiate', 'eventGatewayType' ]) {
      if (Object.hasOwn(attrs, key)) target[key] = attrs[key];
      else if (Object.hasOwn(newBo, key)) target[key] = newBo[key];
    }
    if (requestedExpanded !== undefined) target.isExpanded = requestedExpanded;
    if (attrs.eventDefinitionAttrs !== undefined) target.eventDefinitionAttrs = attrs.eventDefinitionAttrs;
    if (!(attachment?.allowBlank && newType === 'bpmn:BoundaryEvent' && !target.eventDefinitionType) && !isValidReplacement(element, target)) return null;
    const compatibleBoundary = (boundary, host) => canAttachBoundary(boundary, host) &&
      (!(boundary.businessObject.eventDefinitions || []).some(definition => definition.$type === 'bpmn:CancelEventDefinition') || host.businessObject.$instanceOf('bpmn:Transaction'));
    const prospective = { ...element, type: newType, businessObject: newBo };
    if (newBo.$instanceOf('bpmn:BoundaryEvent') && (!element.host || !compatibleBoundary(prospective, element.host))) return null;
    const normalization = new Map();
    if (!removeContents) {
      const attachedChanges = contextRules.dropReplacements(element.attachers || [], prospective)?.replacements || [];
      attachedChanges.forEach(change => { const node = viewer.getElement(change.oldElementId); if (node) normalization.set(node.businessObject, { eventDefinitions: [] }); });
    }
    if (oldBo.$instanceOf('bpmn:SubProcess') && newBo.$instanceOf('bpmn:SubProcess')) {
      for (const child of oldBo.flowElements || []) {
        if (!child.$instanceOf('bpmn:StartEvent') && !child.$instanceOf('bpmn:EndEvent')) continue;
        const probe = viewer.getElement(child.id) || { id: child.id, type: child.$type, businessObject: child };
        const scopeTarget = { ...prospective, collapsed: false, di: { ...prospective.di, isExpanded: true } };
        const changes = contextRules.dropReplacements([ probe ], scopeTarget)?.replacements || [];
        const properties = changes.length ? { eventDefinitions: [], ...(child.$instanceOf('bpmn:StartEvent') ? { isInterrupting: true } : {}) } : null;
        const childTarget = { type: child.$type, eventDefinitionType: properties ? undefined : child.eventDefinitions?.[0]?.$type,
          ...(child.$instanceOf('bpmn:StartEvent') ? { isInterrupting: properties ? true : child.isInterrupting } : {}) };
        if (!isValidTarget(childTarget, { parent: newBo })) return null;
        if (properties) normalization.set(child, properties);
      }
    }
    const removeAttachers = (element.attachers || []).filter(boundary => !normalization.has(boundary.businessObject) && !compatibleBoundary(boundary, prospective));
    if (removeAttachers.length && (!removeContents || options.removeContents !== true)) return null;
    const newDi = cloneSemanticObjects([ oldDi ], false).get(oldDi);
    newDi.bpmnElement = newBo;
    if (!newBo.$instanceOf('bpmn:SubProcess')) delete newDi.isExpanded;
    const membership = semanticMembership(oldBo), plane = findCurrentPlane();
    const oldIncoming = oldBo.incoming, oldOutgoing = oldBo.outgoing;
    const incompatibleAssociations = ioPlan.associations;
    const newDataObject = newType === 'bpmn:DataObjectReference' && !newBo.dataObjectRef
      ? moddle.create('bpmn:DataObject', { id: nextId('DataObject') }) : null;
    if (newDataObject) { newDataObject.$parent = membership?.owner; newBo.dataObjectRef = newDataObject; }
    const previousDataObject = oldBo.dataObjectRef;
    const previousDataMembership = previousDataObject && newType !== 'bpmn:DataObjectReference' &&
      ![ ...ownedSemantics(viewer.getDefinitions()) ].some(object => object !== oldBo && object.dataObjectRef === previousDataObject) && semanticMembership(previousDataObject);
    if (dataType(newBo) && !contextRules.canDrop({ ...element, type: newType, businessObject: newBo }, element.parent)) return null;
    if (preview) return element;
    const incoming = graph.edges.filter(edge => edge.target === element), outgoing = graph.edges.filter(edge => edge.source === element);
    const before = geometrySnapshot([ element ]);
    const oldLabel = element.label, oldLabelDi = oldLabel?.di;
    const oldLabelBounds = oldLabel && { x: oldLabel.x, y: oldLabel.y, width: oldLabel.width, height: oldLabel.height };
    const references = [];
    // References in every diagram, hidden connections and lane memberships
    // must follow replacement, including views that are not currently open.
    ownedSemantics(viewer.getDefinitions()).forEach(object => {
      (object.$descriptor && object.$descriptor.properties || []).filter(property => property.isReference)
        .forEach(property => references.push({ object, key: property.name }));
    });
    const remap = (from, to) => references.forEach(({ object, key }) => {
      if (Array.isArray(object[key])) object[key].forEach((value, index) => { if (value === from) object[key][index] = to; });
      else if (object[key] === from) object[key] = to;
    });
    let newLabel = null;
    const apply = (bo, type, di, previousBo, previousDi, label) => {
      if (membership) { const list = membership.owner[membership.key]; const index = list.indexOf(previousBo); if (index !== -1) list[index] = bo; }
      if (plane) { const index = plane.planeElement.indexOf(previousDi); if (index !== -1) plane.planeElement[index] = di; }
      if (element.label) removeExternalLabelNode(element, element.label);
      Object.assign(element, { type, businessObject: bo, di });
      element.collapsed = bo.$instanceOf('bpmn:SubProcess') && di.isExpanded !== true;
      remap(previousBo, bo);
      // Graph data edges own these exact association and IO objects. Using
      // clones here would duplicate association IDs when reparenting and
      // leave their item references pointing outside the replacement's IO.
      for (const key of retainedKeys) {
        if (oldBo[key]) bo[key] = oldBo[key];
        (Array.isArray(bo[key]) ? bo[key] : [ bo[key] ]).forEach(child => { if (child) child.$parent = bo; });
      }
      if (oldIncoming) bo.incoming = oldIncoming; else delete bo.incoming;
      if (oldOutgoing) bo.outgoing = oldOutgoing; else delete bo.outgoing;
      // Preserve descendants' semantic identity when changing subprocess
      // variants; otherwise existing editing commands would refer to clones.
      if (bo.$instanceOf('bpmn:SubProcess')) {
        for (const key of [ 'flowElements', 'artifacts', 'laneSets' ]) {
          if (oldBo[key]) bo[key] = oldBo[key];
          (bo[key] || []).forEach(child => { child.$parent = bo; });
        }
      }
      internals.redrawShape(element);
      if (hasExternalLabel(type) && bo.name) {
        // Imported labels may be rendered without an explicit BPMNLabel DI.
        // Undo must restore that absence and its original graph-DI alias.
        if (!di.label && di !== oldDi) di.label = moddle.create('bpmndi:BPMNLabel', { bounds: moddle.create('dc:Bounds', oldLabelBounds || { x: element.x + element.width / 2 - 45, y: element.y + element.height + 5, width: 90, height: 20 }) });
        label = createExternalLabelNode(element, bo.name, di.label?.bounds || oldLabelBounds, label);
        if (di === oldDi) label.di = oldLabelDi;
      }
      [ ...incoming, ...outgoing ].forEach(edge => internals.redrawConnection(edge));
      return label;
    };
    commands.compound('replace-shape', () => {
      if (newDataObject) commands.execute({ name: 'add-data-object', do: () => { membership.owner.flowElements.push(newDataObject); }, undo: () => { membership.owner.flowElements.splice(membership.owner.flowElements.indexOf(newDataObject), 1); } });
      if (incompatibleAssociations.size) removeInvisibleConnections(new Set([ ...ownedSemantics(oldBo), ...ioPlan.removed ]), bo => incompatibleAssociations.has(bo));
      graph.nodes.filter(node => node.type !== 'label' && ioPlan.removed.has(node.businessObject)).forEach(deleteElement);
      const removedIoDi = diagramEntriesFor(ioPlan.removed);
      if (removedIoDi.length) commands.execute({ name: 'remove-incompatible-data-di', do: () => {
        removedIoDi.forEach(({ array, value }) => { const index = array.indexOf(value); if (index !== -1) array.splice(index, 1); });
      }, undo: () => {
        removedIoDi.forEach(({ array, value, index }) => { if (!array.includes(value)) array.splice(index, 0, value); });
      } });
      if (removeContents) removeSubProcessContents(element);
      removeAttachers.forEach(deleteElement);
      commands.execute({ name: 'replace-shape',
        do: () => { newLabel = apply(newBo, newType, newDi, oldBo, oldDi, newLabel); },
        undo: () => { apply(oldBo, oldType, oldDi, newBo, newDi, oldLabel); restoreGeometry(before); }
      });
      normalization.forEach((properties, object) => {
        const before = Object.entries(properties).map(([ key ]) => ({ key, value: object[key], own: Object.hasOwn(object, key) }));
        const apply = entries => {
          entries.forEach(({ key, value, own = true }) => { if (own) object[key] = value; else delete object[key]; });
          const node = viewer.getElement(object.id); if (node && !node.hidden) internals.redrawShape(node);
        };
        commands.execute({ name: 'normalize-contained-event', do: () => apply(Object.entries(properties).map(([ key, value ]) => ({ key, value }))), undo: () => apply(before) });
      });
      if (previousDataMembership) {
        const { owner, key, index } = previousDataMembership;
        commands.execute({ name: 'remove-unused-data-object', do: () => { owner[key].splice(owner[key].indexOf(previousDataObject), 1); }, undo: () => { owner[key].splice(index, 0, previousDataObject); } });
      }
      pruneInvalidConnections([ element ]);
      const affectedSemantics = ownedSemantics(newBo);
      normalization.forEach((_, object) => affectedSemantics.add(object));
      pruneInvisibleConnections(affectedSemantics);
      if (requestedExpanded !== undefined && newBo.$instanceOf('bpmn:SubProcess') && element.di.isExpanded !== requestedExpanded) toggleSubProcessExpanded(element);
      if (descriptorTarget && (oldBo.$instanceOf('bpmn:Task') || oldBo.$instanceOf('bpmn:CallActivity')) &&
          newType === 'bpmn:SubProcess' && element.di.isExpanded === true && !newBo.triggeredByEvent) {
        addShape('bpmn:StartEvent', { x: element.x + element.width / 6, y: element.y + element.height / 2 }, { parent: element });
      }
    });
    return element;
  }

  function updateProperties(element, properties) {
    if (!element || viewer.getElement(element.id) !== element || !properties || typeof properties !== 'object') return false;
    const bo = element.businessObject;
    const forbidden = [ '$type', '$parent', 'id', 'sourceRef', 'targetRef', 'attachedToRef', 'processRef', 'flowElements', 'children', 'incoming', 'outgoing' ];
    if (Object.keys(properties).some(key => forbidden.includes(key))) return false;
    if ('isForCompensation' in properties) {
      if (typeof properties.isForCompensation !== 'boolean') return false;
      const plan = compensationPlan(element, properties.isForCompensation);
      if (!plan || plan.connections.length || plan.boundaries.length) return false;
    }
    if (properties.default) {
      const flow = properties.default.businessObject || properties.default;
      if (!flow.$instanceOf || !flow.$instanceOf('bpmn:SequenceFlow') || flow.sourceRef !== bo) return false;
    }
    commands.compound('update-properties', () => {
      if ('name' in properties) updateLabel(element, properties.name);
      if ('text' in properties && element.type === 'bpmn:TextAnnotation') updateLabel(element, properties.text);
      const entries = Object.entries(properties).filter(([ key ]) => key !== 'name' && !(key === 'text' && element.type === 'bpmn:TextAnnotation'));
      if (!entries.length) return;
      const before = entries.map(([ key ]) => ({ key, value: bo.get(key) }));
      const apply = values => {
        values.forEach(({ key, value }) => {
          bo.set(key, value && value.businessObject || value);
          const prop = bo.$descriptor.propertiesByName[key];
          if (value && value.$type && prop && !prop.isReference) value.$parent = bo;
        });
        if (element.waypoints) internals.redrawConnection(element); else internals.redrawShape(element);
        if (values.some(({ key }) => key === 'default')) getEdgesConnectedTo(element).forEach(edge => internals.redrawConnection(edge));
      };
      commands.execute({ name: 'update-properties', do: () => apply(entries.map(([ key, value ]) => ({ key, value }))), undo: () => apply(before) });
    });
    return element;
  }

  // Activity markers ///////////////
  function compensationPlan(activity, next = !activity?.businessObject?.isForCompensation) {
    if (!activity || viewer.getElement(activity.id) !== activity || !activity.businessObject.$instanceOf('bpmn:Activity') || activity.businessObject.triggeredByEvent) return null;
    const bo = activity.businessObject, all = [ ...ownedSemantics(viewer.getDefinitions()) ];
    const prospective = moddle.create(bo.$type, { id: bo.id, isForCompensation: next }); prospective.$parent = bo.$parent;
    const shape = object => object === bo ? { ...activity, businessObject: prospective } : viewer.getElement(object?.id) || { type: object?.$type, businessObject: object };
    const connections = all.filter(edge => edge.sourceRef === bo || edge.targetRef === bo).filter(edge => {
      if (!edge.$instanceOf || ![ 'bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association' ].some(type => edge.$instanceOf(type))) return false;
      if (!next && edge.targetRef === bo && edge.sourceRef?.$instanceOf('bpmn:BoundaryEvent') && edge.sourceRef.eventDefinitions?.some(definition => definition.$type === 'bpmn:CompensateEventDefinition')) return true;
      return getConnectionType(shape(edge.sourceRef), shape(edge.targetRef)) !== edge.$type;
    });
    const boundaries = next ? all.filter(object => object.$instanceOf?.('bpmn:BoundaryEvent') && object.attachedToRef === bo) : [];
    return { next, connections, boundaries };
  }

  function deleteSemanticElement(object) {
    const visible = viewer.getElement(object.id);
    if (visible) { deleteElement(visible); return; }
    if ([ 'bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataAssociation' ].some(type => object.$instanceOf(type))) {
      removeInvisibleConnections(new Set([ ...(Array.isArray(object.sourceRef) ? object.sourceRef : [ object.sourceRef ]), object.targetRef ]), edge => edge === object);
      return;
    }
    const member = semanticMembership(object);
    if (!member) return;
    const semantics = ownedSemantics(object);
    removeInvisibleConnections(semantics);
    const entries = [ { array: member.owner[member.key], value: object, index: member.index }, ...diagramEntriesFor(semantics) ];
    for (const owner of ownedSemantics(viewer.getDefinitions())) if (owner.flowNodeRef?.includes(object)) entries.push({ array: owner.flowNodeRef, value: object, index: owner.flowNodeRef.indexOf(object) });
    commands.execute({ name: 'remove-incompatible-element', do: () => entries.forEach(({ array, value }) => { const index = array.indexOf(value); if (index !== -1) array.splice(index, 1); }),
      undo: () => entries.forEach(({ array, value, index }) => { if (!array.includes(value)) array.splice(index, 0, value); }) });
  }

  function applyCompensation(activity, plan) {
    commands.compound('toggle-compensation', () => {
      plan.connections.forEach(deleteSemanticElement); plan.boundaries.forEach(deleteSemanticElement);
      changeOwnedProperties(activity, activity.businessObject, { isForCompensation: plan.next }, 'toggle-compensation');
    });
    return activity;
  }

  function requestCompensationToggle(activity, clientX, clientY) {
    const plan = compensationPlan(activity);
    if (!plan) return false;
    if (!plan.connections.length && !plan.boundaries.length) return applyCompensation(activity, plan);
    destroyReplaceMenu();
    const rect = viewer.getContainer().getBoundingClientRect();
    replaceMenu = document.createElement('div'); replaceMenu.className = 'bpmn-xyflow-replace-menu';
    replaceMenu.setAttribute('role', 'dialog'); replaceMenu.setAttribute('aria-label', 'Change compensation');
    Object.assign(replaceMenu.style, { position: 'absolute', left: Math.max(0, clientX - rect.left) + 'px', top: Math.max(0, clientY - rect.top) + 'px',
      background: themeToken('surface'), color: themeToken('text'), border: `1px solid ${themeToken('border')}`, borderRadius: themeToken('radius-lg'), padding: '12px', maxWidth: '300px', zIndex: 8 });
    const message = document.createElement('p'); message.textContent = `Changing compensation removes ${plan.connections.length} incompatible connections and ${plan.boundaries.length} attached boundary events with their connections. Undo restores them.`;
    const confirm = document.createElement('button'); confirm.textContent = 'Change compensation and remove incompatible elements';
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
    confirm.addEventListener('click', () => { const current = compensationPlan(activity); destroyReplaceMenu(); if (current) applyCompensation(activity, current); });
    cancel.addEventListener('click', destroyReplaceMenu);
    replaceMenu.append(message, confirm, cancel); viewer.getContainer().appendChild(replaceMenu); cancel.focus();
    replaceMenuOff = event => { if (replaceMenu && !replaceMenu.contains(event.target)) destroyReplaceMenu(); };
    window.addEventListener('mousedown', replaceMenuOff, true);
    return false;
  }

  function toggleActivityMarker(activity, marker) {
    if (!activity || viewer.getElement(activity.id) !== activity || !activity.businessObject.$instanceOf('bpmn:Activity')) return false;
    const bo = activity.businessObject;
    if (marker === 'compensation') {
      const plan = compensationPlan(activity);
      return plan && !plan.connections.length && !plan.boundaries.length ? applyCompensation(activity, plan) : false;
    }
    if (![ 'loop', 'parallelMI', 'sequentialMI' ].includes(marker) || bo.triggeredByEvent) return false;
    const current = bo.loopCharacteristics, multi = current?.$instanceOf('bpmn:MultiInstanceLoopCharacteristics');
    const currentKind = multi ? (current.isSequential ? 'sequentialMI' : 'parallelMI') : current?.$instanceOf('bpmn:StandardLoopCharacteristics') ? 'loop' : null;
    if (currentKind === marker) changeOwnedProperties(activity, bo, { loopCharacteristics: undefined }, 'remove-loop');
    else if (multi && marker !== 'loop') changeOwnedProperties(activity, current, { isSequential: marker === 'sequentialMI' }, 'change-multi-instance-mode');
    else changeOwnedProperties(activity, bo, { loopCharacteristics: moddle.create(marker === 'loop' ? 'bpmn:StandardLoopCharacteristics' : 'bpmn:MultiInstanceLoopCharacteristics', marker === 'loop' ? {} : { isSequential: marker === 'sequentialMI' }) }, 'set-loop');
    return activity;
  }

  function toggleEventInterrupting(element) {
    if (!element || viewer.getElement(element.id) !== element) return false;
    const bo = element.businessObject, key = element.type === 'bpmn:BoundaryEvent' ? 'cancelActivity' : element.type === 'bpmn:StartEvent' ? 'isInterrupting' : null;
    if (!key || !isValidReplacement(element, { type: element.type, eventDefinitionType: bo.eventDefinitions?.[0]?.$type, [key]: !bo[key] })) return false;
    changeOwnedProperties(element, bo, { [key]: !bo[key] }, 'toggle-event-interrupting');
    return element;
  }

  // Sub-process drill-in / collapse
  const expandedBounds = new WeakMap();

  function refreshCurrentGraph(retained = new Map()) {
    const graph = viewer.getGraph(), before = new Set(graph.elementsById.keys());
    retained.forEach((element, id) => { if (!graph.elementsById.has(id)) graph.elementsById.set(id, element); });
    const fresh = buildGraph(viewer.getDefinitions(), graph.diagram || undefined);
    layoutImportedLabels(fresh, internals.renderer.textRenderer);
    reconcileGraph(graph, fresh);
    before.forEach(id => { if (!graph.elementsById.has(id)) internals.removeElementGfx(id); });
    graph.nodes.forEach(node => {
      if (node.hidden) internals.removeElementGfx(node.id);
      else if (node.type !== 'label') internals.redrawShape(node);
    });
    graph.edges.forEach(edge => { if (edge.hidden) internals.removeElementGfx(edge.id); else internals.redrawConnection(edge); });
    graph.nodes.filter(node => node.type === 'label' && !node.hidden).forEach(label => retextExternalLabelNode(label, label.text));
    refreshSelectionMarkers(); refreshResizeHandles(); refreshBendpoints();
    return new Map(graph.elementsById);
  }

  function translatedDi(original, dx, dy) {
    const di = cloneSemanticObjects([ original ]).get(original);
    if (di.bounds) { di.bounds.x += dx; di.bounds.y += dy; }
    (di.waypoint || []).forEach(point => { point.x += dx; point.y += dy; });
    if (di.label && di.label.bounds) { di.label.bounds.x += dx; di.label.bounds.y += dy; }
    return di;
  }

  function expansionPlan(node) {
    const plane = findCurrentPlane(), definitions = viewer.getDefinitions();
    const childDiagram = (definitions.diagrams || []).find(diagram => diagram.plane && diagram.plane !== plane && diagram.plane.bpmnElement === node.businessObject);
    const semantics = ownedSemantics(node.businessObject);
    const local = (plane.planeElement || []).filter(di => semantics.has(di.bpmnElement) && di.bpmnElement !== node.businessObject);
    const existingIds = new Set((plane.planeElement || []).map(di => di.bpmnElement && di.bpmnElement.id));
    const source = childDiagram && childDiagram.plane.planeElement || [];
    const missing = source.filter(di => !existingIds.has(di.bpmnElement && di.bpmnElement.id));
    const visibleBounds = (local.length ? local : source).filter(di => di.bounds).map(di => di.bounds);
    const minX = visibleBounds.length ? Math.min(...visibleBounds.map(bounds => bounds.x)) : 0;
    const minY = visibleBounds.length ? Math.min(...visibleBounds.map(bounds => bounds.y)) : 0;
    const maxX = visibleBounds.length ? Math.max(...visibleBounds.map(bounds => bounds.x + bounds.width)) : 0;
    const maxY = visibleBounds.length ? Math.max(...visibleBounds.map(bounds => bounds.y + bounds.height)) : 0;
    const remembered = expandedBounds.get(node.di);
    const width = remembered && remembered.width || Math.max(350, maxX - minX + 60, node.width);
    const height = remembered && remembered.height || Math.max(200, maxY - minY + 90, node.height);
    const midpoint = getMid(node);
    const bounds = { x: midpoint.x - width / 2, y: midpoint.y - height / 2, width, height };
    // Existing DI always keeps its distinct coordinates. Only missing child
    // representations are translated into the expanded parent's content area.
    let dx = bounds.x + 30 - minX, dy = bounds.y + 50 - minY;
    if (local.length) {
      const counterpart = local.find(di => source.some(other => other.bpmnElement.id === di.bpmnElement.id && other.bounds && di.bounds));
      if (counterpart) {
        const other = source.find(di => di.bpmnElement.id === counterpart.bpmnElement.id);
        dx = counterpart.bounds.x - other.bounds.x; dy = counterpart.bounds.y - other.bounds.y;
      } else { dx = 0; dy = 0; }
      bounds.x = Math.min(node.x, minX - 30); bounds.y = Math.min(node.y, minY - 50);
      bounds.width = Math.max(node.x + node.width, maxX + 30) - bounds.x;
      bounds.height = Math.max(node.y + node.height, maxY + 40) - bounds.y;
    }
    return { bounds, entries: missing.map(original => {
      const di = translatedDi(original, dx, dy); di.$parent = plane; return di;
    }) };
  }

  function toggleSubProcessExpanded(node) {
    return categoryMutation(categoryGeometryElements([ node ]), () => {
      const result = toggleSubProcessExpandedCore(node);
      recordCategoryElements(categoryGeometryElements([ node ]));
      return result;
    });
  }

  function toggleSubProcessExpandedCore(node) {
    if (!node || !node.di || viewer.getElement(node.id) !== node || !node.businessObject.$instanceOf('bpmn:SubProcess')) return false;
    const before = node.di.isExpanded, expanding = before !== true;
    if (!isValidTarget({ type: node.type, triggeredByEvent: !!node.businessObject.triggeredByEvent, isExpanded: expanding }, { parent: node.parent })) return false;
    const beforeGeometry = geometrySnapshot([ node ]), plane = findCurrentPlane();
    const midpoint = getMid(node);
    if (!expanding) expandedBounds.set(node.di, { width: node.width, height: node.height });
    const plan = expanding ? expansionPlan(node) : { entries: [], bounds: { x: midpoint.x - 50, y: midpoint.y - 40, width: 100, height: 80 } };
    let retained = new Map();
    commands.execute({ name: 'toggle-expanded', do: () => {
      node.di.isExpanded = expanding;
      plan.entries.forEach(di => { if (!plane.planeElement.includes(di)) plane.planeElement.push(di); });
      resizeWithoutChildren(node, plan.bounds);
      retained = refreshCurrentGraph(retained);
    }, undo: () => {
      plan.entries.forEach(di => { const index = plane.planeElement.indexOf(di); if (index !== -1) plane.planeElement.splice(index, 1); });
      node.di.isExpanded = before;
      restoreGeometry(beforeGeometry);
      refreshCurrentGraph(retained);
    } });
    return node;
  }

  // Collect every shape AND every connection internal to a sub-process,
  // recursively. We treat children (graph link) as the source of truth
  // for shapes; for connections we include any whose source AND target
  // are inside the descendant set.
  function collectDescendants(root) {
    const shapes = new Set();
    function walk(node) {
      (node.children || []).forEach(c => {
        if (c === root) return;
        shapes.add(c);
        walk(c);
      });
    }
    walk(root);
    const graph = viewer.getGraph();
    const edges = (graph && graph.edges || []).filter(e =>
      shapes.has(e.source) && shapes.has(e.target)
    );
    return { shapes: [ ...shapes ], edges };
  }


  function applySpacePlan(plan) {
    const moved = new Set(plan.movingShapes), resized = new Set(plan.resizingShapes);
    const snapshot = geometrySnapshot(viewer.getGraph().nodes);
    const original = new Map(snapshot.shapes.map(state => [ state.node, state ]));
    plan.moves.forEach(({ node, dx, dy }) => {
      node.x += dx; node.y += dy;
      if (node.type === 'label') {
        const host = node.labelTarget;
        const labelDi = host && host.di && host.di.label;
        if (labelDi && labelDi.bounds) { labelDi.bounds.x = node.x; labelDi.bounds.y = node.y; }
      } else if (node.di && node.di.bounds) { node.di.bounds.x = node.x; node.di.bounds.y = node.y; }
    });
    plan.resizes.forEach(({ node, bounds }) => {
      Object.assign(node, bounds); if (node.di && node.di.bounds) Object.assign(node.di.bounds, bounds);
      resizeOwnerLabel(node, snapshot);
    });
    snapshot.edges.forEach(({ edge, waypoints }) => {
      if (![ edge.source, edge.target ].some(node => moved.has(node) || resized.has(node))) return;
      const positive = plan.direction === 'e' || plan.direction === 's';
      const amount = plan.delta[plan.axis];
      edge.waypoints = waypoints.map(point => {
        const delta = (positive ? point[plan.axis] > plan.coordinate : point[plan.axis] < plan.coordinate) ? amount : 0;
        return translateWaypoints([ point ], plan.axis === 'x' ? delta : 0, plan.axis === 'y' ? delta : 0)[0];
      });
      for (const [ node, index ] of [ [ edge.source, 0 ], [ edge.target, edge.waypoints.length - 1 ] ]) {
        const old = original.get(node), point = waypoints[index];
        if (!old) continue;
        if (moved.has(node)) edge.waypoints[index] = translateWaypoints([ point ], node.x - old.x, node.y - old.y)[0];
        else if (resized.has(node)) edge.waypoints[index] = remapDocking(point, old, node);
      }
      syncEdgeDi(edge);
    });
    propagateDependentGeometry(snapshot.edges, new Map(), new Set(), true);
  }

  function createSpace(elements, axis, coordinate, delta, options = {}) {
    const graph = viewer.getGraph();
    if (!graph) return false;
    const plan = spaceAdjustments(elements || [ ...graph.nodes, ...graph.edges ], axis, coordinate, delta, options);
    if (!plan.moves.length && !plan.resizes.length) return false;
    if (geometryCommand('space', () => applySpacePlan(plan)) === false) return false;
    return plan;
  }

  function childLanes(shape) {
    const axis = horizontalLane(shape) ? 'y' : 'x';
    return (shape.children || []).filter(child => child.type === 'bpmn:Lane').sort((a, b) => a[axis] - b[axis]);
  }

  function geometryCommand(name, edit) { return categoryMutation([], () => geometryCommandCore(name, edit)); }

  function geometryCommandCore(name, edit) {
    const before = geometrySnapshot(viewer.getGraph().nodes);
    if (edit() === false) { restoreGeometry(before); return false; }
    const after = geometrySnapshot(viewer.getGraph().nodes);
    if (sameGeometry(before, after)) { restoreGeometry(before); return true; }
    recordCategoryElements(after.shapes.filter((entry, index) => [ 'x', 'y', 'width', 'height' ].some(key => entry[key] !== before.shapes[index][key])).map(entry => entry.node));
    recordCategoryElements(after.edges.filter((entry, index) => !sameWaypoints(entry.waypoints, before.edges[index].waypoints)).map(entry => entry.edge));
    restoreGeometry(before);
    commands.execute({ name, do: () => restoreGeometry(after), undo: () => restoreGeometry(before) });
    return true;
  }

  function resizeWithoutChildren(node, bounds) {
    return applyResize(node, bounds.x, bounds.y, bounds.width, bounds.height);
  }

  function requireGeometry(result) {
    if (result !== false) return;
    const error = new Error('Cannot complete geometry transaction');
    error.code = 'UNROUTABLE_DOCKING'; throw error;
  }

  function laneTransaction(name, edit) {
    try { commands.compound(name, edit); return true; }
    catch (error) { if (error.code === 'UNROUTABLE_DOCKING') return false; throw error; }
  }

  function assignLaneContents(container) {
    const leaves = [];
    function visit(shape) {
      const lanes = childLanes(shape);
      if (!lanes.length && shape.type === 'bpmn:Lane') leaves.push(shape);
      else lanes.forEach(visit);
    }
    visit(container);
    if (!leaves.length) return;
    // Process-only diagrams may render lane members under the process root.
    // Include semantic membership as well as visual descendants, including
    // nested lanes, without collecting unrelated members of sibling lanes.
    const candidates = new Set(collectAllDescendants(container));
    function includeLaneMembers(shape) {
      if (shape.type === 'bpmn:Lane') (shape.businessObject.flowNodeRef || []).forEach(bo => {
        const node = viewer.getElement(bo.id); if (node) candidates.add(node);
      });
      childLanes(shape).forEach(includeLaneMembers);
    }
    includeLaneMembers(container);
    const nodes = [ ...candidates ].filter(node => node.type !== 'bpmn:Lane' && node.type !== 'label' &&
      node.businessObject.$instanceOf('bpmn:FlowNode') && getFlowScope(node) === semanticContainer(container));
    nodes.forEach(node => {
      if (node.host) return;
      const center = getMid(node);
      const axis = horizontalLane(container) ? 'y' : 'x';
      const size = axis === 'y' ? 'height' : 'width';
      const lane = leaves.find(candidate => center[axis] >= candidate[axis] && center[axis] <= candidate[axis] + candidate[size]) ||
        leaves.slice().sort((a, b) => Math.abs(getMid(a)[axis] - center[axis]) - Math.abs(getMid(b)[axis] - center[axis]))[0];
      if (node.parent === lane) return;
      const change = { node, oldParent: node.parent, newParent: lane };
      commands.execute({ name: 'lane-membership', do: () => applyReparent(change), undo: () => undoReparent(change) });
      (node.attachers || []).forEach(boundary => {
        const boundaryChange = { node: boundary, oldParent: boundary.parent, newParent: lane };
        commands.execute({ name: 'lane-membership', do: () => applyReparent(boundaryChange), undo: () => undoReparent(boundaryChange) });
      });
    });
  }

  function splitLane(shape, count) {
    if (!shape || viewer.getElement(shape.id) !== shape || ![ 'bpmn:Participant', 'bpmn:Lane' ].includes(shape.type) ||
        (shape.type === 'bpmn:Participant' && !shape.businessObject.processRef)) return null;
    const existing = childLanes(shape);
    if (!Number.isInteger(count) || count < 1 || existing.length > count) return null;
    const bounds = laneSplitBounds(shape, count);
    if (bounds.some(bound => bound.width < 20 || bound.height < 20)) return null;
    const result = [];
    if (!laneTransaction('split-lane', () => {
      bounds.forEach((bound, index) => {
        let lane = existing[index];
        if (lane) requireGeometry(geometryCommand('resize-lane', () => resizeWithoutChildren(lane, bound)));
        else lane = addShape('bpmn:Lane', { x: bound.x + bound.width / 2, y: bound.y + bound.height / 2 }, {
          parent: shape, width: bound.width, height: bound.height,
          di: moddle.create('bpmndi:BPMNShape', { isHorizontal: horizontalLane(shape) })
        });
        if (!lane) throw new Error('cannot create split lane');
        result.push(lane);
      });
      assignLaneContents(shape);
    })) return null;
    return result;
  }

  function addLane(shape, location = 'after') {
    if (!canAddLane(shape)) return null;
    if (!shape || viewer.getElement(shape.id) !== shape || ![ 'bpmn:Participant', 'bpmn:Lane' ].includes(shape.type) ||
        (shape.type === 'bpmn:Participant' && !shape.businessObject.processRef)) return null;
    if (![ 'before', 'after', 'top', 'bottom', 'left', 'right' ].includes(location)) return null;
    const horizontal = horizontalLane(shape);
    const before = [ 'before', 'top', 'left' ].includes(location);
    const parent = shape.type === 'bpmn:Participant' ? shape : shape.parent;
    let root = parent;
    while (root.parent && root.type === 'bpmn:Lane') root = root.parent;
    const original = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    const laneParentIsShape = parent === shape;
    let lane;
    if (!laneTransaction('add-lane', () => {
      if (!childLanes(parent).length) requireGeometry(splitLane(parent, 1) !== null);
      const affected = [];
      const visit = node => { affected.push(node); if (node.label) affected.push(node.label); if (node !== shape) (node.children || []).filter(child => child !== shape).forEach(visit); };
      visit(root);
      const position = horizontal ? 'y' : 'x', size = horizontal ? 'height' : 'width';
      const coordinate = original[position] + (before ? 10 : original[size] - 10);
      const plan = spaceAdjustments(affected, horizontal ? 'vertical' : 'horizontal', coordinate, before ? -120 : 120);
      requireGeometry(geometryCommand('make-lane-space', () => applySpacePlan(plan)));
      const bounds = horizontal ? {
        x: original.x + (laneParentIsShape ? 30 : 0), y: original.y + (before ? -120 : original.height),
        width: original.width - (laneParentIsShape ? 30 : 0), height: 120
      } : {
        x: original.x + (before ? -120 : original.width), y: original.y + (laneParentIsShape ? 30 : 0),
        width: 120, height: original.height - (laneParentIsShape ? 30 : 0)
      };
      lane = addShape('bpmn:Lane', { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, {
        parent, width: bounds.width, height: bounds.height,
        di: moddle.create('bpmndi:BPMNShape', { isHorizontal: horizontal })
      });
      if (!lane) throw new Error('cannot add lane');
      // Keep semantic lane order aligned with visible order.
      const laneSet = lane.businessObject.$parent, oldOrder = laneSet.lanes.slice();
      const order = childLanes(parent).map(child => child.businessObject);
      commands.execute({ name: 'order-lanes', do: () => laneSet.lanes.splice(0, laneSet.lanes.length, ...order),
        undo: () => laneSet.lanes.splice(0, laneSet.lanes.length, ...oldOrder) });
    })) return null;
    return lane;
  }

  function deleteLane(lane) {
    if (!lane || lane.type !== 'bpmn:Lane' || viewer.getElement(lane.id) !== lane) return false;
    const siblings = childLanes(lane.parent).filter(node => node !== lane);
    const resize = laneDeletionBounds(lane, siblings);
    return laneTransaction('delete-lane', () => {
      deleteElement(lane);
      if (resize.length) requireGeometry(geometryCommand('rebalance-lanes', () => {
        for (const { node, bounds } of resize) if (resizeWithoutChildren(node, bounds) === false) return false;
      }));
    });
  }

  function deleteModelElement(element) {
    if (element && element.type === 'bpmn:Lane') return deleteLane(element);
    return deleteElement(element);
  }

  // Graph identities and viewports are per diagram; command history is global.
  // Navigation itself never adds, clears or restores command entries.
  const navStack = [];
  const diagramStates = new Map();
  let currentDiagramId = null;
  let navigationPending = false;

  function emitNavigationState() {
    internals.emit('navigation.change', { canNavigateBack: navStack.length > 0, pending: navigationPending || importPending || viewer.getDefinitions() !== historyDefinitions,
      diagramId: currentDiagramId, depth: navStack.length });
  }

  function currentDiagramState() {
    return {
      diagramId: viewer.getGraph().diagram.id, graph: viewer.getGraph(),
      viewport: viewer.getViewport(), ancestors: navStack.slice()
    };
  }

  function ensureSubProcessDiagram(node) {
    const definitions = viewer.getDefinitions(), businessObject = node.businessObject;
    let diagram = (definitions.diagrams || []).find(candidate => candidate.plane && candidate.plane.bpmnElement === businessObject);
    if (diagram) return diagram;
    const { shapes, edges } = collectDescendants(node);
    const originalDi = [ ...shapes, ...edges ].filter(element => element.type !== 'label' && element.di).map(element => element.di);
    const copied = cloneSemanticObjects(originalDi);
    const plane = moddle.create('bpmndi:BPMNPlane', {
      id: nextId('BPMNPlane'), bpmnElement: businessObject,
      planeElement: originalDi.map(di => copied.get(di))
    });
    plane.planeElement.forEach(di => { di.$parent = plane; });
    diagram = moddle.create('bpmndi:BPMNDiagram', { id: nextId('BPMNDiagram'), plane });
    plane.$parent = diagram; diagram.$parent = definitions;
    definitions.diagrams = definitions.diagrams || [];
    definitions.diagrams.push(diagram);
    return diagram;
  }

  function assertCurrentGraph(graph, warnings = []) {
    if (viewer.getGraph() !== graph) {
      const error = new Error('diagram superseded by a newer operation');
      error.name = 'AbortError';
      error.warnings = warnings;
      throw error;
    }
  }

  async function activateDiagram(diagramId, state) {
    const result = await viewer.switchDiagram(diagramId, { reuseGraph: state && state.graph });
    assertCurrentGraph(result.graph);
    currentDiagramId = diagramId;
    resetModelingOverlays(); ensureGridBackground();
    if (state) await viewer.setViewport(state.viewport, { duration: 0 });
    assertCurrentGraph(result.graph);
  }

  function activateHistoryDiagram(context) {
    if (viewer.getGraph() === context.graph) return;
    const previous = currentDiagramState();
    const target = diagramStates.get(context.diagramId) || context;
    // Keep the latest view, not the viewport at the time the command was made.
    diagramStates.set(previous.diagramId, previous);
    internals.activateDiagram(target.diagramId, target.graph);
    currentDiagramId = target.diagramId;
    navStack.splice(0, navStack.length, ...target.ancestors);
    resetModelingOverlays(); ensureGridBackground();
    viewer.setViewport(target.viewport, { duration: 0 });
    emitNavigationState();
  }

  async function drillInto(subProcessNode) {
    if (navigationPending || importPending || viewer.getDefinitions() !== historyDefinitions || !subProcessNode || viewer.getElement(subProcessNode.id) !== subProcessNode ||
        !subProcessNode.businessObject.$instanceOf('bpmn:SubProcess')) return false;
    const definitions = viewer.getDefinitions();
    if (!definitions) return false;
    cancelActiveGesture(); closeLabelEditor(false);
    const diagram = ensureSubProcessDiagram(subProcessNode);
    const previous = currentDiagramState();
    if (diagram.id === previous.diagramId) return false;
    navigationPending = true;
    emitNavigationState();
    try {
      await activateDiagram(diagram.id, diagramStates.get(diagram.id));
      diagramStates.set(previous.diagramId, previous);
      navStack.push(previous.diagramId);
      return true;
    } finally { navigationPending = false; emitNavigationState(); }
  }

  async function navigateBack() {
    if (navigationPending || importPending || viewer.getDefinitions() !== historyDefinitions || !navStack.length) return false;
    cancelActiveGesture(); closeLabelEditor(false);
    const previousId = navStack[navStack.length - 1];
    const previous = diagramStates.get(previousId);
    const current = currentDiagramState();
    navigationPending = true;
    emitNavigationState();
    try {
      await activateDiagram(previousId, previous);
      diagramStates.set(current.diagramId, current);
      navStack.pop();
      return true;
    } finally { navigationPending = false; emitNavigationState(); }
  }

  // Public modeling API ////////////
  this.addShape = addShape;
  this.moveShape = (node, delta, parent) => moveShapes([ node ], delta, parent);
  this.moveShapes = moveShapes;
  this.resizeShape = resizeShape;
  this.updateWaypoints = updateWaypoints;
  this.reconnect = reconnectConnection;
  this.updateLabel = updateLabel;
  this.updateProperties = updateProperties;
  this.getModdle = () => moddle;
  this.copy = copySelection;
  this.paste = pasteElements;
  this.cancel = cancelActiveGesture;
  this.findElements = viewer.findElements;
  this.focusElement = viewer.focusElement;
  this.saveSVG = viewer.saveSVG;
  this.exportSVG = viewer.exportSVG;
  const applyMoves = (name, moves) => commands.compound(name, () => moves.forEach(({ node, dx, dy }) => {
    if (dx || dy) moveShapes([ node ], { x: dx, y: dy });
  }));
  this.align = (nodes, direction) => applyMoves('align', alignmentMoves(nodes, direction));
  this.distribute = (nodes, axis) => applyMoves('distribute', distributionMoves(nodes, axis));
  this.createSpace = createSpace;
  this.connect = createConnection;
  this.insertShape = insertShape;
  this.delete = deleteModelElement;
  this.splitLane = splitLane;
  this.addLane = addLane;
  this.deleteLane = deleteLane;
  this.replace = replaceShape;
  this.attachBoundary = attachBoundary;
  this.setSequenceFlowType = setSequenceFlowType;
  this.toggleCollection = toggleCollection;
  this.toggleParticipantMultiplicity = toggleParticipantMultiplicity;
  this.toggleEventInterrupting = toggleEventInterrupting;
  this.toggleMarker = toggleActivityMarker;
  this.toggleExpanded = toggleSubProcessExpanded;
  this.drillInto = drillInto;
  this.navigateBack = navigateBack;
  this.canNavigateBack = () => navStack.length > 0;
  this.undo = () => { cancelActiveGesture(); closeLabelEditor(false); return commands.undo(); };
  this.redo = () => { cancelActiveGesture(); closeLabelEditor(false); return commands.redo(); };
  this.canUndo = () => commands.canUndo();
  this.canRedo = () => commands.canRedo();

  this.getXML = async function(options = {}) {
    const defs = viewer.getDefinitions();
    if (!defs) throw new Error('no diagram loaded');
    const { xml } = await moddle.toXML(defs, { format: options.format !== false });
    return xml;
  };
  disposeEditorActions = installEditorActions(this, viewer, opts);
}
