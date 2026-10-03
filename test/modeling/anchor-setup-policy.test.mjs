/** Structural setup evidence only: no browser or accepted native-result claim. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  nativeWheelStepBudget,
  collectReferenceClickTrapCount,
  conditionalSegmentExpectation,
} from "../helpers/anchor-setup-policy.mjs";
import { observeReferenceBackgroundClicks } from "../helpers/hover-background.mjs";
const require = createRequire(import.meta.url),
  upstream = createRequire(require.resolve("bpmn-js/package.json"));
const { default: EventBus } = await import(
  pathToFileURL(upstream.resolve("diagram-js/lib/core/EventBus.js"))
);
const { install } = await import(
  pathToFileURL(upstream.resolve("diagram-js/lib/util/ClickTrap.js"))
);

test("wheel setup permits enough real Linux wheel steps without relaxing the requested zoom range", () => {
  assert.equal(
    4 * 2 ** (-60 * 0.002 * 12),
    1.4742692172911012,
    "exact hosted failure after the former 12-tick cap",
  );
  for (const start of [0.1, 0.5, 1, 1.5, 4])
    for (const wanted of [0.5, 0.8, 1, 1.5, 4]) {
      let value = start,
        ticks = 0;
      for (
        ;
        ticks < nativeWheelStepBudget(start, wanted) && Math.abs(Math.log(value / wanted)) >= 0.12;
        ticks++
      )
        value *= 2 ** ((value > wanted ? -60 : 60) * 0.002);
      assert.ok(Math.abs(Math.log(value / wanted)) < 0.12, `${start}→${wanted}`);
      assert.ok(ticks <= 64);
    }
  for (const invalid of [0, -1, NaN, Infinity])
    assert.throws(() => nativeWheelStepBudget(invalid, 1));
});
test("multiple actual pinned one-shot click traps are observed and consumed individually", () => {
  const bus = new EventBus(),
    trace = observeReferenceBackgroundClicks(bus);
  let selection = ["Task"];
  const saved = globalThis.window;
  globalThis.window = {
    referenceModeler: {
      get(name) {
        assert.equal(name, "eventBus");
        return bus;
      },
    },
  };
  try {
    bus.on("element.click", 1000, () => {
      selection = [];
    });
    install(bus);
    install(bus);
    assert.equal(collectReferenceClickTrapCount(), 2);
    bus.fire("element.click", { element: { id: "Root" }, originalEvent: { isTrusted: true } });
    assert.equal(collectReferenceClickTrapCount(), 1);
    assert.deepEqual(selection, ["Task"]);
    bus.fire("element.click", { element: { id: "Root" }, originalEvent: { isTrusted: true } });
    assert.equal(collectReferenceClickTrapCount(), 0);
    assert.deepEqual(selection, ["Task"]);
    bus.fire("element.click", { element: { id: "Root" }, originalEvent: { isTrusted: true } });
    assert.deepEqual(selection, []);
    assert.deepEqual(
      trace.map((t) => [t.trap, t.afterTrap]),
      [
        [true, false],
        [true, false],
        [false, true],
      ],
    );
    const cancel = install(bus);
    assert.equal(collectReferenceClickTrapCount(), 1);
    cancel();
    assert.equal(collectReferenceClickTrapCount(), 0, "expired traps do not grant extra clicks");
    bus.on("element.click", 5000, function otherBlocker() {
      return false;
    });
    assert.equal(
      collectReferenceClickTrapCount(),
      0,
      "unrelated blocking listeners do not authorize retries",
    );
  } finally {
    if (saved === undefined) delete globalThis.window;
    else globalThis.window = saved;
  }
});
test("Conditional hosted three-point segment result is exact rounded-outline geometry", () => {
  const options = {
    source: { x: 270, y: 225, width: 100, height: 80 },
    target: { x: 425, y: 245, width: 40, height: 40 },
    originalStart: { x: 370, y: 265.199203187251 },
    pressY: 538,
    releaseY: 593,
    zoom: 1.4346839457567804,
  };
  assert.deepEqual(conditionalSegmentExpectation(options), [
    { x: 365.2106455492788, y: 303.5351726965411 },
    { x: 445, y: 303.5351726965411 },
    { x: 445, y: 285 },
  ]);
  assert.throws(() => conditionalSegmentExpectation({ ...options, releaseY: 700 }), /native setup/);
  assert.throws(() => conditionalSegmentExpectation({ ...options, releaseY: 538 }), /native setup/);
});
