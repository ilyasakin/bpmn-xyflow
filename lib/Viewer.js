import {
  XYPanZoom,
  XYMinimap,
  PanOnScrollMode
} from '@xyflow/system';

import {
  append as svgAppend,
  create as svgCreate,
  classes as svgClasses,
  clear as svgClear
} from 'tiny-svg';

import { parseBpmnXML, buildGraph } from './Importer';
import Renderer from './Renderer';
import { BpmnModdle } from './bpmn/moddle';
import { getGraphBounds as computeGraphBounds, fitViewport } from './util/ViewportUtil';
import { reconcileGraph } from './util/GraphUtil';
import { themeToken } from './util/Theme';
import { getShapePaintOrder } from './util/PaintOrder';
import { open as openPoweredBy, BPMNIO_IMG, LOGO_STYLES, LINK_STYLES } from './util/PoweredByUtil';
import { domify, assignStyle, query as domQuery } from 'min-dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

const NOOP = function() {};
let connectionHitId = 0;

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, char => `\\${ char.codePointAt(0).toString(16) } `);
}

// Mid-of-longest-segment heuristic for placing a connection label.
function pickLabelPosition(waypoints) {
  let best = { dx: 0, dy: 0 };
  let bestLen = -1;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) {
      bestLen = len;
      best = { x: (a.x + b.x) / 2 - 45, y: (a.y + b.y) / 2 - 25 };
    }
  }
  return best;
}

const DEFAULT_OPTIONS = {
  minZoom: 0.01,
  maxZoom: 4,
  fitPadding: 20,
  fitInsets: {},
  fitViewOnInit: true,
  refitOnResize: true,
  keyboard: true,
  minimap: false
};

const DEFAULT_MINIMAP = {
  width: 200,
  height: 150,
  position: 'bottom-right',
  margin: 10,
  background: themeToken('surface-overlay'),
  border: `1px solid ${ themeToken('border') }`,
  nodeFill: themeToken('border'),
  viewportFill: `color-mix(in srgb, ${ themeToken('canvas-accent') } 15%, transparent)`,
  viewportStroke: themeToken('canvas-accent')
};

function ensureSvgRoot() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';
  svg.style.userSelect = 'none';
  svg.style.touchAction = 'none';
  return svg;
}

function appendChildSvg(parent, child) {
  parent.appendChild(child);
}

/**
 * A read-only BPMN viewer powered by @xyflow/system for pan/zoom and
 * the bpmn-js renderer for shapes.
 *
 * @param {Object} options
 * @param {HTMLElement} options.container DOM element to mount the viewer in
 * @param {Object} [options.config] Renderer config (colors, fonts)
 * @param {number} [options.minZoom]
 * @param {number} [options.maxZoom]
 * @param {number} [options.fitPadding]
 * @param {boolean} [options.fitViewOnInit]
 */
export default function BpmnXyflowViewer(options = {}) {
  // Optional framework props are often explicitly undefined. They must not
  // erase our defaults (in particular XYFlow's numeric zoom constraints).
  const opts = { ...DEFAULT_OPTIONS };
  for (const [ key, value ] of Object.entries(options)) {
    if (value !== undefined) opts[key] = value;
  }
  if (!(Number.isFinite(opts.minZoom) && opts.minZoom > 0) ||
      !(Number.isFinite(opts.maxZoom) && opts.maxZoom >= opts.minZoom)) {
    throw new Error('minZoom and maxZoom must be positive finite numbers, with minZoom <= maxZoom');
  }
  const moddle = opts.moddle || BpmnModdle(opts.moddleExtensions);
  const container = opts.container;

  if (!container) {
    throw new Error('options.container is required');
  }

  const originalContainerStyle = { position: container.style.position, overflow: container.style.overflow };
  container.classList.add('bpmn-xyflow-container');
  container.style.position = container.style.position || 'relative';
  container.style.overflow = 'hidden';

  const svg = ensureSvgRoot();
  appendChildSvg(container, svg);
  svg.setAttribute('class', 'bpmn-xyflow-canvas');
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-label', opts.ariaLabel || 'BPMN diagram');

  // Retain the original bpmn.io attribution and its unmodified lightbox.
  const projectLogo = domify('<a href="https://bpmn.io" target="_blank" rel="noopener" class="bjs-powered-by" title="Powered by bpmn.io">' + BPMNIO_IMG + '</a>');
  assignStyle(domQuery('svg', projectLogo), LOGO_STYLES);
  assignStyle(projectLogo, LINK_STYLES, {
    position: 'absolute', bottom: '15px', right: '15px', zIndex: '100',
    background: themeToken('surface'), color: themeToken('text')
  });
  projectLogo.addEventListener('click', event => {
    event.preventDefault();
    openPoweredBy();
  });
  container.appendChild(projectLogo);

  // viewport <g> that gets transformed by XYPanZoom
  const viewport = document.createElementNS(SVG_NS, 'g');
  viewport.setAttribute('class', 'bpmn-xyflow-viewport');
  svg.appendChild(viewport);

  // separate layers so connections render above shapes,
  // labels above connections
  const shapeLayer = document.createElementNS(SVG_NS, 'g');
  shapeLayer.setAttribute('class', 'bpmn-xyflow-shapes');
  viewport.appendChild(shapeLayer);

  const connectionLayer = document.createElementNS(SVG_NS, 'g');
  connectionLayer.setAttribute('class', 'bpmn-xyflow-connections');
  viewport.appendChild(connectionLayer);

  const labelLayer = document.createElementNS(SVG_NS, 'g');
  labelLayer.setAttribute('class', 'bpmn-xyflow-labels');
  viewport.appendChild(labelLayer);

  const renderer = new Renderer({
    rootSvg: svg,
    config: opts.config
  });

  let destroyed = false;
  let importSequence = 0;
  let renderWarnings = [];
  let panZoom;
  let currentGraph = null;
  let currentDefinitions = null;
  let currentViewport = { x: 0, y: 0, zoom: 1 };
  let cancelPointerClicks = NOOP;
  let disposeInteractions = NOOP;

  // Event listeners /////////////
  const listeners = new Map();

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
    return () => off(type, handler);
  }

  function off(type, handler) {
    const set = listeners.get(type);
    if (set) set.delete(handler);
  }

  function emit(type, payload) {
    const set = listeners.get(type);
    if (!set) return;
    for (const h of set) {
      try { h(payload); } catch (e) { console.error(`listener for ${ type } threw`, e); }
    }
  }

  // Selection state /////////////
  const selection = new Set();

  function elementGfx(id) {
    return viewport.querySelector(`[data-element-id="${ cssEscape(id) }"]`);
  }

  function applySelectionClass(id, on) {
    const gfx = elementGfx(id);
    if (gfx) {
      if (on) gfx.classList.add('is-selected');
      else gfx.classList.remove('is-selected');
    }
  }

  /**
   * Render (or re-render) a connection edge into the connection layer.
   * Includes the connection name label if `edge.businessObject.name`
   * is set; the label position priority is:
   *   1. `edge.di.label.bounds` (persists across export/import)
   *   2. longest-segment midpoint heuristic
   *
   * Shared by the initial render path (drawConnectionEdge) and any
   * later updates (internals.redrawConnection).
   */
  function drawConnectionInto(edge) {
    const old = elementGfx(edge.id);
    if (edge.hidden) { old?.remove(); return; }

    const g = svgCreate('g', {
      'class': 'bpmn-xyflow-connection',
      'data-element-id': edge.id
    });
    if (old) old.replaceWith(g);
    else svgAppend(connectionLayer, g);

    try {
      const visual = renderer.drawConnection(g, edge);
      if (visual?.getAttribute('d')) {
        visual.classList.add('bpmn-xyflow-connection-visual');
        // Interaction corridor only: do not widen the visible BPMN stroke or
        // its default/conditional/message markers. Non-scaling stroke keeps
        // selection usable after zooming out.
        const hit = svgCreate('path', {
          'class': 'bpmn-xyflow-connection-hit', 'data-bpmn-hit': 'true',
          d: visual.getAttribute('d')
        });
        for (const [name, value] of Object.entries({ fill: 'none', stroke: 'transparent',
          'stroke-width': '12', 'stroke-linecap': 'butt',
          'vector-effect': 'non-scaling-stroke', 'pointer-events': 'stroke'
        })) hit.setAttribute(name, value);
        const outlines = [...new Set([edge.source, edge.target])].filter(Boolean)
          .map(shape => renderer.bpmnRenderer.getShapePath(shape)).filter(Boolean);
        let hitGraphic = hit;
        for (const outline of outlines) {
          const id = `bpmn-xyflow-hit-clip-${++connectionHitId}`;
          const clip = svgCreate('clipPath', { id, clipPathUnits: 'userSpaceOnUse', 'data-bpmn-hit-clip': 'true' });
          // Intersect separate outside-shape clips. Combining both holes in
          // one even-odd path would incorrectly expose overlapping interiors.
          const clipPath = svgCreate('path', {
            d: `M -10000000 -10000000 H 10000000 V 10000000 H -10000000 Z ${outline}`,
            'data-bpmn-hit': 'true'
          });
          clipPath.setAttribute('clip-rule', 'evenodd');
          svgAppend(clip, clipPath);
          g.insertBefore(clip, visual);
          const wrapper = svgCreate('g', { 'data-bpmn-hit': 'true' });
          wrapper.setAttribute('clip-path', `url(#${id})`);
          svgAppend(wrapper, hitGraphic);
          hitGraphic = wrapper;
        }
        g.insertBefore(hitGraphic, visual);
      }
    } catch (e) {
      reportRenderWarning(edge, e);
    }

    const name = edge.businessObject && edge.businessObject.name;
    if (name && !edge.label && edge.waypoints && edge.waypoints.length >= 2) {
      const diLabelBounds = edge.di && edge.di.label && edge.di.label.bounds;
      const labelPos = diLabelBounds
        ? { x: diLabelBounds.x, y: diLabelBounds.y, width: diLabelBounds.width, height: diLabelBounds.height }
        : Object.assign({ width: 90, height: 20 }, pickLabelPosition(edge.waypoints));

      const labelG = svgCreate('g', {
        'class': 'bpmn-xyflow-connection-label',
        'data-element-id': edge.id,
        'data-connection-label': 'true',
        transform: `translate(${ labelPos.x }, ${ labelPos.y })`
      });
      labelG.style.cursor = 'pointer';

      const text = renderer.textRenderer.createText(name, {
        box: { width: labelPos.width, height: labelPos.height },
        align: 'center-middle',
        padding: 0,
        style: renderer.getExternalLabelStyle(edge)
      });
      svgClasses(text).add('djs-label');
      svgAppend(labelG, text);
      svgAppend(g, labelG);
    }
    if (selection.has(edge.id)) g.classList.add('is-selected');
    return g;
  }

  function setSelection(ids) {
    const next = new Set([ ...ids ].filter(id => getElement(id)));

    // remove old
    for (const id of selection) {
      if (!next.has(id)) applySelectionClass(id, false);
    }
    // add new
    for (const id of next) {
      if (!selection.has(id)) applySelectionClass(id, true);
    }

    const changed = next.size !== selection.size ||
      [ ...next ].some(id => !selection.has(id));

    selection.clear();
    next.forEach(id => selection.add(id));

    if (changed) {
      emit('selection.change', {
        ids: [ ...selection ],
        elements: [ ...selection ].map(id => currentGraph?.elementsById.get(id)).filter(Boolean)
      });
    }
  }

  function findElementId(target) {
    let node = target;
    while (node && node !== svg) {
      if (node.getAttribute && node.getAttribute('data-element-id')) {
        return node.getAttribute('data-element-id');
      }
      node = node.parentNode;
    }
    return null;
  }

  function getElement(id) {
    return (currentGraph && currentGraph.elementsById.get(id)) || null;
  }

  function attachInteractionListeners() {
    // Observe, rather than consume, the native pointer stream. d3/XYPanZoom
    // still owns pan/pinch. A two-contact gesture must not become a shape tap
    // when one finger lifts while the other is still down.
    const pointerWindow = svg.ownerDocument.defaultView || window;
    const activePointers = new Map();
    let suppressClick = false;
    const cancelClicks = () => { if (activePointers.size) suppressClick = true; };
    const resetPointers = () => { activePointers.clear(); suppressClick = false; };
    function pointerDown(evt) {
      const inside = svg.contains(evt.target);
      activePointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY, inside });
      if (activePointers.size > 1) suppressClick = true;
      // focus svg so keyboard shortcuts work
      if (inside && opts.keyboard && document.activeElement !== svg) svg.focus({ preventScroll: true });
    }
    function pointerEnd(evt) {
      const origin = activePointers.get(evt.pointerId);
      if (!origin) return;
      // Losing capture does not release the finger. Keep its ID active until
      // up/cancel so a later contact cannot be mistaken for a fresh lone tap.
      if (evt.type === 'lostpointercapture') { suppressClick = true; return; }
      const click = evt.type === 'pointerup' && !suppressClick && origin.inside && svg.contains(evt.target);
      activePointers.delete(evt.pointerId);
      // Cancellation invalidates the remaining contacts too. Keep suppression
      // until every contact ends, even if a later finger is added mid-stream.
      if (evt.type !== 'pointerup') suppressClick = true;
      if (!activePointers.size) suppressClick = false;
      if (!click) return;

      // ignore if user dragged (panned) — threshold ~3px
      const dx = evt.clientX - origin.x;
      const dy = evt.clientY - origin.y;
      if (Math.hypot(dx, dy) > 3) return;

      const id = findElementId(evt.target);
      const element = id ? getElement(id) : null;
      emit('element.click', { event: evt, element, id });

      if (opts.selectOnClick !== false) {
        if (id) {
          if (evt.shiftKey || evt.metaKey || evt.ctrlKey) {
            const next = new Set(selection);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setSelection(next);
          } else {
            setSelection([ id ]);
          }
        } else {
          setSelection([]);
        }
      }
    }
    // Capture also sees releases outside SVG and contacts on other surfaces.
    // These listeners never preventDefault, stop propagation, or capture a
    // pointer; only a single-contact gesture belonging to this SVG can click.
    pointerWindow.addEventListener('pointerdown', pointerDown, true);
    pointerWindow.addEventListener('pointerup', pointerEnd, true);
    pointerWindow.addEventListener('pointercancel', pointerEnd, true);
    pointerWindow.addEventListener('lostpointercapture', pointerEnd, true);
    pointerWindow.addEventListener('blur', resetPointers);

    let hoveredId = null;
    svg.addEventListener('pointermove', (evt) => {
      const id = findElementId(evt.target);
      if (id === hoveredId) return;

      if (hoveredId) {
        const prev = elementGfx(hoveredId);
        if (prev) prev.classList.remove('is-hovered');
        emit('element.out', { event: evt, id: hoveredId, element: getElement(hoveredId) });
      }
      if (id) {
        const next = elementGfx(id);
        if (next) next.classList.add('is-hovered');
        emit('element.hover', { event: evt, id, element: getElement(id) });
      }
      hoveredId = id;
    });

    svg.addEventListener('pointerleave', (evt) => {
      if (hoveredId) {
        const prev = elementGfx(hoveredId);
        if (prev) prev.classList.remove('is-hovered');
        emit('element.out', { event: evt, id: hoveredId, element: getElement(hoveredId) });
        hoveredId = null;
      }
    });
    return { cancelClicks, dispose() {
      pointerWindow.removeEventListener('pointerdown', pointerDown, true);
      pointerWindow.removeEventListener('pointerup', pointerEnd, true);
      pointerWindow.removeEventListener('pointercancel', pointerEnd, true);
      pointerWindow.removeEventListener('lostpointercapture', pointerEnd, true);
      pointerWindow.removeEventListener('blur', resetPointers);
      resetPointers();
    } };
  }

  // Targeted engine controls use the current bpmn.io semantic theme tokens.
  const styleEl = document.createElementNS(SVG_NS, 'style');
  styleEl.textContent = `
    .bpmn-xyflow-container {
      color-scheme: var(--bpmn-xyflow-color-scheme, light);
      color: ${ themeToken('text') };
      background: ${ themeToken('surface') };
    }
    .bpmn-xyflow-container :is(button, select, [contenteditable]) {
      color: ${ themeToken('text') };
      color-scheme: var(--bpmn-xyflow-color-scheme, light);
    }
    .bpmn-xyflow-container :is(button, select):disabled {
      color: ${ themeToken('text-subtle') } !important;
      border-color: ${ themeToken('border-disabled') } !important;
      cursor: default;
    }
    .bpmn-xyflow-container .bpmn-xyflow-palette button:hover:not(:disabled) {
      color: ${ themeToken('primary') };
      background: ${ themeToken('surface-medium') } !important;
      border-color: ${ themeToken('primary') } !important;
    }
    .bpmn-xyflow-container :is(button, select, [contenteditable], a):focus-visible {
      outline: 2px solid ${ themeToken('focus') };
      outline-offset: 1px;
    }
    .bpmn-xyflow-container button[aria-pressed="true"] {
      color: ${ themeToken('selected-text') } !important;
      background: ${ themeToken('selected-surface') } !important;
      border-color: ${ themeToken('primary') } !important;
    }
    .bpmn-xyflow-container .bjs-powered-by { display: block; opacity: 1; visibility: visible; }
    /* The original attribution stays readable even in a custom dark theme. */
    .bjs-powered-by-lightbox { color: #222; color-scheme: light; }
    .bjs-powered-by-lightbox .notice a { color: #0369a1; }
    .bpmn-xyflow-canvas:focus-visible { outline: 2px solid ${ themeToken('focus') } !important; outline-offset: -2px; }
    .bpmn-xyflow-shape, .bpmn-xyflow-connection { cursor: pointer; }
    .bpmn-xyflow-shape.is-hovered :is(rect, circle, polygon, path):not([data-marker]):not([data-bpmn-hit]),
    .bpmn-xyflow-connection.is-hovered path:not([data-marker]):not([data-bpmn-hit]) {
      stroke: ${ themeToken('canvas-accent') } !important;
    }
    .bpmn-xyflow-shape.is-selected :is(rect, circle, polygon, path):not([data-marker]):not([data-bpmn-hit]),
    .bpmn-xyflow-connection.is-selected path:not([data-marker]):not([data-bpmn-hit]) {
      stroke: ${ themeToken('canvas-accent') } !important;
      stroke-width: 3 !important;
    }
  `;
  svg.appendChild(styleEl);

  const interactionListeners = attachInteractionListeners();
  cancelPointerClicks = interactionListeners.cancelClicks;
  disposeInteractions = interactionListeners.dispose;

  // Track whether the user has interacted with the viewport since the
  // last fitView/import. We only refit on resize while this is false.
  let userTouchedViewport = false;

  // Resize observer //////////////
  let resizeObserver;
  if (typeof ResizeObserver !== 'undefined' && opts.refitOnResize) {
    resizeObserver = new ResizeObserver(() => {
      if (destroyed || !currentGraph) return;
      if (!userTouchedViewport) fitView();
      setupMinimap();
    });
    resizeObserver.observe(container);
  }

  // Keyboard shortcuts //////////
  function handleKey(evt) {
    if (!opts.keyboard) return;

    // skip when typing in inputs / textareas
    const tag = evt.target && evt.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (evt.target && evt.target.isContentEditable)) {
      return;
    }

    if ([ '+', '=', '-', '_', '0' ].includes(evt.key)) userTouchedViewport = true;

    if (evt.key === '+' || evt.key === '=') {
      panZoom?.scaleBy(1.2);
      evt.preventDefault();
    } else if (evt.key === '-' || evt.key === '_') {
      panZoom?.scaleBy(1 / 1.2);
      evt.preventDefault();
    } else if (evt.key === '0') {
      const v = { x: 0, y: 0, zoom: 1 };
      panZoom?.setViewport(v, { duration: 0 });
      setViewportTransform(v);
      evt.preventDefault();
    } else if (evt.key === 'f' || evt.key === 'F') {
      fitView();
      evt.preventDefault();
    } else if (evt.key === 'Escape') {
      setSelection([]);
    }
  }

  // bind to the SVG so other inputs on the page aren't captured;
  // make the SVG focusable so it can actually receive keys
  svg.setAttribute('tabindex', '0');
  svg.style.outline = 'none';
  svg.addEventListener('keydown', handleKey);

  // Minimap //////////////////////
  let minimap = null;
  let minimapApi = null;
  let minimapNodesG = null;
  let minimapViewportRect = null;
  let minimapConfig = null;

  function ensureMinimap() {
    if (!opts.minimap || minimap) return;

    minimapConfig = Object.assign({}, DEFAULT_MINIMAP, opts.minimap === true ? {} : opts.minimap);

    minimap = document.createElementNS(SVG_NS, 'svg');
    minimap.setAttribute('class', 'bpmn-xyflow-minimap');
    minimap.setAttribute('width', minimapConfig.width);
    minimap.setAttribute('height', minimapConfig.height);
    Object.assign(minimap.style, {
      position: 'absolute',
      bottom: minimapConfig.position.includes('bottom') ? Math.max(46, minimapConfig.margin) + 'px' : '',
      top: minimapConfig.position.includes('top') ? minimapConfig.margin + 'px' : '',
      right: minimapConfig.position.includes('right') ? minimapConfig.margin + 'px' : '',
      left: minimapConfig.position.includes('left') ? minimapConfig.margin + 'px' : '',
      background: minimapConfig.background,
      border: minimapConfig.border,
      borderRadius: themeToken('radius-lg'),
      pointerEvents: 'auto',
      cursor: 'pointer'
    });

    minimapNodesG = document.createElementNS(SVG_NS, 'g');
    minimap.appendChild(minimapNodesG);

    minimapViewportRect = document.createElementNS(SVG_NS, 'rect');
    minimapViewportRect.setAttribute('fill', minimapConfig.viewportFill);
    minimapViewportRect.setAttribute('stroke', minimapConfig.viewportStroke);
    minimapViewportRect.setAttribute('stroke-width', '1');
    minimap.appendChild(minimapViewportRect);

    minimap.addEventListener('pointerdown', () => { userTouchedViewport = true; });
    minimap.addEventListener('wheel', () => { userTouchedViewport = true; }, { passive: true });
    container.appendChild(minimap);
  }

  function destroyMinimap() {
    if (minimapApi) { minimapApi.destroy(); minimapApi = null; }
    if (minimap && minimap.parentNode) minimap.parentNode.removeChild(minimap);
    minimap = null;
    minimapNodesG = null;
    minimapViewportRect = null;
  }

  function renderMinimapNodes() {
    if (!minimap || !currentGraph) return;
    const bounds = getGraphBounds();
    while (minimapNodesG.firstChild) minimapNodesG.removeChild(minimapNodesG.firstChild);
    minimap.style.display = bounds ? 'block' : 'none';
    if (!bounds) { delete minimap._mapTransform; return; }

    const padding = 4;
    const w = minimapConfig.width - padding * 2;
    const h = minimapConfig.height - padding * 2;
    const scale = Math.min(w / bounds.width, h / bounds.height);
    const offX = padding + (w - bounds.width * scale) / 2 - bounds.x * scale;
    const offY = padding + (h - bounds.height * scale) / 2 - bounds.y * scale;

    currentGraph.nodes.forEach(n => {
      if (n.hidden || n.type === 'label' || typeof n.x !== 'number') return;
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', n.x * scale + offX);
      r.setAttribute('y', n.y * scale + offY);
      r.setAttribute('width', Math.max(1, (n.width || 0) * scale));
      r.setAttribute('height', Math.max(1, (n.height || 0) * scale));
      r.setAttribute('fill', minimapConfig.nodeFill);
      r.setAttribute('rx', 1);
      minimapNodesG.appendChild(r);
    });

    minimap._mapTransform = { scale, offX, offY };
    updateMinimapViewport();
  }

  function updateMinimapViewport() {
    if (!minimap || !minimapViewportRect || !minimap._mapTransform) return;
    const { scale, offX, offY } = minimap._mapTransform;
    const v = currentViewport;
    const rect = container.getBoundingClientRect();

    // viewport in graph coords:
    const vx = -v.x / v.zoom;
    const vy = -v.y / v.zoom;
    const vw = rect.width / v.zoom;
    const vh = rect.height / v.zoom;

    minimapViewportRect.setAttribute('x', vx * scale + offX);
    minimapViewportRect.setAttribute('y', vy * scale + offY);
    minimapViewportRect.setAttribute('width', vw * scale);
    minimapViewportRect.setAttribute('height', vh * scale);
  }

  on('viewport.change', updateMinimapViewport);

  function setViewportTransform(v) {
    currentViewport = v;
    viewport.setAttribute(
      'transform',
      `translate(${ v.x }, ${ v.y }) scale(${ v.zoom })`
    );
  }

  function initPanZoom() {
    if (minimapApi) { minimapApi.destroy(); minimapApi = null; }
    if (panZoom) panZoom.destroy();

    panZoom = XYPanZoom({
      domNode: svg,
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      viewport: currentViewport,
      translateExtent: [ [ -Infinity, -Infinity ], [ Infinity, Infinity ] ],
      onPanZoom: (event, v) => {
        if (event) userTouchedViewport = true;
        currentViewport = v;
        viewport.setAttribute('transform', `translate(${ v.x }, ${ v.y }) scale(${ v.zoom })`);
        emit('viewport.change', { viewport: v });
      },
      onPanZoomStart: NOOP,
      onPanZoomEnd: NOOP,
      onDraggingChange: NOOP
    });

    panZoom.update({
      noWheelClassName: 'nowheel',
      noPanClassName: 'nopan',
      preventScrolling: true,
      panOnScroll: false,
      panOnDrag: true,
      panOnScrollMode: PanOnScrollMode.Free,
      panOnScrollSpeed: 0.5,
      userSelectionActive: false,
      zoomOnPinch: true,
      zoomOnScroll: true,
      // dblclick is reserved for rename / drill-in actions in the
      // modeler; consumers can opt back in via opts.zoomOnDoubleClick
      zoomOnDoubleClick: opts.zoomOnDoubleClick !== false,
      zoomActivationKeyPressed: false,
      lib: 'bpmn-xyflow',
      onTransformChange: NOOP,
      connectionInProgress: false,
      paneClickDistance: 0
    });
  }

  function clearGraphics() {
    cancelPointerClicks();
    svgClear(shapeLayer);
    svgClear(connectionLayer);
    svgClear(labelLayer);

    // also clear marker defs from previous render
    const defs = svg.querySelector(':scope > defs');
    if (defs) {
      defs.parentNode.removeChild(defs);
    }
  }

  function reportRenderWarning(element, error) {
    const warning = { message: `failed to render ${ element.id }: ${ error.message }`, context: { element, error } };
    renderWarnings.push(warning);
    emit('render.warning', warning);
  }

  function renderGraph(graph) {
    clearGraphics();
    renderWarnings = [];

    const { nodes, edges } = graph;

    const labels = nodes.filter(node => node.type === 'label');
    const shapes = getShapePaintOrder(nodes);

    // BpmnRenderer expects shape coordinates baked into the gfx via parent translation
    function drawShapeNode(node, layer) {
      if (node.hidden) return;

      const g = svgCreate('g', {
        'class': 'bpmn-xyflow-shape',
        'data-element-id': node.id,
        transform: `translate(${ node.x }, ${ node.y })`
      });

      svgAppend(layer, g);

      try {
        renderer.drawShape(g, node);
      } catch (err) {
        reportRenderWarning(node, err);
      }
    }

    function drawConnectionEdge(edge) {
      // Delegate to the shared helper so initial render and every
      // subsequent update produce the same SVG (including the
      // rendered connection name label, if any).
      drawConnectionInto(edge);
    }

    function drawLabelNode(node, layer) {
      if (node.hidden) return;

      const g = svgCreate('g', {
        'class': 'bpmn-xyflow-label',
        'data-element-id': node.id,
        transform: `translate(${ node.x }, ${ node.y })`
      });

      svgAppend(layer, g);

      // Labels render as text via TextRenderer
      const text = renderer.textRenderer.createText(node.text || '', {
        box: { width: node.width, height: node.height },
        align: 'center-top',
        padding: 0,
        style: renderer.getExternalLabelStyle(node)
      });

      svgClasses(text).add('djs-label');
      svgAppend(g, text);
    }

    // Parent/host/lane backgrounds paint before their descendants.
    // Connections and labels have their own upper layers.
    shapes.forEach(n => drawShapeNode(n, shapeLayer));
    edges.forEach(e => drawConnectionEdge(e, connectionLayer));
    labels.forEach(n => {
      try { drawLabelNode(n, labelLayer); } catch (error) { reportRenderWarning(n, error); }
    });
  }

  function getGraphBounds() {
    return computeGraphBounds(currentGraph);
  }

  function getFitInsets() {
    const rect = container.getBoundingClientRect();
    const result = { top: 0, right: 0, bottom: 0, left: 0, ...opts.fitInsets };
    const reserve = (side, value) => { result[side] = Math.max(Number(result[side]) || 0, value); };
    const palette = container.querySelector('.bpmn-xyflow-palette');
    if (palette && palette.style.display !== 'none') {
      const bounds = palette.getBoundingClientRect();
      if (bounds.width > 0) reserve('left', bounds.right - rect.left);
    }
    const actions = container.querySelector('.bpmn-xyflow-editor-actions');
    if (actions && actions.style.display !== 'none') {
      const bounds = actions.getBoundingClientRect();
      if (bounds.height > 0) reserve('top', bounds.bottom - rect.top);
    }
    // Keep the original attribution unobstructed, including without a minimap.
    const logoBounds = projectLogo.getBoundingClientRect();
    reserve('bottom', logoBounds.height > 0 ? rect.bottom - logoBounds.top : 36);
    if (minimap && minimap.style.display !== 'none') {
      const bounds = minimap.getBoundingClientRect();
      if (minimapConfig.position.includes('bottom')) {
        reserve('bottom', bounds.height > 0 ? rect.bottom - bounds.top : Number(minimapConfig.height) + Math.max(46, minimapConfig.margin));
      } else {
        reserve('top', bounds.height > 0 ? bounds.bottom - rect.top : Number(minimapConfig.height) + minimapConfig.margin);
      }
    }
    return result;
  }

  function fitView(padding) {
    const bounds = getGraphBounds();
    if (!bounds) return;

    const rect = container.getBoundingClientRect();
    const v = fitViewport(
      bounds,
      rect.width,
      rect.height,
      opts.minZoom,
      opts.maxZoom,
      padding ?? opts.fitPadding,
      getFitInsets()
    );
    if (!v) return;

    if (panZoom) {
      panZoom.setViewport(v, { duration: 0 });
    }
    setViewportTransform(v);
    updateMinimapViewport();
    userTouchedViewport = false;
    return v;
  }

  function setupMinimap() {
    if (!opts.minimap) return;

    ensureMinimap();

    if (panZoom && !minimapApi) {
      minimapApi = XYMinimap({
        domNode: minimap,
        panZoom,
        getTransform: () => [ currentViewport.x, currentViewport.y, currentViewport.zoom ],
        getViewScale: () => 1 / (minimap?._mapTransform?.scale || 1)
      });
    }
    if (minimapApi) {
      const rect = container.getBoundingClientRect();
      minimapApi.update({
        translateExtent: [ [ -Infinity, -Infinity ], [ Infinity, Infinity ] ],
        width: rect.width,
        height: rect.height,
        pannable: true,
        zoomable: true,
        zoomStep: 10,
        inversePan: false
      });
    }

    renderMinimapNodes();
  }

  // Public API ////////////

  function assertActive(sequence = importSequence) {
    if (destroyed || sequence !== importSequence) {
      const error = new Error(destroyed ? 'viewer is destroyed' : 'import superseded by a newer operation');
      error.name = 'AbortError';
      throw error;
    }
  }

  async function displayDiagram(definitions, bpmnDiagramId, sequence, reuseGraph) {
    assertActive(sequence);
    const diagram = typeof bpmnDiagramId === 'string'
      ? (definitions.diagrams || []).find(d => d.id === bpmnDiagramId)
      : bpmnDiagramId;
    if (bpmnDiagramId && !diagram) throw new Error(`diagram with id ${ bpmnDiagramId } not found`);
    const freshGraph = buildGraph(definitions, diagram);
    const graph = reuseGraph ? reconcileGraph(reuseGraph, freshGraph) : freshGraph;
    setSelection([]);
    currentGraph = graph;
    currentDefinitions = definitions;
    emit('import.render.start', { definitions, graph });
    renderGraph(graph);
    initPanZoom();
    setupMinimap();
    if (opts.fitViewOnInit) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      assertActive(sequence);
      fitView();
    }
    const warnings = [ ...(graph.warnings || []), ...renderWarnings ];
    emit('import.render.complete', { graph, warnings });
    userTouchedViewport = false;
    return { graph, warnings };
  }

  this.importXML = async function(xml, bpmnDiagramId) {
    const sequence = ++importSequence;
    cancelPointerClicks();
    const warnings = [];
    let parsed = false;
    try {
      assertActive(sequence);
      emit('import.parse.start', { xml });
      const result = await parseBpmnXML(xml, moddle);
      assertActive(sequence);
      warnings.push(...(result.warnings || []));
      parsed = true;
      emit('import.parse.complete', { definitions: result.rootElement, warnings: [ ...warnings ] });
      const rendered = await displayDiagram(result.rootElement, bpmnDiagramId, sequence);
      warnings.push(...rendered.warnings);
      const imported = { graph: rendered.graph, warnings };
      emit('import.done', imported);
      return imported;
    } catch (error) {
      error.warnings = [ ...warnings, ...(error.warnings || []) ];
      if (sequence === importSequence && !destroyed) {
        if (!parsed) emit('import.parse.complete', { error, warnings: error.warnings });
        emit('import.done', { error, warnings: error.warnings });
      }
      throw error;
    }
  };

  /** Switch diagrams while retaining the shared semantic model. */
  this.switchDiagram = async function(bpmnDiagramId, { reuseGraph } = {}) {
    assertActive();
    if (!currentDefinitions) throw new Error('no diagram loaded');
    return displayDiagram(currentDefinitions, bpmnDiagramId, ++importSequence, reuseGraph);
  };

  this.getModdle = function() { return moddle; };

  this.clear = function() {
    assertActive();
    ++importSequence;
    setSelection([]);
    clearGraphics();
    currentGraph = null;
    currentDefinitions = null;
    destroyMinimap();
    emit('diagram.clear', {});
  };

  this.fitView = fitView;

  this.getViewport = function() {
    return { ...currentViewport };
  };

  this.setViewport = function(v, transformOptions) {
    assertActive();
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.zoom) || v.zoom <= 0) {
      throw new Error('viewport requires finite x, y and positive zoom');
    }
    const next = { x: v.x, y: v.y, zoom: Math.min(opts.maxZoom, Math.max(opts.minZoom, v.zoom)) };
    userTouchedViewport = true;
    setViewportTransform(next);
    updateMinimapViewport();
    if (panZoom) return panZoom.setViewport(next, transformOptions);
    emit('viewport.change', { viewport: next });
  };

  /** Find visible BPMN elements by ID or name (case-insensitive). */
  this.findElements = function(query = '') {
    const term = String(query).trim().toLocaleLowerCase();
    if (!currentGraph || !term) return [];
    return [ ...currentGraph.nodes, ...currentGraph.edges ].filter(element =>
      !element.hidden && element.type !== 'label' &&
      [ element.id, element.businessObject?.name ].some(value => String(value || '').toLocaleLowerCase().includes(term))
    );
  };

  this.focusElement = function(id) {
    assertActive();
    const element = getElement(typeof id === 'string' ? id : id?.id);
    if (!element || element.hidden) return false;
    const bounds = computeGraphBounds({ nodes: element.waypoints ? [] : [ element ], edges: element.waypoints ? [ element ] : [] });
    if (!bounds) return false;
    const rect = container.getBoundingClientRect();
    const zoom = currentViewport.zoom;
    this.setViewport({ x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom });
    setSelection([ element.id ]);
    return true;
  };

  /** Export the diagram at model coordinates, independent of current pan/zoom. */
  this.saveSVG = async function({ padding = 10 } = {}) {
    assertActive();
    if (!currentGraph) throw new Error('no diagram loaded');
    if (!Number.isFinite(padding) || padding < 0) throw new Error('SVG padding must be a non-negative finite number');
    let bounds = getGraphBounds() || { x: 0, y: 0, width: 1, height: 1 };
    // Actual text extents may exceed the DI label rectangle.
    try {
      const rendered = viewport.getBBox();
      if (rendered.width > 0 && rendered.height > 0) {
        const x = Math.min(bounds.x, rendered.x), y = Math.min(bounds.y, rendered.y);
        bounds = { x, y, width: Math.max(bounds.x + bounds.width, rendered.x + rendered.width) - x, height: Math.max(bounds.y + bounds.height, rendered.y + rendered.height) - y };
      }
    } catch { /* Empty/detached DOMs can lack SVG geometry. */ }
    const exported = document.createElementNS(SVG_NS, 'svg');
    exported.setAttribute('xmlns', SVG_NS);
    exported.setAttribute('width', bounds.width + padding * 2);
    exported.setAttribute('height', bounds.height + padding * 2);
    exported.setAttribute('viewBox', `${ bounds.x - padding } ${ bounds.y - padding } ${ bounds.width + padding * 2 } ${ bounds.height + padding * 2 }`);
    const description = document.createElementNS(SVG_NS, 'desc');
    description.textContent = 'BPMN diagram rendered with bpmn-xyflow and bpmn.io (https://bpmn.io)';
    exported.appendChild(description);
    // Markers may be defined at the root or inside a connection group.
    for (const defs of svg.querySelectorAll(':scope > defs')) exported.appendChild(defs.cloneNode(true));
    const content = viewport.cloneNode(true);
    content.removeAttribute('transform');
    for (const element of content.querySelectorAll('.is-selected, .is-hovered')) element.classList.remove('is-selected', 'is-hovered');
    for (const hit of content.querySelectorAll('[data-bpmn-hit], [data-bpmn-hit-clip]')) hit.remove();
    // Export only diagram layers, never editor handles, grid, lasso or previews.
    // Copy the live collection before removing editor layers.
    for (const child of Array.from(content.children)) {
      if (![ 'bpmn-xyflow-shapes', 'bpmn-xyflow-connections', 'bpmn-xyflow-labels' ].some(name => child.classList.contains(name))) child.remove();
    }
    exported.appendChild(content);
    return { svg: new XMLSerializer().serializeToString(exported) };
  };

  this.exportSVG = this.saveSVG;

  this.getGraph = function() {
    return currentGraph;
  };

  this.getDefinitions = function() {
    return currentDefinitions;
  };

  this.getContainer = function() {
    return container;
  };

  this.getSvg = function() {
    return svg;
  };

  this.on = on;
  this.off = off;

  this.select = function(idOrIds) {
    const ids = Array.isArray(idOrIds) ? idOrIds : [ idOrIds ];
    setSelection(ids);
  };

  this.deselect = function(idOrIds) {
    if (idOrIds === undefined) {
      setSelection([]);
      return;
    }
    const remove = new Set(Array.isArray(idOrIds) ? idOrIds : [ idOrIds ]);
    setSelection([ ...selection ].filter(id => !remove.has(id)));
  };

  this.getSelection = function() {
    return [ ...selection ];
  };

  this.clearSelection = function() {
    setSelection([]);
  };

  this.getElement = getElement;

  // Internals for the modeler / extensions /////////////
  this._internals = {
    get svg() { return svg; },
    get viewport() { return viewport; },
    get shapeLayer() { return shapeLayer; },
    get connectionLayer() { return connectionLayer; },
    get labelLayer() { return labelLayer; },
    get renderer() { return renderer; },
    get panZoom() { return panZoom; },
    get currentViewport() { return currentViewport; },
    elementGfx,
    findElementId,
    setSelection,
    emit,
    refreshMinimap() {
      // re-render the minimap node rects + viewport indicator after
      // an edit (add / move / delete / resize).
      if (typeof renderMinimapNodes === 'function') renderMinimapNodes();
    },
    /**
     * Convert pointer (page) coords to graph coords.
     */
    toGraph(clientX, clientY) {
      const rect = svg.getBoundingClientRect();
      const v = currentViewport;
      return {
        x: (clientX - rect.left - v.x) / v.zoom,
        y: (clientY - rect.top - v.y) / v.zoom
      };
    },
    redrawShape(node) {
      const old = elementGfx(node.id);
      if (node.hidden) { old?.remove(); return; }
      const g = svgCreate('g', {
        'class': 'bpmn-xyflow-shape',
        'data-element-id': node.id,
        transform: `translate(${ node.x }, ${ node.y })`
      });
      if (old) old.replaceWith(g);
      else {
        // Newly created/restored pools and lanes must not cover existing tasks.
        const order = getShapePaintOrder(currentGraph?.nodes || [node]);
        const index = order.findIndex(element => element.id === node.id);
        const next = order.slice(index + 1).map(element => elementGfx(element.id))
          .find(graphic => graphic?.parentNode === shapeLayer);
        shapeLayer.insertBefore(g, next || null);
      }
      try { renderer.drawShape(g, node); } catch (error) { reportRenderWarning(node, error); }
      if (selection.has(node.id)) g.classList.add('is-selected');
      return g;
    },
    redrawConnection(edge) {
      return drawConnectionInto(edge);
    },
    removeElementGfx(id) {
      const g = elementGfx(id);
      if (g) g.parentNode.removeChild(g);
    },
    refreshSelection() {
      // re-apply current selection's CSS class (after redraw)
      [ ...selection ].forEach(id => applySelectionClass(id, true));
    }
  };

  this.setMinimap = function(value) {
    opts.minimap = value;
    if (!value) {
      destroyMinimap();
    } else if (currentGraph) {
      destroyMinimap();
      setupMinimap();
    }
    if (!userTouchedViewport) fitView();
  };

  this.destroy = function() {
    if (destroyed) return;
    destroyed = true;
    ++importSequence;
    disposeInteractions();
    emit('diagram.destroy', {});
    if (panZoom) {
      panZoom.destroy();
      panZoom = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    svg.removeEventListener('keydown', handleKey);
    destroyMinimap();
    clearGraphics();
    if (svg.parentNode === container) {
      container.removeChild(svg);
    }
    projectLogo.remove();
    container.classList.remove('bpmn-xyflow-container');
    Object.assign(container.style, originalContainerStyle);
    selection.clear();
    listeners.clear();
    currentGraph = null;
    currentDefinitions = null;
  };
}
