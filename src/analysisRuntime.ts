// Lazy analysis chunk for the mobile shell. App.tsx reaches this module only via
// dynamic import(), so matchingEngine and the 1,080-record database are fetched
// when the user starts an analysis. The pipeline below is the V4.7 App.tsx
// handleStartAnalysis sequence moved verbatim; engine calls and arguments are unchanged.
import {formatSourceFps} from './services/sourceTiming';
import {SelectedEvents,sourceIndexAt} from './services/analysisTimeline';
import {CameraGeometry,estimateImageLines} from './services/cameraGeometry';
import {VideoTimingService} from './services/videoTimingService';
import {PITCH_DATABASE,PITCH_TYPE_OPTIONS,calculateVelocity,matchPitchData,analyzePitchFramesFrameByFrame,FrameDetectionResult} from './matchingEngine';
import {CameraViewMode,PitcherBiometrics,BaseballTrackPoint,VideoTrackMetrics,UnifiedConfidenceScores,ManualAnchorInput,VideoTiming,MatchResult} from './types';
import {trackBaseballSparse} from './baseballTracker';
import type {SparseTrackingResult} from './baseballTracker';
import {trackWithNewModule} from './services/pitchBallAdapter';
import type {BallTrackRun,BallAnchor} from './services/pitchBallTracker';
import {createDatabaseSearchPrior} from './services/projectedDatabaseMatcher';
import {standardCameras} from './services/standardCamera';
import {runGeometryStage} from './services/geometryStage';
import type {PitchEstimates} from './services/pitchEstimates';
import type {CameraMetadata} from './services/cameraMetadata';
import {validateAndReconstructVideoTrack} from './services/trajectoryValidationService';
import {calculateUnifiedConfidence} from './confidenceEngine';

export {PITCH_DATABASE,PITCH_TYPE_OPTIONS};

type EventView={releaseFrame:number;gloveFrame:number;engineTimingBridge:number[];eventOnly?:boolean};

export interface AnalysisInput {
  videoElement:HTMLVideoElement|null;
  events:SelectedEvents;
  eventView:EventView;
  videoTiming:(VideoTiming&{width:number;height:number})|null;
  videoFps:number;
  totalVideoFrames:number;
  sourceTimesValid:boolean;
  analysisHasSourceFrames:boolean;
  analysisFps:number;
  analysisDistance:number;
  releaseFrame:number;
  gloveFrame:number;
  visibleEndFrame:number;
  originalFlightFrames:number|null;
  selectedPitchType:string;
  cameraViewMode:CameraViewMode;
  biometrics:PitcherBiometrics;
  strictPitchTypeMode:boolean;
  allowCrossTypeFallback:boolean;
  manualAnchor:ManualAnchorInput|null;
  cameraGeometry:CameraGeometry|null;
  useExistingTracking:boolean;
  hasAiDetection:boolean;
  autoDetectConfidence?:number;
  isCancelled:()=>boolean;
  /** Points the user tapped or confirmed (forced anchors for the new ball finder). */
  userPoints?:BallAnchor[];
  /** Frames the user marked "no ball here". */
  noBallFrames?:number[];
  /** Lens facts read from the file (focal-length prior). */
  cameraMeta?:CameraMetadata|null;
  /** Owner-entered release→net distance in metres; replaces the prior. */
  distanceOverrideM?:number|null;
  /** Test hooks: number of geometry-fit draws; switch the whole 5.0.3 geometry stage off (reproduces 5.0.2 inputs). */
  fitSamples?:number;
  disableGeometryStage?:boolean;
}

/** What the new ball finder reported, for the UI (counts, status, per-frame points, timing). */
export interface BallTrackSummary{
  engine:'new'|'old';status:BallTrackRun['status']|'old_detector';message:string;
  observedCount:number;estimatedCount:number;
  points:{frame:number;timeSec:number;xNorm:number;yNorm:number;source:'observation'|'estimated'|'user'}[];
  tripodAdvised:boolean;maxShiftFrac:number;work:string|null;ms:number;
}

export interface AnalysisHooks {
  onProgress:(pct:number,text:string)=>void;
  onVisibleEndFrame:(frame:number)=>void;
  onCameraGeometry:(geometry:CameraGeometry)=>void;
  onTrack:(track:BaseballTrackPoint[],metrics:VideoTrackMetrics)=>void;
  onConfidence:(scores:UnifiedConfidenceScores)=>void;
  onAiDetection:(detection:FrameDetectionResult)=>void;
}

export type AnalysisOutcome=
  | {status:'done';result:MatchResult;velocityKmh:number;flightSeconds:number;flightFrames:number;
     /** Raw per-frame ball detections inside the marked window; display only, never fed back into the engine. */
     detections:BaseballTrackPoint[];trackingRan:boolean;ballTrack:BallTrackSummary|null;
     /** 5.0.3 geometry stage: camera, distance, events, movement, speeds and pitch types, each with range and origin. */
     estimates:PitchEstimates|null;distanceM:number;eventTimes:{releaseSec:number;gloveSec:number}}
  | {status:'stale';message?:string};

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let pacing=true; // progress pacing between steps; tests switch it off
export const setAnalysisPacing=(on:boolean)=>{pacing=on;};
const wait=(ms:number)=>pacing?pause(ms):Promise.resolve();

export function previewVelocity(eventView:EventView,analysisFps:number,analysisDistance:number){
  return calculateVelocity(eventView.releaseFrame,eventView.gloveFrame,analysisFps,analysisDistance,eventView.engineTimingBridge);
}

export async function runPitchAnalysis(input:AnalysisInput,hooks:AnalysisHooks):Promise<AnalysisOutcome>{
  const {events,eventView,videoTiming,videoFps,totalVideoFrames,sourceTimesValid,analysisHasSourceFrames,analysisFps,analysisDistance,releaseFrame,gloveFrame,visibleEndFrame,originalFlightFrames,selectedPitchType,cameraViewMode,biometrics,strictPitchTypeMode,allowCrossTypeFallback,manualAnchor,cameraGeometry,useExistingTracking,isCancelled}=input;
  const video=input.videoElement;
  const {velocityKmh,flightSeconds,flightFrames}=previewVelocity(eventView,analysisFps,analysisDistance);

  hooks.onProgress(10,`【步驟 1/6】鎖定出手 ${events.release!.timeSec.toFixed(6)}s 與進手套 ${events.glove!.timeSec.toFixed(6)}s...`);

  // 步驟 2: 找球。新找球模組優先；只有它發生技術性失敗（例外）時才回退到舊追蹤器。
  let sparseResult=null;
  let trackingFailure:string|null=null;
  let ballTrack:BallTrackSummary|null=null;
  if(useExistingTracking&&sourceTimesValid&&videoTiming?.timeBase==='timestamp'&&video){
    const sourceRelease=sourceIndexAt(videoTiming.timestamps,events.release!.timeSec),sourceCatch=sourceIndexAt(videoTiming.timestamps,events.glove!.timeSec);
    hooks.onProgress(20,`【步驟 2/6】尋找影片中的球（對齊畫面、建立背景、物理連線）...`);
    try{
      const out=await trackWithNewModule({
        videoUrl:video.currentSrc||video.src,times:videoTiming.timestamps,releaseFrame:sourceRelease,catchFrame:sourceCatch,fps:videoFps,view:cameraViewMode,
        sourceWidth:video.videoWidth||videoTiming.width,sourceHeight:video.videoHeight||videoTiming.height,
        userPoints:input.userPoints,noBallFrames:input.noBallFrames,isCancelled,
        onProgress:(pct,text)=>{if(isCancelled())return;hooks.onProgress(Math.round(20+pct*0.3),`【步驟 2/6】${text}`);}
      });
      sparseResult=out.sparse;
      ballTrack={engine:'new',status:out.run.status,message:out.run.message,observedCount:out.run.observedCount,estimatedCount:out.run.estimatedCount,
        points:out.run.points.map(p=>({frame:p.frame,timeSec:p.time,xNorm:p.xNorm,yNorm:p.yNorm,source:p.source})),
        tripodAdvised:out.run.camera.tripodAdvised,maxShiftFrac:out.run.camera.maxShiftFrac,work:`${out.run.source.workWidth}x${out.run.source.workHeight}`,ms:Math.round(out.run.captureMs+out.run.stats.ms)};
    }catch(err){
      if(isCancelled())return {status:'stale'};
      console.warn('New ball finder failed; falling back to the old tracker:',err);
      // 回退：舊的運動差分候選＋時間走廊追蹤器
      try{
        const geometry=cameraGeometry??standardCameras(cameraViewMode,video.videoWidth,video.videoHeight,analysisDistance)[0];
        await pause(0);
        const searchPrior=createDatabaseSearchPrior(PITCH_DATABASE,velocityKmh,selectedPitchType,cameraViewMode,{releaseTimeSec:events.release!.timeSec,flightTimeSec:flightSeconds,distanceM:analysisDistance,geometry});
        sparseResult=await trackBaseballSparse(video,{
          releaseFrame:sourceRelease,visibleEndFrame:sourceCatch,releaseTimeSec:events.release!.timeSec,catchTimeSec:events.glove!.timeSec,searchPrior,
          isCancelled,catchFrame:sourceCatch,fps:videoFps,cameraView:cameraViewMode,manualAnchor:manualAnchor||undefined,timestamps:videoTiming?.timestamps,
          onProgress:(pct,_curF,stageText)=>{if(isCancelled())return;hooks.onProgress(Math.round(20+pct*0.3),`【步驟 2/6】${stageText}`);}
        });
        ballTrack={engine:'old',status:'old_detector',message:'新找球模組無法執行，已改用舊偵測器。',observedCount:sparseResult.observations.length,estimatedCount:0,points:sparseResult.observations.map(o=>({frame:o.frame,timeSec:o.timestamp,xNorm:o.x_norm,yNorm:o.y_norm,source:'observation' as const})),tripodAdvised:false,maxShiftFrac:0,work:null,ms:0};
      }catch(err2){
        trackingFailure=`視覺追蹤未完成：${err2 instanceof Error?err2.message:'解碼或搜尋不可用'}；保留手動分析。`;
        console.warn('Sparse baseball tracking fallback:',err2);
      }
    }
  }

  if(isCancelled())return {status:'stale'};
  const trackingMessage=sparseResult?.statusMessage??trackingFailure??(useExistingTracking?'無已驗證原始PTS，略過視覺追蹤；保留手動媒體時間分析。':'未啟用視覺追蹤；資料庫估計。');
  return finishAnalysis(input,hooks,{sparseResult,trackingMessage,ballTrack,velocityKmh,flightSeconds,flightFrames});
}

/** Steps 3–6: everything after ball finding. Exported so tests can run the engine on a known track without a video. */
export interface TrackingStage{sparseResult:SparseTrackingResult|null;trackingMessage:string;ballTrack:BallTrackSummary|null;velocityKmh:number;flightSeconds:number;flightFrames:number;}
export async function finishAnalysis(input:AnalysisInput,hooks:AnalysisHooks,stage:TrackingStage):Promise<AnalysisOutcome>{
  const {events,videoTiming,videoFps,totalVideoFrames,sourceTimesValid,analysisHasSourceFrames,analysisFps,releaseFrame,gloveFrame,visibleEndFrame,originalFlightFrames,selectedPitchType,cameraViewMode,biometrics,strictPitchTypeMode,allowCrossTypeFallback,manualAnchor,cameraGeometry,eventView,isCancelled}=input;
  const video=input.videoElement;
  const {sparseResult,trackingMessage,ballTrack,velocityKmh,flightSeconds,flightFrames}=stage;

  // 步驟 3: 嚴格執行 ACCURACY > COVERAGE 驗證閘門 (絕不用 MODEL TRACK 或兩點直連冒充 VIDEO TRACK)
  hooks.onProgress(55,'【步驟 3/6】驗證真實視覺證據：需 >= 3 個獨立觀測點，拒絕偽造直線/拋物線...');
  const effectiveVisibleEnd=sparseResult?.visibleEndFrame||visibleEndFrame||gloveFrame;
  if(sparseResult&&sparseResult.visibleEndFrame)hooks.onVisibleEndFrame(sparseResult.visibleEndFrame);

  // 5.0.3: camera, distance and event times from the ball path (falls back to the 5.0.2 inputs when the fit is not trustworthy)
  hooks.onProgress(58,'【步驟 3/6】由球路估計相機、距離與出手／撞網時間...');
  await wait(0);
  const geo=!input.disableGeometryStage&&analysisHasSourceFrames&&videoTiming?.timeBase==='timestamp'&&events.release&&events.glove
    ?runGeometryStage({observations:sparseResult?.observations??[],width:videoTiming.width||video?.videoWidth||720,height:videoTiming.height||video?.videoHeight||1280,fps:videoFps,view:cameraViewMode,times:videoTiming.timestamps,durationSec:videoTiming.durationSec,
      events,biometrics,cameraMeta:input.cameraMeta,distanceM:input.analysisDistance,distanceOverrideM:input.distanceOverrideM,db:PITCH_DATABASE,samples:input.fitSamples})
    :null;
  const engineEvents=geo?.events??events,engineBiometrics=geo?.biometrics??{...biometrics,effectiveTravelDistanceM:input.analysisDistance},engineEventView=geo?.eventView??eventView;
  const engineRelease=engineEventView.releaseFrame,engineGlove=engineEventView.gloveFrame;
  const engineVelocity=geo?calculateVelocity(engineRelease,engineGlove,analysisFps,engineBiometrics.effectiveTravelDistanceM,engineEventView.engineTimingBridge):{velocityKmh,flightSeconds,flightFrames};
  if(geo?.fitUsed&&geo.geometry)hooks.onCameraGeometry(geo.geometry);

  const validationResult=validateAndReconstructVideoTrack({
    observations:(sparseResult?.observations||[]).filter(p=>p.timestamp>=engineEvents.release!.timeSec-1e-6&&p.timestamp<=engineEvents.glove!.timeSec+1e-6),
    releaseFrame:sparseResult?.firstSeenFrame??releaseFrame,
    lastReliableBallFrame:effectiveVisibleEnd,
    catchFrame:sparseResult?.lastSeenFrame??gloveFrame,
    actualFps:videoFps,releaseTimeSec:engineEvents.release!.timeSec,catchTimeSec:engineEvents.glove!.timeSec,sourceTimestamps:sourceTimesValid&&videoTiming?.timeBase==='timestamp'?videoTiming.timestamps:undefined,
    videoWidth:video?.videoWidth||videoTiming?.width||720,
    videoHeight:video?.videoHeight||videoTiming?.height||1280
  });

  let analysisGeometry=geo?.fitUsed&&geo.geometry?geo.geometry:cameraGeometry;
  if(!geo?.fitUsed&&video&&cameraGeometry?.method!=='planar_reference'){
    try{
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const decoded=await VideoTimingService.seekAndCaptureFrame(video,releaseFrame,analysisFps,canvas,events.release!.timeSec);
      if(decoded.imageData){analysisGeometry=estimateImageLines(decoded.imageData);hooks.onCameraGeometry(analysisGeometry);}
    }catch{hooks.onProgress(55,'幾何影像擷取不可用，沿用既有模型估算，不中斷手動分析');}
  }
  hooks.onTrack(validationResult.videoTrack,validationResult.metrics);

  // 步驟 4: 相機透視與尺度校正 (Perspective / Scale Calibrated Estimate)
  await wait(220);
  hooks.onProgress(72,`【步驟 4/6】${geo?.fitUsed?'使用球路估計的相機與距離':'相機為推測（沿用標準相機）'}：身高${biometrics.pitcherHeightCm}cm、距離 ${engineBiometrics.effectiveTravelDistanceM} m，解算 IVB / HB...`);

  // 步驟 5: 球種鎖定 -> 速度窗口 -> 觀測位移反查 RPM / Spin Axis -> 出手角微調
  await wait(220);
  hooks.onProgress(88,`【步驟 5/6】鎖定球種【${selectedPitchType}】➔ 原始影像觀測與投影候選比較；資料庫提供旋轉參數...`);

  // 步驟 6: Gravity + Drag + Magnus 物理重建 MODEL TRACK 與閉環驗證
  await wait(200);
  hooks.onProgress(96,'【步驟 6/6】數值積分資料庫候選並比對影像；匹配殘差不是獨立準確度驗證...');

  const isManualUsed=analysisHasSourceFrames&&Boolean(manualAnchor?.point1&&manualAnchor?.point2);
  const conf=calculateUnifiedConfidence({
    fps:analysisFps,
    totalVideoFrames,
    releaseFrame:engineRelease,
    gloveFrame:engineGlove,
    isUserConfirmedFrames:true,
    isManualAnchorUsed:isManualUsed,
    autoDetectionConfidence:input.autoDetectConfidence,
    videoMetrics:validationResult.metrics
  });
  hooks.onConfidence(conf);

  if(!input.hasAiDetection&&analysisHasSourceFrames){
    const refEst=analyzePitchFramesFrameByFrame(totalVideoFrames,videoFps,selectedPitchType,cameraViewMode);
    hooks.onAiDetection({...refEst,releaseFrame,gloveFrame});
  }

  if(isCancelled())return {status:'stale',message:'分析期間事件或設定已變更，請重新分析'};
  const computed=matchPitchData(engineVelocity.velocityKmh,engineVelocity.flightSeconds,selectedPitchType,cameraViewMode,PITCH_DATABASE,engineRelease,engineGlove,engineBiometrics,validationResult.videoTrack,validationResult.metrics,conf,analysisFps,engineEventView.engineTimingBridge,strictPitchTypeMode,allowCrossTypeFallback,isManualUsed,input.autoDetectConfidence,analysisGeometry||undefined,sourceTimesValid&&videoTiming?.timeBase==='timestamp'?videoTiming.timestamps:undefined);
  // Time-source presentation only; confidence formulas and numerical scores stay unchanged.
  computed.confidence_scores.quality_notes=computed.confidence_scores.quality_notes.map(note=>note.startsWith('飛行時間 ')?`事件時差 ${flightSeconds.toFixed(6)}s；品質評分沿用原始影格跨度，不把90Hz位置當觀測`:note);
  if(!analysisHasSourceFrames){
    computed.confidence_scores.quality_notes=computed.confidence_scores.quality_notes.map(note=>note.includes('幀率影片')?'來源 FPS 未確認，不能推斷影格解析度。':note);
    if(computed.observed_metrics)computed.observed_metrics.details=computed.observed_metrics.details.map(note=>note.startsWith('實測飛行時間：')?`手動媒體事件時差：${flightSeconds.toFixed(6)}s；不依賴來源 FPS。`:note);
    computed.confidence_scores.quality_notes.push(`${sourceTimesValid?'事件未對應來源影格':'來源 FPS／PTS 未確認'}：以播放器事件秒數執行模型估算；時間槽不是原始影格，無新增實測追蹤點。`);
  }
  computed.event_times={releaseTimeSec:engineEvents.release!.timeSec,catchTimeSec:engineEvents.glove!.timeSec};
  if(geo?.fitUsed&&computed.spatial_calibration)computed.spatial_calibration.calibration_status='相機由球路自動估計（角度由球路、焦距由手機資訊、位置為先驗）；距離為先驗，單鏡頭無法量距離。';
  computed.original_flight_frames=originalFlightFrames;
  computed.tracking_evidence=sparseResult?.evidence??{sourceFrames:0,attemptedFrames:0,verifiedFrames:0,unverifiedFrames:0,observationCount:0,excludedFrames:0,trackFound:false,trackReliable:false,reason:trackingMessage};
  computed.confidence_scores.quality_notes.push(trackingMessage);
  const detections=(sparseResult?.observations||[]).filter(p=>p.timestamp>=events.release!.timeSec&&p.timestamp<=events.glove!.timeSec) as unknown as BaseballTrackPoint[];
  return {status:'done',result:computed,velocityKmh:engineVelocity.velocityKmh,flightSeconds:engineVelocity.flightSeconds,flightFrames:engineVelocity.flightFrames,detections,trackingRan:Boolean(sparseResult),ballTrack,
    estimates:geo?.estimates??null,distanceM:engineBiometrics.effectiveTravelDistanceM,eventTimes:{releaseSec:engineEvents.release!.timeSec,gloveSec:engineEvents.glove!.timeSec}};
}
