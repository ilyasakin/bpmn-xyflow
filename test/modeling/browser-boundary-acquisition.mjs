/** Diagnostic repetition of the unchanged known intermittent F23-B workflow.
 * Passing repeats do not resolve the previously observed control disappearance. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAnchorHarness } from '../helpers/anchor-ux-browser.mjs';
import { installBoundaryAcquisitionDiagnostics, readBoundaryAcquisitionDiagnostics } from '../helpers/boundary-acquisition-diagnostics.mjs';
import { runAnchorFollowups, registeredAnchorFollowups } from './browser-anchor-followup.mjs';
import { instrumentBoundaryTeardown } from '../helpers/boundary-teardown-transform.mjs';

async function captureSourceIdentity() {
  const cwd=fileURLToPath(new URL('../../',import.meta.url));
  const git=async(...args)=>(await promisify(execFile)('git',args,{cwd})).stdout.trim();
  const sourceFiles=['lib/Modeler.js','lib/Viewer.js','lib/modeling/ConnectGrabPlacement.js'];
  const sha256={};
  for(const path of sourceFiles)sha256[path]=createHash('sha256').update(await readFile(new URL(`../../${path}`,import.meta.url))).digest('hex');
  const instrumented=instrumentBoundaryTeardown(await readFile(new URL('../../lib/Modeler.js',import.meta.url),'utf8'));
  return {head:await git('rev-parse','HEAD'),committedLibTree:await git('rev-parse','HEAD:lib'),
    instrumentation:{sourceSha256:instrumented.sourceSha256,servedSha256:instrumented.servedSha256},
    modifiedSourcePaths:(await git('diff','HEAD','--name-only','--','lib')).split('\n').filter(Boolean),sha256};
}

export async function runBoundaryAcquisitionDiagnostics({harnessFactory=createAnchorHarness, runner=runAnchorFollowups,
  registerCases=registeredAnchorFollowups,readSourceIdentity=captureSourceIdentity,
  output='test-artifacts/boundary-acquisition-diagnostics'}={}) {
const repeats=6, source=await readSourceIdentity();
let factoryIndex=0;
return runner({batch:'b',engine:'local'}, {
  artifactRoot:output,
  registerCases:async()=>{
    const cases=await registerCases();
    const found=cases.filter(c=>c.id==='F23-B'&&c.engine==='local'&&c.name==='selected-boundary-lower-origin');
    assert.equal(found.length,1,'exact unchanged recorded workflow');
    const original=found[0];
    return Array.from({length:repeats},(_,index)=>({...original,name:`${original.name}-diagnostic-${index%2?'viewport-only':'full-page'}-${index+1}`}));
  },
  harnessFactory:options=>{
    const h=harnessFactory({...options,serverEntry:'test/helpers/boundary-diagnostic-server.mjs'}), index=++factoryIndex;
    const screenshotCohort=index%2?'original-full-page':'viewport-only-source-control';
    const originalOpen=h.open;
    let page, originalScreenshot, originalEvaluate, browserClock, dumped=false;
    const phases=[];
    const mark=(label,details={})=>{
      const monotonicMs=performance.now();
      phases.push({sequence:phases.length+1,monotonicMs,epochMs:performance.timeOrigin+monotonicMs,label,...details});
    };
    const observed=async(label,operation)=>{
      mark(`${label}:before`);
      try{const result=await operation();mark(`${label}:after`);return result;}
      catch(error){mark(`${label}:rejected`,{error:String(error)});throw error;}
    };
    const persist=async()=>{
      if(dumped||!page||page.isClosed())return;
      dumped=true;
      mark('final-dump:before');
      const evidence=await originalEvaluate(readBoundaryAcquisitionDiagnostics);
      mark('final-dump:after');
      await mkdir(output,{recursive:true});
      await writeFile(`${output}/repeat-${index}-final.json`,JSON.stringify({
        ...evidence,source,browserClock,nodeTimeOrigin:performance.timeOrigin,driverPhases:phases,screenshotCohort,
        capturePolicy:'Diagnostic served teardown trace; one passive installation without per-event CTM/hit reads; Node-only phases; one final dump. Only the declared cohort source screenshot differs.',
      },null,2));
      assert.deepEqual(evidence.callbackErrors,[],'diagnostic callback failures remain visible');
      const removals=evidence.records.filter(record=>record.type==='modeler:destroyConnectHandle');
      assert.ok(removals.length,'served teardown instrumentation was actually reached');
      assert.ok(removals.every(record=>record.details.sourceSha256===source.sha256['lib/Modeler.js']),'served trace matches the recorded original product bytes');
    };
    h.open=async(...args)=>{
      const opened=await originalOpen(...args);page=opened.page;
      originalEvaluate=page.evaluate.bind(page);
      mark('install:before');
      browserClock=await originalEvaluate(installBoundaryAcquisitionDiagnostics);
      mark('install:after');
      originalScreenshot=page.screenshot.bind(page);
      page.screenshot=async(...screenshotArgs)=>{
        const path=screenshotArgs[0]?.path || 'unnamed';
        const sourceControl=path.endsWith('-source-control.png');
        const effective=sourceControl&&screenshotCohort==='viewport-only-source-control'
          ?[{...screenshotArgs[0],fullPage:false},...screenshotArgs.slice(1)]:screenshotArgs;
        if(sourceControl)mark('source-screenshot-options',{requested:screenshotArgs[0],effective:effective[0],screenshotCohort});
        return observed(`screenshot:${path}`,()=>originalScreenshot(...effective));
      };
      // Phase markers stay in Node: no extra browser round trip, artifact dump
      // or wait is inserted between any original evaluation/screenshot calls.
      page.evaluate=async(fn,...args)=>{
        const signature=String(fn).slice(0,180);
        return observed(`evaluate:${signature}`,()=>originalEvaluate(fn,...args));
      };
      return opened;
    };
    const originalStop=h.stop;
    h.stop=async()=>{
      try{await persist();}
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
