import { themeToken } from '../util/Theme';

/** Accessible entry points for core multi-selection and space operations. */
export default function installEditorActions(modeler, viewer, options = {}) {
  if (options.editorActions === false) return () => {};
  const container = viewer.getContainer(), svg = viewer.getSvg();
  const toolbar = document.createElement('div');
  toolbar.className = 'bpmn-xyflow-editor-actions';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Diagram editing actions');
  Object.assign(toolbar.style, {
    position:'absolute',top:'10px',left:options.palette === false ? '10px' : '150px',
    display:'flex',gap:'6px',padding:'5px',background:themeToken('surface'),color:themeToken('text'),
    border:`1px solid ${ themeToken('border') }`,borderRadius:themeToken('radius-lg'),zIndex:'6',font:'12px sans-serif',
    maxWidth:options.palette === false ? 'calc(100% - 20px)' : 'calc(100% - 160px)',
    flexWrap:'wrap',colorScheme:'var(--bpmn-xyflow-color-scheme, light)'
  });
  const selected = () => modeler.getSelection().map(id=>modeler.getElement(id))
    .filter(node=>node && !node.waypoints && node.type!=='label' && !node.hidden);
  function selector(label, items, action) {
    const select=document.createElement('select');
    select.setAttribute('aria-label',label);
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=label;select.appendChild(placeholder);
    for(const [value,text] of items){const option=document.createElement('option');option.value=value;option.textContent=text;select.appendChild(option);}
    Object.assign(select.style,{font:'inherit',background:themeToken('surface'),color:themeToken('text'),border:`1px solid ${ themeToken('border') }`,borderRadius:themeToken('radius-md'),minHeight:'26px'});
    select.addEventListener('change',()=>{if(select.value)action(select.value);select.value='';});
    toolbar.appendChild(select);return select;
  }
  const alignment=selector('Align selection',[
    ['left','Align left'],['center','Align center'],['right','Align right'],
    ['top','Align top'],['middle','Align middle'],['bottom','Align bottom']
  ],direction=>modeler.align(selected(),direction));
  const distribution=selector('Distribute selection',[
    ['horizontal','Distribute horizontally'],['vertical','Distribute vertically']
  ],axis=>modeler.distribute(selected(),axis));
  const space=document.createElement('button');space.type='button';space.textContent='Space tool';
  space.setAttribute('aria-pressed','false');
  space.title='Drag to add space. Hold Shift while dragging to remove space. Escape cancels.';
  Object.assign(space.style,{font:'inherit',background:themeToken('surface'),color:themeToken('text'),border:`1px solid ${ themeToken('border') }`,borderRadius:themeToken('radius-md'),minHeight:'26px',cursor:'pointer'});
  toolbar.appendChild(space);
  const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  Object.assign(status.style,{position:'absolute',width:'1px',height:'1px',overflow:'hidden',clipPath:'inset(50%)'});
  toolbar.appendChild(status);container.appendChild(toolbar);
  let armed=false,drag=null,guide=null;
  const point=event=>{const rect=container.getBoundingClientRect(),v=viewer.getViewport();return{x:(event.clientX-rect.left-v.x)/v.zoom,y:(event.clientY-rect.top-v.y)/v.zoom};};
  function reset() {
    armed=false;drag=null;guide?.remove();guide=null;
    space.setAttribute('aria-pressed','false');svg.style.cursor='';
  }
  function startMode() {
    if(armed){reset();return;}
    modeler.cancel();armed=true;space.setAttribute('aria-pressed','true');svg.style.cursor='crosshair';
    status.textContent='Space tool active. Drag to add space, Shift-drag to remove space, Escape to cancel.';
  }
  space.addEventListener('click',startMode);
  function down(event) {
    if(!armed||event.button!==0)return;
    event.preventDefault();event.stopImmediatePropagation();
    drag={start:point(event),shift:event.shiftKey};
    guide=document.createElement('div');guide.className='bpmn-xyflow-space-guide';
    Object.assign(guide.style,{position:'absolute',pointerEvents:'none',borderLeft:`2px dashed ${ themeToken('text') }`,zIndex:'7'});
    container.appendChild(guide);move(event);
  }
  function details(event) {
    const end=point(event),dx=end.x-drag.start.x,dy=end.y-drag.start.y;
    const horizontal=Math.abs(dx)>=Math.abs(dy),axis=horizontal?'horizontal':'vertical';
    const amount=horizontal?dx:dy;
    const direction=drag.shift ? (horizontal ? (amount>=0?'w':'e') : (amount>=0?'n':'s')) : undefined;
    return {axis,coordinate:horizontal?drag.start.x:drag.start.y,amount,direction};
  }
  function move(event) {
    if(!drag)return;
    event.preventDefault();event.stopImmediatePropagation();
    const {axis}=details(event),v=viewer.getViewport();
    if(axis==='horizontal')Object.assign(guide.style,{left:(drag.start.x*v.zoom+v.x)+'px',top:'0',width:'0',height:'100%',borderLeft:`2px dashed ${ themeToken('text') }`,borderTop:'0'});
    else Object.assign(guide.style,{left:'0',top:(drag.start.y*v.zoom+v.y)+'px',width:'100%',height:'0',borderTop:`2px dashed ${ themeToken('text') }`,borderLeft:'0'});
  }
  function up(event) {
    if(!drag)return;
    event.preventDefault();event.stopImmediatePropagation();
    const {axis,coordinate,amount,direction}=details(event);
    reset();
    if(Math.abs(amount)<1)return;
    const graph=modeler.getGraph();
    try {
      modeler.createSpace([...graph.nodes,...graph.edges],axis,coordinate,amount,{direction});
      status.textContent='Diagram space updated';
    } catch(error) {
      status.textContent=error.message || 'Could not update diagram space';
      viewer._internals?.emit?.('error',{error});
    }
  }
  function key(event){if(event.key==='Escape'&&armed){event.preventDefault();reset();status.textContent='Space operation cancelled';}}
  function refresh(){const length=selected().length;alignment.disabled=length<2;distribution.disabled=length<3;space.disabled=!modeler.getGraph();}
  svg.addEventListener('mousedown',down,true);
  window.addEventListener('mousemove',move,true);window.addEventListener('mouseup',up,true);
  window.addEventListener('keydown',key,true);window.addEventListener('blur',reset);
  const offSelection=viewer.on('selection.change',refresh);
  const offImport=viewer.on('import.parse.start',reset);
  const offDone=viewer.on('import.done',refresh);
  const offHistory=modeler.commandStack.onChange(() => { reset(); refresh(); });
  refresh();
  return () => {
    reset();offSelection();offImport();offDone();offHistory();toolbar.remove();
    svg.removeEventListener('mousedown',down,true);
    window.removeEventListener('mousemove',move,true);window.removeEventListener('mouseup',up,true);
    window.removeEventListener('keydown',key,true);window.removeEventListener('blur',reset);
  };
}
