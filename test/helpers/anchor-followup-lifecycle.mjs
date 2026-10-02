import { createConnection } from "node:net";

/** Follow-up-only lifecycle bounds. The reviewed green39 factory stays unchanged. */
export const FOLLOWUP_LIMITS = Object.freeze({
  setup: 90000,
  workflow: 90000,
  evidence: 10000,
  failureEvidence: 5000,
  teardown: 15000,
  persist: 5000,
});
export const FOLLOWUP_CASE_MAX_MS = Object.values(FOLLOWUP_LIMITS).reduce((a, b) => a + b, 0);

export class FollowupPhaseTimeout extends Error {
  constructor(phase, milliseconds) {
    super(`Native follow-up ${phase} exceeded ${milliseconds}ms`);
    this.name = "FollowupPhaseTimeout";
    this.phase = phase;
  }
}

/** Reject first, then abort observers. Late operation completion cannot become success. */
export async function boundedFollowupPhase(phase, milliseconds, operation) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw Error("Invalid lifecycle bound");
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new FollowupPhaseTimeout(phase, milliseconds);
      reject(error);
      controller.abort(error);
    }, milliseconds);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** One factory/browser per case; a failed teardown blocks subsequent cases. */
export async function runFollowupCase(
  c,
  {
    createHarness,
    prepare = async () => {},
    captureFailure = async () => {},
    verifyStopped = async () => {},
    persist = async () => {},
    limits = FOLLOWUP_LIMITS,
    log = console.log,
    errorLog = console.error,
  },
) {
  for (const key of Object.keys(FOLLOWUP_LIMITS))
    if (!Number.isFinite(limits[key]) || limits[key] <= 0) throw Error(`Invalid ${key} bound`);
  const { id, name, engine, sample } = c;
  const key = `${id}-${engine}-${name}`;
  const result = { id, name, engine, status: "failed", phases: [] };
  let h,
    opened,
    setup,
    retiring = false,
    fatal = false;
  const phase = async (name, operation) => {
    const started = performance.now();
    try {
      const value = await boundedFollowupPhase(name, limits[name], operation);
      result.phases.push({
        name,
        status: "passed",
        elapsedMs: Math.round(performance.now() - started),
      });
      return value;
    } catch (error) {
      result.phases.push({
        name,
        status: "failed",
        elapsedMs: Math.round(performance.now() - started),
        error: String(error),
      });
      if (error instanceof FollowupPhaseTimeout) result.timedOutPhase ??= name;
      throw error;
    }
  };
  log(`START anchor follow-up ${key}`);
  try {
    await phase("setup", () => {
      setup = (async () => {
        h = createHarness();
        await h.start();
        if (retiring) throw Error("Case setup completed after retirement");
        opened = await h.open(engine, sample);
        if (retiring) throw Error("Case page opened after retirement");
        return opened;
      })();
      return setup;
    });
    const details = await phase("workflow", async () => {
      await prepare(h, opened.page, key, c);
      return c.run(h, opened.page, key);
    });
    if (opened.errors.length) throw Error(`Browser errors: ${JSON.stringify(opened.errors)}`);
    await phase("evidence", () => h.save(opened.page, key, details));
    if (opened.errors.length) throw Error(`Browser errors: ${JSON.stringify(opened.errors)}`);
    result.status = "passed";
    result.details = details;
  } catch (error) {
    result.error = error.stack || String(error);
    result.browserErrors = opened?.errors || [];
    errorLog(`FAIL anchor follow-up ${key}: ${result.error}`);
    if (opened) {
      try {
        await phase("failureEvidence", (signal) =>
          captureFailure(h, opened.page, key, error, signal),
        );
      } catch (captureError) {
        result.evidenceError = String(captureError);
      }
    }
  } finally {
    retiring = true;
    try {
      await phase("teardown", async () => {
        // stop can race a still-pending start/open. Settle that setup, then stop
        // again so a browser allocated during the first stop cannot survive.
        await h?.stop();
        await setup?.catch(() => {});
        await h?.stop();
        if (opened && (!opened.page.isClosed() || opened.page.browser().isConnected()))
          throw Error("Owned case page/browser did not close");
        await verifyStopped(h);
      });
    } catch (error) {
      result.status = "failed";
      result.cleanupError = String(error);
      result.error ||= error.stack || String(error);
      fatal = true;
    }
    try {
      await phase("persist", (signal) => persist(result, signal));
    } catch (error) {
      result.status = "failed";
      result.persistenceError = String(error);
      result.error ||= error.stack || String(error);
      fatal = true;
    }
  }
  log(`${result.status === "passed" ? "PASS" : "FAIL"} anchor follow-up ${key}`);
  return { result, fatal };
}

export function selectFollowupShard(cases, { shardIndex = 0, shardCount = 1 } = {}) {
  if (
    !Number.isInteger(shardCount) ||
    shardCount < 1 ||
    !Number.isInteger(shardIndex) ||
    shardIndex < 0 ||
    shardIndex >= shardCount
  )
    throw Error("Expected integer shardCount >= 1 and 0 <= shardIndex < shardCount");
  const selected = cases.filter((_, index) => index % shardCount === shardIndex);
  if (!selected.length) throw Error("Native follow-up shard is empty");
  return selected;
}

/** Attempt every isolated case unless ownership cleanup or recording is uncertain. */
export async function runFollowupCases(
  cases,
  {
    createHarness,
    persistProgress = async () => {},
    persistAggregate = async () => {},
    verifyStopped = async () => {},
    ...options
  },
) {
  const results = [];
  for (const [index, c] of cases.entries()) {
    const { result, fatal } = await runFollowupCase(c, {
      ...options,
      createHarness: () => createHarness(c, index),
      verifyStopped: (h) => verifyStopped(h, c, index),
      persist: (result, signal) => persistProgress([...results, result], index, signal),
    });
    results.push(result);
    if (fatal) {
      for (const skipped of cases.slice(index + 1))
        results.push({
          id: skipped.id,
          name: skipped.name,
          engine: skipped.engine,
          status: "blocked",
          error:
            "Prior case teardown or evidence persistence could not be established within its bound",
        });
      break;
    }
  }
  await boundedFollowupPhase(
    "aggregate persistence",
    (options.limits || FOLLOWUP_LIMITS).persist,
    (signal) => persistAggregate(results, signal),
  );
  return results;
}

/** A returned factory stop must also retire its known listener; never signal other ports. */
export async function assertFollowupPortClosed(port, milliseconds = 1000) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid owned case port");
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "localhost", port, autoSelectFamily: true });
    const finish = (error) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(Error(`Could not verify owned case port ${port} closed`)),
      milliseconds,
    );
    socket.once("connect", () => finish(Error(`Owned case server still listens on port ${port}`)));
    socket.once("error", (error) => {
      const refused =
        error.code === "ECONNREFUSED" &&
        (!error.errors || error.errors.every((e) => e.code === "ECONNREFUSED"));
      finish(refused ? null : error);
    });
  });
}
