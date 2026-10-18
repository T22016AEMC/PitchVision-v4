import {build} from 'esbuild';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
// Container timing: programmatically generated QuickTime/MP4 structures (nothing copied from real footage),
// plus, when the local iPhone originals exist in ../test videos, a comparison against known values and ffprobe.
await mkdir('test-results',{recursive:true});
await build({entryPoints:['src/services/mp4Timing.ts'],outfile:'test-results/mp4-timing.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {readMp4Timing}=await import(pathToFileURL(resolve('test-results/mp4-timing.mjs')).href);
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;};
const near=(a,b,eps=1e-9)=>Math.abs(a-b)<eps;

// ── tiny box writer ──────────────────────────────────────────
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n>>>0);return b;},i32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;},u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;};
const box=(type,...d)=>{const body=Buffer.concat(d);return Buffer.concat([u32(body.length+8),Buffer.from(type),body]);};
const full=(type,ver,...d)=>box(type,Buffer.from([ver,0,0,0]),...d);
const z=n=>Buffer.alloc(n);
/** One video track (+ optional audio / metadata tracks) in a moov placed AFTER mdat, like an iPhone .mov. */
function movie({movieScale=600,mediaScale=600,deltas,ctts=null,cttsVersion=0,edits=[],withOtherTracks=true}){
  const total=deltas.reduce((a,b)=>a+b,0);
  const stts=full('stts',0,u32(deltas.length),...deltas.flatMap(d=>[u32(1),u32(d)])),stsz=full('stsz',0,u32(0),u32(deltas.length)),
    cttsBox=ctts?full('ctts',cttsVersion,u32(ctts.length),...ctts.flatMap(o=>[u32(1),i32(o)])):Buffer.alloc(0);
  const videoTable=Buffer.concat([stts,stsz,cttsBox]);
  const elst=edits.length?box('edts',full('elst',0,u32(edits.length),...edits.flatMap(e=>[u32(e.seg),i32(e.media),u16(e.rate??1),u16(0)]))):Buffer.alloc(0);
  const video=box('trak',full('tkhd',0,z(80)),elst,box('mdia',full('mdhd',0,u32(0),u32(0),u32(mediaScale),u32(total),u16(0),u16(0)),full('hdlr',0,u32(0),Buffer.from('vide'),z(12)),box('minf',box('stbl',videoTable))));
  const other=h=>box('trak',full('tkhd',0,z(80)),box('mdia',full('mdhd',0,u32(0),u32(0),u32(48000),u32(48000),u16(0),u16(0)),full('hdlr',0,u32(0),Buffer.from(h),z(12)),box('minf',box('stbl',full('stts',0,u32(1),u32(40),u32(1024)))))); // audio/metadata, must be ignored
  const mvhd=full('mvhd',0,u32(0),u32(0),u32(movieScale),u32(Math.round(total/mediaScale*movieScale)),u32(65536),u16(256),z(10),z(36),z(24),u32(2));
  const moov=box('moov',mvhd,...(withOtherTracks?[other('soun'),other('soun')]:[]),video,...(withOtherTracks?[other('meta')]:[]));
  return Buffer.concat([box('ftyp',Buffer.from('qt  '),u32(0),Buffer.from('qt  ')),box('wide'),box('mdat',z(256)),moov]);
}
const read=async opts=>readMp4Timing(new Blob([movie(opts)]));
const fr=i=>i*25/600; // 24 FPS in a 600 timescale
const times24=n=>Array.from({length:n},(_,i)=>fr(i));
const same=(got,want,label)=>{assert.equal(got.length,want.length,label+' count');got.forEach((t,i)=>assert.ok(near(t,want[i]),`${label} t[${i}] ${t} vs ${want[i]}`));checks++;};
const seq=(n,d=25)=>Array.from({length:n},()=>d);

// 1. plain file: unchanged behaviour
let t=await read({deltas:seq(30),withOtherTracks:false});
check(t.totalFrames===30&&near(t.actualFps,24,1e-9)&&near(t.durationSec,1.25),'plain: 30 frames, 24 FPS, 1.25 s');
same(t.timestamps,times24(30),'plain');

// 2. other tracks (audio, metadata) are ignored, only the video track is read
t=await read({deltas:seq(30)});check(t.totalFrames===30&&t.timeBase==='timestamp'&&t.fpsSource==='container_timestamps','audio/metadata tracks ignored');

// 3. NEGATIVE ctts in a version-0 box (Apple style). Decode order I P B P B ..., display slot p_k; offset = 25*(p_k-k).
const order=[0,2,1,4,3,6,5,8,7,10,9,11],offs=order.map((p,k)=>25*(p-k));
check(offs.some(o=>o<0),'fixture really contains negative offsets');
for(const version of [0,1]){
  t=await read({deltas:seq(12),ctts:offs,cttsVersion:version,edits:[{seg:300,media:0}]});
  check(t.totalFrames===12&&near(t.actualFps,24,1e-9)&&near(t.durationSec,.5)&&!t.isVFR,`negative ctts v${version}: 12 frames, 24 FPS, CFR`);
  same(t.timestamps,times24(12),`negative ctts v${version}`);
}

// 4. edit-list tail trim: samples beyond media_time+segment_duration must not be counted
t=await read({deltas:seq(30),edits:[{seg:600,media:0}]});
check(t.totalFrames===24&&near(t.durationSec,1)&&near(t.actualFps,24,1e-9),'tail trim: 30 samples -> 24 frames, 1.0 s');
same(t.timestamps,times24(24),'tail trim');

// 5. head + tail trim (media_time skips 2 frames, 16 frames kept, first timestamp 0)
t=await read({deltas:seq(30),edits:[{seg:400,media:50}]});
check(t.totalFrames===16&&t.timestamps[0]===0&&near(t.durationSec,16/24),'head+tail trim: 16 frames starting at 0');
same(t.timestamps,times24(16),'head+tail trim');

// 6. empty edit then media edit: window end includes the empty time; a frame exactly at the end is excluded
t=await read({deltas:seq(30),edits:[{seg:60,media:-1},{seg:600,media:0}]});
check(t.totalFrames===24&&near(t.timestamps[0],.1)&&near(t.durationSec,1.1),'empty edit + media edit: 24 frames from 0.1 s');

// 7. movie and media timescales differ (segment_duration is in MOVIE units)
t=await read({movieScale:1000,mediaScale:24000,deltas:seq(30,1000),edits:[{seg:1000,media:0}]});
check(t.totalFrames===24&&near(t.durationSec,1)&&near(t.actualFps,24,1e-9),'different movie/media timescales: 24 frames');

// 8. segment_duration 0 means "to the end"
t=await read({deltas:seq(30),edits:[{seg:0,media:0}]});check(t.totalFrames===30,'segment duration 0 keeps every sample');

// 9. the iPhone combination: negative ctts + head offset + tail trim at once
const pairs=Array.from({length:18},(_,i)=>[2*i+1,2*i]).flat(),big=pairs.map((p,k)=>25*(p-k)); // p_k pairs swap neighbours
t=await read({deltas:seq(36),ctts:big,edits:[{seg:600,media:75}]});
check(t.totalFrames===24&&t.timestamps[0]===0&&near(t.actualFps,24,1e-6),'negative ctts + media_time + trim together: 24 frames');
check(t.timestamps.every((x,i,a)=>i===0||x>a[i-1])&&t.timestamps.at(-1)<1,'timestamps strictly increasing and inside the edit window');

// 10. unsupported cases stay explicit errors
await assert.rejects(()=>read({deltas:seq(30),edits:[{seg:300,media:0},{seg:300,media:300}]}),/多段 edit list/);checks++;
await assert.rejects(()=>read({deltas:seq(30),edits:[{seg:600,media:0,rate:2}]}),/非正常速率/);checks++;

// ── real files (local only; never committed) ───────────────────
const folder=resolve('..','test videos'),real=[];
const expected={ // frames/duration measured with ffprobe by the user; sha = timestamps of the pre-fix parser for the converted files
  '直球.mov':{frames:162,duration:6.773,fps:24},
  '彈指曲球.mov':{frames:131,duration:5.458},
  '直球.mp4':{frames:162,sha:'d2a7d6c8f5ba22fb',duration:6.7733},
  '彈指曲球.mp4':{frames:131,sha:'e97e127e66513349',duration:5.48}
};
const ffprobe=spawnSync('ffprobe',['-version'],{encoding:'utf8'}).status===0;
if(existsSync(folder)){
  for(const name of (await readdir(folder)).filter(n=>expected[n])){
    const want=expected[name],bytes=await readFile(resolve(folder,name)),timing=await readMp4Timing(new Blob([bytes]));
    check(timing&&timing.totalFrames===want.frames,`${name}: ${timing?.totalFrames} frames, expected ${want.frames}`);
    check(Math.abs(timing.durationSec-want.duration)<.005,`${name}: duration ${timing.durationSec.toFixed(4)} s`);
    if(want.fps)check(near(timing.actualFps,want.fps,1e-6)&&!timing.isVFR,`${name}: ${timing.actualFps} FPS`);
    if(want.sha)check(createHash('sha256').update(JSON.stringify(timing.timestamps)).digest('hex').slice(0,16)===want.sha,`${name}: converted file's timestamps unchanged by the fix`);
    const row={name,frames:timing.totalFrames,durationSec:timing.durationSec,fps:timing.actualFps,firstSec:timing.timestamps[0]};
    if(ffprobe){
      const r=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',resolve(folder,name)],{encoding:'utf8',maxBuffer:64*1024*1024});
      const probe=JSON.parse(r.stdout).frames.map(f=>Number(f.best_effort_timestamp_time)).sort((a,b)=>a-b);
      check(probe.length===timing.totalFrames,`${name}: ffprobe frame count ${probe.length}`);
      const worst=Math.max(...probe.map((p,i)=>Math.abs((p-probe[0])-(timing.timestamps[i]-timing.timestamps[0]))));
      check(worst<.002,`${name}: frame times match ffprobe (relative to first frame), worst ${worst.toExponential(2)} s`);
      row.ffprobeFrames=probe.length;row.ffprobeWorstDiffSec=worst;
    }
    real.push(row);
  }
}
console.log(JSON.stringify({mp4TimingChecks:checks,realFiles:real,ffprobe:ffprobe?'compared':'not installed: real files checked against your ffprobe-measured values only'}));
