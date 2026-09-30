import { BpmnModdle } from './bpmn/moddle';

import BpmnTreeWalker from './import/BpmnTreeWalker';

import { is } from './util/ModelUtil';

import {
  isLabelExternal,
  getExternalLabelBounds,
  getLabel
} from './util/LabelUtil';

import { isExpanded } from './util/DiUtil';

import { getMid } from 'diagram-js/lib/layout/LayoutUtil';

const moddle = BpmnModdle();

export function parseBpmnXML(xml, model = moddle) {
  const instance = typeof model.fromXML === 'function' ? model : BpmnModdle(model);
  return instance.fromXML(xml);
}

function elementData(semantic, di, attrs = {}) {
  return Object.assign({
    id: semantic.id,
    type: semantic.$type,
    businessObject: semantic,
    di
  }, attrs);
}

function getWaypoints(di, source, target) {
  const waypoints = di.waypoint;

  if (!waypoints || waypoints.length < 2) {
    return [ getMid(source), getMid(target) ];
  }

  return waypoints.map(p => ({ x: p.x, y: p.y }));
}

function isFrameElement(semantic) {
  return is(semantic, 'bpmn:Group');
}

function isPointInsideBBox(bbox, point) {
  return point.x >= bbox.x &&
    point.x <= bbox.x + bbox.width &&
    point.y >= bbox.y &&
    point.y <= bbox.y + bbox.height;
}

/**
 * Build a flat node/edge graph from a BPMN definitions moddle tree.
 *
 * @param {ModdleElement} definitions
 * @param {ModdleElement} [bpmnDiagram]
 *
 * @return {{ nodes: Element[], edges: Element[], roots: Element[], warnings: any[] }}
 */
export function buildGraph(definitions, bpmnDiagram) {
  const warnings = [];
  const elementsById = new Map();
  const nodes = [];
  const edges = [];
  const roots = [];

  function register(element) {
    elementsById.set(element.id, element);
    return element;
  }

  function findRoot(element) {
    let current = element;
    while (current && !current.isRoot) {
      current = current.parent;
    }
    return current;
  }

  function addLabel(semantic, di, element) {
    const text = getLabel(element);
    if (!text) {
      return;
    }

    let bounds = getExternalLabelBounds(di, element);

    const label = register({
      id: semantic.id + '_label',
      type: 'label',
      businessObject: semantic,
      di,
      labelTarget: element,
      hidden: element.hidden || !text,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      parent: element.parent,
      text
    });

    nodes.push(label);
    element.label = label;
    return label;
  }

  const visitor = {

    root(semantic, di) {
      const attrs = is(semantic, 'bpmn:SubProcess') ? { id: semantic.id + '_plane' } : {};

      const root = register(Object.assign(elementData(semantic, di, attrs), {
        isRoot: true,
        children: []
      }));

      roots.push(root);
      return root;
    },

    element(semantic, di, parentElement) {
      if (!di) {
        return;
      }

      let element;

      if (di.$instanceOf('bpmndi:BPMNShape')) {
        const collapsed = !isExpanded(semantic, di);
        const hidden = Boolean(parentElement && (parentElement.hidden || parentElement.collapsed));
        const isFrame = isFrameElement(semantic);
        const bounds = di.bounds;

        element = register(Object.assign(elementData(semantic, di), {
          collapsed,
          hidden,
          isFrame,
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
          parent: parentElement,
          children: []
        }));

        if (is(semantic, 'bpmn:BoundaryEvent')) {
          const hostSemantic = semantic.attachedToRef;
          const host = hostSemantic && elementsById.get(hostSemantic.id);
          if (host) {
            element.host = host;
            host.attachers = host.attachers || [];
            if (host.attachers.indexOf(element) === -1) {
              host.attachers.push(element);
            }
          }
        }

        if (is(semantic, 'bpmn:DataStoreReference')) {
          if (parentElement && !isPointInsideBBox(parentElement, getMid(bounds))) {
            const root = findRoot(parentElement);
            if (root) {
              element.parent = root;
            }
          }
        }

        if (parentElement) {
          parentElement.children = parentElement.children || [];
          parentElement.children.push(element);
        }

        nodes.push(element);
      }
      else if (di.$instanceOf('bpmndi:BPMNEdge')) {
        let source, target;

        const refSemantic = (side) => {
          let ref = semantic[side + 'Ref'];

          if (side === 'source' && semantic.$type === 'bpmn:DataInputAssociation') {
            ref = ref && ref[0];
          }
          if (side === 'source' && semantic.$type === 'bpmn:DataOutputAssociation' ||
              side === 'target' && semantic.$type === 'bpmn:DataInputAssociation') {
            ref = semantic.$parent;
          }
          return ref;
        };

        const sourceRef = refSemantic('source');
        const targetRef = refSemantic('target');

        source = sourceRef && elementsById.get(sourceRef.id);
        target = targetRef && elementsById.get(targetRef.id);

        if (!source || !target) {

          // skip dangling edges, but still warn
          warnings.push({
            message: `skipping ${ semantic.id }: source or target not found`,
            context: { element: semantic }
          });
          return;
        }

        const hidden = Boolean(parentElement && (parentElement.hidden || parentElement.collapsed));

        let edgeParent = parentElement;
        if (is(semantic, 'bpmn:DataAssociation')) {
          edgeParent = findRoot(parentElement) || parentElement;
        }

        element = register(Object.assign(elementData(semantic, di), {
          hidden,
          source,
          target,
          waypoints: getWaypoints(di, source, target),
          parent: edgeParent
        }));

        edges.push(element);
      } else {
        warnings.push({
          message: `unknown di for ${ semantic.id }`,
          context: { element: semantic }
        });
        return;
      }

      if (isLabelExternal(semantic) && getLabel(element)) {
        addLabel(semantic, di, element);
      }

      return element;
    },

    error(message, context) {
      warnings.push({ message, context });
    }
  };

  const walker = new BpmnTreeWalker(visitor);

  bpmnDiagram = bpmnDiagram || (definitions.diagrams && definitions.diagrams[0]);

  if (!bpmnDiagram || !bpmnDiagram.plane) {
    throw new Error('no diagram to display');
  }

  // A graph represents one display plane. Related subprocess and collaboration
  // diagrams remain in definitions for navigation/export, but importing them
  // into this graph leaks their shapes and bounds into the active view.
  walker.handleDefinitions(definitions, bpmnDiagram);

  // Post-process: populate FlowNode.outgoing / .incoming arrays from
  // the SequenceFlow edges. The BPMN spec derives these from
  // sourceRef/targetRef, but bpmn-moddle won't compute them unless
  // the XML explicitly contained <bpmn:outgoing> / <bpmn:incoming>.
  edges.forEach(edge => {
    if (!edge.businessObject || !edge.businessObject.$instanceOf) return;
    if (!edge.businessObject.$instanceOf('bpmn:SequenceFlow')) return;
    const srcBo = edge.source && edge.source.businessObject;
    const tgtBo = edge.target && edge.target.businessObject;
    if (srcBo) {
      srcBo.outgoing = srcBo.outgoing || [];
      if (!srcBo.outgoing.includes(edge.businessObject)) srcBo.outgoing.push(edge.businessObject);
    }
    if (tgtBo) {
      tgtBo.incoming = tgtBo.incoming || [];
      if (!tgtBo.incoming.includes(edge.businessObject)) tgtBo.incoming.push(edge.businessObject);
    }
  });

  return { nodes, edges, roots, warnings, elementsById, diagram: bpmnDiagram };
}
