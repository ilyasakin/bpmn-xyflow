import { mount, unmount, type ComponentProps } from 'svelte';
import BpmnViewer, { BpmnViewer as NamedViewer, type BpmnViewerHandle } from 'bpmn-xyflow/lib/svelte';
import DirectViewer, { type BpmnViewerProps } from 'bpmn-xyflow/lib/svelte/BpmnViewer.svelte';

const props: BpmnViewerProps = {
  xml: '<xml/>', fitInsets: { right: 40 }, fitViewOnInit: false,
  onload: result => console.log(result.graph.nodes.length),
  onelementClick: event => console.log(event.element?.id),
  onselectionChange: event => console.log(event.ids)
};
const inferred: ComponentProps<typeof DirectViewer> = props;
const viewer: BpmnViewerHandle = mount(BpmnViewer, { target: document.body, props: inferred });
const direct = mount(DirectViewer, { target: document.body, props });
const named = mount(NamedViewer, { target: document.body, props });
viewer.findElements('Task');
viewer.focusElement('Task_1');
viewer.saveSVG({ padding: 10 });
direct.getViewer()?.clear();
void unmount(direct);
void unmount(named);
// @ts-expect-error use Svelte's actual lower-case callback spelling
const wrongEvent: BpmnViewerProps = { onLoad: () => {} };
// @ts-expect-error callback receives an element event
const wrongPayload: BpmnViewerProps = { onelementClick: (id: string) => console.log(id) };
void wrongEvent;
void wrongPayload;
