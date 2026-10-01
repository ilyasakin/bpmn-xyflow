/** Linux CI supervisor. Only this invocation's process tree may be signalled. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BROWSER_SUITES = Object.freeze({
  'test:smoke': 'lib/demo/modeler/smoke-test.mjs',
  'test:react': 'lib/demo/react/smoke-test.mjs',
  'test:multi': 'lib/demo/multi-framework-smoke-test.mjs',
  'test:browser:viewer': 'test/viewer/browser-parity.mjs',
  'test:browser:scenarios': 'test/scenarios/browser.mjs',
  'test:browser:actions': 'test/modeling/browser-actions.mjs',
  'test:browser:connections': 'test/modeling/browser-connections.mjs',
  'test:browser:touch': 'test/modeling/browser-touch.mjs',
  'test:browser:core': 'test/modeling/browser-core-controls.mjs',
  'test:browser:advanced': 'test/modeling/browser-advanced-interactions.mjs',
  'test:browser:hits': 'test/modeling/browser-hit-priority.mjs',
  'test:browser:labels': 'test/modeling/browser-label-resize.mjs',
  'test:browser:io': 'test/modeling/browser-io-replacement.mjs'
});

const OWNER_KEY = 'BPMN_BROWSER_SUITE_OWNER';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseProcStat(text) {
  // comm is parenthesized and may itself contain spaces or closing parentheses.
  const end = text.lastIndexOf(')'), pid = Number(text.slice(0, text.indexOf(' ')));
  const fields = text.slice(end + 2).trim().split(/\s+/);
  if (end < 0 || !Number.isInteger(pid) || !/^\d+$/.test(fields[19] || '')) throw Error('Invalid process stat');
  return { pid, state: fields[0], ppid: Number(fields[1]), startTime: fields[19] };
}

async function processIdentity(pid) {
  try { return parseProcStat(await readFile(`/proc/${pid}/stat`, 'utf8')); }
  catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
}

export async function signalIdentity(identity, signal, { readIdentity = processIdentity, kill = process.kill } = {}) {
  const current = await readIdentity(identity.pid);
  if (!current || current.startTime !== identity.startTime || current.state === 'Z' || current.state === 'X') return false;
  try { kill(identity.pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function discoverOwned(token, known) {
  const all = new Map();
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const identity = await processIdentity(Number(name));
    if (identity) all.set(identity.pid, identity);
  }
  const owned = new Map();
  for (const current of all.values()) {
    const prior = known.get(current.pid);
    if (prior?.startTime === current.startTime) owned.set(current.pid, current);
    else {
      // Puppeteer starts Chrome in a separate process group. The inherited
      // random marker also finds descendants after their parent has exited.
      try {
        const environment = await readFile(`/proc/${current.pid}/environ`);
        if (environment.toString().split('\0').includes(`${OWNER_KEY}=${token}`)) owned.set(current.pid, current);
      } catch (error) {
        if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      }
    }
  }
  // Retain descendants that changed their environment while the parent lives.
  let changed;
  do {
    changed = false;
    for (const current of all.values()) {
      if (!owned.has(current.pid) && owned.has(current.ppid)) { owned.set(current.pid, current); changed = true; }
    }
  } while (changed);
  for (const current of owned.values()) known.set(current.pid, current);
  return [...owned.values()].filter(current => current.state !== 'Z' && current.state !== 'X');
}

export async function cleanupOwned(token, known, graceMs, pollMs, { discover = discoverOwned } = {}) {
  const errors = [], signalled = new Set();
  const listLive = async () => {
    try { return await discover(token, known); }
    catch (error) {
      errors.push({ operation: 'discover', code: error.code || error.message });
      // A tracking failure must not skip cleanup of identities already proven
      // to belong to this run. Recheck each identity; never broaden the scope.
      const live = [];
      for (const previous of known.values()) {
        try {
          const current = await processIdentity(previous.pid);
          if (current?.startTime === previous.startTime && current.state !== 'Z' && current.state !== 'X') live.push(current);
        } catch (readError) {
          errors.push({ operation: 'identity', pid: previous.pid, code: readError.code || readError.message });
          live.push(previous); // signalIdentity will independently recheck it.
        }
      }
      return live;
    }
  };
  for (const [signal, duration] of [['SIGTERM', graceMs], ['SIGKILL', 1000]]) {
    const deadline = performance.now() + duration;
    do {
      const live = await listLive();
      if (!live.length) return { remaining: [], errors, signalled: signalled.size };
      for (const identity of live) {
        const key = `${identity.pid}:${identity.startTime}:${signal}`;
        if (signalled.has(key)) continue;
        try { if (await signalIdentity(identity, signal)) signalled.add(key); }
        catch (error) { errors.push({ pid: identity.pid, signal, code: error.code || error.message }); }
      }
      await sleep(pollMs);
    } while (performance.now() < deadline);
  }
  return { remaining: await listLive(), errors, signalled: signalled.size };
}

/** Internal testable supervisor; the CLI below restricts executable suites. */
export async function runManagedProcess({ suite, command = process.execPath, args, cwd = root,
  logDir = path.join(cwd, 'test-artifacts/suite-logs'), timeoutMs = 300000,
  graceMs = 1500, pollMs = 50, env = process.env, stdout = process.stdout, stderr = process.stderr }) {
  if (process.platform !== 'linux') throw Error('Browser-suite cleanup requires Linux /proc');
  if (!/^[a-zA-Z0-9:-]+$/.test(suite)) throw Error('Invalid suite log name');
  for (const value of [timeoutMs, graceMs, pollMs]) if (!Number.isFinite(value) || value <= 0) throw Error('Invalid supervisor duration');
  await readdir('/proc'); // Fail before spawning if ownership tracking is unavailable.
  await mkdir(logDir, { recursive: true });
  const basename = path.join(logDir, suite.replaceAll(':', '-'));
  const files = await Promise.all(['log', 'stdout.log', 'stderr.log'].map(ext => open(`${basename}.${ext}`, 'w')));
  let writes = Promise.resolve(), logError;
  const log = (data, channel = 'stdout') => {
    (channel === 'stderr' ? stderr : stdout)?.write(data);
    writes = writes.then(() => Promise.all([files[0].write(data), files[channel === 'stderr' ? 2 : 1].write(data)]))
      .catch(error => { logError = error; });
  };
  const token = randomUUID(), known = new Map(), startedAt = new Date().toISOString(), started = performance.now();
  let child, outcome, interrupted, cleanup = { remaining: [], errors: [], signalled: 0 }, failure;
  const interrupt = signal => { interrupted = signal; };
  const onTerm = () => interrupt('SIGTERM'), onInt = () => interrupt('SIGINT');
  process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
  let closed = Promise.resolve();
  log(`START ${suite} ${startedAt} timeout=${timeoutMs}ms\n`);
  try {
    child = spawn(command, args, { cwd, env: { ...env, [OWNER_KEY]: token }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    closed = new Promise(resolve => child.once('close', resolve));
    child.once('error', error => { outcome = { code: 127, signal: null, error: error.message }; });
    child.once('exit', (code, signal) => { outcome = { code, signal }; });
    child.stdout.on('data', data => log(data)); child.stderr.on('data', data => log(data, 'stderr'));
    if (child.pid) { const identity = await processIdentity(child.pid); if (identity) known.set(identity.pid, identity); }
    while (!outcome && !interrupted && performance.now() - started < timeoutMs) {
      await discoverOwned(token, known);
      await sleep(Math.min(pollMs, Math.max(1, timeoutMs - (performance.now() - started))));
    }
  } catch (error) { failure = error; }
  const timedOut = !outcome && !interrupted && !failure;
  const resultBeforeCleanup = outcome;
  try { cleanup = await cleanupOwned(token, known, graceMs, pollMs); }
  catch (error) { failure ||= error; }
  await Promise.race([closed, sleep(1000)]);
  child?.stdout?.destroy(); child?.stderr?.destroy();
  process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onInt);
  let exitCode = timedOut ? 124 : interrupted ? 128 + constants.signals[interrupted]
    : resultBeforeCleanup?.code ?? (resultBeforeCleanup?.signal ? 128 + constants.signals[resultBeforeCleanup.signal] : 1);
  if ((failure || cleanup.remaining.length || cleanup.errors.length) && exitCode === 0) exitCode = 1;
  await writes;
  if (logError && exitCode === 0) exitCode = 1;
  const endedAt = new Date().toISOString(), elapsedMs = Math.round(performance.now() - started);
  const status = exitCode === 0 ? 'PASS' : 'FAIL';
  const detail = failure?.message || resultBeforeCleanup?.error || logError?.message;
  log(`${status} ${suite} ${endedAt} exit=${exitCode} elapsed=${elapsedMs}ms${timedOut ? ' TIMEOUT' : ''}${detail ? ` error=${detail}` : ''} cleanupRemaining=${cleanup.remaining.length}\n`);
  await writes;
  if (logError && exitCode === 0) { exitCode = 1; stderr?.write(`FAIL ${suite}: could not persist final log: ${logError.message}\n`); }
  const result = { suite, startedAt, endedAt, elapsedMs, timeoutMs, exitCode, timedOut,
    interrupted: interrupted || null, childExitCode: resultBeforeCleanup?.code ?? null,
    childSignal: resultBeforeCleanup?.signal ?? null, cleanup,
    error: failure?.message || resultBeforeCleanup?.error || logError?.message || null };
  try { await writeFile(`${basename}.json`, JSON.stringify(result, null, 2) + '\n'); }
  catch (error) {
    if (result.exitCode === 0) result.exitCode = 1;
    result.error ||= error.message;
    log(`FAIL ${suite}: could not persist result metadata: ${error.message}\n`, 'stderr');
    await writes;
  }
  await Promise.all(files.map(file => file.close()));
  return result;
}

export async function runBrowserSuite(suite) {
  if (!Object.hasOwn(BROWSER_SUITES, suite)) throw Error(`Unknown browser suite: ${suite}`);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const script = BROWSER_SUITES[suite];
  if (pkg.scripts[suite] !== `node ${script}`) throw Error(`Unexpected package script for ${suite}; review the supervisor allowlist`);
  // Execute the known Node entrypoint directly: no shell and no arbitrary npm script.
  return runManagedProcess({ suite, args: [script] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node test/run-browser-suite.mjs <known-browser-suite>');
    process.exitCode = (await runBrowserSuite(process.argv[2])).exitCode;
  } catch (error) { console.error(`FAIL browser-suite runner: ${error.message}`); process.exitCode = 1; }
}
