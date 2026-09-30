/**
 * Semantic defaults from bpmn-js 18.30.1 dist/assets/{diagram-js,bpmn-js}.css,
 * copied there from @bpmn-io/theme. Keep upstream names and values intact.
 * Source: https://github.com/bpmn-io/bpmn-js/tree/v18.30.1
 * See LICENSE for the retained bpmn.io source license and attribution terms.
 *
 * Fallbacks, rather than declarations on the canvas, allow consumer --bio-*
 * values to inherit from any ancestor and remain reactive to CSS theme changes.
 * Upstream diagram-js selectors are intentionally not loaded into this engine.
 */
export const THEME_DEFAULTS = Object.freeze({
  'surface': 'hsl(0, 0%, 100%)',
  'surface-overlay': 'hsl(0, 0%, 100%)',
  'surface-subtle': 'hsl(225, 10%, 97%)',
  'surface-medium': 'hsl(225, 10%, 95%)',
  'surface-inverted': 'hsl(0, 0%, 22%)',
  'surface-inverted-subtle': 'hsl(225, 10%, 35%)',
  'text': 'hsl(225, 10%, 15%)',
  'text-subtle': 'hsl(225, 10%, 35%)',
  'text-subtlest': 'hsl(225, 10%, 55%)',
  'text-on-inverted': 'hsl(0, 0%, 100%)',
  'text-on-primary': 'hsl(0, 0%, 100%)',
  'border': 'hsl(225, 10%, 75%)',
  'border-disabled': 'hsl(225, 10%, 90%)',
  'primary': 'hsl(205, 100%, 40%)',
  'primary-surface': 'hsl(205, 100%, 95%)',
  'danger': 'hsl(360, 100%, 45%)',
  'danger-surface-subtle': 'hsl(360, 100%, 97%)',
  'selected-surface': 'var(--bio-surface-medium)',
  'selected-text': 'var(--bio-text)',
  'focus': 'hsl(205, 100%, 40%)',
  'focus-surface': 'hsl(205, 100%, 95%)',
  'canvas-accent': 'hsl(205, 100%, 40%)',
  'canvas-accent-subtle': 'hsl(205, 100%, 75%)',
  'shadow': 'hsla(0, 0%, 0%, 30%)',
  'shadow-subtle': 'hsla(0, 0%, 0%, 10%)',
  'radius-sm': '2px',
  'radius-md': '3px',
  'radius-lg': '4px'
});

/** Resolve semantic aliases too, without suppressing a consumer's CSS value. */
export function themeToken(name) {
  const value = THEME_DEFAULTS[name];
  if (!value) throw new Error(`Unknown bpmn.io theme token: ${ name }`);
  const alias = /^var\(--bio-([^,)]+)\)$/.exec(value);
  return `var(--bio-${ name }, ${ alias ? themeToken(alias[1]) : value })`;
}

/** Carry scoped theme overrides into a body-mounted editing/drag overlay. */
export function inheritTheme(source, overlay) {
  const computed = source.ownerDocument.defaultView.getComputedStyle(source);
  for (const name of Object.keys(THEME_DEFAULTS)) {
    const property = `--bio-${ name }`;
    const value = computed.getPropertyValue(property);
    if (value) overlay.style.setProperty(property, value);
  }
  const scheme = computed.getPropertyValue('--bpmn-xyflow-color-scheme');
  if (scheme) overlay.style.setProperty('--bpmn-xyflow-color-scheme', scheme);
  overlay.style.colorScheme = 'var(--bpmn-xyflow-color-scheme, light)';
}
