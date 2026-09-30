import { h, ref } from 'vue';
import BpmnViewer, { BpmnViewer as NamedViewer, type BpmnViewerProps } from 'bpmn-xyflow/lib/vue';

const props: BpmnViewerProps = {
  xml: '<xml/>', fitInsets: { top: 40 }, minZoom: 0.3,
  onLoad: result => console.log(result.graph.nodes.length),
  onSelectionChange: event => console.log(event.ids),
  onElementClick: event => console.log(event.id)
};
export const component = h(BpmnViewer, props);
export const named = h(NamedViewer, { xml: '' });
const viewer = ref<InstanceType<typeof BpmnViewer> | null>(null);
viewer.value?.findElements('Task');
viewer.value?.focusElement('Task_1');
viewer.value?.saveSVG({ padding: 10 });
viewer.value?.getViewer()?.clear();
viewer.value?.$emit('selection-change', { ids: ['Task_1'], elements: [] });
// @ts-expect-error Vue event name is checked
viewer.value?.$emit('selected', []);
// @ts-expect-error Vue event payload is checked
viewer.value?.$emit('selection-change', ['Task_1']);
// @ts-expect-error wrong prop type
const badProps: BpmnViewerProps = { fitPadding: 'wide' };
// @ts-expect-error callback receives a selection object
const badEvent: BpmnViewerProps = { onSelectionChange: (ids: string[]) => console.log(ids) };
void badProps;
void badEvent;
