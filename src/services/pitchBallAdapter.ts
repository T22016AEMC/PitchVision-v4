// Adapter between the new pitch ball tracker and the existing analysis pipeline. The tracker's observations are
// converted to the same shape the old sparse tracker returned, so the unchanged engine gates (assessTrackEvidence,
// validateAndReconstructVideoTrack, matchPitchData) consume them as before. Estimated points are NOT passed on.
import type {SparseTrackingResult} from '../baseballTracker';
import {BallObservation,CameraViewMode} from '../types';
import {assessTrackEvidence} from './trackEvidence';
import {createVideoFrameSource} from './pitchBallFrameSource';
import {trackPitchBall,BallTrackRun,BallAnchor} from './pitchBallTracker';

export interface NewTrackingArgs{
  videoUrl:string;times:number[];releaseFrame:number;catchFrame:number;fps:number;view:CameraViewMode;
  sourceWidth:number;sourceHeight:number;
  /** Points the user tapped or confirmed: forced anchors. */
  userPoints?:BallAnchor[];
  /** Frames the user marked "no ball here": never used as observations. */
  noBallFrames?:number[];
  isCancelled?:()=>boolean;onProgress?:(percent:number,text:string)=>void;
}
export interface NewTrackingOutput{sparse:SparseTrackingResult;run:BallTrackRun;}

export async function trackWithNewModule(a:NewTrackingArgs):Promise<NewTrackingOutput>{
  const source=await createVideoFrameSource(a.videoUrl,a.times,{isCancelled:a.isCancelled});
  try{
    const run=await trackPitchBall(source,a.releaseFrame,a.catchFrame,{fps:a.fps,view:a.view,releaseFrame:a.releaseFrame,anchors:a.userPoints,noBallFrames:a.noBallFrames},a.isCancelled,a.onProgress);
    // work-pixel radius → source pixels
    const k=a.sourceWidth/Math.max(1,run.work.width);
    const observations:BallObservation[]=run.points.filter(p=>p.source!=='estimated').map(p=>({
      frame:p.frame,timestamp:p.time,x:p.xNorm*a.sourceWidth,y:p.yNorm*a.sourceHeight,x_norm:p.xNorm,y_norm:p.yNorm,
      radius:p.radius*k,confidence:p.source==='user'?1:Math.max(.5,p.confidence),source:'observation'
    }));
    const start=a.times[a.releaseFrame],end=a.times[a.catchFrame];
    const evidence=assessTrackEvidence(observations,a.fps,{releaseTimeSec:start,catchTimeSec:end,sourceTimestamps:a.times});
    const reliable=evidence.matchingEligible,windowFrames=run.window.last-run.window.first+1;
    const message=run.status==='tracked'
      ?`新找球模組：找到 ${run.observedCount} 個球點${run.estimatedCount?`，${run.estimatedCount} 格只有推估`:''}；${reliable?'通過共用觀測閘門，球體身份仍待確認':`證據不足或不完整：${evidence.matchingReasons.join('、')||'區間覆蓋不足'}；保留手動匹配`}。非神經網路辨識，推估點不當觀測。`
      :`新找球模組：${run.message}`;
    const sparse:SparseTrackingResult={
      observations,
      visibleEndFrame:observations.at(-1)?.frame??a.catchFrame,
      firstSeenFrame:observations[0]?.frame??a.releaseFrame,
      lastSeenFrame:observations.at(-1)?.frame??a.releaseFrame,
      status:reliable?'reliable':observations.length?'sparse':'insufficient_evidence',
      statusMessage:message,
      evidence:{sourceFrames:windowFrames,attemptedFrames:windowFrames+run.backgroundIndices.length,verifiedFrames:run.captureBreakdown.frames,unverifiedFrames:0,
        observationCount:evidence.observations.length,excludedFrames:Math.max(0,windowFrames-evidence.observations.length),
        trackFound:evidence.trackingSuccess,trackReliable:evidence.valid,reason:reliable?'通過共用觀測閘門；球體身份仍待確認':evidence.matchingReasons.join('、')}
    };
    return {sparse,run};
  }finally{source.dispose();}
}
