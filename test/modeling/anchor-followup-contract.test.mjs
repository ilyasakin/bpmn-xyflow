import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { CdpKeyboard, CdpMouse, CdpPage } from "puppeteer";
import { createHash } from "node:crypto";
import { createAnchorHarness } from "../helpers/anchor-ux-browser.mjs";
import { withAnchorDeadline, selectAnchorCases } from "../helpers/anchor-case-deadline.mjs";
import {
  assertMessageConversion,
  assertCreatedConnection,
  assertDataChange,
  assertDeletedClosure,
  parseExport,
  canonicalExport,
} from "../helpers/anchor-followup-model.mjs";
import { anchorEditCases } from "./anchor-followup-edits.mjs";
import { anchorInterruptionCases } from "./anchor-followup-interruptions.mjs";
import { anchorInstanceCases } from "./anchor-followup-instances.mjs";
import {
  beginFollowupEvidence,
  saveFollowupEvidence,
} from "../helpers/anchor-followup-controls.mjs";
import { registeredAnchorFollowups } from "./browser-anchor-followup.mjs";
const digest = (text) => createHash("sha256").update(text).digest("hex");

test("the shared extraction preserves the current d462 green39 helpers byte-for-byte", async () => {
  const source = await readFile(
    new URL("../helpers/anchor-ux-browser.mjs", import.meta.url),
    "utf8",
  );
  const body = source.slice(
    source.indexOf("const xy ="),
    source.indexOf("\nasync function start()"),
  );
  assert.equal(digest(body), "c18a6ca91f6514b9fed118d829ca5c1ebc1c04cfce16427dc3c02240da14d45d");
  const h = createAnchorHarness({ port: 5254, output: "test-artifacts/anchor-followup" });
  for (const key of ["state", "raw", "sourcePort", "drag", "history", "run", "start", "stop"])
    assert.equal(typeof h[key], "function");
  assert.deepEqual(h.results, []);
});
// Published 1d3fe967 added stronger tangent-acquisition checks to ownership24.
// Preserve those exact accepted bytes when adding this separate workflow suite.
test("the green39 and ownership24 runners remain byte-identical while follow-ups are added", async () => {
  for (const [file, hash] of [
    ["browser-anchor-ux.mjs", "d72578ae9c9900367734faaba7ad73ea40bec1df274197d3dde4996ff54a7c23"],
    [
      "browser-anchor-ownership.mjs",
      "b41e2b2d457a5ca2ed502c0d2025b82eb7a2fe9198195cb1d1afbbf568ba30b6",
    ],
  ])
    assert.equal(digest(await readFile(new URL(file, import.meta.url), "utf8")), hash);
});

test("case timeouts terminate their page while completed/failed actions retain their own outcomes", async () => {
  const events = [],
    page = {
      async close() {
        events.push("closed");
      },
    };
  assert.equal(await withAnchorDeadline(page, async () => "done", { milliseconds: 20 }), "done");
  await assert.rejects(
    withAnchorDeadline(
      page,
      async () => {
        throw new Error("actual assertion");
      },
      { milliseconds: 20 },
    ),
    /actual assertion/,
  );
  assert.deepEqual(events, []);
  await assert.rejects(
    withAnchorDeadline(page, () => new Promise(() => {}), {
      milliseconds: 5,
      onTimeout: async () => {
        events.push("evidence");
      },
    }),
    /exceeded 5ms/,
  );
  assert.deepEqual(events, ["evidence", "closed"]);
  assert.equal(
    await withAnchorDeadline(page, async () => "next isolated case", { milliseconds: 20 }),
    "next isolated case",
  );
});

test("timeout stays terminal when the action succeeds during evidence capture or page close", async () => {
  for (const lateSuccessPhase of ["capture", "close"]) {
    const events = [];
    const action = Promise.withResolvers(),
      capture = Promise.withResolvers(),
      close = Promise.withResolvers();
    const captureStarted = Promise.withResolvers(),
      closeStarted = Promise.withResolvers();
    const workflow = withAnchorDeadline(
      {
        async close() {
          events.push("close-start");
          if (lateSuccessPhase === "close") action.resolve("late success");
          closeStarted.resolve();
          await close.promise;
          events.push("close-end");
        },
      },
      () => action.promise,
      {
        milliseconds: 5,
        cleanupMilliseconds: 1000,
        onTimeout: async () => {
          events.push("capture-start");
          if (lateSuccessPhase === "capture") action.resolve("late success");
          captureStarted.resolve();
          await capture.promise;
          events.push("capture-end");
        },
      },
    );
    const outcome = workflow.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await captureStarted.promise;
    await new Promise((resolve) => setImmediate(resolve));
    const settledDuringCapture = settled;
    capture.resolve();
    await closeStarted.promise;
    await new Promise((resolve) => setImmediate(resolve));
    const settledDuringClose = settled;
    close.resolve();
    const result = await outcome;
    assert.match(
      result.error?.message ?? `Unexpected success: ${result.value}`,
      /exceeded 5ms/,
      lateSuccessPhase,
    );
    assert.equal(settledDuringCapture, false, "wait for bounded evidence capture");
    assert.equal(settledDuringClose, false, "wait for bounded owned-page close");
    assert.deepEqual(events, ["capture-start", "capture-end", "close-start", "close-end"]);
  }
});

test("timeout cleanup remains bounded even when evidence capture and page close never settle", async () => {
  const events = [];
  await assert.rejects(
    withAnchorDeadline(
      {
        close() {
          events.push("close");
          return new Promise(() => {});
        },
      },
      () => new Promise(() => {}),
      {
        milliseconds: 5,
        cleanupMilliseconds: 5,
        onTimeout() {
          events.push("capture");
          return new Promise(() => {});
        },
      },
    ),
    /exceeded 5ms/,
  );
  assert.deepEqual(events, ["capture", "close"]);
});

test("case selection is explicit, rejects duplicates/empty filters and preserves every Batch A/C workflow", () => {
  const cases = [
    ...anchorEditCases.map((c) => ({ ...c, batch: "a" })),
    ...anchorInterruptionCases.map((c) => ({ ...c, batch: "c" })),
    ...anchorInstanceCases.map((c) => ({ ...c, batch: "c" })),
  ];
  assert.deepEqual([...new Set(cases.filter((c) => c.batch === "a").map((c) => c.id))].sort(), [
    "F17-D",
    "F17-M",
    "F18-B",
    "F18-S",
    "F21-E",
    "F21-N",
    "F22",
    "F25",
  ]);
  assert.deepEqual(
    cases.filter((c) => c.batch === "c").map((c) => c.id),
    ["F26-O", "F26-R", "F27", "F28"],
  );
  assert.equal(selectAnchorCases(cases).length, 16);
  assert.equal(selectAnchorCases(cases, { batch: "a", id: "F17-M", engine: "upstream" }).length, 1);
  assert.throws(() => selectAnchorCases(cases, { id: "mistyped-id" }), /No native cases/);
  assert.throws(() => selectAnchorCases([cases[0], cases[0]]), /unique/);
  for (const c of cases) {
    assert.equal(typeof c.run, "function");
    assert.ok(c.sample);
  }
});

test("the complete manifest retains all 22 workflows with isolated unique native variants", async () => {
  const cases = await registeredAnchorFollowups();
  assert.equal(selectAnchorCases(cases).length, 62);
  assert.deepEqual([...new Set(cases.map((c) => c.id))].sort(), [
    "F02-03",
    "F05",
    "F09",
    "F10",
    "F11",
    "F12",
    "F15-16",
    "F17-D",
    "F17-M",
    "F18-B",
    "F18-S",
    "F21-E",
    "F21-N",
    "F22",
    "F23-B",
    "F23-T",
    "F25",
    "F26-O",
    "F26-R",
    "F27",
    "F28",
    "F29",
  ]);
  for (const batch of ["a", "b", "c"]) assert.ok(selectAnchorCases(cases, { batch }).length);
});

test("batch/engine jobs are disjoint and collectively retain all62 native variants", async () => {
  const all = await registeredAnchorFollowups(),
    counts = { "a-local": 11, "a-upstream": 1, "b-local": 25, "b-upstream": 21, "c-local": 4 },
    keys = [];
  for (const [job, count] of Object.entries(counts)) {
    const [batch, engine] = job.split("-"),
      cases = selectAnchorCases(all, { batch, engine });
    assert.equal(cases.length, count, job);
    keys.push(...cases.map((c) => `${c.id}-${c.engine}-${c.name}`));
  }
  assert.equal(keys.length, 62);
  assert.equal(new Set(keys).size, 62);
});

test("mutation artifacts are isolated by native case and retained before subsequent failures", async () => {
  const a = {},
    b = {},
    calls = [],
    h = {
      async save(page, name, details) {
        calls.push({ page, name, details });
      },
    };
  beginFollowupEvidence(a, "A");
  beginFollowupEvidence(b, "B");
  await saveFollowupEvidence(h, a, "before", { id: "edgeA" });
  await saveFollowupEvidence(h, b, "before", { id: "edgeB" });
  await saveFollowupEvidence(h, a, "preview", { visible: true });
  assert.deepEqual(
    calls.map((c) => c.name),
    ["A-step-1-before", "B-step-1-before", "A-step-2-preview"],
  );
  assert.equal(calls[0].page, a);
  assert.equal(calls[1].page, b);
});

test("new native follow-up modules use installed Puppeteer input and page methods", async () => {
  for (const file of [
    "anchor-followup-edits.mjs",
    "anchor-followup-interruptions.mjs",
    "anchor-followup-instances.mjs",
    "anchor-followup-shapes.mjs",
    "../helpers/anchor-followup-controls.mjs",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    for (const [, input, method] of source.matchAll(/\b(keyboard|mouse)\.(\w+)\s*\(/g))
      assert.equal(
        typeof (input === "mouse" ? CdpMouse : CdpKeyboard).prototype[method],
        "function",
        `${file} ${input}.${method}`,
      );
    for (const [, method] of source.matchAll(/\bpage\.(\$\$eval|\$eval|\$\$|\$|[A-Za-z]\w*)\s*\(/g))
      assert.equal(typeof CdpPage.prototype[method], "function", `${file} page.${method}`);
  }
});

const ns =
  'xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bd="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:v="urn:guard" targetNamespace="urn:guard"';
const drawing = (id, bo) =>
  `<bd:BPMNEdge id="${id}" bpmnElement="${bo}"><di:waypoint x="100" y="100"/><di:waypoint x="200" y="100"/></bd:BPMNEdge>`;
const messageFixture = (converted) =>
  `<b:definitions ${ns}><b:process id="P"><b:task id="A" name="source" v:keep="yes">${converted ? "<b:outgoing>F</b:outgoing>" : ""}</b:task><b:task id="B">${converted ? "<b:incoming>F</b:incoming>" : ""}</b:task>${converted ? '<b:sequenceFlow id="F" name="Message" sourceRef="A" targetRef="B"/>' : ""}</b:process><b:process id="Q"><b:task id="C"/></b:process><b:collaboration id="Collab"><b:participant id="PoolP" processRef="P"/><b:participant id="PoolQ" processRef="Q"/>${converted ? "" : '<b:messageFlow id="F" name="Message" sourceRef="A" targetRef="C"/>'}</b:collaboration><bd:BPMNDiagram id="Diagram"><bd:BPMNPlane id="Plane" bpmnElement="Collab">${drawing("F_di", "F")}</bd:BPMNPlane></bd:BPMNDiagram></b:definitions>`;
async function mutate(xml, edit) {
  const p = await parseExport(xml);
  edit(p.elementsById, p.rootElement);
  return canonicalExport(p.rootElement);
}
test("conversion guard detects unrelated semantic/reference/DI/extension corruption", async () => {
  const before = messageFixture(false),
    after = messageFixture(true);
  await assertMessageConversion(before, after, "F", "B");
  for (const edit of [
    (ids) => {
      ids.A.name = "wrong";
    },
    (ids) => {
      ids.F.sourceRef = ids.C;
    },
    (ids) => {
      ids.F_di.id = "wrong";
    },
    (ids) => {
      ids.A.$attrs["v:keep"] = "lost";
    },
  ]) {
    await assert.rejects(assertMessageConversion(before, await mutate(after, edit), "F", "B"));
  }
});
const dataFixture = (mode = "none") => {
  const owner = mode === "owner" ? "B" : "A",
    data = mode === "source" || mode === "owner" ? "D2" : "D1",
    property = mode === "owner" ? "NewProperty" : "Property";
  const io =
    mode === "none"
      ? ""
      : `<b:property id="${property}" name="__targetRef_placeholder"/><b:dataInputAssociation id="F"><b:sourceRef>${data}</b:sourceRef><b:targetRef>${property}</b:targetRef></b:dataInputAssociation>`;
  return `<b:definitions ${ns}><b:process id="P"><b:task id="A" name="source" v:keep="yes">${owner === "A" ? io : ""}</b:task><b:task id="B">${owner === "B" ? io : ""}</b:task><b:dataObjectReference id="D1"/><b:dataObjectReference id="D2"/></b:process><bd:BPMNDiagram id="Diagram"><bd:BPMNPlane id="Plane" bpmnElement="P">${mode === "none" ? "" : drawing("F_di", "F")}</bd:BPMNPlane></bd:BPMNDiagram></b:definitions>`;
};
test("creation semantics reject wrong type, endpoints, source-array contents and owning activity", async () => {
  const parsed = await parseExport(dataFixture("create")),
    edge = {
      id: "F",
      type: "bpmn:DataInputAssociation",
      source: null,
      sourceIds: ["D1"],
      target: "Property",
      owner: "A",
      associationCollection: "dataInputAssociations",
    };
  assertCreatedConnection({ parsed }, edge, "D1", "A", "bpmn:DataInputAssociation");
  for (const patch of [
    { type: "bpmn:SequenceFlow" },
    { sourceIds: ["D2"] },
    { sourceIds: ["D1", "D2"] },
    { source: "D1" },
    { target: "Other" },
    { owner: "B" },
    { associationCollection: "dataOutputAssociations" },
  ])
    assert.throws(() =>
      assertCreatedConnection(
        { parsed },
        { ...edge, ...patch },
        "D1",
        "A",
        "bpmn:DataInputAssociation",
      ),
    );
  const sequence = {
    id: "S",
    type: "bpmn:SequenceFlow",
    source: "A",
    sourceIds: ["A"],
    target: "B",
  };
  assertCreatedConnection({}, sequence, "A", "B");
  for (const patch of [
    { type: "bpmn:MessageFlow" },
    { source: "B" },
    { sourceIds: ["B"] },
    { target: "A" },
  ])
    assert.throws(() => assertCreatedConnection({}, { ...sequence, ...patch }, "A", "B"));
});

test("data guard distinguishes full source arrays, owner bindings and fresh placeholder cleanup", async () => {
  await assertDataChange(dataFixture(), dataFixture("create"), "F", {
    mode: "create",
    dataId: "D1",
    ownerId: "A",
  });
  await assertDataChange(dataFixture("create"), dataFixture("source"), "F", {
    mode: "source",
    dataId: "D2",
    ownerId: "A",
  });
  await assertDataChange(dataFixture("source"), dataFixture("owner"), "F", {
    mode: "owner",
    dataId: "D2",
    ownerId: "B",
  });
  for (const edit of [
    (ids) => {
      ids.F.sourceRef.push(ids.D1);
    },
    (ids) => {
      ids.NewProperty.name = "wrong";
    },
    (ids) => {
      ids.A.$attrs["v:keep"] = "lost";
    },
    (ids) => {
      ids.B.name = "unrelated change";
    },
  ]) {
    await assert.rejects(
      assertDataChange(dataFixture("source"), await mutate(dataFixture("owner"), edit), "F", {
        mode: "owner",
        dataId: "D2",
        ownerId: "B",
      }),
    );
  }
});
test("node deletion guard removes only the named incident closure and its default/lane refs", async () => {
  const before = await readFile(
    new URL("../fixtures/scenarios/approval-rejection-rework.bpmn", import.meta.url),
    "utf8",
  );
  const idsToRemove = ["ReworkRequest", "RejectFlow", "ReworkFlow"];
  const after = await mutate(before, (ids, root) => {
    ids.ApprovalProcess.flowElements = ids.ApprovalProcess.flowElements.filter(
      (e) => !idsToRemove.includes(e.id),
    );
    delete ids.ApprovalDecision.default;
    ids.ApprovalDecision.outgoing = ids.ApprovalDecision.outgoing.filter(
      (e) => e.id !== "RejectFlow",
    );
    ids.ReviewRequest.incoming = ids.ReviewRequest.incoming.filter((e) => e.id !== "ReworkFlow");
    ids.RequesterLane.flowNodeRef = ids.RequesterLane.flowNodeRef.filter(
      (e) => e.id !== "ReworkRequest",
    );
    root.diagrams[0].plane.planeElement = root.diagrams[0].plane.planeElement.filter(
      (e) => !idsToRemove.includes(e.bpmnElement.id),
    );
  });
  await assertDeletedClosure(before, after, idsToRemove);
  await assert.rejects(
    assertDeletedClosure(
      before,
      await mutate(after, (ids) => {
        ids.ApproveFlow.name = "lost label";
      }),
      idsToRemove,
    ),
  );
});
