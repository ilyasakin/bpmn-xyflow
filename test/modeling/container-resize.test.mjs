/** Registered local gestures and complete pinned resize services, not native certification. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { BpmnModdle } from "bpmn-moddle";
import { setupDOM } from "../helpers/dom.mjs";
import { assertOnlyAnchorGeometry } from "../helpers/anchor-model-guard.mjs";
import { assertLaneSpaceResult } from "../helpers/container-resize-oracle.mjs";
let dom,
  Local,
  Reference,
  planner,
  artifact = 0;
const bounds = (node) =>
  Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, node[key]]));
const xy = (points) => points.map(({ x, y }) => ({ x, y }));
before(async () => {
  dom = await setupDOM();
  globalThis.MouseEvent = window.MouseEvent;
  ({ default: Local } = await dom.loadModule("/lib/Modeler.js"));
  ({ default: Reference } = await dom.loadModule("/node_modules/bpmn-js/lib/Modeler.js"));
  planner = await dom.loadModule("/lib/modeling/ContainerResize.js");
});
after(async () => {
  delete globalThis.MouseEvent;
  await dom.cleanup();
});
async function input(name, vertical = false) {
  const xml = await readFile(`test/fixtures/scenarios/${name}.bpmn`, "utf8");
  if (!vertical) return xml;
  const oracle = new BpmnModdle(),
    parsed = await oracle.fromXML(xml);
  for (const diagram of parsed.rootElement.diagrams)
    for (const di of diagram.plane.planeElement || []) {
      if (di.bounds) {
        const b = di.bounds;
        Object.assign(b, { x: b.y, y: b.x, width: b.height, height: b.width });
      }
      if (di.waypoint)
        for (const point of di.waypoint) {
          const x = point.x;
          point.x = point.y;
          point.y = x;
        }
      if (["bpmn:Lane", "bpmn:Participant"].includes(di.bpmnElement.$type)) di.isHorizontal = false;
    }
  return (await oracle.toXML(parsed.rootElement, { format: true })).xml;
}
async function fixture(engine, xml) {
  const records = new WeakMap(),
    restores = [];
  if (engine === "local")
    for (const target of [window, window.SVGElement.prototype, window.HTMLElement.prototype]) {
      const add = target.addEventListener;
      target.addEventListener = function (type, callback, options) {
        const list = records.get(this) || [];
        list.push({ type, callback, options });
        records.set(this, list);
        return add.call(this, type, callback, options);
      };
      restores.push(() => {
        target.addEventListener = add;
      });
    }
  const m = new (engine === "local" ? Local : Reference)({
    container: dom.createContainer(),
    fitViewOnInit: false,
    snap: false,
    palette: false,
    editorActions: false,
    autoScroll: { scrollThresholdIn: [0, 0, 0, 0], scrollThresholdOut: [0, 0, 0, 0] },
  });
  await m.importXML(xml);
  if (engine === "upstream") m.get("gridSnapping").setActive(false);
  const element = (id) =>
    engine === "local" ? m.getElement(id) : m.get("elementRegistry").get(id);
  const nodes = () =>
    engine === "local"
      ? [...m.getGraph().nodes, ...m.getGraph().edges]
      : m.get("elementRegistry").getAll();
  const snapshot = () =>
    Object.fromEntries(
      nodes()
        .filter((e) => e.waypoints || Number.isFinite(e.width))
        .map((e) => [
          e.id,
          e.waypoints
            ? { points: xy(e.waypoints) }
            : { ...bounds(e), label: !!e.labelTarget, type: e.type },
        ]),
    );
  const save = async () =>
    engine === "local" ? m.getXML() : (await m.saveXML({ format: true })).xml;
  const call = (target, type, event, name) => {
    const matches = (records.get(target) || []).filter(
      (r) => r.type === type && (!name || r.callback.name === name),
    );
    assert.ok(matches.length, `${type}:${name}`);
    for (const r of matches) r.callback.call(target, event);
  };
  let start, control, direction, extra;
  const event = (type, point) =>
    new window.MouseEvent(type, {
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons: type === "mouseup" ? 0 : 1,
      bubbles: true,
      cancelable: true,
      view: window,
      ...extra,
    });
  return {
    m,
    element,
    nodes,
    snapshot,
    save,
    begin(id, dir, modifiers = {}) {
      direction = dir;
      extra = modifiers;
      const node = element(id);
      start = {
        x: node.x + (/w/.test(dir) ? 0 : /e/.test(dir) ? node.width : node.width / 2),
        y: node.y + (/n/.test(dir) ? 0 : /s/.test(dir) ? node.height : node.height / 2),
      };
      if (engine === "upstream") m.get("resize").activate(event("mousedown", start), node, dir);
      else {
        m.select(id);
        control = m.getContainer().querySelector(`[data-resize-dir="${direction}"]`);
        assert.ok(control);
        call(
          m.getSvg(),
          "mousedown",
          {
            ...start,
            clientX: start.x,
            clientY: start.y,
            target: control,
            button: 0,
            preventDefault() {},
            stopPropagation() {},
            ...extra,
          },
          "onMouseDown",
        );
      }
    },
    move(dx, dy) {
      const point = { x: start.x + dx, y: start.y + dy };
      if (engine === "upstream") m.get("dragging").move(event("mousemove", point));
      else
        call(
          window,
          "mousemove",
          { clientX: point.x, clientY: point.y, target: control, ...extra },
          "onMouseMove",
        );
      return point;
    },
    end(dx, dy) {
      const point = { x: start.x + dx, y: start.y + dy };
      if (engine === "upstream") m.get("dragging").end(event("mouseup", point));
      else
        call(
          window,
          "mouseup",
          { clientX: point.x, clientY: point.y, target: control, ...extra },
          "onMouseUp",
        );
    },
    cancel() {
      if (engine === "upstream") m.get("dragging").cancel();
      else m.cancel();
    },
    undo() {
      return engine === "local" ? m.undo() : m.get("commandStack").undo();
    },
    redo() {
      return engine === "local" ? m.redo() : m.get("commandStack").redo();
    },
    close() {
      m.destroy();
      restores.reverse().forEach((f) => f());
    },
  };
}
async function exported(xml) {
  const parsed = await new BpmnModdle().fromXML(xml);
  assert.deepEqual(parsed.warnings, []);
  if (process.env.BPMN_XML_ARTIFACT_DIR) {
    await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
    await writeFile(
      path.join(process.env.BPMN_XML_ARTIFACT_DIR, `container-resize-${++artifact}.bpmn`),
      xml,
    );
  }
  return parsed;
}
async function pair(name, id, dir, dx, dy, { ctrl = false, vertical = false } = {}) {
  const xml = await input(name, vertical),
    r = await fixture("upstream", xml),
    l = await fixture("local", xml);
  try {
    const beforeR = r.snapshot(),
      beforeL = l.snapshot(),
      beforeXML = await l.save(),
      beforeRXML = await r.save(),
      count = l.m.commandStack.size();
    const graph = l.m.getGraph(),
      all = [...graph.nodes, ...graph.edges, ...graph.roots],
      arrays = all.map((node) => [node, node.children, node.children?.slice(), node.parent]);
    const context = planner.containerResizeContext(l.element(id), dir, {
      balanced: !ctrl,
      elements: all,
    });
    assert.ok(context);
    for (const [node, array, values, parent] of arrays) {
      assert.equal(node.children, array);
      assert.deepEqual(node.children, values);
      assert.equal(node.parent, parent);
    }
    assert.equal(await l.save(), beforeXML, "pure planning leaves the whole document unchanged");
    r.begin(id, dir, { ctrlKey: ctrl });
    r.move(dx, dy);
    r.end(dx, dy);
    l.begin(id, dir, { ctrlKey: ctrl });
    l.move(dx, dy);
    l.end(dx, dy);
    const afterR = r.snapshot(),
      afterL = l.snapshot(),
      connectedRouteCorrections = [];
    for (const [shapeId, original] of Object.entries(beforeL)) {
      const expected = afterR[shapeId];
      assert.ok(expected, shapeId);
      if (original.points) {
        const edge = l.element(shapeId),
          sourceBefore = beforeL[edge.source.id],
          targetBefore = beforeL[edge.target.id];
        const sourceDelta = {
          x: edge.source.x - sourceBefore.x,
          y: edge.source.y - sourceBefore.y,
        };
        const targetDelta = {
          x: edge.target.x - targetBefore.x,
          y: edge.target.y - targetBefore.y,
        };
        if (
          ctrl &&
          (sourceDelta.x || sourceDelta.y) &&
          sourceDelta.x === targetDelta.x &&
          sourceDelta.y === targetDelta.y
        ) {
          // Pinned ResizeLaneHandler omits SpaceTool's start coordinate. Both
          // nodes move but its route stays behind. Preserve connected local DI.
          assert.deepEqual(
            expected.points,
            beforeR[shapeId].points,
            `measured pinned stale route ${shapeId}`,
          );
          assert.deepEqual(
            afterL[shapeId].points,
            original.points.map((p) => ({ x: p.x + sourceDelta.x, y: p.y + sourceDelta.y })),
            `connected modifier route ${shapeId}`,
          );
          connectedRouteCorrections.push(shapeId);
        } else if (JSON.stringify(expected.points) === JSON.stringify(beforeR[shapeId].points))
          assert.deepEqual(
            afterL[shapeId].points,
            original.points,
            `unaffected/internal route ${shapeId}`,
          );
        continue;
      }
      if (!original.label)
        assert.deepEqual(bounds(afterL[shapeId]), bounds(expected), `reference bounds ${shapeId}`);
      else
        for (const key of ["x", "y", "width", "height"])
          assert.ok(
            Math.abs(
              afterL[shapeId][key] - original[key] - (expected[key] - beforeR[shapeId][key]),
            ) < 1e-7,
            `reference label delta ${shapeId}.${key}`,
          );
    }
    const changed = Object.keys(beforeR).filter(
      (key) => JSON.stringify(beforeR[key]) !== JSON.stringify(afterR[key]),
    );
    const parsedBefore = await exported(beforeXML),
      shapeIds = changed.filter((key) => !beforeR[key].points && !beforeR[key].label),
      edgeIds = [
        ...new Set([...changed.filter((key) => beforeR[key].points), ...connectedRouteCorrections]),
      ];
    const labelIds = changed
      .filter((key) => beforeR[key].label)
      .map((key) => key.replace(/_label$/, ""))
      .filter((key) =>
        Object.values(parsedBefore.elementsById).some(
          (di) => di.$type === "bpmndi:BPMNShape" && di.bpmnElement?.id === key && di.label?.bounds,
        ),
      );
    const afterXML = await l.save(),
      parsedAfter = await exported(afterXML);
    for (const labelId of changed.filter((key) => beforeR[key].label)) {
      const owner = labelId.replace(/_label$/, ""),
        getDi = (p) =>
          Object.values(p.elementsById).find(
            (di) =>
              ["bpmndi:BPMNShape", "bpmndi:BPMNEdge"].includes(di.$type) &&
              di.bpmnElement?.id === owner,
          );
      const oldDi = getDi(parsedBefore),
        newDi = getDi(parsedAfter);
      if (!oldDi.label && newDi.label) {
        assert.deepEqual(
          bounds(newDi.label.bounds),
          bounds(afterL[labelId]),
          "new label DI stores the independently checked displayed bounds",
        );
        const label = new BpmnModdle().create("bpmndi:BPMNLabel");
        label.bounds = new BpmnModdle().create("dc:Bounds", bounds(afterL[labelId]));
        oldDi.label = label;
      }
    }
    const comparableBefore = (
      await new BpmnModdle().toXML(parsedBefore.rootElement, { format: true })
    ).xml;
    await assertOnlyAnchorGeometry(comparableBefore, afterXML, { shapeIds, edgeIds, labelIds });
    if (ctrl && id === "RequesterLane" && dir === "s" && !vertical) {
      const state = (engine, xml, snapshot) => ({
        engine,
        xml,
        nodes: Object.entries(snapshot).map(([id, n]) => ({ id, ...n })),
      });
      for (const [engine, first, last, firstXML, lastXML] of [
        ["local", beforeL, afterL, beforeXML, afterXML],
        ["upstream", beforeR, afterR, beforeRXML, await r.save()],
      ]) {
        const a = state(engine, firstXML, first),
          b = state(engine, lastXML, last);
        await assertLaneSpaceResult(a, b);
        const corrupted = structuredClone(b);
        corrupted.nodes.find((n) => n.id === "ReviewRequest").x++;
        await assert.rejects(assertLaneSpaceResult(a, corrupted), /displayed shape/);
        const changedXML = await new BpmnModdle().fromXML(b.xml);
        changedXML.elementsById.ReviewRequest.name = "unexpected mutation";
        await assert.rejects(
          assertLaneSpaceResult(a, {
            ...b,
            xml: (await new BpmnModdle().toXML(changedXML.rootElement, { format: true })).xml,
          }),
          /unrelated/,
        );
      }
      r.undo();
      await assertLaneSpaceResult(
        state("upstream", beforeRXML, beforeR),
        state("upstream", await r.save(), r.snapshot()),
        { undo: true },
      );
      r.redo();
    }
    assert.equal(l.m.commandStack.size(), count + 1);
    for (let cycle = 0; cycle < 3; cycle++) {
      l.undo();
      assert.equal(await l.save(), beforeXML);
      assert.deepEqual(l.snapshot(), beforeL);
      l.redo();
      assert.equal(await l.save(), afterXML);
    }
    if (ctrl && id === "RequesterLane" && dir === "s" && !vertical) {
      await l.m.importXML(afterXML);
      const reopened = await exported(await l.save()),
        saved = await exported(afterXML);
      const canonical = async (parsed) =>
        (await new BpmnModdle().toXML(parsed.rootElement, { format: true })).xml;
      assert.equal(
        await canonical(reopened),
        await canonical(saved),
        "modifier resize export reopens with the complete model unchanged",
      );
      assert.deepEqual(l.snapshot(), afterL, "modifier resize displayed geometry survives reopen");
    }
    return { l, r, beforeL, afterL };
  } finally {
    l.close();
    r.close();
  }
}
for (const dir of ["n", "e", "s", "w", "nw", "ne", "sw", "se"])
  test(`Transaction ${dir} expansion matches pinned descendant/attacher policy with exact local history`, async () => {
    await pair(
      "booking-timeout-compensation",
      "BookingTransaction",
      dir,
      dir.includes("w") ? -30 : dir.includes("e") ? 30 : 0,
      dir.includes("n") ? -30 : dir.includes("s") ? 30 : 0,
    );
  });
for (const [id, sample, dir, dx, dy, ctrl, vertical] of [
  ["Payment", "order-payment-delivery", "nw", -30, -30, false, false],
  ["Payment", "order-payment-delivery", "se", -500, -400, false, false],
  ["BookingTransaction", "booking-timeout-compensation", "se", -700, -500, false, false],
  ["SellerPool", "order-payment-delivery", "n", 0, -30, false, false],
  ["SellerPool", "order-payment-delivery", "w", -30, 0, false, false],
  ["SellerPool", "order-payment-delivery", "n", 0, -30, true, false],
  ["SellerPool", "order-payment-delivery", "w", -30, 0, true, false],
  ["SellerPool", "order-payment-delivery", "nw", -30, -30, false, false],
  ["SellerPool", "order-payment-delivery", "nw", -30, -30, true, false],
  ["RequesterLane", "approval-rejection-rework", "n", 0, -30, false, false],
  ["RequesterLane", "approval-rejection-rework", "s", 0, 30, false, false],
  ["RequesterLane", "approval-rejection-rework", "s", 0, 30, true, false],
  ["ReviewerLane", "approval-rejection-rework", "w", 700, 0, false, false],
  ["RequesterLane", "approval-rejection-rework", "e", 30, 0, false, true],
  ["RequesterLane", "approval-rejection-rework", "e", 30, 0, true, true],
])
  test(`${id} ${dir} ${ctrl ? "space" : "balanced"} ${vertical ? "vertical" : "horizontal"} resize matches complete reference services`, async () => {
    await pair(sample, id, dir, dx, dy, { ctrl, vertical });
  });

test("container preview cancellation/out-and-back remain exact, and ordinary Move still translates descendants", async () => {
  const h = await fixture("local", await input("booking-timeout-compensation"));
  try {
    const before = await h.save(),
      snapshot = h.snapshot(),
      count = h.m.commandStack.size(),
      node = h.element("BookingTransaction");
    for (const mode of ["cancel", "outback"]) {
      h.begin(node.id, "nw");
      h.move(-35, -25);
      assert.notDeepEqual(bounds(node), bounds(snapshot[node.id]));
      if (mode === "cancel") h.cancel();
      else h.move(0, 0);
      h.end(0, 0);
      assert.equal(await h.save(), before);
      assert.deepEqual(h.snapshot(), snapshot);
      assert.equal(h.m.commandStack.size(), count);
    }
    const child = h.element("ReserveFlight"),
      old = bounds(child);
    h.m.moveShape(node, { x: 25, y: 15 });
    assert.equal(child.x, old.x + 25);
    assert.equal(child.y, old.y + 15);
    h.undo();
    assert.equal(await h.save(), before);
  } finally {
    h.close();
  }
});

test("modifier lane routing refusal restores prior child/lane mutations and pending Redo atomically", async () => {
  const h = await fixture("local", await input("approval-rejection-rework"));
  try {
    const child = h.element("ReviewRequest"),
      edge = h.element("ReviewFlow");
    h.m.updateLabel(child, "Pending redo");
    h.undo();
    assert.equal(h.m.canRedo(), true);
    edge.waypoints[0].original = {
      x: NaN,
      y: edge.waypoints[0].y,
      custom: "invalid logical docking",
    };
    const before = await h.save(),
      snapshot = h.snapshot(),
      count = h.m.commandStack.size(),
      points = edge.waypoints.slice(),
      diPoints = edge.di.waypoint.slice();
    let y = child.y,
      sawMove = false;
    Object.defineProperty(child, "y", {
      configurable: true,
      enumerable: true,
      get: () => y,
      set: (value) => {
        if (value === snapshot.ReviewRequest.y + 30) sawMove = true;
        y = value;
      },
    });
    h.begin("RequesterLane", "s", { ctrlKey: true });
    h.move(0, 30);
    h.end(0, 30);
    assert.equal(sawMove, true, "child movement happened before routing refused");
    assert.equal(await h.save(), before);
    assert.deepEqual(h.snapshot(), snapshot);
    assert.equal(h.m.commandStack.size(), count);
    assert.equal(h.m.canRedo(), true);
    assert.deepEqual(edge.waypoints, points);
    assert.deepEqual(edge.di.waypoint, diPoints);
    for (let i = 0; i < points.length; i++) assert.equal(edge.di.waypoint[i], diPoints[i]);
    Object.defineProperty(child, "y", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: y,
    });
  } finally {
    h.close();
  }
});

test("modifier lane movement translates flow-owned manual Associations transitively in both endpoint directions", async () => {
  for (const reverse of [false, true])
    for (const noteY of [360, 250.1]) {
      const h = await fixture("local", await input("approval-rejection-rework"));
      try {
        const flow = h.element("DecisionFlow"),
          note = h.m.addShape(
            "bpmn:TextAnnotation",
            { x: 900, y: 360 },
            { text: "Retain manual route" },
          );
        if (noteY !== 360) {
          h.m.moveShape(note, { x: 0, y: noteY - note.y });
          assert.equal(note.y, noteY, "fractional setup remains exact");
        }
        const edge = h.m.connect(reverse ? note : flow, reverse ? flow : note);
        assert.ok(edge);
        const p = xy(edge.waypoints),
          manual = [p[0], { x: 720, y: p[0].y }, { x: 720, y: p.at(-1).y }, p.at(-1)];
        assert.ok(h.m.updateWaypoints(edge, manual));
        const note2 = h.m.addShape(
            "bpmn:TextAnnotation",
            { x: 1050, y: 400 },
            { text: "Dependent note" },
          ),
          child = h.m.connect(edge, note2);
        assert.ok(child);
        const points = [edge, child].map((e) => ({
          edge: e,
          points: structuredClone(e.waypoints),
          di: e.di.waypoint.slice(),
        }));
        const before = await h.save(),
          count = h.m.commandStack.size(),
          oldFlow = xy(flow.waypoints),
          oldNote = bounds(note);
        h.begin("RequesterLane", "s", { ctrlKey: true });
        h.move(0, 30);
        h.end(0, 30);
        const after = await h.save();
        await exported(after);
        assert.equal(h.m.commandStack.size(), count + 1);
        assert.deepEqual(
          xy(flow.waypoints),
          oldFlow.map((p) => ({ x: p.x, y: p.y + 30 })),
        );
        assert.equal(note.y, oldNote.y + 30);
        for (const value of points)
          assert.deepEqual(
            value.edge.waypoints,
            value.points.map((p) => ({
              ...p,
              y: p.y + 30,
              ...(p.original ? { original: { ...p.original, y: p.original.y + 30 } } : {}),
            })),
            "manual interiors and logical endpoint metadata translate together",
          );
        for (let i = 0; i < 3; i++) {
          h.undo();
          assert.equal(await h.save(), before);
          for (const value of points) {
            assert.deepEqual(value.edge.waypoints, value.points);
            value.di.forEach((point, j) => assert.equal(value.edge.di.waypoint[j], point));
          }
          h.redo();
          assert.equal(await h.save(), after);
        }
      } finally {
        h.close();
      }
    }
});

test("container resize pure helper provenance matches the exact pinned source and retained license", async () => {
  const provenance = JSON.parse(await readFile("lib/upstream/PROVENANCE.json", "utf8"));
  for (const target of ["modeling/behavior/ResizeBehavior.js", "modeling/util/LaneUtil.js"]) {
    const entry = provenance.additionalSources[target],
      actual = await readFile(`lib/upstream/${target}`),
      reference = await readFile(`node_modules/bpmn-js/${entry.source}`);
    assert.deepEqual(actual, reference);
    assert.equal(createHash("sha256").update(actual).digest("hex"), entry.sha256);
  }
  assert.deepEqual(
    await readFile("lib/upstream/LICENSE"),
    await readFile("node_modules/bpmn-js/LICENSE"),
  );
});
