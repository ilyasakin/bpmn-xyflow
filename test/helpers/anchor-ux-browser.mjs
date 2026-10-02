/** Exact shared block from reviewed d462c8c9 native39; guarded against divergence. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import puppeteer from "puppeteer";
import { BpmnModdle } from "bpmn-moddle";
import {
  assertSourcePortApproach,
  referenceTaskTopConnectExpectation,
} from "../helpers/anchor-native-oracles.mjs";
import {
  nativeWheelStepBudget,
  collectReferenceClickTrapCount,
} from "../helpers/anchor-setup-policy.mjs";
const require = createRequire(import.meta.url);
assert.equal(require("bpmn-js/package.json").version, "18.30.1");

export function createAnchorHarness({ port, output, serverEntry = "lib/demo/serve.mjs" }) {
assert.ok(["lib/demo/serve.mjs", "test/helpers/boundary-diagnostic-server.mjs"].includes(serverEntry), "known owned test server entry");
const base = `http://localhost:${port}`, oracle = new BpmnModdle(), results = [];
let server, browser, serverOutput = "";
const refURL = `${base}/@fs/${path.resolve("test/anchor-ux/reference.html")}`;
const xy = (p) => ({ x: p.x, y: p.y });
const near = (a, b, epsilon, message) =>
  assert.ok(
    a && b && Math.hypot(a.x - b.x, a.y - b.y) <= epsilon,
    `${message}: ${JSON.stringify({ actual: a, expected: b, epsilon })}`,
  );
const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function raw(page) {
  return page.evaluate(async () => {
    const reference = !!window.referenceModeler,
      m = window.referenceModeler || window.modeler,
      container = document.querySelector("#viewer");
    const graph = reference ? null : m.getGraph(),
      canvas = reference ? m.get("canvas") : null,
      v = reference ? canvas.viewbox() : m.getViewport();
    const nodes = reference
      ? m.get("elementRegistry").getAll()
      : [...graph.nodes, ...graph.edges, ...graph.roots];
    return {
      engine: reference ? "upstream" : "local",
      xml: reference ? (await m.saveXML({ format: true })).xml : await m.getXML(),
      selection: reference
        ? m
            .get("selection")
            .get()
            .map((e) => e.id)
        : m.getSelection(),
      history: reference
        ? { undo: m.get("commandStack").canUndo(), redo: m.get("commandStack").canRedo() }
        : { size: m.commandStack.size(), undo: m.canUndo(), redo: m.canRedo() },
      viewport: reference ? { x: -v.x * v.scale, y: -v.y * v.scale, zoom: v.scale } : v,
      container: (() => {
        const r = container.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })(),
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type || n.businessObject?.$type,
        name: n.businessObject?.name,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        hidden: !!n.hidden,
        label: !!n.labelTarget || n.type === "label",
        points: n.waypoints?.map((p) => ({ x: p.x, y: p.y })),
      })),
      input: (window.anchorInput || []).slice(-80),
      status: document.querySelector("#status")?.textContent,
    };
  });
}
async function state(page) {
  const s = await raw(page),
    p = await oracle.fromXML(s.xml);
  assert.deepEqual(p.warnings, [], "independent exported BPMN resolves without warnings");
  const di = p.rootElement.diagrams.flatMap((d) => d.plane.planeElement || []);
  return {
    ...s,
    parsed: p,
    canonical: (await oracle.toXML(p.rootElement, { format: true })).xml,
    edges: Object.fromEntries(
      di
        .filter((d) => d.waypoint)
        .map((d) => [
          d.bpmnElement.id,
          {
            id: d.bpmnElement.id,
            type: d.bpmnElement.$type,
            source: Array.isArray(d.bpmnElement.sourceRef) ? null : d.bpmnElement.sourceRef?.id,
            sourceIds: (Array.isArray(d.bpmnElement.sourceRef)
              ? d.bpmnElement.sourceRef
              : [d.bpmnElement.sourceRef]
            )
              .filter(Boolean)
              .map((ref) => ref.id),
            target: d.bpmnElement.targetRef?.id,
            owner: d.bpmnElement.$parent?.id,
            ownerType: d.bpmnElement.$parent?.$type,
            associationCollection:
              ["dataInputAssociations", "dataOutputAssociations"].find((key) =>
                d.bpmnElement.$parent?.[key]?.includes(d.bpmnElement),
              ) || null,
            points: d.waypoint.map(xy),
          },
        ]),
    ),
  };
}
const serial = (s) => {
  const { parsed: _parsed, ...other } = s;
  return other;
};
const node = (s, id) => {
  const n = s.nodes.find((n) => n.id === id);
  assert.ok(n, `visible ${id}`);
  return n;
};
const screen = (s, p) => ({
  x: s.container.x + s.viewport.x + p.x * s.viewport.zoom,
  y: s.container.y + s.viewport.y + p.y * s.viewport.zoom,
});
const graph = (s, p) => ({
  x: (p.x - s.container.x - s.viewport.x) / s.viewport.zoom,
  y: (p.y - s.container.y - s.viewport.y) / s.viewport.zoom,
});
function side(n, which, f = 0.5) {
  const cx = n.x + n.width / 2,
    cy = n.y + n.height / 2,
    vertical = which === "left" || which === "right",
    offset = (f - 0.5) * 2,
    sign = which === "left" || which === "top" ? -1 : 1;
  if (n.type.endsWith("Event")) {
    const r = n.width / 2,
      d = r * offset,
      k = Math.sqrt(Math.max(0, r * r - d * d));
    return vertical ? { x: cx + sign * k, y: cy + d } : { x: cx + d, y: cy + sign * k };
  }
  if (n.type.endsWith("Gateway"))
    return vertical
      ? { x: cx + ((sign * n.width) / 2) * (1 - Math.abs(offset)), y: cy + (n.height / 2) * offset }
      : {
          x: cx + (n.width / 2) * offset,
          y: cy + ((sign * n.height) / 2) * (1 - Math.abs(offset)),
        };
  return which === "left"
    ? { x: n.x, y: n.y + n.height * f }
    : which === "right"
      ? { x: n.x + n.width, y: n.y + n.height * f }
      : which === "top"
        ? { x: n.x + n.width * f, y: n.y }
        : { x: n.x + n.width * f, y: n.y + n.height };
}

async function hit(page, p) {
  return page.evaluate((p) => {
    const e = document.elementFromPoint(p.x, p.y),
      r = document.querySelector("#viewer").getBoundingClientRect();
    return {
      id: e?.closest("[data-element-id]")?.getAttribute("data-element-id"),
      owners: [
        ...new Set(
          document
            .elementsFromPoint(p.x, p.y)
            .map((element) => element.closest("[data-element-id]")?.getAttribute("data-element-id"))
            .filter(Boolean),
        ),
      ],
      class: e?.getAttribute("class"),
      tag: e?.tagName,
      inside:
        p.x >= r.left &&
        p.x < Math.min(r.right, innerWidth) &&
        p.y >= r.top &&
        p.y < Math.min(r.bottom, innerHeight),
    };
  }, p);
}
async function clickButton(page, selector) {
  const h = await page.waitForSelector(selector, { visible: true }),
    b = await h.boundingBox();
  assert.ok(b);
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  assert.equal(
    await h.evaluate((e, p) => e.contains(document.elementFromPoint(p.x, p.y)), p),
    true,
    `actual button hit ${selector}`,
  );
  await page.mouse.click(p.x, p.y);
  await settle(page);
}
async function chooseSample(page, label) {
  const option = await page.$eval(
    "#sample-select",
    (e, label) => [...e.options].findIndex((o) => o.textContent === label),
    label,
  );
  assert.ok(option >= 0, `visible sample ${label}`);
  await clickButton(page, "#sample-select");
  await page.keyboard.press("Home");
  for (let i = 0; i < option; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const value = document.querySelector("#status")?.textContent || "";
    return value.startsWith("Loaded ") || value.startsWith("Error:");
  });
  assert.equal(
    await page.$eval("#status", (e) => e.textContent),
    `Loaded ${label} (0 warnings)`,
    "selected sample finishes with its exact zero-warning outcome",
  );
  await settle(page);
}
async function open(engine, sample = "Empty diagram") {
  const page = await browser.newPage(),
    errors = [];
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.setViewport({ width: 1800, height: 1200 });
    await page.evaluateOnNewDocument(() => {
      window.anchorInput = [];
      for (const type of [
        "mousedown",
        "mousemove",
        "mouseup",
        "click",
        "dragstart",
        "keydown",
        "keyup",
        "wheel",
      ])
        window.addEventListener(
          type,
          (event) => {
            const matrix = ["mousemove", "mouseup"].includes(event.type)
              ? document
                  .querySelector("#viewer .bpmn-xyflow-viewport, #viewer .viewport")
                  ?.getScreenCTM()
              : null;
            const delivered = matrix
              ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
              : null;
            window.anchorInput.push({
              type,
              trusted: event.isTrusted,
              x: event.clientX,
              y: event.clientY,
              key: event.key,
              button: event.button,
              control: event.ctrlKey,
              shift: event.shiftKey,
              deltaY: event.deltaY,
              deltaMode: event.deltaMode,
              graphPoint: delivered ? { x: delivered.x, y: delivered.y } : null,
              screenMatrix: matrix
                ? { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }
                : null,
              target: event.target instanceof Element ? event.target.getAttribute("class") : null,
            });
            if (window.anchorInput.length > 300) window.anchorInput.shift();
          },
          { capture: true, passive: true },
        );
    });
    await page.goto(engine === "local" ? `${base}/modeler/` : refURL, {
      waitUntil: "networkidle0",
    });
    await page.waitForFunction(() => {
      const value = document.querySelector("#status")?.textContent || "";
      return value.startsWith("Loaded ") || value.startsWith("Error:");
    });
    assert.equal(
      await page.$eval("#status", (e) => e.textContent),
      "Loaded Empty diagram (0 warnings)",
    );
    if (sample !== "Empty diagram") await chooseSample(page, sample);
    return { page, engine, errors };
  } catch (error) {
    await page.close();
    throw error;
  }
}
async function blank(page, { click = false } = {}) {
  const p = await page.evaluate(() => {
    const root = document.querySelector("#viewer"),
      r = root.getBoundingClientRect(),
      m = window.referenceModeler || window.modeler;
    const ids = new Set(
      window.referenceModeler
        ? [m.get("canvas").getRootElement().id]
        : m.getGraph().roots.map((r) => r.id),
    );
    for (const y of [0.85, 0.7, 0.5, 0.3, 0.15])
      for (const x of [0.85, 0.7, 0.5, 0.3, 0.15]) {
        const p = { x: r.left + r.width * x, y: r.top + r.height * y },
          e = document.elementFromPoint(p.x, p.y),
          id = e?.closest("[data-element-id]")?.getAttribute("data-element-id");
        if (
          root.contains(e) &&
          (!id || ids.has(id)) &&
          !e.closest(
            "button,input,select,.bpmn-xyflow-minimap,.djs-palette,.djs-context-pad,.bpmn-xyflow-palette,.bpmn-xyflow-context-pad",
          )
        )
          return p;
      }
    throw new Error("No visible unobstructed canvas background");
  });
  if (click) {
    const before = await raw(page);
    const budget =
      before.engine === "upstream" ? (await page.evaluate(collectReferenceClickTrapCount)) + 1 : 1;
    for (let attempt = 0; attempt < budget; attempt++) {
      const count = await page.evaluate(() => window.anchorReferenceClicks?.length || 0);
      const pending =
        before.engine === "upstream" ? await page.evaluate(collectReferenceClickTrapCount) : 0;
      await page.mouse.click(p.x, p.y);
      await settle(page);
      const current = await raw(page);
      assert.equal(current.xml, before.xml, "background setup changes no model");
      assert.deepEqual(current.history, before.history, "background setup changes no history");
      if (!current.selection.length) break;
      assert.equal(
        before.engine,
        "upstream",
        "only observed reference traps permit another blank click",
      );
      const trace = await page.evaluate(
        (count) => window.anchorReferenceClicks.slice(count),
        count,
      );
      assert.equal(trace.length, 1);
      assert.equal(trace[0].trusted, true);
      assert.equal(trace[0].trap, true);
      assert.equal(trace[0].afterTrap, false);
      assert.ok(pending > 0, "the exact named one-shot trap existed before this click");
      assert.ok(
        (await page.evaluate(collectReferenceClickTrapCount)) < pending,
        "a trapped click consumes at least one pending trap",
      );
      assert.deepEqual(
        current.selection,
        before.selection,
        "trapped click leaves selection intact",
      );
    }
    assert.deepEqual((await raw(page)).selection, [], "real background click deselects");
  } else await page.mouse.move(p.x, p.y);
  return p;
}
async function selectNode(page, id) {
  const selected = await raw(page);
  if (selected.selection.length === 1 && selected.selection[0] === id) return;
  const s = await raw(page),
    n = node(s, id),
    p = screen(s, { x: n.x + n.width / 2, y: n.y + n.height / 2 });
  assert.equal((await hit(page, p)).id, id);
  await page.mouse.click(p.x, p.y);
  await settle(page);
  assert.deepEqual((await raw(page)).selection, [id]);
}
async function zoom(page, wanted) {
  const before = await state(page);
  const steps = [],
    budget = nativeWheelStepBudget(before.viewport.zoom, wanted);
  for (let n = 0; n < budget; n++) {
    const s = await raw(page);
    steps.push(s.viewport.zoom);
    if (Math.abs(Math.log(s.viewport.zoom / wanted)) < 0.12) break;
    const p = await blank(page);
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down("Control");
    try {
      await page.mouse.wheel({ deltaY: s.viewport.zoom > wanted ? 60 : -60 });
    } finally {
      await page.keyboard.up("Control");
    }
    await settle(page);
  }
  const after = await state(page);
  assert.ok(
    Math.abs(Math.log(after.viewport.zoom / wanted)) < 0.12,
    `native wheel reaches requested zoom range: ${JSON.stringify({ wanted, actual: after.viewport.zoom, steps, budget })}`,
  );
  assert.equal(after.xml, before.xml);
  assert.deepEqual(after.history, before.history);
}
async function pan(page) {
  const before = await state(page),
    p = await blank(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: "middle" });
  try {
    await page.mouse.move(p.x - 70, p.y + 35, { steps: 8 });
  } finally {
    await page.mouse.up({ button: "middle" });
  }
  await settle(page);
  const after = await state(page);
  assert.notDeepEqual(
    after.viewport,
    before.viewport,
    "native background pan actually moves camera",
  );
  assert.equal(after.xml, before.xml);
  assert.deepEqual(after.history, before.history);
}
async function palette(page, label, position) {
  const before = await state(page),
    reference = before.engine === "upstream";
  let h;
  if (reference) {
    const actions = {
      Task: "create.task",
      Start: "create.start-event",
      End: "create.end-event",
      Gateway: "create.exclusive-gateway",
      Subprocess: "create.subprocess-expanded",
    };
    h = await page.waitForSelector(`.djs-palette [data-action="${actions[label]}"]`, {
      visible: true,
    });
  } else {
    h = await page.evaluateHandle(
      (label) =>
        [...document.querySelectorAll(".bpmn-xyflow-palette button")].find(
          (e) => e.textContent === `+ ${label}`,
        ),
      label,
    );
    h = h.asElement();
    assert.ok(h, `visible palette ${label}`);
  }
  const b = await h.boundingBox(),
    start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  assert.equal(
    await h.evaluate((e, p) => e.contains(document.elementFromPoint(p.x, p.y)), start),
    true,
  );
  if (reference) {
    await page.mouse.click(start.x, start.y);
    await page.mouse.move(position.x, position.y, { steps: 10 });
    await page.mouse.click(position.x, position.y);
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(position.x, position.y, { steps: 10 });
    await page.mouse.up();
  }
  await settle(page);
  const after = await state(page),
    added = after.nodes.filter(
      (n) => !n.label && !n.points && !before.nodes.some((old) => old.id === n.id),
    );
  assert.equal(added.length, 1, `native ${label} palette creates one shape`);
  return added[0].id;
}
async function tasks(
  page,
  placement = "right",
  scale = 1,
  { sourceLabel = "Task", targetLabel = "Task" } = {},
) {
  const first = await state(page),
    start = first.nodes.find((n) => n.type === "bpmn:StartEvent");
  if (start) {
    await selectNode(page, start.id);
    await page.keyboard.press("Delete");
    await settle(page);
    assert.equal(
      (await raw(page)).nodes.some((n) => n.id === start.id),
      false,
      "empty setup uses visible Delete",
    );
  }
  await zoom(page, scale);
  const shifts = {
    right: [340, 0],
    left: [-340, 0],
    top: [0, -260],
    bottom: [0, 260],
    diagonal: [300, 220],
    backward: [-340, -180],
  };
  const d = shifts[placement];
  let sourcePosition = { x: 900, y: 650 };
  if (placement === "close-circle") {
    const s = await raw(page),
      center = graph(s, sourcePosition);
    // Native palette placement gives Task.right ≡ 1 mod 5. A +4 resize then
    // reaches the ordinary grid exactly, reproducing the measured 23→19 gap.
    sourcePosition = screen(s, {
      x: Math.round(center.x / 5) * 5 + 1,
      y: Math.round(center.y / 5) * 5,
    });
  }
  const source = await palette(page, sourceLabel, sourcePosition);
  let targetPosition;
  if (placement === "close-circle") {
    const s = await raw(page),
      n = node(s, source);
    targetPosition = screen(s, { x: n.x + n.width + 41, y: n.y + n.height / 2 - 1 });
  } else targetPosition = { x: 900 + d[0], y: 650 + d[1] };
  const target = await palette(page, targetLabel, targetPosition);
  await blank(page, { click: true });
  if (placement === "close-circle") {
    const s = await state(page),
      a = node(s, source),
      b = node(s, target);
    assert.deepEqual([a.width, a.height, b.width, b.height], [100, 80, 36, 36]);
    assert.equal(b.x - (a.x + a.width), 23, "native setup reproduces the measured narrow gap");
    assert.equal(b.y + b.height / 2 - a.y - a.height / 2, -1);
  }
  return { source, target };
}
async function sourcePort(page, id, which, f = 0.5, { selected = false } = {}) {
  if (selected) await selectNode(page, id);
  else if ((await raw(page)).selection.length) await blank(page, { click: true });
  const before = await state(page),
    requested = side(node(before, id), which, f),
    requestedScreen = screen(before, requested);
  await page.mouse.move(requestedScreen.x, requestedScreen.y, { steps: 6 });
  await settle(page);
  const selector = `.bpmn-xyflow-connect-handle[data-connect-source="${id}"]`;
  await page.waitForSelector(selector, { visible: true });
  const evidence = await page.evaluate((id) => {
    const handle = document.querySelector(
        `.bpmn-xyflow-connect-handle[data-connect-source="${id}"]`,
      ),
      docking = document.querySelector(`.bpmn-xyflow-connect-docking[data-connect-source="${id}"]`),
      marker = docking?.querySelector(".bpmn-xyflow-connect-docking-point"),
      tether = docking?.querySelector(".bpmn-xyflow-connect-tether"),
      port = handle?.querySelector(".bpmn-xyflow-connect-port");
    const coord = (e, x, y) =>
      e ? { x: Number(e.getAttribute(x)), y: Number(e.getAttribute(y)) } : null;
    const point = (e) => coord(e, "cx", "cy");
    const screenPoint = (e) => {
      const p = point(e),
        m = e?.getScreenCTM();
      if (!p || !m) return null;
      const s = new DOMPoint(p.x, p.y).matrixTransform(m);
      return { x: s.x, y: s.y };
    };
    const visible = (e) => {
      if (!e?.isConnected) return false;
      for (let n = e; n; n = n.parentElement) {
        const style = getComputedStyle(n);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        )
          return false;
      }
      return true;
    };
    const grab = screenPoint(port),
      actual = grab && document.elementFromPoint(grab.x, grab.y);
    return {
      owner: handle?.getAttribute("data-connect-source"),
      anchor: point(marker),
      markerScreen: screenPoint(marker),
      grab: point(port),
      grabScreen: grab,
      grabVisible: visible(port),
      markerVisible: visible(marker),
      dockingVisible: docking?.getAttribute("visibility") === "visible",
      hit: !!handle && !!actual && (handle === actual || handle.contains(actual)),
      tether: {
        start: coord(tether, "x1", "y1"),
        end: coord(tether, "x2", "y2"),
        visible: visible(tether),
      },
    };
  }, id);
  assert.equal(evidence.owner, id);
  assert.ok(
    evidence.anchor && Number.isFinite(evidence.anchor.x) && Number.isFinite(evidence.anchor.y),
  );
  assert.equal(evidence.grabVisible, true);
  assert.equal(evidence.hit, true, "the visible source grab handle is actually hittable");
  near(
    evidence.markerScreen,
    requestedScreen,
    1.5,
    "on-outline docking marker follows requested side (native CSS pixel delivery)",
  );
  if (evidence.dockingVisible) {
    assert.equal(evidence.markerVisible, true);
    assert.equal(evidence.tether.visible, true);
    assert.deepEqual(evidence.tether.start, evidence.anchor);
    assert.deepEqual(evidence.tether.end, evidence.grab);
  } else
    assert.deepEqual(
      evidence.grab,
      evidence.anchor,
      "unobstructed visible port coincides with its docking point",
    );
  const pressPoint = { x: Math.round(evidence.grabScreen.x), y: Math.round(evidence.grabScreen.y) };
  await page.mouse.move(pressPoint.x, pressPoint.y, { steps: 8 });
  await settle(page);
  const reached = await page.evaluate((id) => {
    const g = document.querySelector(`.bpmn-xyflow-connect-handle[data-connect-source="${id}"]`),
      m = document.querySelector(
        `.bpmn-xyflow-connect-docking[data-connect-source="${id}"] .bpmn-xyflow-connect-docking-point`,
      ),
      p = g?.querySelector(".bpmn-xyflow-connect-port");
    if (!g || !m || !p) return null;
    const delivered = window.anchorInput.findLast((e) => e.type === "mousemove"),
      hit = delivered && document.elementFromPoint(delivered.x, delivered.y);
    return {
      anchor: { x: Number(m.getAttribute("cx")), y: Number(m.getAttribute("cy")) },
      hit: g === hit || g.contains(hit),
      delivered,
    };
  }, id);
  assert.ok(reached, "visible source control survives the actual approach to its grab point");
  assert.equal(reached.hit, true);
  const after = await state(page);
  assertSourcePortApproach({
    evidence,
    reached,
    pressPoint,
    projectedPoint: projected(node(before, id), graph(after, pressPoint)),
  });
  assert.equal(after.xml, before.xml, "hover changes no model");
  assert.deepEqual(after.history, before.history);
  return {
    point: pressPoint,
    anchor: reached.anchor,
    requested,
    evidence: { ...evidence, reached },
  };
}

async function contextConnect(page, id) {
  await selectNode(page, id);
  const s = await raw(page),
    selector =
      s.engine === "local"
        ? '.bpmn-xyflow-context-pad button[title="Connect — drag to a target shape"]'
        : '.djs-context-pad [data-action="connect"]';
  const h = await page.waitForSelector(selector, { visible: true }),
    b = await h.boundingBox();
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  assert.equal(
    await h.evaluate((e, p) => e.contains(document.elementFromPoint(p.x, p.y)), p),
    true,
  );
  return p;
}
async function preview(page) {
  return page.evaluate(() => {
    const local = document.querySelector(".bpmn-xyflow-connect-preview");
    const roots = local
      ? [local]
      : [
          ...(window.referenceModeler
            ?.get("canvas")
            .getActiveLayer()
            .querySelectorAll(":scope > .djs-dragger") || []),
        ];
    for (const root of roots)
      for (const p of root.querySelectorAll("path,polyline,line")) {
        if (p.closest("defs") || !p.getTotalLength || getComputedStyle(p).display === "none")
          continue;
        const len = p.getTotalLength();
        if (len > 0) {
          const a = p.getPointAtLength(0),
            b = p.getPointAtLength(len),
            m = p.getScreenCTM();
          return {
            start: xy(a),
            end: xy(b),
            screenStart: xy(a.matrixTransform(m)),
            screenEnd: xy(b.matrixTransform(m)),
            length: len,
          };
        }
      }
    return null;
    function xy(p) {
      return { x: p.x, y: p.y };
    }
  });
}
async function drag(page, from, to, { via = [], cancel = false, capture } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  try {
    for (const p of via) await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await settle(page);
    if (capture) await capture();
    if (cancel) await page.keyboard.press("Escape");
  } finally {
    await page.mouse.up();
  }
  await settle(page);
}
function projected(n, p) {
  const cx = n.x + n.width / 2,
    cy = n.y + n.height / 2,
    dx = p.x - cx,
    dy = p.y - cy;
  assert.ok(dx || dy);
  if (n.type.endsWith("Event")) {
    const t = n.width / 2 / Math.hypot(dx, dy);
    return { x: cx + dx * t, y: cy + dy * t };
  }
  // Independent nearest-point geometry for the straight outline segments used
  // here. Rounded task-corner cases remain explicitly outside this checkpoint.
  const vertices = n.type.endsWith("Gateway")
    ? [
        { x: cx, y: n.y },
        { x: n.x + n.width, y: cy },
        { x: cx, y: n.y + n.height },
        { x: n.x, y: cy },
      ]
    : [
        { x: n.x, y: n.y },
        { x: n.x + n.width, y: n.y },
        { x: n.x + n.width, y: n.y + n.height },
        { x: n.x, y: n.y + n.height },
      ];
  return vertices
    .map((a, index) => {
      const b = vertices[(index + 1) % vertices.length],
        vx = b.x - a.x,
        vy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)),
      );
      return { x: a.x + t * vx, y: a.y + t * vy };
    })
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
}
async function creationOnly(before, after, edge) {
  const expected = await oracle.fromXML(after.xml),
    bo = expected.elementsById[edge.id];
  assert.ok(bo);
  const owner = bo.$parent;
  let removed = false;
  for (const key of Object.keys(owner)) {
    const value = owner[key];
    if (Array.isArray(value) && value.includes(bo)) {
      owner[key] = value.filter((e) => e !== bo);
      removed = true;
    }
  }
  assert.ok(removed, "new connection has a real semantic owner");
  for (const element of Object.values(expected.elementsById))
    for (const key of ["incoming", "outgoing"])
      if (Array.isArray(element[key])) element[key] = element[key].filter((ref) => ref !== bo);
  for (const d of expected.rootElement.diagrams)
    d.plane.planeElement = d.plane.planeElement.filter((di) => di.bpmnElement !== bo);
  assert.equal(
    (await oracle.toXML(expected.rootElement, { format: true })).xml,
    before.canonical,
    "create changes only the new edge, its inverse refs and DI",
  );
}
async function reconnectOnly(before, after, id, endpoint, newId) {
  const expected = await oracle.fromXML(before.xml),
    actual = await oracle.fromXML(after.xml),
    edge = expected.elementsById[id],
    changed = actual.elementsById[id],
    old = edge[endpoint + "Ref"],
    replacement = expected.elementsById[newId],
    key = endpoint === "source" ? "outgoing" : "incoming";
  assert.equal(changed.$type, edge.$type);
  assert.equal(changed.$parent.id, edge.$parent.id, "same-process reconnect retains owner");
  old[key] = (old[key] || []).filter((e) => e !== edge);
  replacement[key] = [...(replacement[key] || []), edge];
  edge[endpoint + "Ref"] = replacement;
  const di = expected.rootElement.diagrams
      .flatMap((d) => d.plane.planeElement || [])
      .find((d) => d.bpmnElement === edge),
    newDi = actual.rootElement.diagrams
      .flatMap((d) => d.plane.planeElement || [])
      .find((d) => d.bpmnElement === changed);
  di.waypoint = newDi.waypoint;
  assert.equal(
    (await oracle.toXML(expected.rootElement, { format: true })).xml,
    after.canonical,
    "reconnect changes only requested refs/inverse refs and edge route",
  );
}
async function reopenThroughVisibleReference(page, expected, name) {
  await clickButton(page, "#export-btn");
  await page.waitForFunction(() =>
    document.querySelector("#xml-out")?.textContent?.includes("definitions"),
  );
  const exported = await page.$eval("#xml-out", (e) => e.textContent);
  assert.equal(exported, expected.xml, "visible Export XML matches independent state");
  const t = await open("upstream");
  try {
    await clickButton(t.page, "#import-btn");
    await t.page.waitForSelector("#import-dialog[open]");
    await t.page.click("#import-xml");
    await t.page.evaluate(() => {
      const input = document.querySelector("#import-xml");
      if (input.value !== "" || document.activeElement !== input)
        throw new Error("Visible paste textarea must be empty and focused");
      const events = [];
      const listener = (event) => {
        events.push({ trusted: event.isTrusted, type: event.inputType, value: input.value });
      };
      input.addEventListener("input", listener);
      window.anchorPasteObservation = {
        events,
        remove: () => input.removeEventListener("input", listener),
      };
    });
    try {
      await t.page.keyboard.sendCharacter(exported);
      const pasted = await t.page.evaluate(() => ({
        value: document.querySelector("#import-xml").value,
        events: window.anchorPasteObservation.events,
      }));
      assert.equal(pasted.value, exported, "native paste preserves the complete exported XML");
      assert.ok(
        pasted.events.length > 0 && pasted.events.every((event) => event.trusted),
        "Chrome delivers trusted input",
      );
      assert.equal(pasted.events.at(-1).value, exported);
    } finally {
      await t.page.evaluate(() => {
        window.anchorPasteObservation?.remove();
        delete window.anchorPasteObservation;
      });
    }
    await clickButton(t.page, "#import-submit");
    await t.page.waitForFunction(() => {
      const value = document.querySelector("#status")?.textContent || "";
      return value.startsWith("Loaded ") || value.startsWith("Error:");
    });
    assert.equal(
      await t.page.$eval("#status", (e) => e.textContent),
      "Loaded pasted XML (0 warnings)",
    );
    assert.equal(await t.page.$eval("#import-dialog", (e) => e.open), false);
    const imported = await state(t.page);
    assert.deepEqual(
      imported.edges,
      expected.edges,
      "visible independent reopen preserves all edge refs/owners/DI",
    );
    assert.equal(
      imported.canonical,
      expected.canonical,
      "blank task scenario reopens with complete independent semantic/DI equality",
    );
    assert.deepEqual(imported.history, { undo: false, redo: false });
    await save(t.page, name + "-independent-reopen", { original: name });
  } finally {
    await t.page.close();
  }
}
async function history(page, before, after) {
  if (before.engine === "local")
    assert.equal(
      after.history.size,
      before.history.size + 1,
      "one history entry per committed gesture",
    );
  await clickButton(page, "#undo-btn");
  const restored = await state(page);
  assert.equal(
    before.engine === "local" ? restored.xml : restored.canonical,
    before.engine === "local" ? before.xml : before.canonical,
    "native Undo restores original document",
  );
  await clickButton(page, "#redo-btn");
  const redone = await state(page);
  assert.equal(
    before.engine === "local" ? redone.xml : redone.canonical,
    before.engine === "local" ? after.xml : after.canonical,
    "native Redo restores edited document",
  );
}
async function renderEnds(page, id) {
  return page.evaluate((id) => {
    const root = [...document.querySelectorAll("[data-element-id]")].find(
      (e) =>
        e.getAttribute("data-element-id") === id &&
        e.querySelector(".bpmn-xyflow-connection-visual,.djs-visual"),
    );
    const p =
      root?.querySelector(".bpmn-xyflow-connection-visual") ||
      root?.querySelector(".djs-visual > path,.djs-visual > polyline");
    if (!p || !p.getTotalLength) throw new Error(`No visible rendered edge ${id}`);
    const m = p.getScreenCTM(),
      a = p.getPointAtLength(0).matrixTransform(m),
      b = p.getPointAtLength(p.getTotalLength()).matrixTransform(m);
    return { start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } };
  }, id);
}
async function save(page, name, details) {
  const s = await state(page);
  await writeFile(`${output}/${name}.bpmn`, s.xml);
  await writeFile(`${output}/${name}.json`, JSON.stringify({ details, state: serial(s) }, null, 2));
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
async function create(
  page,
  source,
  target,
  sourceSide,
  targetSide,
  {
    selected = false,
    fraction = 0.5,
    sourceFraction = 0.5,
    mode = "port",
    expectedType = "bpmn:SequenceFlow",
    name,
  } = {},
) {
  const start =
    mode === "port"
      ? await sourcePort(page, source, sourceSide, sourceFraction, { selected })
      : { point: await contextConnect(page, source) };
  await page.screenshot({ path: `${output}/${name}-source-control.png`, fullPage: true });
  const before = await state(page),
    targetNode = node(before, target),
    chosen = side(targetNode, targetSide, fraction),
    to = screen(before, chosen);
  const staticDropHit = await hit(page, to);
  assert.equal(staticDropHit.inside, true, "chosen drop is inside the visible canvas");
  assert.ok(
    staticDropHit.owners.includes(target),
    `intended target is present in the actual hit stack: ${JSON.stringify(staticDropHit)}`,
  );
  if (before.engine === "upstream")
    await page.evaluate(() => window.anchorReferenceConnect.clear());
  let live;
  await drag(page, start.point, to, {
    capture: async () => {
      live = await preview(page);
      assert.ok(live, "positive native connection preview");
      await page.screenshot({ path: `${output}/${name}-preview.png`, fullPage: true });
    },
  });
  const after = await state(page),
    added = Object.values(after.edges).filter((e) => !before.edges[e.id]);
  assert.equal(added.length, 1, "one new visible connection");
  const edge = added[0];
  assert.equal(edge.type, expectedType);
  assert.equal(edge.source, source);
  assert.equal(edge.target, target);
  assert.ok(
    edge.points.length >= 2 &&
      edge.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
  const release = after.input.findLast((e) => e.type === "mouseup");
  assert.equal(release.trusted, true);
  const delivered = graph(after, { x: release.x, y: release.y }),
    expectedTarget = projected(targetNode, delivered),
    epsilon = 1.5 / after.viewport.zoom;
  if (mode === "port")
    near(
      edge.points[0],
      start.anchor,
      1e-7,
      "committed source retains the exact visible docking marker",
    );
  let reference;
  if (before.engine === "upstream") {
    reference = await page.evaluate(() => window.anchorReferenceConnect.events);
    const rawEnd = reference.findLast((e) => e.type === "connect.end" && e.phase === "raw"),
      bpmn = reference.findLast((e) => e.type === "connect.end" && e.phase === "post-bpmn"),
      snapped = reference.findLast((e) => e.type === "connect.end" && e.phase === "post-grid"),
      command = reference.findLast((e) => e.phase === "command");
    assert.equal(rawEnd?.input?.trusted, true);
    assert.deepEqual(rawEnd.point, { x: Math.round(delivered.x), y: Math.round(delivered.y) });
    const expectedHints = referenceTaskTopConnectExpectation(
      node(before, source),
      targetNode,
      delivered,
    );
    assert.deepEqual(
      bpmn?.point,
      expectedHints.connectionEnd,
      "reference Task top drop snaps ten units into its bounds",
    );
    assert.deepEqual(
      bpmn?.start,
      expectedHints.connectionStart,
      "reference SequenceFlow starts at the source midpoint before crop",
    );
    assert.deepEqual(
      bpmn?.snapped,
      { x: true, y: true },
      "both BPMN-snapped axes are protected from grid resnapping",
    );
    assert.deepEqual(
      snapped?.point,
      bpmn.point,
      "default grid preserves this already-snapped Task coordinate",
    );
    assert.deepEqual(
      snapped?.hints,
      expectedHints,
      "observed snapping agrees with the independently derived Task policy",
    );
    assert.equal(snapped?.oracleError, undefined);
    assert.ok(
      snapped?.expectedRoute?.length >= 2,
      "pre-command pinned layout/crop reconstruction exists",
    );
    assert.deepEqual(
      [snapped.source, snapped.target, command?.source, command?.target],
      [source, target, source, target],
    );
    assert.deepEqual(
      command.hints,
      snapped.hints,
      "the command receives the observed snapped inputs",
    );
    assert.equal(edge.points.length, snapped.expectedRoute.length);
    edge.points.forEach((point, index) =>
      near(
        point,
        snapped.expectedRoute[index],
        1e-7,
        "reference route follows actual pre-command snapping, layout and cropping",
      ),
    );
  } else
    near(
      edge.points.at(-1),
      expectedTarget,
      epsilon,
      "committed target follows delivered native pointer on the outline",
    );
  const rendered = await renderEnds(page, edge.id);
  near(rendered.start, screen(after, edge.points[0]), 0.05, "painted source and DI coincide");
  near(rendered.end, screen(after, edge.points.at(-1)), 0.05, "painted target and DI coincide");
  near(live.screenStart, rendered.start, 1.5, "preview source agrees with final geometry");
  near(live.screenEnd, rendered.end, 1.5, "preview target agrees with final geometry");
  await writeFile(
    `${output}/${name}-gesture.json`,
    JSON.stringify(
      {
        sourceControl: start,
        chosenTarget: chosen,
        staticDropHit,
        deliveredTarget: delivered,
        reference,
        preview: live,
        edge,
        rendered,
        viewport: after.viewport,
      },
      null,
      2,
    ),
  );
  await creationOnly(before, after, edge);
  await history(page, before, after);
  return { before, after, edge, live, start, chosen, delivered };
}
async function chooseEdge(page, id) {
  const s = await state(page),
    edge = s.edges[id];
  assert.ok(edge);
  let best;
  for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1],
      b = edge.points[i],
      length = Math.hypot(a.x - b.x, a.y - b.y);
    if (!best || length > best.length)
      best = { length, p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  const p = screen(s, best.p);
  assert.equal((await hit(page, p)).id, id);
  await page.mouse.click(p.x, p.y);
  await settle(page);
  assert.deepEqual((await raw(page)).selection, [id]);
  return p;
}
async function noChange(page, before, message) {
  const after = await state(page);
  assert.equal(after.xml, before.xml, message);
  assert.deepEqual(after.history, before.history, message + " history");
  return after;
}
async function run(id, name, engine, sample, fn) {
  let t;
  const key = `${id}-${engine}-${name}`;
  console.log(`START anchor UX ${key}`);
  try {
    t = await open(engine, sample);
    const details = await fn(t.page, key);
    assert.deepEqual(t.errors, []);
    await save(t.page, key, details);
    results.push({ id, name, engine, status: "passed", details });
    console.log(`PASS anchor UX ${key}`);
  } catch (error) {
    results.push({
      id,
      name,
      engine,
      status: "failed",
      error: error.stack || String(error),
      browserErrors: t?.errors || [],
    });
    console.error(`FAIL anchor UX ${key}: ${error.stack || error}`);
    if (t) {
      await t.page
        .screenshot({ path: `${output}/${key}-failure.png`, fullPage: true })
        .catch(() => {});
      const evidence = await raw(t.page).catch(() => null);
      if (evidence) {
        await writeFile(`${output}/${key}-failure.bpmn`, evidence.xml);
        await writeFile(
          `${output}/${key}-failure.json`,
          JSON.stringify({ error: String(error), state: evidence }, null, 2),
        );
      }
    }
  } finally {
    await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    await t?.page.close().catch(() => {});
  }
}

async function start() {
  await mkdir(output, { recursive: true });
  server = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += String(chunk);
  });
  const deadline = Date.now() + 60000;
  while (true) {
    const match = serverOutput.match(/demo listening on http:\/\/localhost:(\d+)/);
    if (match && Number(match[1]) !== port)
      throw Error(`Anchor server bound unexpected port ${match[1]}`);
    try {
      if (match && (await fetch(`${base}/modeler/`, { signal: AbortSignal.timeout(3000) })).ok)
        break;
    } catch {}
    if (server.exitCode !== null || Date.now() > deadline)
      throw Error("Anchor demo startup failed");
    await new Promise((r) => setTimeout(r, 150));
  }
  browser = await puppeteer.launch({ headless: "shell", protocolTimeout: 30000 });
}
async function stop() {
  await browser?.close().catch(() => {});
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
}
return { xy, near, settle, raw, state, serial, node, screen, graph, side, hit, clickButton, chooseSample, open, blank, selectNode, zoom, pan, palette, tasks, sourcePort, contextConnect, preview, drag, projected, creationOnly, reconnectOnly, reopenThroughVisibleReference, history, renderEnds, save, create, chooseEdge, noChange, run, results, output, oracle, start, stop };
}
