/** Actual Chromium regressions. No sandbox/security-disabling browser flags. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const port = Number(process.env.PORT || 5211);
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, [fileURLToPath(new URL('../../lib/demo/serve.mjs', import.meta.url))], {
  env: {...process.env, PORT: String(port)}, stdio: ['ignore', 'pipe', 'inherit']
});
child.stdout.on('data', () => {});
let browser;
try {
  const deadline = Date.now() + 60000;
  while (true) {
    try { if ((await fetch(base)).ok) break; } catch { /* server startup */ }
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('demo server did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await puppeteer.launch({ headless: 'shell' });
  const page = await browser.newPage();
  await page.setViewport({width:1188,height:762});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, {waitUntil:'networkidle0'});
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.startsWith('Loaded'));
  const first = await page.evaluate(() => {
    const task = document.querySelector('[data-element-id="Task_1"]');
    const logo = document.querySelector('.bjs-powered-by');
    const minimap = document.querySelector('.bpmn-xyflow-minimap');
    const l = logo.getBoundingClientRect(), m = minimap.getBoundingClientRect();
    return { width: task.getBoundingClientRect().width, zoom: window.viewer.getViewport().zoom,
      attributionVisible: l.width >= 50 && l.height >= 20,
      attributionClear: l.top >= m.bottom || l.right <= m.left || l.left >= m.right };
  });
  assert.ok(first.width >= 100, JSON.stringify(first));
  assert.ok(first.zoom >= 1, JSON.stringify(first));
  assert.ok(first.attributionVisible && first.attributionClear, JSON.stringify(first));

  // Fit/reset controls, minimap recreation, repeated imports and all visible samples.
  await page.click('#reset-zoom');
  assert.equal(await page.evaluate(() => window.viewer.getViewport().zoom), 1);
  await page.click('#fit-view');
  for (const index of ['1','2','3','4','5','6','7','8','0']) {
    await page.select('#sample-select', index);
    await page.waitForFunction(index => {
      const label = document.querySelector('#sample-select').options[Number(index)].text;
      return document.querySelector('#status').textContent.startsWith(`Loaded ${label}`);
    }, {}, index);
    assert.equal(await page.$eval('#viewer', el => el.querySelectorAll('.bjs-powered-by').length), 1);
  }
  const exported = await page.evaluate(async () => {
    const xml = await fetch('/test/fixtures/bpmn/align-elements.bpmn').then(r => r.text());
    await window.viewer.importXML(xml);
    const {svg} = await window.viewer.saveSVG();
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const references = Array.from(parsed.querySelectorAll('*')).flatMap(element => {
      const all = [...element.attributes].map(attr => attr.value).join(' ');
      return [...all.matchAll(/url\(["']?#([^)'"\s]+)/g)].map(match => match[1]);
    });
    const edge = window.viewer.getGraph().edges.find(edge => edge.label);
    return {references: references.length, dangling:references.filter(id => !parsed.getElementById(id)),
      duplicateLabel: !!document.querySelector(`[data-element-id="${edge.id}"] .bpmn-xyflow-connection-label`),
      exportedUi: !!parsed.querySelector('.bpmn-xyflow-selection-markers, .bpmn-xyflow-resize-handles')};
  });
  assert.ok(exported.references > 0);
  assert.deepEqual(exported.dangling, []);
  assert.equal(exported.duplicateLabel, false);
  assert.equal(exported.exportedUi, false);

  // Original project logo opens/closes the notice; repeating never duplicates it.
  await page.click('.bjs-powered-by');
  await page.waitForSelector('.bjs-powered-by-lightbox');
  await page.click('.bjs-powered-by-lightbox .backdrop', {offset:{x:5,y:5}});
  await page.waitForSelector('.bjs-powered-by-lightbox', {hidden:true});
  await page.click('.bjs-powered-by');
  assert.equal((await page.$$('.bjs-powered-by-lightbox')).length, 1);
  await page.click('.bjs-powered-by-lightbox .backdrop', {offset:{x:5,y:5}});

  // All framework wrappers inherit defaults and visible attribution.
  for (const route of ['react','vue','svelte']) {
    await page.goto(`${base}/${route}/`, {waitUntil:'networkidle0'});
    await page.waitForSelector('.bpmn-xyflow-shape');
    assert.equal((await page.$$('.bjs-powered-by')).length, 1, route);
    const size = await page.$eval('.bpmn-xyflow-shape', el => el.getBoundingClientRect().width);
    assert.ok(size >= 30, `${route}: ${size}`);
  }

  // Readability on dark hosts, selection UI, rename Escape, and repeated teardown.
  await page.goto(`${base}/modeler/`, {waitUntil:'networkidle0'});
  await page.waitForFunction(() => !!window.modeler?.getGraph());
  await page.select('#sample-select', '1');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.startsWith('Loaded Basic'));
  await page.addStyleTag({content:'html {color-scheme:dark} body {color:white} button {color:inherit}'});
  await page.evaluate(() => {
    const task = window.modeler.getGraph().nodes.find(node => node.type === 'bpmn:Task');
    window.modeler.select(task.id);
  });
  for (const selector of ['.bpmn-xyflow-palette button','.bpmn-xyflow-context-pad button']) {
    const colors = await page.$eval(selector, el => ({color:getComputedStyle(el).color, background:getComputedStyle(el).backgroundColor}));
    assert.equal(colors.color, 'rgb(34, 34, 34)', JSON.stringify(colors));
  }
  const before = await page.evaluate(() => {
    const task = window.modeler.getGraph().nodes.find(node => node.type === 'bpmn:Task');
    return {id:task.id,name:task.businessObject.name || '',zoom:window.modeler.getViewport().zoom};
  });
  await page.click(`[data-element-id="${before.id}"]`, {clickCount:2});
  await page.waitForSelector('[contenteditable]');
  await page.keyboard.type('Cancelled rename');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[contenteditable]', {hidden:true});
  const after = await page.evaluate(id => ({name:window.modeler.getElement(id).businessObject.name || '',zoom:window.modeler.getViewport().zoom}), before.id);
  assert.deepEqual(after,{name:before.name,zoom:before.zoom});
  assert.deepEqual(errors, []);
  console.log('PASS browser parity: fit, labels/markers/export, logo/minimap, repeated imports, wrappers, dark host controls, rename cancellation');
} finally {
  await browser?.close();
  child.kill('SIGTERM');
}
