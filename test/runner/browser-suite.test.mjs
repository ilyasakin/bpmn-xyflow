import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BROWSER_SUITE_TIMEOUTS, BROWSER_SUITES, cleanupOwned, parseProcStat, runBrowserSuite, runManagedProcess, signalIdentity } from '../run-browser-suite.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quiet = { write() {} };
async function harness(fn) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bpmn-suite-runner-'));
  const run = (script, options = {}) => runManagedProcess({ suite: 'test:fixture', args: ['-e', script],
    logDir: directory, timeoutMs: 2000, graceMs: 80, pollMs: 15, stdout: quiet, stderr: quiet, ...options });
  try { await fn({ directory, run }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function live(pid) {
  try { const identity = parseProcStat(await readFile(`/proc/${pid}/stat`, 'utf8')); return !['Z', 'X'].includes(identity.state); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

test('success streams and persists both output channels plus timing metadata', async () => harness(async ({ directory, run }) => {
  const stdout = [], stderr = [];
  const result = await run('console.log("hello stdout"); console.error("hello stderr");', {
    stdout: { write: value => stdout.push(String(value)) }, stderr: { write: value => stderr.push(String(value)) }
  });
  assert.equal(result.exitCode, 0); assert.equal(result.timedOut, false); assert.deepEqual(result.cleanup.remaining, []);
  assert.ok(Date.parse(result.endedAt) >= Date.parse(result.startedAt)); assert.ok(result.elapsedMs >= 0);
  assert.match(stdout.join(''), /START test:fixture.*\n[\s\S]*hello stdout[\s\S]*PASS test:fixture/);
  assert.match(stderr.join(''), /hello stderr/);
  assert.match(await readFile(path.join(directory, 'test-fixture.log'), 'utf8'), /hello stdout/);
  assert.match(await readFile(path.join(directory, 'test-fixture.stdout.log'), 'utf8'), /hello stdout/);
  assert.match(await readFile(path.join(directory, 'test-fixture.stderr.log'), 'utf8'), /hello stderr/);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'test-fixture.json'), 'utf8')).exitCode, 0);
}));

test('normal nonzero exit is preserved', async () => harness(async ({ run }) => {
  const result = await run('console.error("expected failure"); process.exit(7);');
  assert.equal(result.exitCode, 7); assert.equal(result.childExitCode, 7); assert.equal(result.timedOut, false);
}));

test('artifact-write failure reports explicit FAIL and a nonzero exit', async () => harness(async ({ directory, run }) => {
  await mkdir(path.join(directory, 'test-fixture.json'));
  const stderr = [], result = await run('console.log("normal child");', { stderr: { write: value => stderr.push(String(value)) } });
  assert.equal(result.exitCode, 1); assert.match(result.error, /EISDIR/);
  assert.match(stderr.join(''), /FAIL test:fixture: could not persist result metadata/);
  assert.match(await readFile(path.join(directory, 'test-fixture.stderr.log'), 'utf8'), /FAIL test:fixture/);
}));

test('spawn errors and signal exits report failure without hanging', async () => harness(async ({ run }) => {
  const missing = await run('', { command: '/does-not-exist/bpmn-runner-node' });
  assert.equal(missing.exitCode, 127); assert.match(missing.error, /ENOENT/);
  const signalled = await run('process.kill(process.pid,"SIGTERM");');
  assert.equal(signalled.exitCode, 143); assert.equal(signalled.childSignal, 'SIGTERM');
}));

test('deadline is a nonzero timeout and terminates an uncooperative root', async () => harness(async ({ directory, run }) => {
  const result = await run('process.on("SIGTERM",()=>{}); setInterval(()=>{},100);', { timeoutMs: 150 });
  assert.equal(result.exitCode, 124); assert.equal(result.timedOut, true);
  assert.ok(result.elapsedMs >= 150 && result.elapsedMs < 3000); assert.deepEqual(result.cleanup.remaining, []);
  assert.match(await readFile(path.join(directory, 'test-fixture.log'), 'utf8'), /FAIL test:fixture.*TIMEOUT/);
}));

function descendantFixture(pidFile, mode) {
  const leaf = `require('node:fs').appendFileSync(${JSON.stringify(pidFile)},process.pid+'\\n'); process.on('SIGTERM',()=>{});setInterval(()=>{},100);`;
  const middle = `const {spawn}=require('node:child_process');require('node:fs').appendFileSync(${JSON.stringify(pidFile)},process.pid+'\\n');const c=spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{detached:true,stdio:'ignore'});c.unref();process.on('SIGTERM',()=>{});setInterval(()=>{},100);`;
  return `const {spawn}=require('node:child_process'),fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},process.pid+'\\n');const c=spawn(process.execPath,['-e',${JSON.stringify(middle)}],{detached:true,stdio:'ignore'});c.unref();const check=setInterval(()=>{if(fs.readFileSync(${JSON.stringify(pidFile)},'utf8').trim().split('\\n').length===3){clearInterval(check);${mode === 'timeout' ? "process.on('SIGTERM',()=>{});setInterval(()=>{},100);" : `process.exit(${mode});`}}},10);`;
}

for (const mode of ['timeout', 0, 9]) test(`cleans nested detached descendants after ${mode}; unrelated process survives`, async () => harness(async ({ directory, run }) => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},100)'], { detached: true, stdio: 'ignore' });
  const ended = new Promise(resolve => unrelated.once('exit', resolve));
  try {
    const pidFile = path.join(directory, 'owned-pids');
    const result = await run(descendantFixture(pidFile, mode), { timeoutMs: mode === 'timeout' ? 800 : 2000 });
    assert.equal(result.exitCode, mode === 'timeout' ? 124 : mode);
    assert.deepEqual(result.cleanup.remaining, []);
    const pids = (await readFile(pidFile, 'utf8')).trim().split('\n').map(Number); assert.equal(pids.length, 3);
    for (const pid of pids) assert.equal(await live(pid), false, `owned descendant ${pid} must be gone`);
    assert.equal(await live(unrelated.pid), true, 'runner must not kill an unrelated Node process');
  } finally { unrelated.kill('SIGKILL'); await ended; }
}));

test('normal root exit is not blocked by a detached descendant holding its stdout pipe', async () => harness(async ({ directory, run }) => {
  const pidFile = path.join(directory, 'pipe-child');
  const child = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); console.log('descendant output'); setInterval(()=>{},100);`;
  const script = `const fs=require('node:fs'),c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:['ignore',1,2]});c.unref();const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(pidFile)})){clearInterval(t);process.exit(0);}},10);`;
  const result = await run(script);
  assert.equal(result.exitCode, 0); assert.equal(result.timedOut, false);
  assert.equal(await live(Number(await readFile(pidFile, 'utf8'))), false);
  assert.match(await readFile(path.join(directory, 'test-fixture.stdout.log'), 'utf8'), /descendant output/);
}));

test('PID identity guard refuses reused PID and zombie before signalling', async () => {
  const sent = [], identity = { pid: 123, startTime: '99' };
  const kill = (...args) => sent.push(args);
  assert.equal(await signalIdentity(identity, 'SIGKILL', { kill, readIdentity: async () => ({ pid: 123, startTime: '100', state: 'S' }) }), false);
  assert.equal(await signalIdentity(identity, 'SIGKILL', { kill, readIdentity: async () => ({ ...identity, state: 'Z' }) }), false);
  assert.deepEqual(sent, []);
  assert.equal(await signalIdentity(identity, 'SIGTERM', { kill, readIdentity: async () => ({ ...identity, state: 'S' }) }), true);
  assert.deepEqual(sent, [[123, 'SIGTERM']]);
});

test('discovery errors still clean already-owned identities and remain visible', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},100)'], { stdio: 'ignore' });
  const ended = new Promise(resolve => child.once('exit', resolve));
  try {
    const identity = parseProcStat(await readFile(`/proc/${child.pid}/stat`, 'utf8'));
    const result = await cleanupOwned('test-marker', new Map([[identity.pid, identity]]), 80, 15, {
      discover: async () => { throw Object.assign(Error('synthetic tracking failure'), { code: 'EIO' }); }
    });
    assert.deepEqual(result.remaining, []); assert.ok(result.errors.some(error => error.operation === 'discover' && error.code === 'EIO'));
    assert.equal(await live(child.pid), false);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await ended; }
});

test('stat parser handles spaces and parentheses in process names', () => {
  const values = ['S', '5', '5', ...Array(16).fill('0'), '123456', '0'];
  assert.deepEqual(parseProcStat(`44 (a process) name) ${values.join(' ')}`), { pid: 44, state: 'S', ppid: 5, startTime: '123456' });
});

test('CLI accepts only the reviewed browser script allowlist', async () => {
  assert.ok(Object.hasOwn(BROWSER_SUITES, 'test:browser:hits'));
  assert.equal(BROWSER_SUITES['test:browser:labels'], 'test/modeling/browser-label-resize.mjs');
  for (const name of ['test:unit', '../anything', 'test:smoke; echo injected', '__proto__']) await assert.rejects(runBrowserSuite(name), /Unknown browser suite/);
});

test('runner cleans owned descendants on external termination and reports the signal', async () => harness(async ({ directory }) => {
  const script = path.resolve('test/run-browser-suite.mjs');
  const pidFile = path.join(directory, 'interrupted-pids');
  const input = `import {runManagedProcess} from ${JSON.stringify('file://' + script)};const r=await runManagedProcess({suite:'test:interrupted',args:['-e',${JSON.stringify(descendantFixture(pidFile, 'timeout'))}],logDir:${JSON.stringify(directory)},graceMs:80,pollMs:15});process.exitCode=r.exitCode;`;
  const runner = spawn(process.execPath, ['--input-type=module', '-e', input], { stdio: 'ignore' });
  const ended = new Promise(resolve => runner.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    const deadline = Date.now() + 2500;
    while (true) { try { if ((await readFile(pidFile, 'utf8')).trim().split('\n').length === 3) break; } catch {} if (Date.now() > deadline) throw Error('Fixture did not become ready'); await sleep(15); }
    runner.kill('SIGTERM'); const result = await ended; assert.equal(result.code, 143); assert.equal(result.signal, null);
    const metadata = JSON.parse(await readFile(path.join(directory, 'test-interrupted.json'), 'utf8'));
    assert.equal(metadata.interrupted, 'SIGTERM'); assert.deepEqual(metadata.cleanup.remaining, []);
    for (const pid of (await readFile(pidFile, 'utf8')).trim().split('\n').map(Number)) assert.equal(await live(pid), false);
  } finally { if (runner.exitCode === null) runner.kill('SIGKILL'); }
}));


test('follow-up supervisor budgets include every bounded case and cleanup', () => {
  const groups = [["a-local", 11], ["a-upstream", 1], ["b-local-1", 9], ["b-local-2", 8], ["b-local-3", 8], ["b-upstream-1", 7], ["b-upstream-2", 7], ["b-upstream-3", 7], ["c-local", 4]];
  for (const [suffix, count] of groups) {
    const name = `test:browser:anchor-followup-${suffix}`;
    assert.equal(BROWSER_SUITES[name], `test/modeling/browser-anchor-followup-${suffix}.mjs`);
    assert.ok(BROWSER_SUITE_TIMEOUTS[name] >= count * 215000 + 90000);
    assert.ok(BROWSER_SUITE_TIMEOUTS[name] < 45 * 60000);
  }
});

test('viewport source lifecycle fits its bounded supervisor and CI job', () => {
  assert.equal(BROWSER_SUITES['test:browser:viewport-source'], 'test/modeling/browser-viewport-source-grabs.mjs');
  assert.equal(BROWSER_SUITE_TIMEOUTS['test:browser:viewport-source'], 12 * 215000 + 90000);
  assert.ok(BROWSER_SUITE_TIMEOUTS['test:browser:viewport-source'] < 45 * 60000);
});


test('six unchanged boundary diagnostics have a dedicated bounded supervisor', () => {
  assert.equal(BROWSER_SUITES['test:browser:boundary-acquisition'], 'test/modeling/browser-boundary-acquisition.mjs');
  assert.equal(BROWSER_SUITE_TIMEOUTS['test:browser:boundary-acquisition'], 6 * 215000 + 90000);
  assert.ok(BROWSER_SUITE_TIMEOUTS['test:browser:boundary-acquisition'] < 30 * 60000);
});
