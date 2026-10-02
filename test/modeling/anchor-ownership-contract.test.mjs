/** Pure/native API preflight only; no browser is launched. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { CdpKeyboard, CdpMouse, CdpPage } from "puppeteer";
import { createAnchorHarness } from "../helpers/anchor-ux-browser.mjs";
import { withAnchorDeadline } from "../helpers/anchor-case-deadline.mjs";
import { anchorOwnershipCases } from "./browser-anchor-ownership.mjs";
import {
  anchorOwnershipPositions,
  roundedTaskPoint,
  projectRoundedTask,
  dragFromCurrentPointer,
} from "../helpers/anchor-ownership-browser.mjs";
const digest = (s) => createHash("sha256").update(s).digest("hex");

test("the published green39 script and copied d462 shared behavior retain exact bytes", async () => {
  const original = await readFile(new URL("./browser-anchor-ux.mjs", import.meta.url), "utf8"),
    factory = await readFile(new URL("../helpers/anchor-ux-browser.mjs", import.meta.url), "utf8");
  assert.equal(
    digest(original),
    "d72578ae9c9900367734faaba7ad73ea40bec1df274197d3dde4996ff54a7c23",
  );
  const block = original.slice(
    original.indexOf("const xy ="),
    original.indexOf("\ntry {\n  await mkdir(output"),
  );
  assert.equal(digest(block), "c18a6ca91f6514b9fed118d829ca5c1ebc1c04cfce16427dc3c02240da14d45d");
  assert.equal(
    factory.slice(factory.indexOf("const xy ="), factory.indexOf("\nasync function start()")),
    block,
  );
  const startup = original.slice(
    original.indexOf("  await mkdir(output"),
    original.indexOf("  const pairs = ["),
  );
  assert.equal(
    factory.slice(
      factory.indexOf("async function start() {\n") + "async function start() {\n".length,
      factory.indexOf("}\nasync function stop()"),
    ).replace('[serverEntry], {', '["lib/demo/serve.mjs"], {'),
    startup,
  );
  const stop = original.slice(
    original.lastIndexOf("} finally {") + "} finally {".length,
    original.lastIndexOf("\n}"),
  );
  assert.equal(
    factory.slice(
      factory.indexOf("async function stop() {") + "async function stop() {".length,
      factory.lastIndexOf("\n}\nreturn {"),
    ),
    stop,
  );
  const harness = createAnchorHarness({ port: 5255, output: "test-artifacts/anchor-ownership" });
  assert.deepEqual(harness.results, []);
  for (const method of [
    "tasks",
    "selectNode",
    "blank",
    "state",
    "creationOnly",
    "history",
    "run",
    "start",
    "stop",
  ])
    assert.equal(typeof harness[method], "function");
});

test("all eight positions have selected/unselected repeat coverage and separate resize cases", () => {
  assert.deepEqual(anchorOwnershipPositions, ["n", "e", "s", "w", "nw", "ne", "se", "sw"]);
  assert.equal(anchorOwnershipCases.length, 24);
  assert.equal(new Set(anchorOwnershipCases.map((c) => c.id + "-" + c.name)).size, 24);
  for (const direction of anchorOwnershipPositions) {
    assert.deepEqual(
      anchorOwnershipCases
        .filter((c) => c.id === "AO-repeat" && c.direction === direction)
        .map((c) => c.selected),
      [false, true],
    );
    assert.equal(
      anchorOwnershipCases.filter((c) => c.id === "AO-resize" && c.direction === direction).length,
      1,
    );
  }
  assert.ok(anchorOwnershipCases.every((c) => typeof c.run === "function"));
});

test("the second gesture presses at the current pointer before any move, then always releases", async () => {
  const events = [],
    page = {
      mouse: {
        down: async () => {
          events.push("down");
        },
        move: async (x, y, options) => {
          events.push(["move", x, y, options]);
        },
        up: async () => {
          events.push("up");
        },
      },
    };
  await dragFromCurrentPointer(page, { x: 250, y: 160 }, async () => {
    events.push("preview");
  });
  assert.deepEqual(events, ["down", ["move", 250, 160, { steps: 12 }], "preview", "up"]);
  events.length = 0;
  await assert.rejects(
    dragFromCurrentPointer(page, { x: 250, y: 160 }, async () => {
      throw new Error("capture failed");
    }),
    /capture failed/,
  );
  assert.deepEqual(events, ["down", ["move", 250, 160, { steps: 12 }], "up"]);
});

test("rounded Task requested points and projections contact all four painted corner arcs and side midpoints", () => {
  const bounds = { x: 100, y: 200, width: 100, height: 80 },
    r = 10;
  const sides = {
    n: { x: 150, y: 200 },
    e: { x: 200, y: 240 },
    s: { x: 150, y: 280 },
    w: { x: 100, y: 240 },
  };
  for (const [direction, expected] of Object.entries(sides))
    assert.deepEqual(roundedTaskPoint(bounds, r, direction), expected);
  for (const [direction, cx, cy, sx, sy] of [
    ["nw", 110, 210, -1, -1],
    ["ne", 190, 210, 1, -1],
    ["se", 190, 270, 1, 1],
    ["sw", 110, 270, -1, 1],
  ]) {
    const expected = { x: cx + sx * Math.SQRT1_2 * r, y: cy + sy * Math.SQRT1_2 * r },
      requested = roundedTaskPoint(bounds, r, direction),
      projected = projectRoundedTask(bounds, r, { x: cx + sx * 20, y: cy + sy * 20 });
    assert.ok(Math.hypot(requested.x - expected.x, requested.y - expected.y) < 1e-12);
    assert.ok(Math.hypot(projected.x - expected.x, projected.y - expected.y) < 1e-12);
    assert.ok(Math.abs(Math.hypot(projected.x - cx, projected.y - cy) - r) < 1e-12);
  }
  assert.throws(() => roundedTaskPoint(bounds, 0, "nw"));
  assert.throws(() => roundedTaskPoint(bounds, r, "center"));
});

test("one CSS-pixel tangent movement updates all four midpoint origins at actual fractional zoom", () => {
  const zoom = 1.05701804056138,
    viewport = { x: 1177.5051283563844, y: 515.442453 },
    shape = { x: -310, y: -155, width: 100, height: 80 };
  for (const direction of ["n", "e", "s", "w"]) {
    const start = roundedTaskPoint(shape, 10, direction),
      delivered = {
        x: Math.round(viewport.x + start.x * zoom),
        y: Math.round(viewport.y + start.y * zoom),
      },
      next = {
        x: delivered.x + (["n", "s"].includes(direction) ? 1 : 0),
        y: delivered.y + (["e", "w"].includes(direction) ? 1 : 0),
      },
      graph = (point) => ({ x: (point.x - viewport.x) / zoom, y: (point.y - viewport.y) / zoom }),
      initial = projectRoundedTask(shape, 10, graph(delivered)),
      moved = projectRoundedTask(shape, 10, graph(next)),
      axis = ["n", "s"].includes(direction) ? "x" : "y",
      other = axis === "x" ? "y" : "x";
    assert.equal(moved[other], initial[other]);
    assert.ok(Math.abs(moved[axis] - initial[axis] - 1 / zoom) < 1e-12);
    assert.notDeepEqual(moved, initial, "a frozen penultimate marker must fail this oracle");
    assert.deepEqual(projectRoundedTask(shape, 10, graph(delivered)), initial);
  }
});

test("the ownership runner and extracted helpers call only installed native Puppeteer methods", async () => {
  for (const name of [
    "./browser-anchor-ownership.mjs",
    "../helpers/anchor-ownership-browser.mjs",
    "../helpers/anchor-ux-browser.mjs",
  ]) {
    const source = await readFile(new URL(name, import.meta.url), "utf8");
    for (const [, input, method] of source.matchAll(/\b(keyboard|mouse)\.(\w+)\s*\(/g))
      assert.equal(
        typeof (input === "mouse" ? CdpMouse : CdpKeyboard).prototype[method],
        "function",
        `${name} ${input}.${method}`,
      );
    for (const [, method] of source.matchAll(/\bpage\.(\$\$eval|\$eval|\$\$|\$|[A-Za-z]\w*)\s*\(/g))
      assert.equal(typeof CdpPage.prototype[method], "function", `${name} page.${method}`);
  }
});

test("ownership timeout remains terminal when late success occurs during evidence capture", async () => {
  let complete;
  const action = new Promise((resolve) => {
      complete = resolve;
    }),
    events = [];
  await assert.rejects(
    withAnchorDeadline(
      {
        async close() {
          events.push("closed");
        },
      },
      () => action,
      {
        milliseconds: 5,
        cleanupMilliseconds: 20,
        async onTimeout() {
          events.push("evidence");
          complete("late pass");
          await new Promise((resolve) => setImmediate(resolve));
        },
      },
    ),
    /exceeded 5ms/,
  );
  assert.deepEqual(events, ["evidence", "closed"]);
});
