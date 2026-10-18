// Side-by-side evaluation of the old tracker (src/baseballTracker.ts) and the new pitch ball tracker
// (src/services/pitchBallTracker.ts) in desktop Chrome, through the real decode path.
//   node tests/tools/eval-ball-tracker.mjs [--real] [--synth] [--only <substring>]
// Real clips need ../test videos (never committed). Output: console table + test-results/ball-tracker-eval.json
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {openVideo,openBlank,bundlePage} from './harness.mjs';
import {mux} from './mux.mjs';
import {scoreScene} from './ball-eval.mjs';

const args=process.argv.slice(2),only=args.includes('--only')?args[args.indexOf('--only')+1]:null;
const maxLongSide=args.includes('--long')?Number(args[args.indexOf('--long')+1]):undefined;
const doReal=args.includes('--real')||!args.includes('--synth'),doSynth=args.includes('--synth')||!args.includes('--real');
const truthFile=JSON.parse(await readFile('tests/fixtures/ball-truth.json','utf8'));
const folder=resolve('..','test videos');
const pageScript=await bundlePage('tests/tools/page-entry.ts');
await mkdir('test-results/synth',{recursive:true});

// ── scoring against the hand-confirmed truth ─────────────────────────────
// hit: within the clip's tolerance (720p pixels). near: within 2x. false positive: farther than that, or an
// observation on a frame that is neither confirmed nor neutral. Contested / uncertain / in-hand frames are neutral.
function scoreReal(clip,points,release,glove){
  const lo=Math.max(0,release-2),hi=glove+5; // the tracker's search window (release-2 .. glove+5)
  const t=truthFile.clips[clip],tol=t.tolerancePx720,conf=new Map(t.confirmed.map(p=>[p.frame,p]));
  const neutral=new Set(t.neutral||[]);
  for(const c of t.contested||[])for(let f=c.frameFirst;f<=c.frameLast;f++)neutral.add(f);
  for(const u of t.uncertain||[])for(let f=u.frameFirst;f<=u.frameLast;f++)neutral.add(f);
  let hits=0,near=0,fp=0,errSum=0,errMax=0,observed=0,neutralObs=0;const hitFrames=[],fpFrames=[];
  for(const p of points){
    if(p.frame<lo||p.frame>hi||p.source==='estimated')continue;
    observed++;
    const c=conf.get(p.frame);
    if(c){const d=Math.hypot(p.x720-c.x,p.y720-c.y);if(d<=tol){hits++;errSum+=d;errMax=Math.max(errMax,d);hitFrames.push(p.frame);}else if(d<=2*tol)near++;else{fp++;fpFrames.push(p.frame);}}
    else if(neutral.has(p.frame))neutralObs++;
    else{fp++;fpFrames.push(p.frame);}
  }
  const inRange=t.confirmed.filter(c=>c.frame>=lo&&c.frame<=hi);
  return {confirmed:inRange.length,hits,near,falsePositives:fp,observed,neutralObserved:neutralObs,meanErrPx720:hits?+(errSum/hits).toFixed(2):null,maxErrPx720:+errMax.toFixed(2),missed:inRange.filter(c=>!hitFrames.includes(c.frame)).map(c=>c.frame),fpFrames,details:points.filter(p=>p.frame>=lo&&p.frame<=hi).map(p=>({frame:p.frame,source:p.source,x:+p.x720.toFixed(1),y:+p.y720.toFixed(1)}))};
}
const conv720=(xNorm,yNorm)=>({x720:xNorm*720,y720:yNorm*1280});

const rows=[];
// per-step time (ms): decode = seek+decode wait, scale = drawImage scaling + pixel copy, then the analysis stages
const breakdown=nw=>{const t=nw.stats.timing||{},r=x=>Math.round(x||0);return {decode:r(nw.captureBreakdown?.seekDecodeMs),scale:r(nw.captureBreakdown?.scaleCopyMs),align:r(t.shift),background:r((t.background||0)+(t.levels||0)),candidates:r((t.energy||0)+(t.components||0)+(t.static||0)),link:r(t.link),refine:r(t.refine),frames:nw.captureBreakdown?.frames};};
async function evaluateVideo({label,file,kind,clip,release,glove,fps,view,truthScene}){
  const v=await openVideo(file,{pageScript});
  try{
    const info=await v.page.evaluate(([t,m])=>window.__pv.open(t,{maxLongSide:m}),[v.timing.timestamps,maxLongSide]);
    const row={label,resolution:`${info.info.sourceWidth}x${info.info.sourceHeight}`,work:`${info.info.width}x${info.info.height}`,fps,view,frames:info.count,release,glove};
    const nw=await v.page.evaluate(p=>window.__pv.runNew(p),{release,glove,fps,view});
    let od;try{od=await v.page.evaluate(p=>window.__pv.runOld(p),{release,glove,fps,view});}catch(e){od={error:String(e.message||e),observations:[]};}
    if(kind==='real'){
      const np=nw.points.map(p=>({frame:p.frame,source:p.source,...conv720(p.xNorm,p.yNorm)}));
      const op=od.observations.map(o=>({frame:o.frame,source:'observation',...conv720(o.x_norm,o.y_norm)}));
      row.new={status:nw.status,...scoreReal(clip,np,release,glove),ms:Math.round(nw.totalMs),captureMs:Math.round(nw.captureMs),analysisMs:Math.round(nw.stats.ms),camera:+nw.camera.maxShiftPx.toFixed(1),timing:breakdown(nw)};
      row.old={status:od.status||'error',error:od.error,...scoreReal(clip,op,release,glove),ms:Math.round(od.ms||0)};
    }else{
      const sc={width:info.info.sourceWidth,height:info.info.sourceHeight,truth:truthScene.truth,release,glove,frames:truthScene.frames};
      const np={points:nw.points.map(p=>({frame:p.frame,source:p.source,x:p.xNorm*sc.width,y:p.yNorm*sc.height})),status:nw.status,observedCount:nw.observedCount,estimatedCount:nw.estimatedCount,stats:{ms:nw.stats.ms}};
      const op={points:od.observations.map(o=>({frame:o.frame,source:'observation',x:o.x_norm*sc.width,y:o.y_norm*sc.height})),status:od.status,observedCount:od.observations.length,estimatedCount:0,stats:{ms:od.ms||0}};
      row.new={...scoreScene(sc,np),ms:Math.round(nw.totalMs),captureMs:Math.round(nw.captureMs),analysisMs:Math.round(nw.stats.ms),timing:breakdown(nw)};
      row.old={...scoreScene(sc,op),ms:Math.round(od.ms||0),error:od.error};
    }
    rows.push(row);
    const f=r=>kind==='real'?`hit ${r.hits}/${r.confirmed} fp ${r.falsePositives} near ${r.near} err ${r.meanErrPx720}`:`hit ${r.hits}/${r.visible} fp ${r.falsePositives} near ${r.near} err ${r.meanErrPx?.toFixed?.(2)}`;
    console.log(`${label.padEnd(36)} ${row.resolution.padEnd(10)} NEW ${f(row.new).padEnd(34)} ${String(row.new.ms).padStart(6)}ms | OLD ${f(row.old).padEnd(34)} ${String(row.old.ms).padStart(6)}ms`);
  }finally{await v.close();}
}

if(doReal){
  // Window = release-2 .. glove+5. The first block uses release/glove chosen so the window covers every confirmed point
  // (straight: release 127, glove 142 -> F125..F147). The second block uses the owner's literal event marks.
  const real=[
    ['直球 720p H.264 (.mp4)','直球.mp4','straight',127,142],['直球 4K HEVC (.mov)','直球.mov','straight',127,142],
    ['彈指曲球 720p H.264 (.mp4)','彈指曲球.mp4','knuckle',97,111],['彈指曲球 4K HEVC (.mov)','彈指曲球.mov','knuckle',97,111],
    ['直球 720p 人工標記 127/139','直球.mp4','straight',127,139],['彈指曲球 720p 人工標記 97/111','彈指曲球.mp4','knuckle',97,111]
  ];
  for(const [label,name,clip,release,glove] of real){
    if(only&&!label.includes(only))continue;
    const file=resolve(folder,name);if(!existsSync(file)){console.log(label,'-> file not found, skipped');continue;}
    await evaluateVideo({label,file,kind:'real',clip,release,glove,fps:24,view:truthFile.clips[clip].view});
  }
}
if(doSynth){
  const matrix=[
    ['rear 720p 24fps clean',{width:720,height:1280,fps:24,view:'pitcher_rear'}],
    ['rear 720p 24fps shake+distract+occl',{width:720,height:1280,fps:24,view:'pitcher_rear',shake:3,distractors:true,occlusion:[[19,20]]}],
    ['catcher 720p 24fps shake',{width:720,height:1280,fps:24,view:'catcher',shake:3}],
    ['rear 1080p 30fps shake+occl',{width:1080,height:1920,fps:30,view:'pitcher_rear',shake:3,occlusion:[[21,22]]}],
    ['catcher 1080p 30fps distract',{width:1080,height:1920,fps:30,view:'catcher',distractors:true}],
    ['rear 1080p 60fps shake+distract',{width:1080,height:1920,fps:60,view:'pitcher_rear',shake:2,distractors:true}],
    ['catcher 1080p 60fps distract+occl',{width:1080,height:1920,fps:60,view:'catcher',distractors:true,occlusion:[[34,36]]}],
    ['rear 4K 24fps shake+distract',{width:2160,height:3840,fps:24,view:'pitcher_rear',shake:3,distractors:true}],
    ['catcher 4K 24fps clean',{width:2160,height:3840,fps:24,view:'catcher'}],
  ];
  for(const [label,o] of matrix){
    if(only&&!label.includes(only))continue;
    const rel=14,glove=rel+Math.round(o.fps*.5),frames=glove+Math.round(o.fps*.5)+14,scene={frames,release:rel,glove,...o};
    const file=resolve('test-results/synth',label.replace(/[^a-z0-9]+/gi,'_')+'.mp4');
    // render + H.264-encode inside a blank page, then mux in Node
    const blank=await openBlank({pageScript});
    let enc;try{enc=await blank.page.evaluate(s=>window.__pv.synthEncode(s),scene);}catch(e){console.log(label,'-> encode failed:',String(e.message).split('\n')[0]);await blank.close();continue;}
    await blank.close();
    await writeFile(file,mux({width:enc.width,height:enc.height,pts:enc.pts,chunks:enc.chunks,config:enc.config,lastDuration:Math.round(1e6/enc.fps)}));
    await evaluateVideo({label,file,kind:'synthetic',release:rel,glove,fps:o.fps,view:o.view,truthScene:{truth:enc.truth,frames:enc.frames}});
  }
}
await writeFile('test-results/ball-tracker-eval.json',JSON.stringify({time:new Date().toISOString(),environment:'desktop Chrome',rows},null,2));
console.log('wrote test-results/ball-tracker-eval.json');
