import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { THEME_DEFAULTS, themeToken, inheritTheme } from '../../lib/util/Theme.js';
import { setupDOM } from '../helpers/dom.mjs';

const dom = await setupDOM();
const { default: Modeler } = await dom.loadModule('/lib/Modeler.js');
const basic = await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8');
after(() => dom.cleanup());

test('semantic defaults exactly match the installed bpmn-js 18.30.1 theme', async () => {
  const pkg = JSON.parse(await readFile('node_modules/bpmn-js/package.json', 'utf8'));
  assert.equal(pkg.version, '18.30.1');
  const declarations = new Map();
  for (const file of [ 'bpmn-js', 'diagram-js' ]) {
    const css = await readFile(`node_modules/bpmn-js/dist/assets/${file}.css`, 'utf8');
    const tokens = css.match(/\.bio-theme-parent\s*\{([^}]+)\}/)[1];
    for (const [, name, value] of tokens.matchAll(/--bio-([^:]+):\s*([^;]+);/g)) declarations.set(name, value);
  }
  assert.deepEqual(Object.fromEntries(declarations), THEME_DEFAULTS);
  assert.equal(themeToken('selected-text'), 'var(--bio-selected-text, var(--bio-text, hsl(225, 10%, 15%)))');
  assert.throws(() => themeToken('unknown'), /Unknown/);
});

test('viewer leaves inherited theme variables unshadowed and selection uses semantic tokens', async () => {
  const parent = document.createElement('section');
  parent.style.setProperty('--bio-text', 'rgb(250, 240, 230)');
  document.body.appendChild(parent);
  const container = dom.createContainer();parent.appendChild(container);
  const modeler = new Modeler({container, fitViewOnInit:false, minimap:true});
  try {
    await modeler.importXML(basic);
    assert.equal(container.style.getPropertyValue('--bio-text'), '');
    assert.equal(parent.style.getPropertyValue('--bio-text'), 'rgb(250, 240, 230)');
    parent.style.setProperty('--bio-text', 'rgb(1, 2, 3)');
    assert.equal(container.style.getPropertyValue('--bio-text'), '');
    assert.equal(parent.style.getPropertyValue('--bio-text'), 'rgb(1, 2, 3)');
    const selectionCss=modeler.getSvg().querySelector('style').textContent;
    assert.ok(selectionCss.includes(`stroke: ${themeToken('canvas-accent')} !important`), 'selection must override renderer inline SVG stroke styles without changing DI');
    modeler.select('Task_1');
    assert.equal(container.querySelectorAll('.bjs-powered-by').length, 1);
    assert.ok(container.querySelector('.bpmn-xyflow-context-pad'));
    // happy-dom drops complex var() fallbacks in regular CSS properties.
    // Computed default colors, control overrides and SVG strokes are exercised
    // by browser-parity.mjs against real Chrome instead of mocked here.
  } finally {modeler.destroy();parent.remove();}
});

test('body-mounted editing overlays retain consumer-scoped semantic tokens', () => {
  const container = dom.createContainer(), overlay = document.createElement('div');
  container.style.setProperty('--bio-text', 'rgb(245, 245, 245)');
  container.style.setProperty('--bio-focus', 'rgb(12, 34, 56)');
  container.style.setProperty('--bpmn-xyflow-color-scheme', 'dark');
  inheritTheme(container, overlay);
  overlay.style.color = themeToken('text');document.body.appendChild(overlay);
  assert.equal(overlay.style.getPropertyValue('--bio-text'), 'rgb(245, 245, 245)');
  assert.equal(overlay.style.getPropertyValue('--bio-focus'), 'rgb(12, 34, 56)');
  assert.equal(overlay.style.getPropertyValue('--bpmn-xyflow-color-scheme'), 'dark');
  container.remove();overlay.remove();
});

test('selection theme is transient and SVG/XML exports retain document colors',async()=>{
  const modeler=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false});
  try {
    await modeler.importXML(basic);
    const task=modeler.getElement('Task_1');task.di.set('bioc:stroke','#123456');
    modeler.viewer._internals.redrawShape(task);
    const before=await modeler.getXML();
    modeler.getContainer().style.setProperty('--bio-canvas-accent','rgb(230, 140, 30)');
    modeler.select(task.id);
    assert.equal(await modeler.getXML(),before);
    assert.equal(task.di.get('bioc:stroke'),'#123456');
    const {svg}=await modeler.saveSVG();
    assert.ok(svg.includes('#123456'));
    assert.ok(!svg.includes('is-selected')&&!svg.includes('is-hovered'));
    assert.ok(!svg.includes('bpmn-xyflow-editor-actions')&&!svg.includes('bpmn-xyflow-resize-handles'));
    assert.ok(svg.includes('https://bpmn.io'));
    modeler.clearSelection();assert.equal(await modeler.getXML(),before);
  } finally {modeler.destroy();}
});
