import { Window } from 'happy-dom';
import { createServer } from 'vite';

/**
 * Structural DOM harness only; text metrics / transforms are deliberately
 * minimal. Real geometry and input gestures must also pass browser suites.
 */
export async function setupDOM({ external = [] } = {}) {
  const window = new Window();
  for (const key of [ 'window', 'document', 'navigator', 'SVGElement', 'Element', 'XMLSerializer', 'DOMParser', 'HTMLElement', 'CSS', 'SVGMatrix', 'SVGTransform' ]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
  }
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  window.SVGTransformList.prototype.consolidate = function() { return this.numberOfItems ? this.getItem(0) : null; };
  window.SVGElement.prototype.getBBox = function() {
    const size = parseFloat(this.style?.fontSize) || 12;
    const lines = this.querySelectorAll('tspan');
    const texts = lines.length ? [ ...lines ].map(line => line.textContent || '') : [ this.textContent || '' ];
    return { x: 0, y: 0, width: Math.max(0, ...texts.map(text => text.length * size * 0.6)), height: size * Math.max(1, lines.length) };
  };
  window.SVGElement.prototype.getComputedTextLength = function() { return this.getBBox().width; };
  window.HTMLCanvasElement.prototype.getContext = function(type) {
    if (type !== '2d') return null;
    return {
      font: '12px Arial',
      measureText(text) {
        const width = String(text).length * 6;
        return { width, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width };
      }
    };
  };
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, ssr: { noExternal: true, external } });
  return {
    window,
    loadModule: path => vite.ssrLoadModule(path),
    createContainer(width = 1188, height = 762) {
      const container = document.createElement('div');
      document.body.appendChild(container);
      container.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height });
      return container;
    },
    async cleanup() { await vite.close(); await window.happyDOM.abort(); }
  };
}
