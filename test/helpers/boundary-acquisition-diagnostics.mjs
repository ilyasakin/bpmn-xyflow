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
  const snapshot = () => {
    const handle=container.querySelector('.bpmn-xyflow-connect-handle');
    const docking=container.querySelector('.bpmn-xyflow-connect-docking');
    const port=handle?.querySelector('.bpmn-xyflow-connect-port');
    return { viewport: modeler.getViewport(), selection: modeler.getSelection(),
      history: { size:modeler.commandStack.size(), undo:modeler.canUndo(), redo:modeler.canRedo() },
      handle:identify(handle), marker:coordinate(docking?.querySelector('.bpmn-xyflow-connect-docking-point')),
      grab:coordinate(port), handleHTML:handle?.outerHTML || null, dockingHTML:docking?.outerHTML || null,
      matrix:matrix(container.querySelector('.bpmn-xyflow-viewport')),
      rootMatrix:matrix(container.querySelector('.bpmn-xyflow-canvas')),
      point, hit:point?identify(document.elementFromPoint(point.x,point.y)):null,
      focus:document.hasFocus(), visibility:document.visibilityState,
      active:identify(document.activeElement) };
  };
  const record=(type, details={})=>{
    if(disposed)return;
    records.push({ sequence:++sequence,time:performance.now(),type,details,state:snapshot() });
    if(records.length>2000){ records.shift(); dropped++; }
  };
  for(const type of ['pointermove','pointerdown','pointerup','pointerleave','pointerout','pointercancel','lostpointercapture','mousemove','mousedown','mouseup','blur','focus','resize','wheel','keydown','keyup','visibilitychange']){
    const callback=event=>{
      if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)) point={x:event.clientX,y:event.clientY};
      const details={trusted:event.isTrusted,client:point,button:event.button,buttons:event.buttons,
        pointerType:event.pointerType,key:event.key,deltaY:event.deltaY,
        targetKind:event.target===window?'window':event.target===document?'document':'node',
        target:identify(event.target),related:identify(event.relatedTarget)};
      record('native:'+type,details);
      queueMicrotask(()=>record('after:'+type,details));
    };
    window.addEventListener(type,callback,{capture:true,passive:true});
    disposers.push(()=>window.removeEventListener(type,callback,true));
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
    read:()=>({records:[...records],dropped,current:snapshot()}),
    stop:()=>{record('phase',{label:'stop'});disposed=true;observer.disconnect();disposers.forEach(dispose=>dispose());},
  };
  record('phase',{label:'installed'});
}

export function markBoundaryAcquisitionPhase(label) {
  window.boundaryAcquisitionDiagnostics?.mark(label);
}

export function readBoundaryAcquisitionDiagnostics() {
  if(!window.boundaryAcquisitionDiagnostics)throw Error('diagnostics missing');
  return window.boundaryAcquisitionDiagnostics.read();
}
