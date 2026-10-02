import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CdpBrowser, CdpPage } from "puppeteer";
import {
  assertFollowupPortClosed,
  boundedFollowupPhase,
  FOLLOWUP_CASE_MAX_MS,
  FOLLOWUP_LIMITS,
  runFollowupCase,
  runFollowupCases,
  selectFollowupShard,
} from "../helpers/anchor-followup-lifecycle.mjs";
import { registeredAnchorFollowups, runAnchorFollowups } from "./browser-anchor-followup.mjs";

const quiet = { log() {}, errorLog() {} };
const limits = {
  setup: 10,
  workflow: 10,
  evidence: 10,
  failureEvidence: 10,
  teardown: 30,
  persist: 10,
};
const never = () => new Promise(() => {});
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const spec = (name, run = async () => ({ name })) => ({
  id: name,
  name,
  engine: "local",
  sample: "Empty diagram",
  run,
});
function harness(events, overrides = {}) {
  let closed = false;
  const page = { isClosed: () => closed, browser: () => ({ isConnected: () => !closed }) };
  return {
    async start() {
      events.push("start");
    },
    async open() {
      events.push("open");
      return { page, errors: [] };
    },
    async save() {
      events.push("save");
    },
    async stop() {
      events.push("stop");
      closed = true;
    },
    page,
    ...overrides,
  };
}

test("whole-case bound includes setup, workflow, evidence, cleanup and persistence", () => {
  assert.equal(FOLLOWUP_CASE_MAX_MS, 215000);
  assert.deepEqual(FOLLOWUP_LIMITS, {
    setup: 90000,
    workflow: 90000,
    evidence: 10000,
    failureEvidence: 5000,
    teardown: 15000,
    persist: 5000,
  });
  for (const [type, method] of [
    [CdpPage, "isClosed"],
    [CdpPage, "browser"],
    [CdpBrowser, "isConnected"],
  ])
    assert.equal(typeof type.prototype[method], "function");
});

test("a setup timeout before page return retires late pages before the next isolated case", async () => {
  const events = [],
    open = Promise.withResolvers();
  let first,
    firstStop = true;
  first = harness(events, {
    open() {
      events.push("open-waiting");
      return open.promise;
    },
    async stop() {
      events.push("stop-first");
      if (firstStop) {
        firstStop = false;
        // This simulates a page allocated while the initial stop was racing setup.
        open.resolve({ page: first.page, errors: [] });
      } else {
        first.page.isClosed = () => true;
        first.page.browser = () => ({ isConnected: () => false });
      }
    },
  });
  const results = await runFollowupCases(
    [spec("late", async () => assert.fail("late setup must not run")), spec("next")],
    {
      ...quiet,
      limits,
      createHarness(c) {
        if (c.id === "late") return first;
        assert.equal(first.page.isClosed(), true);
        events.push("next-created");
        return harness(events);
      },
    },
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["failed", "passed"],
  );
  assert.equal(results[0].timedOutPhase, "setup");
  assert.ok(events.lastIndexOf("stop-first") < events.indexOf("next-created"));
});

test("start timeout before a browser is returned blocks later cases if setup cannot settle", async () => {
  const events = [],
    created = [];
  const results = await runFollowupCases([spec("hung-start"), spec("later")], {
    ...quiet,
    limits,
    createHarness(c) {
      created.push(c.id);
      return harness(events, { start: never });
    },
  });
  assert.deepEqual(created, ["hung-start"]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["failed", "blocked"],
  );
  assert.equal(results[0].timedOutPhase, "setup");
  assert.match(results[0].cleanupError, /teardown exceeded/);
});

test("workflow or final evidence timeout remains failed when its operation succeeds during capture", async () => {
  for (const phase of ["workflow", "evidence"]) {
    const late = Promise.withResolvers(),
      events = [];
    const results = await runFollowupCases(
      [spec("late", phase === "workflow" ? () => late.promise : undefined), spec("next")],
      {
        ...quiet,
        limits,
        createHarness(c) {
          return harness(
            events,
            phase === "evidence" && c.id === "late" ? { save: () => late.promise } : {},
          );
        },
        async captureFailure() {
          events.push("capture");
          late.resolve("late success");
          await wait(1);
        },
      },
    );
    assert.deepEqual(
      results.map((r) => r.status),
      ["failed", "passed"],
      phase,
    );
    assert.equal(results[0].timedOutPhase, phase);
    assert.equal(results[0].details, undefined);
    assert.ok(events.includes("capture"));
  }
});

test("failure capture, final browser close and persistence are bounded and cannot report success", async () => {
  const events = [];
  const captured = await runFollowupCase(
    spec("assertion", async () => {
      throw Error("real assertion");
    }),
    {
      ...quiet,
      limits,
      createHarness: () => harness(events),
      captureFailure: never,
    },
  );
  assert.equal(captured.result.status, "failed");
  assert.match(captured.result.error, /real assertion/);
  assert.match(captured.result.evidenceError, /failureEvidence exceeded/);
  assert.equal(captured.fatal, false, "closed isolated page allows the next case");
  for (const problem of ["close", "persistence", "still-connected"]) {
    const results = await runFollowupCases([spec(problem), spec("blocked")], {
      ...quiet,
      limits,
      createHarness: () =>
        harness(
          events,
          problem === "close"
            ? { stop: never }
            : problem === "still-connected"
              ? { stop: async () => {} }
              : {},
        ),
      persistProgress: problem === "persistence" ? never : async () => {},
    });
    assert.deepEqual(
      results.map((r) => r.status),
      ["failed", "blocked"],
      problem,
    );
  }
});

test("ordinary assertion failures continue with independent factories and aggregate every outcome", async () => {
  const events = [],
    snapshots = [];
  let factories = 0;
  const results = await runFollowupCases(
    [
      spec("first", async () => {
        throw Error("actual guard");
      }),
      spec("second"),
    ],
    {
      ...quiet,
      limits,
      createHarness() {
        factories++;
        return harness(events);
      },
      async persistProgress(snapshot, index, signal) {
        assert.equal(signal.aborted, false);
        snapshots.push({ index, statuses: snapshot.map((r) => r.status) });
      },
      async persistAggregate(snapshot) {
        snapshots.push({ final: snapshot.map((r) => r.status) });
      },
    },
  );
  assert.equal(factories, 2);
  assert.deepEqual(
    results.map((r) => r.status),
    ["failed", "passed"],
  );
  assert.deepEqual(snapshots, [
    { index: 0, statuses: ["failed"] },
    { index: 1, statuses: ["failed", "passed"] },
    { final: ["failed", "passed"] },
  ]);
  await assert.rejects(boundedFollowupPhase("final manifest", 5, never), /final manifest exceeded/);
});

test("three deterministic B shards are disjoint, exhaustive and reject invalid options", async () => {
  const all = await registeredAnchorFollowups();
  for (const engine of ["local", "upstream"]) {
    const cases = all.filter((c) => c.batch === "b" && c.engine === engine);
    const shards = [0, 1, 2].map((shardIndex) =>
      selectFollowupShard(cases, { shardIndex, shardCount: 3 }),
    );
    assert.deepEqual(
      shards.map((s) => s.length),
      engine === "local" ? [9, 8, 8] : [7, 7, 7],
    );
    assert.equal(new Set(shards.flat()).size, cases.length);
    shards.forEach((shard, shardIndex) =>
      assert.deepEqual(
        shard,
        cases.filter((_, index) => index % 3 === shardIndex),
      ),
    );
    assert.deepEqual(
      shards.flat().sort((a, b) => cases.indexOf(a) - cases.indexOf(b)),
      cases,
    );
  }
  assert.deepEqual(selectFollowupShard(all), all);
  for (const options of [
    { shardCount: 0 },
    { shardCount: 1.5 },
    { shardCount: NaN },
    { shardIndex: -1 },
    { shardIndex: 1 },
    { shardIndex: 0.5, shardCount: 3 },
    { shardIndex: 1, shardCount: Infinity },
    { shardIndex: "0", shardCount: 3 },
  ])
    assert.throws(() => selectFollowupShard(all, options), /Expected integer/);
  assert.throws(() => selectFollowupShard([all[0]], { shardIndex: 2, shardCount: 3 }), /empty/);
});

test("teardown requires the owned listening port to close and never stops unrelated listeners", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    await assert.rejects(assertFollowupPortClosed(port), /still listens/);
    assert.equal(server.listening, true);
    const results = await runFollowupCases([spec("listener-left"), spec("later")], {
      ...quiet,
      limits,
      createHarness: () => harness([]),
      verifyStopped: () => assertFollowupPortClosed(port),
    });
    assert.deepEqual(
      results.map((r) => r.status),
      ["failed", "blocked"],
    );
    assert.match(results[0].cleanupError, /still listens/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await assertFollowupPortClosed(port);
});

test("the real controller wires setup, listener verification, sharded artifacts and final results", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "anchor-lifecycle-"));
  const lease = createServer();
  await new Promise((resolve) => lease.listen(0, resolve));
  const port = lease.address().port;
  await new Promise((resolve) => lease.close(resolve));
  const previousPort = process.env.BPMN_ANCHOR_FOLLOWUP_PORT;
  process.env.BPMN_ANCHOR_FOLLOWUP_PORT = String(port);
  const events = [],
    listener = createServer();
  try {
    await runAnchorFollowups(
      { batch: "b", engine: "local", shardIndex: 1, shardCount: 2 },
      {
        artifactRoot: directory,
        registerCases: async () =>
          [spec("unselected"), spec("selected")].map((c) => ({ ...c, batch: "b" })),
        harnessFactory({ port: selectedPort, output }) {
          assert.equal(selectedPort, port);
          assert.ok(output.endsWith("anchor-followup-b-local-shard-1-of-2"));
          const h = harness(events);
          const stop = h.stop;
          h.start = () => new Promise((resolve) => listener.listen(selectedPort, resolve));
          h.stop = async () => {
            await stop();
            if (listener.listening) await new Promise((resolve) => listener.close(resolve));
          };
          return h;
        },
      },
    );
    const output = path.join(directory, "anchor-followup-b-local-shard-1-of-2");
    const results = JSON.parse(await readFile(path.join(output, "results.json"), "utf8"));
    assert.deepEqual(
      results.map((r) => [r.id, r.status]),
      [["selected", "passed"]],
    );
    assert.equal(
      JSON.parse(await readFile(path.join(output, "results-progress-001.json"), "utf8"))[0].id,
      "selected",
    );
    assert.equal(listener.listening, false);
    assert.deepEqual(
      events.filter((e) => e === "save"),
      ["save", "save"],
      "initial and final evidence are wired inside lifecycle bounds",
    );
  } finally {
    if (previousPort === undefined) delete process.env.BPMN_ANCHOR_FOLLOWUP_PORT;
    else process.env.BPMN_ANCHOR_FOLLOWUP_PORT = previousPort;
    if (listener.listening) await new Promise((resolve) => listener.close(resolve));
    await rm(directory, { recursive: true });
  }
});
