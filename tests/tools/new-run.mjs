// Runs the 5.0.3 geometry fit on a synthetic case and returns the numbers in the same shape as legacyNumbers().
import {loadEngine} from './engine.mjs';
import {summarizeCameraError} from './legacy-run.mjs';

export const distancePrior=(mode,heightCm=178)=>{
  if(mode==='legacy')return {priorM:17.5,sigmaM:.7};
  const stride=Math.round(heightCm*.82)/100;return {priorM:Math.round((18.44-(stride+.38))*100)/100,sigmaM:.7};// default pitcher (mound): plate distance − extension, no catcher recession
};
export function fitInputFor(c,o={}){
  const m=c.marks;
  return {
    observations:c.observations.map(p=>({frame:p.frame,time:p.timestamp,x:p.x,y:p.y,radius:p.radius})),width:c.width,height:c.height,fps:c.fps,view:c.view,
    markRelease:{frame:m.releaseFrame,timeSec:c.times[m.releaseFrame]},markGlove:{frame:m.gloveFrame,timeSec:c.times[m.gloveFrame]},times:c.times,
    focal:{px:c.focalPriorPx,relSigma:c.focalRelSigma},biometrics:{heightCm:178,hasMound:true},distance:distancePrior(o.distanceMode??'noCatcher'),
    seed:(c.seed??1)*7919+13,samples:o.samples,useRadius:o.useRadius,useStop:o.useStop,temper:o.temper
  };
}
export async function newNumbers(c,o={}){
  const E=await loadEngine(),t=c.truth,fps=c.fps;
  const t0=performance.now(),fit=E.fitPitchGeometry(fitInputFor(c,o)),ms=performance.now()-t0;
  if(!fit.camera)return {error:fit.reasons.join(';'),status:fit.status,ms};
  const cam=fit.camera.geometry;
  const rank=E.rankPitchTypes(E.PITCH_DATABASE,fit.samples,{useAngle:o.useAngle,mirror:o.mirror});
  const names=rank?rank.top3.map(r=>r.pitchType):[];
  const camErr=summarizeCameraError(E,{...cam,yawDeg:fit.camera.yawDeg.value,pitchDeg:fit.camera.pitchDeg.value,rollDeg:fit.camera.rollDeg.value},t,c.observations);
  const within=(r,v)=>v>=r.lo&&v<=r.hi;
  return {
    status:fit.status,reasons:fit.reasons,ms,fit:fit.fit,
    camera:{method:'estimated',...camErr,ranges:{yaw:within(fit.camera.yawDeg,t.camera.yawDeg),pitch:within(fit.camera.pitchDeg,t.camera.pitchDeg),roll:within(fit.camera.rollDeg,t.camera.rollDeg),focal:within(fit.camera.focalPx,t.camera.focalPx)}},
    distance:{valueM:fit.distance.m.value,lo:fit.distance.m.lo,hi:fit.distance.m.hi,errM:fit.distance.m.value-t.distanceM,inRange:within(fit.distance.m,t.distanceM),widthM:fit.distance.m.hi-fit.distance.m.lo},
    events:{releaseErrFrames:(fit.events.releaseSec.value-t.releaseTimeSec)*fps,gloveErrFrames:(fit.events.gloveSec.value-t.gloveTimeSec)*fps,
      releaseInRange:within(fit.events.releaseSec,t.releaseTimeSec),gloveInRange:within(fit.events.gloveSec,t.gloveTimeSec),stopDetected:fit.events.stopDetected,
      releaseWidthFrames:(fit.events.releaseSec.hi-fit.events.releaseSec.lo)*fps,gloveWidthFrames:(fit.events.gloveSec.hi-fit.events.gloveSec.lo)*fps},
    movement:{ivb:fit.movement.ivbInch.value,hb:fit.movement.hbInch.value,ivbErr:fit.movement.ivbInch.value-t.ivbInch,hbErr:fit.movement.hbInch.value-t.hbInch,ivbInRange:within(fit.movement.ivbInch,t.ivbInch),hbInRange:within(fit.movement.hbInch,t.hbInch),ivbWidth:fit.movement.ivbInch.hi-fit.movement.ivbInch.lo,hbWidth:fit.movement.hbInch.hi-fit.movement.hbInch.lo},
    speed:{avgKmh:fit.speed.avgKmh.value,avgErrKmh:fit.speed.avgKmh.value-t.avgSpeedKmh,avgErrPct:(fit.speed.avgKmh.value/t.avgSpeedKmh-1)*100,avgInRange:within(fit.speed.avgKmh,t.avgSpeedKmh),avgWidthPct:(fit.speed.avgKmh.hi-fit.speed.avgKmh.lo)/t.avgSpeedKmh*100,
      releaseKmh:fit.speed.releaseKmh.value,releaseErrKmh:fit.speed.releaseKmh.value-t.releaseSpeedKmh,releaseErrPct:(fit.speed.releaseKmh.value/t.releaseSpeedKmh-1)*100,releaseInRange:within(fit.speed.releaseKmh,t.releaseSpeedKmh)},
    pitchType:{top1:names[0]??null,top3:names,truth:t.pitchType,top1Ok:names[0]===t.pitchType,top3Ok:names.includes(t.pitchType),hard:rank?.hard??null,probTop1:rank?.top3[0]?.probability??null,probTruth:rank?.ranking.find(r=>r.pitchType===t.pitchType)?.probability??0},
    launch:{angleErrDeg:fit.launch.angleDeg.value-t.releaseAngleDeg,angleInRange:within(fit.launch.angleDeg,t.releaseAngleDeg),heightErrM:fit.launch.heightM.value-t.releaseHeightM}
  };
}
/** 5.0.3.1 final numbers (six items) for a synthetic case; null on engines that do not have them (5.0.3). */
export async function finalNumbersFor(c,o={}){
  const E=await loadEngine();if(!E.computeFinalNumbers)return null;
  return E.finalNumbersForTest?E.finalNumbersForTest(c,fitInputFor(c,o),{ranker503:true,...o}):null;
}
