import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
// Mobile shell guards: the lazy engine split must hold, and the moved analysis
// pipeline must hand the unchanged engine exactly the arguments a direct call would.
await mkdir('test-results',{recursive:true});
await build({stdin:{contents:"export * as shell from './src/shellConstants';export * as runtime from './src/analysisRuntime';export * as engine from './src/matchingEngine';export * from './src/services/analysisTimeline';export {validateAndReconstructVideoTrack} from './src/services/trajectoryValidationService';export {calculateUnifiedConfidence} from './src/confidenceEngine';export {computePitcherBiometrics} from './src/spatialCalibration';",resolveDir:process.cwd(),loader:'ts'},outfile:'test-results/mobile-shell.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const e=await import(pathToFileURL(resolve('test-results/mobile-shell.mjs')).href);
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;};

assert.deepEqual(e.shell.PITCH_TYPE_OPTIONS,e.engine.PITCH_TYPE_OPTIONS);checks++;
assert.equal(e.runtime.PITCH_DATABASE,e.engine.PITCH_DATABASE);checks++;

// Static import graph from the HTML entry. Dynamic import() is the only allowed path to the engine.
const forbidden=['src/matchingEngine.ts','src/pitchDatabase.json','src/analysisRuntime.ts'];
const seen=new Set();
const candidates=p=>[p,p+'.ts',p+'.tsx',p+'/index.ts',p+'/index.tsx'];
async function walk(file){
  if(seen.has(file))return;seen.add(file);
  if(!/\.(ts|tsx)$/.test(file))return;
  const source=(await readFile(file,'utf8')).replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  for(const m of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/gm)){
    if(m[1])continue; // type-only imports are erased
    const target=candidates(resolve(dirname(file),m[2])).find(existsSync);
    assert.ok(target,`unresolved import ${m[2]} in ${file}`);
    await walk(target);
  }
}
await walk(resolve('src/main.tsx'));
const reached=[...seen].map(p=>p.slice(process.cwd().length+1).split('\\').join('/'));
for(const f of forbidden)check(!reached.includes(f),`initial bundle must not statically import ${f}`);
check(reached.includes('src/components/PitchVisualizer.tsx'),'PitchVisualizer animation kept in the shell');
check(reached.includes('src/engineLoader.ts'),'engine reached through loader');

// Moved pipeline vs direct engine call (no video element: tracking and frame capture are skipped
// exactly as in V4.7 when no decoded video is available).
for(const [fps,view,type,strict,cross] of [[30,'catcher','四縫線直球 (Fastball)',true,false],[60,'pitcher_rear','曲球 (Curveball)',true,true],[120,'catcher','🤖 AI 全數據庫自動辨識',false,false]]){
  const times=Array.from({length:Math.round(fps*1.4)},(_,i)=>i/fps);
  const events={release:e.selectEvent(e.describePosition(times,times[Math.round(fps*.3)]),times),glove:e.selectEvent(e.describePosition(times,times[Math.round(fps*.75)]),times)};
  const eventView=e.eventAnalysisView(times,events,1.4);
  const timing={durationSec:1.4,timeBase:'timestamp',actualFps:fps,fpsSource:'container_timestamps',isVFR:false,totalFrames:times.length,timestamps:times,timingReliable:true,width:720,height:1280};
  const biometrics=e.computePitcherBiometrics(fps!==60,172,'ai_auto');
  const input={videoElement:null,events,eventView,videoTiming:timing,videoFps:fps,totalVideoFrames:times.length,sourceTimesValid:true,analysisHasSourceFrames:true,analysisFps:fps,analysisDistance:biometrics.effectiveTravelDistanceM,releaseFrame:eventView.releaseFrame,gloveFrame:eventView.gloveFrame,visibleEndFrame:eventView.gloveFrame,originalFlightFrames:null,selectedPitchType:type,cameraViewMode:view,biometrics,strictPitchTypeMode:strict,allowCrossTypeFallback:cross,manualAnchor:null,cameraGeometry:null,useExistingTracking:false,hasAiDetection:false,autoDetectConfidence:undefined,isCancelled:()=>false};
  const noop=()=>{};
  const outcome=await e.runtime.runPitchAnalysis(input,{onProgress:noop,onVisibleEndFrame:noop,onCameraGeometry:noop,onTrack:noop,onConfidence:noop,onAiDetection:noop});
  check(outcome.status==='done','runtime completes');
  const vel=e.engine.calculateVelocity(eventView.releaseFrame,eventView.gloveFrame,fps,input.analysisDistance,eventView.engineTimingBridge);
  const val=e.validateAndReconstructVideoTrack({observations:[],releaseFrame:eventView.releaseFrame,lastReliableBallFrame:eventView.gloveFrame,catchFrame:eventView.gloveFrame,actualFps:fps,releaseTimeSec:events.release.timeSec,catchTimeSec:events.glove.timeSec,sourceTimestamps:times,videoWidth:720,videoHeight:1280});
  const conf=e.calculateUnifiedConfidence({fps,totalVideoFrames:times.length,releaseFrame:eventView.releaseFrame,gloveFrame:eventView.gloveFrame,isUserConfirmedFrames:true,isManualAnchorUsed:false,autoDetectionConfidence:undefined,videoMetrics:val.metrics});
  const direct=e.engine.matchPitchData(vel.velocityKmh,vel.flightSeconds,type,view,e.engine.PITCH_DATABASE,eventView.releaseFrame,eventView.gloveFrame,biometrics,val.videoTrack,val.metrics,conf,fps,eventView.engineTimingBridge,strict,cross,false,undefined,undefined,times);
  const strip=r=>{const c=structuredClone(r);delete c.event_times;delete c.original_flight_frames;delete c.tracking_evidence;c.confidence_scores.quality_notes=c.confidence_scores.quality_notes.filter(n=>!n.startsWith('事件時差 ')&&!n.startsWith('飛行時間 ')&&!n.includes('視覺追蹤'));return c;};
  assert.deepEqual(strip(outcome.result),strip(direct),`runtime arguments equal direct engine call ${fps}/${view}/${type}`);checks++;
  check(outcome.velocityKmh===vel.velocityKmh&&outcome.flightSeconds===vel.flightSeconds,'average speed from unchanged calculateVelocity');
}
console.log(JSON.stringify({mobileShellChecks:checks,staticShellModules:reached.length,forbiddenInShell:forbidden.filter(f=>reached.includes(f))}));
