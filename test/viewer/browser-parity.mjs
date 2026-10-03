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

  // Switching subprocess planes must not render outer/sibling diagrams.
  const activeViews = await page.evaluate(async () => {
    await window.viewer.importXML(await fetch('/test/fixtures/bpmn/collapsed-sub-process.bpmn').then(r => r.text()));
    const definitions = window.viewer.getDefinitions();
    const parent = definitions.diagrams[0];
    const child = definitions.diagrams.find(diagram => diagram.plane.bpmnElement.id === 'collapsedProcess');
    const results = [];
    for (const diagram of [child, parent, child, parent]) {
      await window.viewer.switchDiagram(diagram.id);
      const graph = window.viewer.getGraph();
      const active = new Set(diagram.plane.planeElement);
      results.push(graph.roots.length === 1 && graph.diagram === diagram &&
        graph.nodes.every(node => active.has(node.di)) && graph.edges.every(edge => active.has(edge.di)) &&
        document.querySelectorAll('.bpmn-xyflow-shape').length === graph.nodes.filter(node => !node.hidden && node.type !== 'label').length);
    }
    return results;
  });
  assert.deepEqual(activeViews, [true, true, true, true]);

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
  const safeFit = await page.evaluate(() => {
    const obstacles = [...document.querySelectorAll('.bpmn-xyflow-palette, .bpmn-xyflow-minimap, .bpmn-xyflow-editor-actions, .bjs-powered-by')]
      .map(element => element.getBoundingClientRect()).filter(rect => rect.width && rect.height);
    const canvas = document.querySelector('#viewer').getBoundingClientRect();
    return [...document.querySelectorAll('.bpmn-xyflow-shape')].map(element => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset.elementId,
        inside: rect.left >= canvas.left && rect.right <= canvas.right && rect.top >= canvas.top && rect.bottom <= canvas.bottom,
        blocked: obstacles.some(obstacle => rect.left < obstacle.right && rect.right > obstacle.left && rect.top < obstacle.bottom && rect.bottom > obstacle.top) };
    });
  });
  assert.ok(safeFit.every(shape => shape.inside && !shape.blocked), JSON.stringify(safeFit));
  await page.addStyleTag({content:'html {color-scheme:dark} body {color:white} button {color:inherit}'});
  await page.evaluate(() => {
    const task = window.modeler.getGraph().nodes.find(node => node.type === 'bpmn:Task');
    window.modeler.select(task.id);
  });
  for (const selector of ['.bpmn-xyflow-palette button','.bpmn-xyflow-context-pad button']) {
    const colors = await page.$eval(selector, el => ({color:getComputedStyle(el).color, background:getComputedStyle(el).backgroundColor}));
    assert.equal(colors.color, 'rgb(34, 36, 42)', JSON.stringify(colors));
  }
  // Upstream semantic defaults and consumer theme overrides share one contract.
  // Ancestor changes must work without reconstructing the viewer or modeler.
  await page.keyboard.press('Tab');
  const themed = await page.evaluate(() => {
    const container = window.modeler.getContainer();
    const parent = container.parentElement;
    const overrides = {
      '--bio-text':'rgb(250, 240, 230)', '--bio-surface':'rgb(25, 30, 35)',
      '--bio-surface-overlay':'rgb(30, 35, 40)', '--bio-surface-subtle':'rgb(35, 40, 45)',
      '--bio-border':'rgb(110, 120, 130)', '--bio-radius-md':'7px',
      '--bio-canvas-accent':'rgb(230, 140, 30)', '--bio-focus':'rgb(200, 100, 30)'
    };
    for (const [key,value] of Object.entries(overrides)) parent.style.setProperty(key,value);
    const palette = container.querySelector('.bpmn-xyflow-palette');
    const button = palette.querySelector('button');button.focus();
    const css = getComputedStyle(button), paletteCss=getComputedStyle(palette);
    const selected = container.querySelector('.bpmn-xyflow-shape.is-selected rect');
    const result = {color:css.color, background:paletteCss.backgroundColor, border:css.borderTopColor,
      radius:css.borderTopLeftRadius, focus:css.outlineColor, stroke:getComputedStyle(selected).stroke,
      logo:getComputedStyle(container.querySelector('.bjs-powered-by')).color};
    container.style.setProperty('--bio-text','rgb(1, 2, 3)');
    result.localColor=getComputedStyle(button).color;
    container.style.removeProperty('--bio-text');
    for (const key of Object.keys(overrides)) parent.style.removeProperty(key);
    return result;
  });
  assert.deepEqual(themed,{color:'rgb(250, 240, 230)',background:'rgb(35, 40, 45)',border:'rgb(110, 120, 130)',
    radius:'7px',focus:'rgb(200, 100, 30)',stroke:'rgb(230, 140, 30)',logo:'rgb(250, 240, 230)',localColor:'rgb(1, 2, 3)'});
  const before = await page.evaluate(() => {
    const task = window.modeler.getGraph().nodes.find(node => node.type === 'bpmn:Task');
    return {id:task.id,name:task.businessObject.name || '',zoom:window.modeler.getViewport().zoom};
  });
  await page.click(`[data-element-id="${before.id}"]`, {count:2,delay:50});
  await page.waitForSelector('[contenteditable]');
  await page.keyboard.type('Cancelled rename');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[contenteditable]', {hidden:true});
  const after = await page.evaluate(id => ({name:window.modeler.getElement(id).businessObject.name || '',zoom:window.modeler.getViewport().zoom}), before.id);
  assert.deepEqual(after,{name:before.name,zoom:before.zoom});
  // Every business example is reachable through the actual sample menu;
  // switching after edits resets history, selection and pending overlays.
  for (const index of ['3', '4', '5', '6']) {
    await page.evaluate(() => {
      const task = window.modeler.getGraph().nodes.find(node => node.type === 'bpmn:Task');
      if (task) window.modeler.moveShape(task, {x:10,y:0});
    });
    await page.select('#sample-select', index);
    await page.waitForFunction(index => {
      const label = document.querySelector('#sample-select').options[Number(index)].text;
      return document.querySelector('#status').textContent.startsWith(`Loaded ${label}`);
    }, {}, index);
    const state = await page.evaluate(() => ({undo: window.modeler.canUndo(), selection: window.modeler.getSelection(), nodes: window.modeler.getGraph().nodes.length}));
    assert.equal(state.undo, false);
    assert.deepEqual(state.selection, []);
    assert.ok(state.nodes > 5);
    assert.equal((await page.$$('[contenteditable]')).length, 0);
  }
  const externalRequests=[];
  page.on('request', request => { if(request.url().includes('bpmn-security.invalid')) externalRequests.push(request.url()); });
  const inert=await page.evaluate(async()=>{
    window.__bpmnSecurityExecution=0;
    const xml='<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:d="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:h="http://www.w3.org/1999/xhtml" targetNamespace="urn:security"><b:process id="SecurityProcess"><b:task id="SecurityTask" name="&lt;img src=x onerror=alert(1)&gt;"><b:extensionElements><h:script>window.__bpmnSecurityExecution=1</h:script><h:img src="https://bpmn-security.invalid/pixel"/><h:iframe src="https://bpmn-security.invalid/frame"/></b:extensionElements></b:task></b:process><d:BPMNDiagram id="SecurityDiagram"><d:BPMNPlane id="SecurityPlane" bpmnElement="SecurityProcess"><d:BPMNShape id="SecurityTask_di" bpmnElement="SecurityTask"><dc:Bounds x="100" y="100" width="100" height="80"/></d:BPMNShape></d:BPMNPlane></d:BPMNDiagram></b:definitions>';
    await window.modeler.importXML(xml);
    const before=window.modeler.getGraph();
    let rejected=false;
    try {await window.modeler.importXML('<!DOCTYPE b:definitions SYSTEM "https://bpmn-security.invalid/external.dtd">'+xml);}catch{rejected=true;}
    const exported=await window.modeler.getXML();
    return {rejected,keptGraph:window.modeler.getGraph()===before,live:window.modeler.getContainer().querySelectorAll('script,img,iframe,foreignObject').length,exported};
  });
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(inert.rejected,true);assert.equal(inert.keptGraph,true);assert.equal(inert.live,0);
  assert.ok(inert.exported.includes('window.__bpmnSecurityExecution=1'));
  assert.equal(await page.evaluate(()=>window.__bpmnSecurityExecution),0);
  assert.deepEqual(externalRequests,[]);
  assert.deepEqual(errors, []);
  console.log('PASS browser parity: fit, labels/markers/export, logo/minimap, repeated imports, wrappers, dark host controls, rename cancellation, inert hostile XML');
} finally {
  await browser?.close();
  child.kill('SIGTERM');
}
