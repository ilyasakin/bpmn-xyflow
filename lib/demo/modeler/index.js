import { Modeler } from '../../index';

const SAMPLES = [
  { label: 'Empty diagram', path: 'empty-process.bpmn' },
  { label: 'Basic', path: 'bpmn/basic.bpmn' },
  { label: 'Conditional flows', path: 'bpmn/draw/conditional-flow.bpmn' },
  { label: 'Order, payment and delivery', path: 'scenarios/order-payment-delivery.bpmn' },
  { label: 'Approval, rejection and rework', path: 'scenarios/approval-rejection-rework.bpmn' },
  { label: 'Booking, timeout and compensation', path: 'scenarios/booking-timeout-compensation.bpmn' },
  { label: 'HR recruitment (retained example)', path: 'bpmn/complex.bpmn' }
];

const FIXTURE_BASE = '/test/fixtures/';

const EMPTY_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="173" y="102" width="36" height="36"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const container = document.getElementById('viewer');
const select = document.getElementById('sample-select');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const exportBtn = document.getElementById('export-btn');
const status = document.getElementById('status');
const xmlOut = document.getElementById('xml-out');
const warningsOut = document.getElementById('warnings-out');
let canExport = false;

SAMPLES.forEach((s, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = s.label;
  select.appendChild(opt);
});

const modeler = new Modeler({
  container,
  fitViewOnInit: true,
  minimap: true
});

window.modeler = modeler;

modeler.commandStack.onChange(({ canUndo, canRedo }) => {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
});

modeler.on('selection.change', ({ ids }) => {
  status.textContent = ids.length ? `Selected: ${ ids.length } element(s)` : '';
});

let loadSequence = 0;
async function loadSample(idx) {
  const sequence = ++loadSequence;
  const sample = SAMPLES[idx];
  status.textContent = `Loading ${ sample.label }...`;
  xmlOut.style.display = 'none';
  warningsOut.replaceChildren();
  warningsOut.hidden = true;
  canExport = false;
  exportBtn.disabled = true;
  try {
    let xml = EMPTY_BPMN;
    if (sample.path !== 'empty-process.bpmn') {
      const response = await fetch(FIXTURE_BASE + sample.path);
      if (!response.ok) throw new Error(`HTTP ${ response.status }`);
      xml = await response.text();
    }
    if (sequence !== loadSequence) return;
    const result = await modeler.importXML(xml);
    if (sequence !== loadSequence) return;
    status.textContent = `Loaded ${ sample.label } (${ result.warnings.length } warnings)`;
    canExport = true;
    exportBtn.disabled = false;
    if (result.warnings.length) {
      warningsOut.hidden = false;
      const summary = document.createElement('summary');
      summary.textContent = `${ result.warnings.length } import warning(s)`;
      const list = document.createElement('ul');
      result.warnings.forEach(warning => {
        const item = document.createElement('li');
        item.textContent = warning.message || String(warning);
        list.appendChild(item);
      });
      warningsOut.append(summary, list);
    }
  } catch (error) {
    if (sequence !== loadSequence || error.name === 'AbortError') return;
    status.textContent = 'Error: ' + error.message;
    console.error(error);
  }
}

select.addEventListener('change', () => loadSample(+select.value));
undoBtn.addEventListener('click', () => modeler.undo());
redoBtn.addEventListener('click', () => modeler.redo());

exportBtn.addEventListener('click', async () => {
  if (!canExport || exportBtn.disabled) return;
  const sequence = loadSequence;
  exportBtn.disabled = true;
  try {
    const xml = await modeler.getXML();
    if (sequence !== loadSequence) return;
    xmlOut.style.display = 'block';
    xmlOut.textContent = xml;
  } catch (error) {
    if (sequence === loadSequence) status.textContent = 'Export error: ' + error.message;
  } finally {
    if (sequence === loadSequence) exportBtn.disabled = !canExport;
  }
});

loadSample(0);
