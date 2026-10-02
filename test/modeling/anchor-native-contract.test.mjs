/** Native-runner API and independent XML-guard preflight; this launches no browser. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { CdpKeyboard, CdpMouse, CdpPage } from "puppeteer";
import { BpmnModdle } from "bpmn-moddle";
import {
  assertOnlyAnchorGeometry,
  assertOnlyAnchorDeletion,
} from "../helpers/anchor-model-guard.mjs";

function inputContract(source) {
  const owners = { keyboard: CdpKeyboard.prototype, mouse: CdpMouse.prototype },
    observed = new Set();
  for (const match of source.matchAll(/\b(keyboard|mouse)\.(\w+)\s*\(/g)) {
    assert.equal(
      typeof owners[match[1]][match[2]],
      "function",
      `installed ${match[1]}.${match[2]}`,
    );
    observed.add(`${match[1]}.${match[2]}`);
  }
  return observed;
}
test("every literal keyboard/mouse call in native modeling runners exists in installed Puppeteer", async () => {
  const files = (await readdir(new URL(".", import.meta.url))).filter((file) =>
    /^browser-.*\.mjs$/.test(file),
  );
  assert.ok(files.includes("browser-anchor-ux.mjs"));
  for (const file of files) inputContract(await readFile(new URL(file, import.meta.url), "utf8"));
  const source = await readFile(new URL("browser-anchor-ux.mjs", import.meta.url), "utf8"),
    used = inputContract(source);
  for (const method of [
    "keyboard.sendCharacter",
    "keyboard.press",
    "keyboard.down",
    "keyboard.up",
    "mouse.click",
    "mouse.move",
    "mouse.down",
    "mouse.up",
    "mouse.wheel",
  ])
    assert.ok(used.has(method), method);
  for (const match of source.matchAll(/\bpage\.(\$\$eval|\$eval|\$\$|\$|[A-Za-z]\w*)\s*\(/g))
    assert.equal(typeof CdpPage.prototype[match[1]], "function", `installed page.${match[1]}`);
  assert.throws(
    () => inputContract("page.keyboard.insertText(xml)"),
    /installed keyboard.insertText/,
  );
});
test("installed native text insertion transmits complete Unicode/multiline XML", async () => {
  const calls = [],
    keyboard = new CdpKeyboard({
      async send(method, params) {
        calls.push({ method, params });
      },
    });
  const text =
    '<!-- ı İ 日本語 😀 -->\n<vendor:payload value="a &amp; b">\n  preserved\n</vendor:payload>';
  await keyboard.sendCharacter(text);
  assert.deepEqual(calls, [{ method: "Input.insertText", params: { text } }]);
  assert.equal(keyboard.insertText, undefined);
});

const oracle = new BpmnModdle();
const fixture = `<?xml version="1.0"?>
<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:v="urn:anchor:guard" targetNamespace="urn:anchor:guard">
 <b:process id="P"><b:task id="A" name="Keep name" v:token="keep"><b:extensionElements><v:payload flag="keep">exact text</v:payload></b:extensionElements><b:outgoing>F</b:outgoing></b:task><b:task id="B"><b:incoming>F</b:incoming></b:task><b:task id="C"/><b:sequenceFlow id="F" sourceRef="A" targetRef="B"/></b:process>
 <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Plane" bpmnElement="P"><bpmndi:BPMNShape id="A_di" bpmnElement="A"><dc:Bounds x="136" y="80" width="100" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="B_di" bpmnElement="B"><dc:Bounds x="259" y="101" width="100" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="C_di" bpmnElement="C"><dc:Bounds x="440" y="101" width="100" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNEdge id="F_di" bpmnElement="F"><di:waypoint x="236" y="120"/><di:waypoint x="259" y="120"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</b:definitions>`;
async function edit(xml, mutate) {
  const p = await oracle.fromXML(xml);
  assert.deepEqual(p.warnings, []);
  mutate(p.elementsById, p.rootElement);
  return (await oracle.toXML(p.rootElement, { format: true })).xml;
}
test("geometry guard allows only named coordinate deltas and rejects unrelated semantics/DI/metadata", async () => {
  const changed = await edit(fixture, (ids) => {
    ids.A_di.bounds.width += 4;
    ids.F_di.waypoint = [
      { x: 240, y: 120 },
      { x: 249, y: 120 },
      { x: 249, y: 115 },
      { x: 259, y: 115 },
    ].map((p) => oracle.create("dc:Point", p));
  });
  const allowed = { shapeIds: ["A"], edgeIds: ["F"] };
  await assertOnlyAnchorGeometry(fixture, changed, allowed);
  const corruptions = [
    (ids) => {
      ids.A.name = "wrong";
    },
    (ids) => {
      ids.F.targetRef = ids.C;
    },
    (ids) => {
      ids.A.$attrs["v:token"] = "wrong";
    },
    (ids) => {
      ids.A.extensionElements.values[0].$body = "wrong";
    },
    (ids) => {
      ids.A.extensionElements.values[0].flag = "wrong";
    },
    (ids) => {
      ids.B_di.bounds.x += 1;
    },
    (ids) => {
      ids.F_di.id = "Wrong_di";
    },
    (ids) => {
      ids.F_di.waypoint[0].$attrs["v:extra"] = "wrong";
    },
    (ids) => {
      ids.Plane.planeElement.reverse();
    },
    (ids) => {
      ids.A.outgoing = [];
    },
  ];
  for (const corrupt of corruptions)
    await assert.rejects(assertOnlyAnchorGeometry(fixture, await edit(changed, corrupt), allowed));
  await assert.rejects(assertOnlyAnchorGeometry(fixture, changed, { edgeIds: ["F"] }));
});
test("Delete guard permits only the selected flow/inverse references/DI removal", async () => {
  const removed = await edit(fixture, (ids) => {
    ids.P.flowElements = ids.P.flowElements.filter((e) => e !== ids.F);
    ids.A.outgoing = [];
    ids.B.incoming = [];
    ids.Plane.planeElement = ids.Plane.planeElement.filter((e) => e !== ids.F_di);
  });
  await assertOnlyAnchorDeletion(fixture, removed, "F");
  for (const corrupt of [
    (ids) => {
      ids.A.name = "wrong";
    },
    (ids) => {
      ids.B_di.bounds.y += 1;
    },
    (ids) => {
      ids.P.flowElements = ids.P.flowElements.filter((e) => e !== ids.C);
    },
    (ids) => {
      ids.A.extensionElements.values[0].flag = "wrong";
    },
    (ids) => {
      ids.Plane.planeElement.reverse();
    },
  ])
    await assert.rejects(assertOnlyAnchorDeletion(fixture, await edit(removed, corrupt), "F"));
  await assert.rejects(assertOnlyAnchorDeletion(fixture, fixture, "F"));
});
