/**
 * Import-time display layout, matching bpmn-js 18.30.1 BpmnImporter.addLabel.
 * Source: https://github.com/bpmn-io/bpmn-js/blob/v18.30.1/lib/import/BpmnImporter.js
 * Adapted from Copyright (c) 2014-present Camunda Services GmbH under the
 * retained upstream LICENSE. Saved BPMNLabel DI is deliberately not rewritten.
 */
import { getExternalLabelBounds, getLabel } from './LabelUtil';

export function layoutImportedLabels(graph, textRenderer) {
  for (const label of graph.nodes) {
    if (label.type !== 'label' || !label.labelTarget) continue;
    const owner = label.labelTarget, text = getLabel(owner);
    let bounds = getExternalLabelBounds(owner.di, owner);
    if (text) bounds = textRenderer.getExternalLabelBounds(bounds, text);
    Object.assign(label, {
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.round(bounds.width), height: Math.round(bounds.height)
    });
  }
  return graph;
}
