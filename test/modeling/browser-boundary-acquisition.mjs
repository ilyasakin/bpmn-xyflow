/** Diagnostic repetition of the unchanged known intermittent F23-B workflow.
 * Passing repeats do not resolve the previously observed control disappearance. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createAnchorHarness } from '../helpers/anchor-ux-browser.mjs';
import { installBoundaryAcquisitionDiagnostics, markBoundaryAcquisitionPhase, readBoundaryAcquisitionDiagnostics } from '../helpers/boundary-acquisition-diagnostics.mjs';
import { runAnchorFollowups, registeredAnchorFollowups } from './browser-anchor-followup.mjs';

export async function runBoundaryAcquisitionDiagnostics({harnessFactory=createAnchorHarness, runner=runAnchorFollowups, registerCases=registeredAnchorFollowups}={}) {
const repeats=6, output='test-artifacts/boundary-acquisition-diagnostics';
let factoryIndex=0;
return runner({batch:'b',engine:'local'}, {
  artifactRoot:output,
  registerCases:async()=>{
    const cases=await registerCases();
    const found=cases.filter(c=>c.id==='F23-B'&&c.engine==='local'&&c.name==='selected-boundary-lower-origin');
    assert.equal(found.length,1,'exact unchanged recorded workflow');
    const original=found[0];
    return Array.from({length:repeats},(_,index)=>({...original,name:`${original.name}-diagnostic-${index+1}`}));
  },
  harnessFactory:options=>{
    const h=harnessFactory(options), index=++factoryIndex;
    const originalOpen=h.open;
    let page, originalScreenshot, originalEvaluate;
    const mark=label=>originalEvaluate(markBoundaryAcquisitionPhase,label);
    const observed=async(label,operation,after=async()=>{})=>{
      await mark(`${label}:before`);
      let result;
      try{result=await operation();}
      catch(error){
        // Evidence failure must never replace the original tested-operation
        // rejection. The whole-case runner will retain that original error.
        try{await mark(`${label}:rejected:${String(error)}`);await after();}catch{}
        throw error;
      }
      await mark(`${label}:after`);await after();return result;
    };
    const persist=async(label)=>{
      if(!page||page.isClosed())return;
      const evidence=await originalEvaluate(readBoundaryAcquisitionDiagnostics);
      await mkdir(output,{recursive:true});
      await writeFile(`${output}/repeat-${index}-${label}.json`,JSON.stringify(evidence,null,2));
    };
    h.open=async(...args)=>{
      const opened=await originalOpen(...args);page=opened.page;
      originalEvaluate=page.evaluate.bind(page);
      await originalEvaluate(installBoundaryAcquisitionDiagnostics);
      originalScreenshot=page.screenshot.bind(page);
      page.screenshot=async(...screenshotArgs)=>{
        const path=screenshotArgs[0]?.path || 'unnamed';
        return observed(`screenshot:${path}`,()=>originalScreenshot(...screenshotArgs),()=>persist('latest'));
      };
      // Mark read-only evaluation boundaries without changing their callback,
      // arguments, result or rejection. The observer uses the original binding.
      page.evaluate=async(fn,...args)=>{
        const signature=String(fn).slice(0,180);
        return observed(`evaluate:${signature}`,()=>originalEvaluate(fn,...args));
      };
      return opened;
    };
    const originalStop=h.stop;
    h.stop=async()=>{
      try{await persist('final');}
      finally{
        if(page){page.evaluate=originalEvaluate;page.screenshot=originalScreenshot;}
        await originalStop();
      }
    };
    return h;
  },
});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await runBoundaryAcquisitionDiagnostics();
