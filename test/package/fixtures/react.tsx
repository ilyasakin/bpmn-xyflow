import { createRef } from 'react';
import BpmnViewer, { BpmnViewer as NamedViewer, useBpmnViewer, type BpmnViewerHandle, type BpmnViewerProps } from 'bpmn-xyflow/lib/react';

const ref = createRef<BpmnViewerHandle>();
const props: BpmnViewerProps = {
  xml: '<xml/>', fitInsets: { left: 40 }, config: { textRenderer: { defaultStyle: { fontSize: 12 } } },
  onLoad: result => result.graph.nodes.forEach(node => console.log(node.id)),
  onElementClick: event => console.log(event.element?.businessObject.name),
  onError: error => console.log(error.message)
};
export const component = <BpmnViewer {...props} ref={ref} style={{ height: 500 }} />;
export const named = <NamedViewer xml="" minimap={{ position: 'bottom-left' }} />;
export function HookConsumer() {
  const { containerRef, viewer, findElements, getViewer, clear } = useBpmnViewer({ fitPadding: 20 });
  viewer?.findElements('invoice');
  findElements('invoice');
  getViewer()?.getSelection();
  clear();
  return <div ref={containerRef} />;
}
ref.current?.findElements('Task');
ref.current?.focusElement('Task_1');
ref.current?.saveSVG({ padding: 10 });
// @ts-expect-error callback payload is typed
const invalid = <BpmnViewer onLoad={(result: string) => console.log(result)} />;
// @ts-expect-error invalid minimap corner
const invalidPosition = <BpmnViewer minimap={{ position: 'left' }} />;
void invalid;
void invalidPosition;
