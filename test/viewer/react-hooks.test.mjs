import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { setupDOM } from '../helpers/dom.mjs';

const dom = await setupDOM({ external: [ 'react', 'react-dom', 'react-dom/client', 'react-dom/test-utils' ] });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { useBpmnViewer } = await dom.loadModule('/lib/react/index.js');
const act = React.act || (await import('react-dom/test-utils')).act;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(async () => { delete globalThis.IS_REACT_ACT_ENVIRONMENT; await dom.cleanup(); });

test('useBpmnViewer publishes its instance reactively without an unrelated rerender', async () => {
  const states = [];
  let latest;
  function Consumer() {
    const result = useBpmnViewer({ fitViewOnInit: false });
    latest = result;
    React.useEffect(() => { states.push(result.viewer); }, [result.viewer]);
    return React.createElement('div', { ref: result.containerRef });
  }
  const host = dom.createContainer();
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(Consumer)); });
  assert.equal(states[0], null);
  assert.ok(states[1], 'consumer effect receives the created viewer');
  assert.equal(latest.viewer, latest.getViewer());
  assert.equal(host.querySelectorAll('.bjs-powered-by').length, 1);
  await act(async () => { root.unmount(); });
  assert.equal(latest.getViewer(), null);
  assert.equal(host.querySelectorAll('.bjs-powered-by').length, 0);
});

test('StrictMode leaves one live viewer and destroys it on unmount', async () => {
  let latest;
  function Consumer() {
    latest = useBpmnViewer({ fitViewOnInit: false });
    return React.createElement('div', { ref: latest.containerRef });
  }
  const host = dom.createContainer();
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Consumer))); });
  assert.ok(latest.viewer);
  assert.equal(latest.viewer, latest.getViewer());
  assert.equal(host.querySelectorAll('.bpmn-xyflow-canvas').length, 1);
  assert.equal(host.querySelectorAll('.bjs-powered-by').length, 1);
  await act(async () => { root.unmount(); });
  assert.equal(latest.getViewer(), null);
});
