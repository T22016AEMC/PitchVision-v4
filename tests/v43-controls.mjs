import {build} from 'esbuild';import assert from 'node:assert/strict';import {mkdir} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
await mkdir('test-results',{recursive:true});await build({stdin:{contents:"export * from './src/components/playerControls';export * from './src/services/analysisTimeline';",resolveDir:process.cwd(),loader:'ts'},outfile:'test-results/v43-controls.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const e=await import(pathToFileURL(resolve('test-results/v43-controls.mjs')).href),times=Array.from({length:42},(_,i)=>i/30),source={timestamps:times,timeBase:'timestamp',actualFps:30,fpsSource:'container_timestamps'};
// Source timing wins even while the parent still supplies preview-only positions.
const resolved=e.resolvePlayerTiming(source,Array.from({length:140},(_,i)=>i/100),true);assert.equal(resolved.fps,30);assert.equal(resolved.fineReason,null);assert.equal(resolved.times,times);
assert.equal(e.resolvePlayerTiming({...source,timeBase:'fps_derived',fpsSource:'user_supplied'},[],true).fineReason,null);
assert.match(e.resolvePlayerTiming(null,Array.from({length:140},(_,i)=>i/100),true).fineReason,/確認 FPS/);
assert.match(e.resolvePlayerTiming({...source,timestamps:times.map(t=>t/4)},[],false).fineReason,/保留原始/);
const p=e.createFineGridTimeline(resolved.times,resolved.fps),mid=p.get(28);assert.ok(Math.abs(mid.timeSec-28/90)<1e-9);assert.equal(mid.kind,'interpolated');
const event=(t,type)=>({timeSec:t,kind:'cfr_assumed',left:0,right:0,alpha:0,sourceSpanSec:NaN,selectionType:type,timelineIndex:475});
const events={release:event(5.275,'media_time'),glove:event(5.774,'media_time')};assert.equal(e.flightTimeDescription(events),'飛行時間：0.4990 秒');assert.equal(e.flightTimeDescription({...events,glove:event(5.8,'media_time')}),'飛行時間：0.5250 秒');assert.match(e.flightTimeDescription({...events,release:null}),/尚未完成/);assert.match(e.flightTimeDescription({...events,glove:event(5,'media_time')}),/需晚於/);
assert.match(e.eventDescription(events.release),/媒體時間.*5.275000/);assert.match(e.eventDescription(event(5.275,'interpolated')),/90 FPS 位置 475.*推算影格/);assert.match(e.eventDescription({...event(5.275,'original'),left:126}),/原始影格 F126/);
console.log('V4.3 control tests passed: source precedence, CFR, disabled reasons, high FPS, 90Hz positions, immutable event labels and live flight time.');
