// 5.0.3 Step 0: the current (5.0.2) numbers on synthetic truth and on the two real clips, saved as the baseline every later
// step is compared against.   node tests/tools/baseline-503.mjs [--quick]   → test-results/baseline-5.0.2.json
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {caseSpecs,buildCase} from './accuracy-cases.mjs';
import {legacyNumbers} from './legacy-run.mjs';
import {stats,rate} from './accuracy-stats.mjs';

const quick=process.argv.includes('--quick');
const rows=[];
for(const spec of caseSpecs({quick})){
  const c=await buildCase(spec);
  let n;try{n=await legacyNumbers(c);}catch(e){n={error:String(e.message||e)};}
  rows.push({spec,truth:{distanceM:c.truth.distanceM,avgSpeedKmh:c.truth.avgSpeedKmh,releaseSpeedKmh:c.truth.releaseSpeedKmh,ivbInch:c.truth.ivbInch,hbInch:c.truth.hbInch,type:c.truth.pitchType,observations:c.observations.length},...n});
}
const ok=rows.filter(r=>!r.error);
const summarize=sel=>({
  cases:sel.length,
  camera:{worldRmsCm:stats(sel.map(r=>r.camera.worldRmsCm)),pitchErrDeg:stats(sel.map(r=>r.camera.pitchErrDeg)),yawErrDeg:stats(sel.map(r=>r.camera.yawErrDeg)),rollErrDeg:stats(sel.map(r=>r.camera.rollErrDeg)),focalErrPct:stats(sel.map(r=>r.camera.focalErrPct)),positionErrM:stats(sel.map(r=>r.camera.positionErrM))},
  distanceErrM:stats(sel.map(r=>r.distance.errM)),
  releaseEventErrFrames:stats(sel.map(r=>r.events.releaseErrFrames)),gloveEventErrFrames:stats(sel.map(r=>r.events.gloveErrFrames)),
  ivbErrInch:stats(sel.map(r=>r.movement.ivbErr)),hbErrInch:stats(sel.map(r=>r.movement.hbErr)),
  avgSpeedErrPct:stats(sel.map(r=>r.speed.avgErrPct)),avgSpeedErrKmh:stats(sel.map(r=>r.speed.avgErrKmh)),
  pitchType:{top1Pct:rate(sel.map(r=>r.pitchType.top1Ok)),top3Pct:rate(sel.map(r=>r.pitchType.top3Ok))}
});
const byView=Object.fromEntries(['pitcher_rear','catcher'].map(v=>[v,summarize(ok.filter(r=>r.spec.view===v))]));
const byFps=Object.fromEntries([24,30,60].map(f=>[f,summarize(ok.filter(r=>r.spec.fps===f))]));

// ── real clips: the genuine 5.0.2 app path (tests/tools/real-run.mjs), compared with the owner's marks and statements
const real=[];
for(const name of ['straight-720p','straight-4k','knuckle-720p','knuckle-4k']){
  const file=`test-results/real-run/${name}.json`;if(!existsSync(file)){real.push({name,error:'run tests/tools/real-run.mjs first'});continue;}
  const j=JSON.parse(await readFile(file,'utf8')),r=j.outcome.result,cam=r.spatial_calibration?.camera_geometry,c=j.clip;
  const top=[];for(const x of r.top_candidates||[])if(!top.includes(x.pitch_type))top.push(x.pitch_type);
  real.push({
    name,view:c.view,marks:{release:c.release,glove:c.glove},ownerSpeedClaimKmh:c.speedClaimKmh,
    camera:{method:cam?.method,positionM:cam?.positionM,yawDeg:cam?.yawDeg,pitchDeg:cam?.pitchDeg,rollDeg:cam?.rollDeg,focalPx:cam?.focalPx,imageSize:[j.width,j.height]},
    distanceM:r.spatial_calibration?.effective_travel_distance_m,
    events:{releaseTimeSec:r.event_times?.releaseTimeSec,gloveTimeSec:r.event_times?.catchTimeSec,flightSec:j.outcome.flightSeconds,autoVsMarkFrames:{release:0,glove:0,note:'5.0.2 uses the owner marks as given'}},
    movement:{ivbInch:r.ivb_inch,hbInch:r.hb_inch,source:r.source_ivb},
    speed:{avgKmh:j.outcome.velocityKmh,releaseKmh:null},
    pitchType:{top1:r.matched_pitch_type,top3:top.slice(0,3),windowKmh:r.effective_velocity_window_kmh},
    observations:j.outcome.detections.length,trackingMs:j.outcome.ballTrack?.ms
  });
}
await mkdir('test-results',{recursive:true});
await writeFile('test-results/baseline-5.0.2.json',JSON.stringify({
  version:'5.0.2',created:new Date().toISOString(),
  note:'Synthetic = known-truth physics scenes seen through a known pinhole camera with a tracker-like noise model (self-consistency only). Real = the two owner clips through the real app path; there is no instrument truth for them.',
  synthetic:{caseCount:rows.length,failed:rows.length-ok.length,overall:summarize(ok),byView,byFps,rows},
  real
},null,1));
console.log('cases',rows.length,'failed',rows.length-ok.length);
console.log(JSON.stringify(summarize(ok),null,1).slice(0,2500));
