// Normal application initialization with two real editors in the same document.
// Inspect buttons select only read-only test/DOM evidence; they never change a model.
import { Modeler } from "../../lib/index.js";
const samples = [
  ["Empty diagram", new URL("./empty.bpmn", import.meta.url).href],
  ["Conditional flows", "/test/fixtures/bpmn/draw/conditional-flow.bpmn"],
];
const editors = {};
window.anchorEditors = editors;
function inspect(id) {
  for (const section of document.querySelectorAll("[data-editor]")) {
    const active = section.dataset.editor === id;
    section.dataset.active = String(active);
    section.querySelector(".canvas").id = active ? "viewer" : "viewer-inactive";
  }
  window.modeler = editors[id];
}
for (const id of ["a", "b"]) {
  const section = document.querySelector(`[data-editor="${id}"]`),
    container = section.querySelector(".canvas");
  const modeler = (editors[id] = new Modeler({ container, fitViewOnInit: true, minimap: true }));
  const select = section.querySelector("select"),
    status = section.querySelector(".status");
  let generation = 0;
  for (const [index, [name]] of samples.entries()) select.add(new Option(name, String(index)));
  async function load(index) {
    const request = ++generation;
    const [name, url] = samples[index];
    status.textContent = `Loading ${name}...`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Sample HTTP ${response.status}`);
      const result = await modeler.importXML(await response.text());
      if (request !== generation) return;
      status.textContent = `Loaded ${name} (${result.warnings.length} warnings)`;
    } catch (error) {
      if (request === generation) status.textContent = `Error: ${error.message}`;
    }
  }
  select.addEventListener("change", () => {
    load(Number(select.value));
  });
  section.querySelector("[data-inspect]").addEventListener("click", () => {
    inspect(id);
  });
  section.querySelector("[data-undo]").addEventListener("click", () => {
    modeler.undo();
  });
  section.querySelector("[data-redo]").addEventListener("click", () => {
    modeler.redo();
  });
  modeler.commandStack.onChange(({ canUndo, canRedo }) => {
    section.querySelector("[data-undo]").disabled = !canUndo;
    section.querySelector("[data-redo]").disabled = !canRedo;
  });
  load(0);
}
inspect("a");
