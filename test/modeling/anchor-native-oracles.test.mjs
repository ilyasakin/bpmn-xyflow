import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSourcePortApproach,
  referenceTaskTopConnectExpectation,
} from "../helpers/anchor-native-oracles.mjs";

test("coincident grab accepts exact delivered projection and rejects stale marker, wrong hit, synthetic input or fractional press", () => {
  const zoom = 1.05701804056138,
    pan = 1177.5051283563844;
  const original = { x: (899 - pan) / zoom, y: 50 },
    projectedPoint = { x: (898 - pan) / zoom, y: 50 };
  const value = {
    evidence: {
      dockingVisible: false,
      anchor: original,
      grabScreen: { x: 898.4999376386853, y: 100 },
    },
    pressPoint: { x: 898, y: 100 },
    projectedPoint,
    reached: { anchor: projectedPoint, hit: true, delivered: { trusted: true, x: 898, y: 100 } },
  };
  assertSourcePortApproach(value);
  for (const edit of [
    (v) => {
      v.reached.anchor = original;
    },
    (v) => {
      v.reached.hit = false;
    },
    (v) => {
      v.reached.delivered.trusted = false;
    },
    (v) => {
      v.pressPoint.x = 898.25;
      v.reached.delivered.x = 898.25;
    },
    (v) => {
      v.reached.delivered.x = 899;
    },
    (v) => {
      v.projectedPoint.x = NaN;
    },
  ]) {
    const bad = structuredClone(value);
    edit(bad);
    assert.throws(() => assertSourcePortApproach(bad));
  }
  const observed = structuredClone(value);
  observed.evidence.grabScreen.x = 898.9999376386853;
  observed.pressPoint.x = observed.reached.delivered.x = 899;
  observed.projectedPoint = observed.reached.anchor = original;
  assertSourcePortApproach(observed);
});

test("displaced grab freezes its exact original marker even when the delivered point projects elsewhere", () => {
  const value = {
    evidence: { dockingVisible: true, anchor: { x: 10, y: 20 }, grabScreen: { x: 35.2, y: 40.1 } },
    pressPoint: { x: 35, y: 40 },
    projectedPoint: { x: 15, y: 25 },
    reached: { anchor: { x: 10, y: 20 }, hit: true, delivered: { trusted: true, x: 35, y: 40 } },
  };
  assertSourcePortApproach(value);
  assert.throws(() =>
    assertSourcePortApproach({
      ...value,
      reached: { ...value.reached, anchor: value.projectedPoint },
    }),
  );
});

test("reference top-drop expectation is independently fixed and rejects unrelated geometry or raw inputs", () => {
  const source = { type: "bpmn:Task", x: 850, y: 570, width: 100, height: 80 },
    target = { ...source, x: 1190 },
    delivered = { x: 1240, y: 570 };
  assert.deepEqual(referenceTaskTopConnectExpectation(source, target, delivered), {
    connectionStart: { x: 900, y: 610 },
    connectionEnd: { x: 1240, y: 580 },
  });
  for (const patch of [
    { type: "bpmn:EndEvent" },
    { x: 1191 },
    { y: 580 },
    { width: 110 },
    { height: 90 },
    { x: 850 },
  ])
    assert.throws(() =>
      referenceTaskTopConnectExpectation(source, { ...target, ...patch }, delivered),
    );
  for (const point of [
    { x: 1240, y: 580 },
    { x: 1190, y: 580 },
    { x: 1241, y: 570 },
  ])
    assert.throws(() => referenceTaskTopConnectExpectation(source, target, point));
});
