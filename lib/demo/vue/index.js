import { createApp, defineComponent, h, ref, onMounted } from 'vue';

import { BpmnViewer } from '../../vue';

const SAMPLES = [
  { label: 'Basic', path: 'basic.bpmn' },
  { label: 'Task types', path: 'draw/task-types.bpmn' },
  { label: 'Conditional flows', path: 'draw/conditional-flow.bpmn' },
  { label: 'Pools', path: 'collaboration.bpmn' },
  { label: 'Complex', path: 'complex.bpmn' }
];

const FIXTURE_BASE = '/test/fixtures/bpmn/';

const App = defineComponent({
  setup() {
    const idx = ref(0);
    const xml = ref('');
    const status = ref('');
    const selection = ref([]);
    const viewerRef = ref(null);

    let loadSequence = 0;
    async function loadSample(i) {
      const sequence = ++loadSequence;
      status.value = 'Fetching ' + SAMPLES[i].label + '...';
      try {
        const response = await fetch(FIXTURE_BASE + SAMPLES[i].path);
        if (!response.ok) throw new Error(`HTTP ${ response.status }`);
        const text = await response.text();
        if (sequence === loadSequence) xml.value = text;
      } catch (error) {
        if (sequence === loadSequence) status.value = 'Error: ' + error.message;
      }
    }

    onMounted(() => loadSample(idx.value));

    return () => h('div', { class: 'app' }, [
      h('div', { class: 'toolbar' }, [
        h('select', {
          value: idx.value,
          onChange: (e) => {
            idx.value = Number(e.target.value);
            loadSample(idx.value);
          }
        }, SAMPLES.map((s, i) => h('option', { key: i, value: i }, s.label))),
        h('button', { onClick: () => viewerRef.value?.fitView() }, 'Fit view'),
        h('button', { onClick: () => viewerRef.value?.setViewport({ x: 0, y: 0, zoom: 1 }) }, 'Reset'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'info', id: 'selection' },
          selection.value.length
            ? `Selected: ${ selection.value.map(e => e.type.replace('bpmn:', '') + (e.businessObject.name ? ` "${ e.businessObject.name }"` : '')).join(', ') }`
            : ''
        ),
        h('span', { class: 'info', id: 'status' }, status.value)
      ]),
      h('div', { class: 'viewer-host' }, [
        h(BpmnViewer, {
          ref: viewerRef,
          xml: xml.value,
          minimap: true,
          onLoad: (result) => { status.value = `Loaded (${ result.warnings.length } warnings)`; },
          onError: (err) => { status.value = 'Error: ' + err.message; },
          'onSelection-change': ({ elements }) => { selection.value = elements; }
        })
      ])
    ]);
  }
});

const app = createApp(App);
app.mount('#root');

window.__bpmn_vue_app = app;
