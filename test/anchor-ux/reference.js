// A visible comparison application, not an API gesture fixture. Tests choose
// these controls natively; only this ordinary application initialization/import
// code mutates the model. empty.bpmn matches the local demo's initial document.
import Modeler from "bpmn-js/lib/Modeler";
import { observeReferenceConnect } from "../helpers/anchor-reference-connect.mjs";
import { observeReferenceBackgroundClicks } from "../helpers/hover-background.mjs";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
const samples = [
  ["Empty diagram", new URL("./empty.bpmn", import.meta.url).href],
  ["Basic", "/test/fixtures/bpmn/basic.bpmn"],
  ["Conditional flows", "/test/fixtures/bpmn/draw/conditional-flow.bpmn"],
  ["Order, payment and delivery", "/test/fixtures/scenarios/order-payment-delivery.bpmn"],
  ["Approval, rejection and rework", "/test/fixtures/scenarios/approval-rejection-rework.bpmn"],
  [
    "Booking, timeout and compensation",
    "/test/fixtures/scenarios/booking-timeout-compensation.bpmn",
  ],
];
const model = new Modeler({ container: "#viewer" });
window.anchorReferenceConnect = observeReferenceConnect(model);
window.referenceModeler = model; // Read-only evidence access in the native test.
window.anchorReferenceClicks = observeReferenceBackgroundClicks(model.get("eventBus"));
const byId = (id) => document.getElementById(id),
  status = byId("status");
let sequence = 0;
function history() {
  const stack = model.get("commandStack");
  byId("undo-btn").disabled = !stack.canUndo();
  byId("redo-btn").disabled = !stack.canRedo();
}
model.on("commandStack.changed", () => {
  history();
});
async function load(xml, label) {
  const request = ++sequence;
  status.textContent = `Loading ${label}...`;
  try {
    const result = await model.importXML(xml);
    if (request !== sequence) return;
    model.get("canvas").zoom("fit-viewport");
    history();
    byId("xml-out").hidden = true;
    status.textContent = `Loaded ${label} (${result.warnings.length} warnings)`;
    return true;
  } catch (error) {
    if (request === sequence) status.textContent = `Error: ${error.message}`;
    return false;
  }
}
async function sample(index) {
  const [label, url] = samples[index];
  status.textContent = `Loading ${label}...`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sample HTTP ${response.status}`);
  await load(await response.text(), label);
}
for (const [index, [label]] of samples.entries())
  byId("sample-select").add(new Option(label, String(index)));
byId("sample-select").addEventListener("change", () => {
  sample(Number(byId("sample-select").value));
});
byId("undo-btn").addEventListener("click", () => {
  model.get("commandStack").undo();
});
byId("redo-btn").addEventListener("click", () => {
  model.get("commandStack").redo();
});
byId("export-btn").addEventListener("click", async () => {
  byId("xml-out").textContent = (await model.saveXML({ format: true })).xml;
  byId("xml-out").hidden = false;
});
byId("import-btn").addEventListener("click", () => {
  byId("import-error").textContent = "";
  byId("import-dialog").showModal();
  byId("import-xml").focus();
});
byId("import-cancel").addEventListener("click", () => {
  byId("import-dialog").close();
});
byId("import-submit").addEventListener("click", async () => {
  if (await load(byId("import-xml").value, "pasted XML")) byId("import-dialog").close();
  else byId("import-error").textContent = status.textContent;
});
sample(0);
