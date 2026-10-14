import {build} from 'esbuild';import {readFile,writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import assert from 'node:assert/strict';
await build({stdin:{contents:"export * from './src/services/sourceTiming';export * from './src/services/analysisTimeline';export * from './src/services/mp4Timing';export * from './src/services/manualAnalysisReadiness';export * as engine from './src/matchingEngine';",resolveDir:process.cwd(),loader:'ts'},outfile:'test-results/v422.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});const e=await import(pathToFileURL(resolve('test-results/v422.mjs')).href);let count=0;const check=(a,n)=>{assert.ok(a,n);count++;};
for(const fps of [24,30,60,90,120,30000/1001]){
 const times=Object.freeze(Array.from({length:Math.ceil(fps*1.4)},(_,i)=>i/fps)),timing={actualFps:0,timestamps:times,totalFrames:times.length,durationSec:1.5,fpsSource:'container_timestamps'};
 check(Math.abs(e.normalizeSourceTiming(timing).actualFps-fps)<1e-8,'zero/stale metadata corrected from actual PTS');
 const r=e.selectEvent(e.describePosition(times,.3),times,'low'),g=e.selectEvent(e.describePosition(times,.9),times,'low'),v=e.eventAnalysisView(times,{release:r,glove:g});
 check(v.sourceTimestamps===times&&v.sourceTimestamps.every((t,i)=>t===i/fps),'original PTS identity and content immutable');check(v.eventTimes.releaseTimeSec===.3&&v.eventTimes.gloveTimeSec===.9,'explicit event times separated');check(v.engineTimingBridge.every((t,i,a)=>!i||t>a[i-1]),'legacy event bridge monotonic');
 const velocity=e.engine.calculateVelocity(v.releaseFrame,v.gloveFrame,fps,17.5,v.engineTimingBridge),result=e.engine.matchPitchData(velocity.velocityKmh,velocity.flightSeconds,'🤖 AI 全數據庫自動辨識','pitcher_rear',e.engine.PITCH_DATABASE,v.releaseFrame,v.gloveFrame,undefined,[],undefined,undefined,fps,v.engineTimingBridge);
 check(Math.abs(result.flight_time_sec-.6)<1e-12,'same explicit delta reaches unchanged engine across FPS');check(velocity.velocityKmh===105,'distance/time formula conserved');
}
check(e.formatSourceFps(0)==='未知／待確認'&&e.formatSourceFps(NaN)==='未知／待確認','invalid FPS never presented as valid zero');
check(e.createAnalysisTimeline([],NaN,false,true).get(0).timeSec===0,'unknown empty timeline has safe cursor, not undefined frame/time');
check(!e.hasUsableSourceTimes({actualFps:0,totalFrames:2,timestamps:[0,.1],fpsSource:'container_timestamps'}),'zero FPS cannot enter analysis');
let rejected=false;try{e.normalizeSourceTiming({actualFps:30,totalFrames:2,timestamps:[0,0],durationSec:1})}catch{rejected=true}check(rejected,'duplicate timing rejected');
rejected=false;try{e.normalizeSourceTiming({actualFps:30,totalFrames:2,timestamps:[0,.1],durationSec:1},2)}catch{rejected=true}check(rejected,'container/browser duration mismatch becomes unknown, not valid low FPS');
rejected=false;try{e.eventAnalysisView([0,.1,.2,.3],{release:{timeSec:.15,left:0,right:1},glove:{timeSec:.25,left:2,right:3}})}catch{rejected=true}check(rejected,'stale indices cannot misrepresent event times');
// Both events inside the same source interval retain their exact time difference.
const t=Object.freeze([0,.1,.2,.3]),ev=e.eventAnalysisView(t,{release:e.selectEvent(e.describePosition(t,.0222222222222),t,'low'),glove:e.selectEvent(e.describePosition(t,.0777777777777),t,'low')});check(Math.abs(ev.flightSeconds-.0555555555555)<1e-12&&ev.engineTimingBridge.every((x,i,a)=>!i||x>a[i-1]),'same-support events remain separated without corrupting PTS');
await writeFile('test-results/v422-unit.json',JSON.stringify({assertions:count,coreModelsChanged:false},null,2));console.log(JSON.stringify({v422Assertions:count}));
