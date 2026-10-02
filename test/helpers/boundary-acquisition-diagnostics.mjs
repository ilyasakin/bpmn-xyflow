/** Passive evidence only. Never dispatches input or changes modeling state. */
export function installBoundaryAcquisitionDiagnostics() {
  if (window.boundaryAcquisitionDiagnostics) throw Error('diagnostics already installed');
  const container = document.querySelector('#viewer');
  const modeler = window.modeler;
  if (!container || !modeler?.viewer) throw Error('loaded local modeler required');
  const records = [], identities = new WeakMap(), disposers = [];
  let sequence = 0, identity = 0, point = null, dropped = 0, disposed = false;
  const identify = element => {
    if (!element?.nodeType) return null;
    if (!identities.has(element)) identities.set(element, ++identity);
    return { identity: identities.get(element), tag: element.tagName || element.nodeName,
      class: element.getAttribute?.('class') || '',
      owner: element.closest?.('[data-element-id]')?.getAttribute('data-element-id') || null,
      source: element.closest?.('[data-connect-source]')?.getAttribute('data-connect-source') || null,
      connected: element.isConnected };
  };
  const matrix = element => {
    const m = element?.getScreenCTM?.();
    return m ? { a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f } : null;
  };
  const coordinate = element => element ? {
    x: Number(element.getAttribute('cx')), y: Number(element.getAttribute('cy')),
    r: Number(element.getAttribute('r')),
  } : null;
  const windowDimensions=()=>({innerWidth:window.innerWidth,innerHeight:window.innerHeight,
    outerWidth:window.outerWidth,outerHeight:window.outerHeight,devicePixelRatio:window.devicePixelRatio});
  let dimensions={window:windowDimensions(),observed:[]};
  const initialMatrix=matrix(container.querySelector('.bpmn-xyflow-viewport'));
  const initialRootMatrix=matrix(container.querySelector('.bpmn-xyflow-canvas'));
  const snapshot = (fresh=false) => {
    const handle=container.querySelector('.bpmn-xyflow-connect-handle');
    const docking=container.querySelector('.bpmn-xyflow-connect-docking');
    const port=handle?.querySelector('.bpmn-xyflow-connect-port');
    // The original acceptance driver already captured this matrix before the
    // product mouse handler. Reuse it; never force layout during diagnostics.
    const delivered=(window.anchorInput||[]).findLast(input=>input.screenMatrix);
    return { viewport: modeler.getViewport(), selection: modeler.getSelection(),
      history: { size:modeler.commandStack.size(), undo:modeler.canUndo(), redo:modeler.canRedo() },
      handle:identify(handle), marker:coordinate(docking?.querySelector('.bpmn-xyflow-connect-docking-point')),
      grab:coordinate(port),
      matrix:delivered?.screenMatrix || initialMatrix,rootMatrix:initialRootMatrix,
      matrixEvidence:delivered?{source:'existing native input',type:delivered.type,x:delivered.x,y:delivered.y}:{source:'installation'},
      point,dimensions,focus:document.hasFocus(),visibility:document.visibilityState,
      active:identify(document.activeElement),
      ...(fresh?{finalGeometry:{
        matrix:matrix(container.querySelector('.bpmn-xyflow-viewport')),
        rootMatrix:matrix(container.querySelector('.bpmn-xyflow-canvas')),
        hit:point?identify(document.elementFromPoint(point.x,point.y)):null,
        window:windowDimensions(),handleHTML:handle?.outerHTML || null,dockingHTML:docking?.outerHTML || null,
      }}:{}),
    };
  };
  const record=(type, details={})=>{
    if(disposed)return;
    records.push({ sequence:++sequence,time:performance.now(),type,details,state:snapshot() });
    if(records.length>2000){ records.shift(); dropped++; }
  };
  for(const type of ['pointermove','pointerdown','pointerup','pointerleave','pointerout','pointercancel','lostpointercapture','mousemove','mousedown','mouseup','blur','focus','resize','wheel','keydown','keyup','visibilitychange']){
    const callback=event=>{
      if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)) point={x:event.clientX,y:event.clientY};
      const previousDimensions=type==='resize'?dimensions:undefined;
      if(type==='resize')dimensions={...dimensions,window:windowDimensions()};
      const details={trusted:event.isTrusted,client:point,button:event.button,buttons:event.buttons,previousDimensions,
        pointerType:event.pointerType,key:event.key,deltaY:event.deltaY,
        targetKind:event.target===window?'window':event.target===document?'document':'node',
        target:identify(event.target),related:identify(event.relatedTarget)};
      record('native:'+type,details);
      queueMicrotask(()=>record('after:'+type,details));
    };
    window.addEventListener(type,callback,{capture:true,passive:true});
    disposers.push(()=>window.removeEventListener(type,callback,true));
  }
  if(window.__bpmnBoundaryTeardownRecord)throw Error('teardown observer already installed');
  window.__bpmnBoundaryTeardownErrors=[];
  window.__bpmnBoundaryTeardownRecord=details=>{
    const {handle,...values}=details;
    record('modeler:destroyConnectHandle',{...values,handle:identify(handle)});
  };
  disposers.push(()=>{delete window.__bpmnBoundaryTeardownRecord;});
  if(window.ResizeObserver){
    const sizes=new Map();
    const observer=new window.ResizeObserver(entries=>{
      for(const entry of entries)sizes.set(entry.target,{
        target:identify(entry.target),
        content:{x:entry.contentRect.x,y:entry.contentRect.y,width:entry.contentRect.width,height:entry.contentRect.height},
        border:[...(entry.borderBoxSize||[])].map(box=>({inlineSize:box.inlineSize,blockSize:box.blockSize})),
      });
      dimensions={...dimensions,observed:[...sizes.values()]};
      record('observer:resize',{entries:entries.map(entry=>sizes.get(entry.target))});
    });
    observer.observe(document.documentElement);observer.observe(container);
    disposers.push(()=>observer.disconnect());
  }
  let previousViewport=modeler.getViewport();
  for(const type of ['viewport.change','selection.change','element.hover','element.out','diagram.clear','import.done']){
    const dispose=modeler.viewer.on(type,event=>{
      record('viewer:'+type,{
        viewport:event?.viewport,previousViewport:type==='viewport.change'?previousViewport:undefined,
        ids:event?.ids,id:event?.id,eventType:event?.event?.type,target:identify(event?.event?.target),
        stack:['viewport.change','selection.change'].includes(type)?new Error('passive notification trace').stack:undefined,
      });
      if(type==='viewport.change')previousViewport=modeler.getViewport();
    });
    if(typeof dispose==='function')disposers.push(dispose);
  }
  const relevant=element=>element?.nodeType===1 && (
    element.matches?.('.bpmn-xyflow-connect-handle,.bpmn-xyflow-connect-docking,.bpmn-xyflow-connect-outline') ||
    element.closest?.('.bpmn-xyflow-connect-handle,.bpmn-xyflow-connect-docking,.bpmn-xyflow-connect-outline')
  );
  const observer=new MutationObserver(mutations=>{
    const changes=[];
    for(const mutation of mutations){
      const added=[...mutation.addedNodes].filter(relevant),removed=[...mutation.removedNodes].filter(relevant);
      if(!relevant(mutation.target)&&!added.length&&!removed.length)continue;
      changes.push({type:mutation.type,target:identify(mutation.target),attribute:mutation.attributeName,
        oldValue:mutation.oldValue,value:mutation.attributeName?mutation.target.getAttribute(mutation.attributeName):null,
        added:added.map(identify),removed:removed.map(element=>({...identify(element),html:element.outerHTML}))});
    }
    if(changes.length)record('mutation', {changes});
  });
  observer.observe(container,{subtree:true,childList:true,attributes:true,attributeOldValue:true});
  window.boundaryAcquisitionDiagnostics={
    mark:label=>record('phase',{label}),
    read:()=>({records:[...records],dropped,callbackErrors:[...window.__bpmnBoundaryTeardownErrors],current:snapshot(true)}),
    stop:()=>{record('phase',{label:'stop'});disposed=true;observer.disconnect();disposers.forEach(dispose=>dispose());},
  };
  record('phase',{label:'installed'});
  return { timeOrigin:performance.timeOrigin, installedAt:performance.now() };
}

export function markBoundaryAcquisitionPhase(label) {
  window.boundaryAcquisitionDiagnostics?.mark(label);
}

export function readBoundaryAcquisitionDiagnostics() {
  if(!window.boundaryAcquisitionDiagnostics)throw Error('diagnostics missing');
  return window.boundaryAcquisitionDiagnostics.read();
}
