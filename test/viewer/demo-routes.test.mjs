import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('modeler serves every authored/retained sample byte-for-byte from its source fixture', async () => {
  const server = spawn(process.execPath, [fileURLToPath(new URL('../../lib/demo/serve.mjs', import.meta.url))], {
    env: {...process.env, PORT: '5227'}, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  server.stderr.on('data', data => { logs += data; });
  try {
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`demo server timeout: ${logs}`)), 60000);
      server.once('exit', code => { clearTimeout(timeout); reject(new Error(`demo exited ${code}: ${logs}`)); });
      server.stdout.on('data', data => {
        logs += data;
        const match = logs.match(/listening on (http:\/\/localhost:\d+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    for (const name of ['bpmn/basic.bpmn', 'bpmn/draw/conditional-flow.bpmn', 'scenarios/order-payment-delivery.bpmn', 'scenarios/approval-rejection-rework.bpmn', 'scenarios/booking-timeout-compensation.bpmn', 'bpmn/complex.bpmn']) {
      const response = await fetch(`${base}/test/fixtures/${name}`);
      assert.equal(response.status, 200, name);
      assert.equal(await response.text(), await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'), name);
    }
    const html = await fetch(`${base}/modeler/`).then(response => response.text());
    assert.ok(html.includes('warnings-out'));
    const script = await fetch(`${base}/modeler/index.js`).then(response => response.text());
    for (const label of ['Order, payment and delivery', 'Approval, rejection and rework', 'Booking, timeout and compensation', 'HR recruitment']) assert.ok(script.includes(label), label);
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  }
});
