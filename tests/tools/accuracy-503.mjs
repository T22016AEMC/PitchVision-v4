// 5.0.3 accuracy report: every number 5.0.2 → 5.0.3, synthetic (known truth) and real (owner clips, no instrument truth) kept apart.
//   node tests/tools/accuracy-503.mjs [--quick] [--out test-results/accuracy-5.0.3.json]
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {caseSpecs,buildCase} from './accuracy-cases.mjs';
import {legacyNumbers} from './legacy-run.mjs';
import {newNumbers} from './new-run.mjs';
import {stats,rate} from './accuracy-stats.mjs';
import {fitReal} from './real-fit.mjs';
import {REAL_CLIPS} from './real-clips.mjs';

const args=process.argv.slice(2),quick=args.includes('--quick'),outFile=args.includes('--out')?args[args.indexOf('--out')+1]:'test-results/accuracy-5.0.3.json';
const specs=caseSpecs({quick});
const rows=[],lateRows=[];
const pick=(old,nw,policyOk)=>policyOk?nw:old;
for(const spec of specs){
  const c=await buildCase(spec),old=await legacyNumbers(c);let nw;
  try{nw=await newNumbers(c);}catch(e){nw={error:String(e.message||e)};}
  rows.push({spec,old,new:nw,usedFit:!nw.error&&nw.status==='ok'});
  if(spec.seed%3===0){ // robustness: the owner's glove mark is 2 frames late
    const late=await buildCase({...spec,gloveMarkLate:2}),oldL=await legacyNumbers(late);let nl;try{nl=await newNumbers(late);}catch(e){nl={error:String(e.message||e)};}
    lateRows.push({spec,old:oldL,new:nl,usedFit:!nl.error&&nl.status==='ok'});
  }
}
// Product policy: a low-confidence or failed fit falls back to the 5.0.2 numbers (and says so).
const S=(sel,f)=>stats(sel.map(f));
function summarize(sel,label){
  const used=sel.filter(r=>r.usedFit),fit=r=>r.usedFit?r.new:r.old; // what the product would show
  const both=sel.filter(r=>!r.old.error);
  const cov=f=>rate(used.map(r=>f(r.new)));
  return {
    label,cases:sel.length,fitUsed:used.length,fallback:sel.length-used.length,
    C1_camera:{ // fit-used cases only compared like for like; fallback cases keep the 5.0.2 camera
      worldRmsCm:{old:S(both,r=>r.old.camera.worldRmsCm),new:S(both,r=>fit(r).camera.worldRmsCm),fitOnlyOld:S(used,r=>r.old.camera.worldRmsCm),fitOnlyNew:S(used,r=>r.new.camera.worldRmsCm)},
      yawErrDeg:{old:S(both,r=>r.old.camera.yawErrDeg),new:S(both,r=>fit(r).camera.yawErrDeg)},pitchErrDeg:{old:S(both,r=>r.old.camera.pitchErrDeg),new:S(both,r=>fit(r).camera.pitchErrDeg)},
      rollErrDeg:{old:S(both,r=>r.old.camera.rollErrDeg),new:S(both,r=>fit(r).camera.rollErrDeg)},focalErrPct:{old:S(both,r=>r.old.camera.focalErrPct),new:S(both,r=>fit(r).camera.focalErrPct)},
      positionErrM:{old:S(both,r=>r.old.camera.positionErrM),new:S(both,r=>fit(r).camera.positionErrM)}},
    D1_distance:{errM:{old:S(both,r=>r.old.distance.errM),new:S(both,r=>fit(r).distance.errM)},
      rangeWidthM:S(used,r=>r.new.distance.widthM),coveragePct:cov(n=>n.distance.inRange),
      note:'The fit only returns the prior distance with a very weak correction (video cannot measure range); the difference to 5.0.2 is the changed prior (no catcher recession), not a measurement.'},
    A4_events:{releaseErrFrames:{old:S(both,r=>r.old.events.releaseErrFrames),new:S(both,r=>fit(r).events.releaseErrFrames)},gloveErrFrames:{old:S(both,r=>r.old.events.gloveErrFrames),new:S(both,r=>fit(r).events.gloveErrFrames)},
      releaseRangeWidthFrames:S(used,r=>r.new.events.releaseWidthFrames),gloveRangeWidthFrames:S(used,r=>r.new.events.gloveWidthFrames),releaseCoveragePct:cov(n=>n.events.releaseInRange),gloveCoveragePct:cov(n=>n.events.gloveInRange),stopDetectedPct:rate(used.map(r=>r.new.events.stopDetected))},
    M1_movement:{ivbErrInch:{old:S(both,r=>r.old.movement.ivbErr),new:S(both,r=>fit(r).movement.ivbErr)},hbErrInch:{old:S(both,r=>r.old.movement.hbErr),new:S(both,r=>fit(r).movement.hbErr)},
      ivbRangeWidth:S(used,r=>r.new.movement.ivbWidth),hbRangeWidth:S(used,r=>r.new.movement.hbWidth),ivbCoveragePct:cov(n=>n.movement.ivbInRange),hbCoveragePct:cov(n=>n.movement.hbInRange)},
    P1_pitchType:{top1Pct:{old:rate(both.map(r=>r.old.pitchType.top1Ok)),new:rate(both.map(r=>fit(r).pitchType.top1Ok))},top3Pct:{old:rate(both.map(r=>r.old.pitchType.top3Ok)),new:rate(both.map(r=>fit(r).pitchType.top3Ok))},hardFlaggedPct:rate(used.map(r=>r.new.pitchType.hard)),
      note:'Synthetic pitches are drawn from the same database the ranker compares against, so these rates are self-consistency, not real-world accuracy.'},
    A2_speed:{avgErrPct:{old:S(both,r=>r.old.speed.avgErrPct),new:S(both,r=>fit(r).speed.avgErrPct)},releaseErrPct:{old:'not reported in 5.0.2',new:S(used,r=>r.new.speed.releaseErrPct)},
      avgRangeWidthPct:S(used,r=>r.new.speed.avgWidthPct),avgCoveragePct:cov(n=>n.speed.avgInRange),releaseCoveragePct:cov(n=>n.speed.releaseInRange)},
    timing:{fitMs:S(used,r=>r.new.ms)}
  };
}
const byView=Object.fromEntries(['pitcher_rear','catcher'].map(v=>[v,summarize(rows.filter(r=>r.spec.view===v),v)]));
const byFps=Object.fromEntries([24,30,60].map(f=>[f,summarize(rows.filter(r=>r.spec.fps===f),'fps '+f)]));
const lateSummary={cases:lateRows.length,gloveErrFrames:{old:S(lateRows.filter(r=>!r.old.error),r=>r.old.events.gloveErrFrames),new:S(lateRows.filter(r=>!r.old.error),r=>(r.usedFit?r.new:r.old).events.gloveErrFrames)},
  avgSpeedErrPct:{old:S(lateRows.filter(r=>!r.old.error),r=>r.old.speed.avgErrPct),new:S(lateRows.filter(r=>!r.old.error),r=>(r.usedFit?r.new:r.old).speed.avgErrPct)},
  note:'Owner glove mark 2 frames after the true net arrival: 5.0.2 takes the mark as given, 5.0.3 re-derives the time from the ball stopping.'};

// ── real clips (no instrument truth): 5.0.2 baseline vs 5.0.3 fit
const real=[];
const base=existsSync('test-results/baseline-5.0.2.json')?JSON.parse(await readFile('test-results/baseline-5.0.2.json','utf8')).real:[];
for(const c of REAL_CLIPS){
  const old=base.find(b=>b.name===c.name);let r;
  try{r=await fitReal(c.name);}catch(e){real.push({name:c.name,error:String(e.message||e)});continue;}
  const {fit,rank}=r;if(!fit.camera){real.push({name:c.name,old,new:{status:fit.status,reasons:fit.reasons}});continue;}
  const rg=x=>x&&{value:+x.value.toFixed(3),lo:+x.lo.toFixed(3),hi:+x.hi.toFixed(3)};
  const top=rank?.top3.map(t=>({type:t.pitchType,pct:+(t.probability*100).toFixed(1)}))??[];
  real.push({name:c.name,view:c.view,marks:{release:c.release,glove:c.glove},ownerClaim:{speedKmh:c.speedClaimKmh,pitchType:c.pitchType,note:'owner statement, not an instrument reading'},
    old:{distanceM:old?.distanceM,camera:old?.camera,events:'owner marks as given',avgKmh:old?.speed.avgKmh,releaseKmh:null,ivbInch:old?.movement.ivbInch,hbInch:old?.movement.hbInch,top3:old?.pitchType.top3,top1Ok:old?.pitchType.top3?.[0]===c.pitchType,top3Ok:old?.pitchType.top3?.includes(c.pitchType)},
    new:{status:fit.status,reasons:fit.reasons,ms:Math.round(r.ms),
      camera:{yawDeg:rg(fit.camera.yawDeg),pitchDeg:rg(fit.camera.pitchDeg),rollDeg:rg(fit.camera.rollDeg),focalPx:rg(fit.camera.focalPx),positionM:fit.camera.positionM.map(rg),source:'estimated (angles from the ball path; focal from the phone-model prior; position mostly prior)'},
      distanceM:rg(fit.distance.m),events:{stopFrame:fit.events.stopFrame,releaseFrame:rg(fit.events.releaseFrameFloat),gloveFrame:rg(fit.events.gloveFrameFloat),releaseVsMarkFrames:rg(fit.events.releaseVsMarkFrames),gloveVsMarkFrames:rg(fit.events.gloveVsMarkFrames)},
      avgKmh:rg(fit.speed.avgKmh),releaseKmh:rg(fit.speed.releaseKmh),flightSec:rg(fit.speed.flightSec),ivbInch:rg(fit.movement.ivbInch),hbInch:rg(fit.movement.hbInch),angleDeg:rg(fit.launch.angleDeg),releaseHeightM:rg(fit.launch.heightM),
      speedIfOwnerMarksKmh:+(fit.distance.m.value/(r.input.markGlove.timeSec-r.input.markRelease.timeSec)*3.6).toFixed(1),
      top3:top,hard:rank?.hard??null,top1Ok:top[0]?.type===c.pitchType,top3Ok:top.some(t=>t.type===c.pitchType),fit:fit.fit}});
}
const result={version:'5.0.3',created:new Date().toISOString(),
  note:'Synthetic: known-truth pitches, camera and tracker-like noise (self-consistency only). Real: the two owner clips; no instrument truth exists, owner marks and speed statements are not truth.',
  policy:'A fit with status ok replaces the 5.0.2 numbers; low-confidence or failed fits fall back to 5.0.2 (camera guessed).',
  synthetic:{caseCount:rows.length,overall:summarize(rows,'all'),byView,byFps,lateGloveMark:lateSummary,rows:rows.map(r=>({spec:r.spec,usedFit:r.usedFit,reasons:r.new.reasons??r.new.error,old:r.old,new:r.new}))},real};
await writeFile(outFile,JSON.stringify(result,null,1));
console.log('wrote',outFile,'cases',rows.length,'fitUsed',rows.filter(r=>r.usedFit).length);
console.log(JSON.stringify({C1:result.synthetic.overall.C1_camera.worldRmsCm,A4:result.synthetic.overall.A4_events.gloveErrFrames,M1:result.synthetic.overall.M1_movement,P1:result.synthetic.overall.P1_pitchType.top1Pct,A2:result.synthetic.overall.A2_speed.avgErrPct}).slice(0,1500));
