// Runs the app's post-tracking pipeline (finishAnalysis: validation, confidence, matchPitchData) on a known track,
// the same code the app runs after the ball finder. Used for the 5.0.2 baseline and for later comparisons.
import {loadEngine} from './engine.mjs';

export function summarizeCameraError(E,est,truth,observations){
  // Camera usefulness is judged by what it does downstream: back-project each observed pixel to the TRUE depth and compare with the
  // true 3D point. (A camera is good when pixels map to the right place in the world.)
  const g=est;if(!g?.rotation||!g.translation||!g.focalPx)return null;
  let sum=0,n=0;
  for(const o of observations){
    const w=truth.world(o.timestamp-truth.releaseTimeSec);
    try{const q=E.reconstructAtDepth(g,o.x_norm,o.y_norm,w.z);sum+=(q.x-w.x)**2+(q.y-w.y)**2;n++;}catch{}
  }
  const t=truth.camera,p=g.positionM??null;
  return {
    worldRmsCm:n?Math.sqrt(sum/n)*100:null,
    yawErrDeg:g.yawDeg!==undefined?angleDiff(g.yawDeg,t.yawDeg):null,pitchErrDeg:g.pitchDeg!==undefined?g.pitchDeg-t.pitchDeg:null,rollErrDeg:g.rollDeg-t.rollDeg,
    focalErrPct:g.focalPx?(g.focalPx/t.focalPx-1)*100:null,
    positionErrM:p?Math.hypot(p[0]-t.position[0],p[1]-t.position[1],p[2]-t.position[2]):null
  };
}
const angleDiff=(a,b)=>{let d=a-b;while(d>180)d-=360;while(d<-180)d+=360;return d;};

export async function runLegacy(c,opts={}){
  const E=await loadEngine();
  const {width,height,fps,times,marks,observations}=c;
  const biometrics=opts.biometrics??E.computePitcherBiometrics(true,178);
  const duration=times.at(-1)+1/fps;
  const timing={actualFps:fps,fpsSource:'container_timestamps',totalFrames:times.length,durationSec:duration,isVFR:false,timeBase:'timestamp',timestamps:times,width,height};
  const ev=i=>E.selectEvent(E.describePosition(times,times[i]),times);
  const events={release:ev(marks.releaseFrame),glove:ev(marks.gloveFrame)};
  const eventView=E.eventAnalysisView(times,events,duration);
  const last=observations.at(-1)?.frame??marks.gloveFrame,first=observations[0]?.frame??marks.releaseFrame;
  const sparse={observations:observations.map(o=>({...o})),visibleEndFrame:last,firstSeenFrame:first,lastSeenFrame:last,status:'reliable',statusMessage:'synthetic track',
    evidence:{sourceFrames:marks.gloveFrame-marks.releaseFrame+1,attemptedFrames:0,verifiedFrames:observations.length,unverifiedFrames:0,observationCount:observations.length,excludedFrames:0,trackFound:true,trackReliable:true,reason:'synthetic'}};
  const flight=E.calculateVelocity(eventView.releaseFrame,eventView.gloveFrame,fps,biometrics.effectiveTravelDistanceM,eventView.engineTimingBridge);
  const geometry={method:'assumed',width,height,azimuthDeg:0,elevationDeg:0,rollDeg:0,quality:.07,limitations:[]};
  const input={videoElement:null,events,eventView,videoTiming:timing,videoFps:fps,totalVideoFrames:times.length,sourceTimesValid:true,analysisHasSourceFrames:true,analysisFps:fps,analysisDistance:biometrics.effectiveTravelDistanceM,
    releaseFrame:eventView.releaseFrame,gloveFrame:eventView.gloveFrame,visibleEndFrame:last,originalFlightFrames:marks.gloveFrame-marks.releaseFrame+1,selectedPitchType:'🤖 AI 全數據庫自動辨識',cameraViewMode:c.view,biometrics,
    strictPitchTypeMode:true,allowCrossTypeFallback:false,manualAnchor:null,cameraGeometry:geometry,useExistingTracking:true,hasAiDetection:false,isCancelled:()=>false,disableGeometryStage:true,...(opts.input||{})};
  const hooks={onProgress(){},onVisibleEndFrame(){},onCameraGeometry(){},onTrack(){},onConfidence(){},onAiDetection(){}};
  const out=await E.finishAnalysis(input,hooks,{sparseResult:sparse,trackingMessage:'synthetic track',ballTrack:null,velocityKmh:flight.velocityKmh,flightSeconds:flight.flightSeconds,flightFrames:flight.flightFrames});
  return {out,input,biometrics,geometry};
}

/** The 5.0.2 numbers for one case, in the shape the accuracy report uses. */
export async function legacyNumbers(c){
  const E=await loadEngine(),{out,biometrics}=await runLegacy(c);
  if(out.status!=='done')return {error:out.message??out.status};
  const r=out.result,cam=r.spatial_calibration?.camera_geometry,fps=c.fps,t=c.truth;
  const top=(r.top_candidates||[]).map(x=>x.pitch_type);
  const types=[];for(const p of top)if(!types.includes(p))types.push(p);
  return {
    camera:{method:cam?.method,...summarizeCameraError(E,cam,t,c.observations)},
    distance:{valueM:biometrics.effectiveTravelDistanceM,errM:biometrics.effectiveTravelDistanceM-t.distanceM},
    events:{releaseErrFrames:(c.times[c.marks.releaseFrame]-t.releaseTimeSec)*fps,gloveErrFrames:(c.times[c.marks.gloveFrame]-t.gloveTimeSec)*fps},
    movement:{ivb:r.ivb_inch,hb:r.hb_inch,ivbErr:r.ivb_inch-t.ivbInch,hbErr:r.hb_inch-t.hbInch},
    speed:{avgKmh:out.velocityKmh,avgErrKmh:out.velocityKmh-t.avgSpeedKmh,avgErrPct:(out.velocityKmh/t.avgSpeedKmh-1)*100,releaseKmh:null},
    pitchType:{top1:r.matched_pitch_type,truth:t.pitchType,top1Ok:r.matched_pitch_type===t.pitchType,top3:types.slice(0,3),top3Ok:types.slice(0,3).includes(t.pitchType),window:r.effective_velocity_window_kmh}
  };
}
