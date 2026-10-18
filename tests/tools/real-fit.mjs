// Runs the 5.0.3 geometry fit on the saved real-clip tracks (test-results/real-tracks.json) and prints/saves the result.
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadEngine} from './engine.mjs';
import {distancePrior} from './new-run.mjs';
export async function fitReal(name,o={}){
  const E=await loadEngine(),j=JSON.parse(await readFile('test-results/real-tracks.json','utf8'))[name],c=j.clip;
  const obs=j.points.filter(p=>p.source!=='estimated');
  const times=j.times;
  const filePath=resolve('..','test videos',c.file),meta=existsSync(filePath)?await E.readCameraMetadata(new Blob([await readFile(filePath)])):{source:'none'};
  const fp=E.focalPrior(j.width,j.height,meta);
  const input={observations:obs.map(p=>({frame:p.frame,time:p.time,x:p.x,y:p.y,radius:p.radius})),width:j.width,height:j.height,fps:j.fps,view:c.view,
    markRelease:{frame:c.release,timeSec:times[c.release]},markGlove:{frame:c.glove,timeSec:times[c.glove]},times,
    focal:{px:fp.px,relSigma:fp.relSigma},biometrics:{heightCm:Number(process.env.HEIGHT_CM||178),hasMound:process.env.MOUND!=='0'},distance:distancePrior(o.distanceMode??'noCatcher'),seed:2024,samples:o.samples,useRadius:o.useRadius,useStop:o.useStop,temper:o.temper,eventSource:o.eventSource};
  const t0=performance.now(),fit=E.fitPitchGeometry(input),ms=performance.now()-t0;
  const rank=fit.camera?E.rankPitchTypes(E.PITCH_DATABASE,fit.samples):null;
  return {name,clip:c,input,fit,rank,ms,obs,meta,focalBasis:fp.basis};
}
if(process.argv[1]?.endsWith('real-fit.mjs')){
  const r2=x=>x?`${x.value.toFixed(2)} [${x.lo.toFixed(2)}, ${x.hi.toFixed(2)}]`:'-';
  for(const name of ['straight-720p','straight-4k','knuckle-720p','knuckle-4k']){
    const {fit,rank,ms,clip,obs}=await fitReal(name);
    console.log('\n==',name,'status',fit.status,fit.reasons.join(';'),'ms',Math.round(ms),'obs',obs.length,'frames',obs[0].frame,'-',obs.at(-1).frame,'marks',clip.release,clip.glove);
    if(!fit.camera)continue;
    console.log(' fit',JSON.stringify({ess:+fit.fit.ess.toFixed(1),costDof:+fit.fit.bestCostPerDof.toFixed(2),rms:+fit.fit.bestRmsPx.toFixed(2),free:fit.fit.freeFrames,stopped:fit.fit.stopFrames}),'stopFrame',fit.events.stopFrame);
    console.log(' cam yaw',r2(fit.camera.yawDeg),'pitch',r2(fit.camera.pitchDeg),'roll',r2(fit.camera.rollDeg),'f',r2(fit.camera.focalPx),'pos',fit.camera.positionM.map(r2).join(' | '));
    console.log(' D',r2(fit.distance.m),'releaseVsMark(frames)',r2(fit.events.releaseVsMarkFrames),'gloveVsMark',r2(fit.events.gloveVsMarkFrames),'releaseFrame',r2(fit.events.releaseFrameFloat),'gloveFrame',r2(fit.events.gloveFrameFloat));
    console.log(' speed avg',r2(fit.speed.avgKmh),'release',r2(fit.speed.releaseKmh),'flight',r2(fit.speed.flightSec),'| ivb',r2(fit.movement.ivbInch),'hb',r2(fit.movement.hbInch),'angle',r2(fit.launch.angleDeg),'h',r2(fit.launch.heightM));
    console.log(' types',rank?.top3.map(r=>r.pitchType.slice(0,6)+' '+(r.probability*100).toFixed(0)+'%').join(' | '),rank?.hard?'(難以區分)':'');
  }
}
