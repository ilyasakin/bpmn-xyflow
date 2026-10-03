/** Real DOM propagation in a structural DOM. Hosted native input remains required. */
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { setupDOM } from "../helpers/dom.mjs";
let dom, Modeler, Viewer, xml, hit, oldHit;
before(async () => {
  dom = await setupDOM();
  ({ default: Modeler } = await dom.loadModule("/lib/Modeler.js"));
  ({ default: Viewer } = await dom.loadModule("/lib/Viewer.js"));
  xml = await readFile("test/fixtures/bpmn/basic.bpmn", "utf8");
  oldHit = document.elementsFromPoint;
  document.elementsFromPoint = () => (hit ? [hit] : []);
});
after(async () => {
  document.elementsFromPoint = oldHit;
  await dom.cleanup();
});
const point = (n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
const box = (n) => ({ x: n.x, y: n.y, width: n.width, height: n.height });
async function create(options = {}) {
  const m = new Modeler({
    container: dom.createContainer(),
    fitViewOnInit: false,
    palette: false,
    editorActions: false,
    snap: false,
    ...options,
  });
  await m.importXML(xml);
  const gfx = (n) => m.getContainer().querySelector(`[data-element-id="${n.id}"]`);
  const client = (p) => {
    const v = m.getViewport();
    return { x: v.x + p.x * v.zoom, y: v.y + p.y * v.zoom };
  };
  const mouse = (target, type, p) => {
    hit = target;
    const c = client(p),
      e = new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: c.x,
        clientY: c.y,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
        view: window,
      });
    target.dispatchEvent(e);
    return e;
  };
  const pointer = (target, type, p) => {
    const c = client(p),
      e = new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: c.x,
        clientY: c.y,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });
    target.dispatchEvent(e);
  };
  const key = (target = m.getSvg(), value = "Escape") => {
    const e = new window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  return {
    m,
    gfx,
    mouse,
    key,
    move(p, target = m.getSvg()) {
      mouse(target, "mousemove", p);
    },
    down(target, p) {
      pointer(target, "pointerdown", p);
      mouse(target, "mousedown", p);
    },
    up(target, p) {
      pointer(target, "pointerup", p);
      mouse(target, "mouseup", p);
    },
    connect(source, target, { activate = true } = {}) {
      const origin = { x: source.x + source.width / 2, y: source.y };
      mouse(gfx(source), "mousemove", origin);
      const handle = m.getContainer().querySelector(".bpmn-xyflow-connect-handle");
      assert.ok(handle, "visible source control");
      const circle = handle.querySelector(".bpmn-xyflow-connect-port"),
        grab = { x: Number(circle.getAttribute("cx")), y: Number(circle.getAttribute("cy")) };
      const control = handle.querySelector(".bpmn-xyflow-connect-hit");
      pointer(control, "pointerdown", grab);
      mouse(control, "mousedown", grab);
      const end = { x: target.x, y: target.y + target.height / 2 };
      if (activate) mouse(gfx(target), "mousemove", end);
      assert.equal(
        !!m.getContainer().querySelector(".bpmn-xyflow-connect-preview path"),
        activate,
        "positive preview distinguishes active from pending Connect",
      );
      return { end, target: gfx(target), grab };
    },
    close() {
      m.destroy();
    },
  };
}
async function stable(m) {
  return {
    xml: await m.getXML(),
    size: m.commandStack.size(),
    undo: m.canUndo(),
    redo: m.canRedo(),
    selection: m.getSelection(),
    camera: m.getViewport(),
  };
}
async function unchanged(m, before) {
  assert.deepEqual(await stable(m), before);
}

for (const selected of [false, true])
  test(`bubbling canvas Escape preserves ${selected ? "selected" : "unselected"} Connect intent and exact history repeatedly`, async () => {
    const h = await create(),
      { m } = h;
    try {
      const source = m.getElement("Task_1"),
        target = m.addShape("bpmn:Task", { x: 750, y: 350 });
      m.updateLabel(target, "Pending redo");
      m.undo();
      assert.equal(m.canRedo(), true);
      for (const zoom of [0.65, 1, 2]) {
        await m.setViewport({ x: 45, y: 70, zoom });
        if (selected) m.select(source.id);
        else m.clearSelection();
        const before = await stable(m);
        for (let i = 0; i < 3; i++) {
          const drag = h.connect(source, target),
            event = h.key();
          assert.equal(event.defaultPrevented, true);
          h.up(drag.target, drag.end);
          assert.equal(m.getContainer().querySelector(".bpmn-xyflow-connect-preview"), null);
          await unchanged(m, before);
          assert.equal(
            m.getContainer().querySelectorAll(".bpmn-xyflow-resize-handle").length,
            selected ? 8 : 0,
          );
        }
        h.key();
        assert.deepEqual(m.getSelection(), [], "idle Escape retains ordinary deselection");
      }
      m.select(source.id);
      const before = await stable(m),
        drag = h.connect(source, target);
      h.up(drag.target, drag.end);
      assert.equal(
        m.commandStack.size(),
        before.size + 1,
        "Connect still commits one command after repeated cancellation",
      );
      m.undo();
      assert.equal(await m.getXML(), before.xml);
    } finally {
      h.close();
    }
  });

test("pending source-control Escape preserves selection; a later activated gesture still works", async () => {
  const h = await create(),
    { m } = h;
  try {
    const source = m.getElement("Task_1"),
      target = m.addShape("bpmn:Task", { x: 750, y: 350 });
    m.select(source.id);
    const before = await stable(m);
    const drag = h.connect(source, target, { activate: false });
    assert.equal(h.key().defaultPrevented, true);
    h.up(drag.target, drag.end);
    await unchanged(m, before);
    const next = h.connect(source, target);
    assert.equal(h.key().defaultPrevented, true);
    h.up(next.target, next.end);
    await unchanged(m, before);
  } finally {
    h.close();
  }
});

test("propagated Escape rolls back shape move, resize and bend preview without clearing selection", async () => {
  const h = await create(),
    { m } = h;
  try {
    const source = m.getElement("Task_1"),
      target = m.addShape("bpmn:Task", { x: 750, y: 350 });
    assert.ok(m.connect(source, target));
    for (const mode of ["move", "resize", "bend"]) {
      const edge = m.getGraph().edges[0];
      m.select(mode === "bend" ? edge.id : source.id);
      const before = await stable(m),
        bounds = box(source),
        route = structuredClone(edge.waypoints);
      let control, start, end;
      if (mode === "move") {
        control = h.gfx(source);
        start = point(source);
        end = { x: start.x + 35, y: start.y + 25 };
      } else if (mode === "resize") {
        control = m.getContainer().querySelector('[data-resize-dir="s"]');
        start = { x: source.x + source.width / 2, y: source.y + source.height };
        end = { x: start.x, y: start.y + 25 };
      } else {
        control = m.getContainer().querySelector('.bpmn-xyflow-bendpoint-hit[data-bend-index="0"]');
        assert.ok(control);
        start = edge.waypoints[0];
        end = { x: start.x + 25, y: start.y + 35 };
      }
      h.down(control, start);
      h.move(end, mode === "bend" ? m.getSvg() : h.gfx(source));
      if (mode === "bend") assert.notDeepEqual(edge.waypoints, route);
      else assert.notDeepEqual(box(source), bounds);
      assert.equal(h.key().defaultPrevented, true);
      h.up(m.getSvg(), end);
      await unchanged(m, before);
      assert.deepEqual(box(source), bounds);
      assert.deepEqual(edge.waypoints, route);
    }
  } finally {
    h.close();
  }
});

test("idle Viewer Escape and editable targets retain their existing keyboard behavior", async () => {
  const h = await create(),
    v = new Viewer({ container: dom.createContainer(), fitViewOnInit: false });
  try {
    await v.importXML(xml);
    v.select("Task_1");
    h.key(v.getSvg());
    assert.deepEqual(v.getSelection(), []);
    h.m.select("Task_1");
    const input = document.createElement("input");
    h.m.getContainer().appendChild(input);
    h.key(input);
    assert.deepEqual(h.m.getSelection(), ["Task_1"]);
    h.key();
    assert.deepEqual(h.m.getSelection(), []);
  } finally {
    h.close();
    v.destroy();
  }
});

test("Escape ownership stays instance-scoped and remains usable after import resets", async () => {
  const a = await create(),
    b = await create();
  try {
    const one = a.m.getElement("Task_1"),
      two = b.m.getElement("Task_1");
    a.m.select(one.id);
    b.m.select(two.id);
    const targetA = a.m.addShape("bpmn:Task", { x: 750, y: 350 }),
      targetB = b.m.addShape("bpmn:Task", { x: 750, y: 350 }),
      beforeA = await stable(a.m),
      beforeB = await stable(b.m);
    const da = a.connect(one, targetA),
      db = b.connect(two, targetB);
    assert.equal(b.key().defaultPrevented, true);
    assert.ok(
      a.m.getContainer().querySelector(".bpmn-xyflow-connect-preview"),
      "a different editor keeps its active gesture",
    );
    assert.equal(b.m.getContainer().querySelector(".bpmn-xyflow-connect-preview"), null);
    await unchanged(b.m, beforeB);
    assert.equal(a.key().defaultPrevented, true);
    a.up(da.target, da.end);
    b.up(db.target, db.end);
    await unchanged(a.m, beforeA);
    await unchanged(b.m, beforeB);
    for (let i = 0; i < 2; i++) {
      await a.m.importXML(xml);
      const source = a.m.getElement("Task_1"),
        target = a.m.addShape("bpmn:Task", { x: 750, y: 350 });
      a.m.select(source.id);
      const before = await stable(a.m),
        drag = a.connect(source, target);
      a.key();
      a.up(drag.target, drag.end);
      await unchanged(a.m, before);
    }
  } finally {
    a.close();
    b.close();
  }
});

test("keyboard:false keeps idle selection while active cancellation and label-editor Escape remain available", async () => {
  const h = await create({ keyboard: false }),
    { m } = h;
  try {
    const source = m.getElement("Task_1"),
      target = m.addShape("bpmn:Task", { x: 750, y: 350 });
    m.select(source.id);
    const before = await stable(m);
    assert.equal(h.key().defaultPrevented, false);
    await unchanged(m, before);
    const drag = h.connect(source, target);
    assert.equal(h.key().defaultPrevented, true);
    h.up(drag.target, drag.end);
    await unchanged(m, before);
    h.mouse(h.gfx(source), "dblclick", point(source));
    const editor = document.activeElement;
    assert.equal(editor.contentEditable, "plaintext-only");
    editor.textContent = "Discarded edit";
    let received = false;
    editor.addEventListener("keydown", () => {
      received = true;
    });
    assert.equal(h.key(editor).defaultPrevented, true);
    assert.equal(received, true, "the editor receives its own Escape");
    assert.equal(editor.isConnected, false);
    await unchanged(m, before);
  } finally {
    h.close();
  }
});
