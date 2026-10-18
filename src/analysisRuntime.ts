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
import {createDatabaseSearchPrior} from './services/projectedDatabaseMatcher';
import {standardCameras} from './services/standardCamera';
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
     detections:BaseballTrackPoint[];trackingRan:boolean}
  | {status:'stale';message?:string};

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export function previewVelocity(eventView:EventView,analysisFps:number,analysisDistance:number){
  return calculateVelocity(eventView.releaseFrame,eventView.gloveFrame,analysisFps,analysisDistance,eventView.engineTimingBridge);
}

export async function runPitchAnalysis(input:AnalysisInput,hooks:AnalysisHooks):Promise<AnalysisOutcome>{
  const {events,eventView,videoTiming,videoFps,totalVideoFrames,sourceTimesValid,analysisHasSourceFrames,analysisFps,analysisDistance,releaseFrame,gloveFrame,visibleEndFrame,originalFlightFrames,selectedPitchType,cameraViewMode,biometrics,strictPitchTypeMode,allowCrossTypeFallback,manualAnchor,cameraGeometry,useExistingTracking,isCancelled}=input;
  const video=input.videoElement;
  const {velocityKmh,flightSeconds,flightFrames}=previewVelocity(eventView,analysisFps,analysisDistance);

  hooks.onProgress(10,`【步驟 1/6】鎖定出手 ${events.release!.timeSec.toFixed(6)}s 與進手套 ${events.glove!.timeSec.toFixed(6)}s...`);

  // 步驟 2: 運動差分候選、時間走廊追蹤與稀疏觀測點擷取
  let sparseResult=null;
  let trackingFailure:string|null=null;
  if(useExistingTracking&&sourceTimesValid&&videoTiming?.timeBase==='timestamp'&&video){
    hooks.onProgress(20,`【步驟 2/6】執行 ${formatSourceFps(videoFps)} FPS 差分運動偵測與時間走廊追蹤...`);
    try{
      const geometry=cameraGeometry??standardCameras(cameraViewMode,video.videoWidth,video.videoHeight,analysisDistance)[0];
      // Yield before bounded candidate integration; the UI can paint progress first.
      await pause(0);
      const searchPrior=createDatabaseSearchPrior(PITCH_DATABASE,velocityKmh,selectedPitchType,cameraViewMode,{releaseTimeSec:events.release!.timeSec,flightTimeSec:flightSeconds,distanceM:analysisDistance,geometry});
      const sourceRelease=sourceIndexAt(videoTiming.timestamps,events.release!.timeSec),sourceCatch=sourceIndexAt(videoTiming.timestamps,events.glove!.timeSec);
      sparseResult=await trackBaseballSparse(video,{
        releaseFrame:sourceRelease,
        visibleEndFrame:sourceCatch,
        releaseTimeSec:events.release!.timeSec,catchTimeSec:events.glove!.timeSec,searchPrior,
        isCancelled,
        catchFrame:sourceCatch,
        fps:videoFps,
        cameraView:cameraViewMode,
        manualAnchor:manualAnchor||undefined,
        timestamps:videoTiming?.timestamps,
        onProgress:(pct,_curF,stageText)=>{
          if(isCancelled())return;
          hooks.onProgress(Math.round(20+pct*0.3),`【步驟 2/6】${stageText}`);
        }
      });
    }catch(err){
      trackingFailure=`視覺追蹤未完成：${err instanceof Error?err.message:'解碼或搜尋不可用'}；保留手動分析。`;
      console.warn('Sparse baseball tracking fallback:',err);
    }
  }

  if(isCancelled())return {status:'stale'};
  const trackingMessage=sparseResult?.statusMessage??trackingFailure??(useExistingTracking?'無已驗證原始PTS，略過視覺追蹤；保留手動媒體時間分析。':'未啟用視覺追蹤；資料庫估計。');

  // 步驟 3: 嚴格執行 ACCURACY > COVERAGE 驗證閘門 (絕不用 MODEL TRACK 或兩點直連冒充 VIDEO TRACK)
  hooks.onProgress(55,'【步驟 3/6】驗證真實視覺證據：需 >= 3 個獨立觀測點，拒絕偽造直線/拋物線...');
  const effectiveVisibleEnd=sparseResult?.visibleEndFrame||visibleEndFrame||gloveFrame;
  if(sparseResult&&sparseResult.visibleEndFrame)hooks.onVisibleEndFrame(sparseResult.visibleEndFrame);

  const validationResult=validateAndReconstructVideoTrack({
    observations:(sparseResult?.observations||[]).filter(p=>p.timestamp>=events.release!.timeSec&&p.timestamp<=events.glove!.timeSec),
    releaseFrame:sparseResult?.firstSeenFrame??releaseFrame,
    lastReliableBallFrame:effectiveVisibleEnd,
    catchFrame:sparseResult?.lastSeenFrame??gloveFrame,
    actualFps:videoFps,releaseTimeSec:events.release!.timeSec,catchTimeSec:events.glove!.timeSec,sourceTimestamps:sourceTimesValid&&videoTiming?.timeBase==='timestamp'?videoTiming.timestamps:undefined,
    videoWidth:video?.videoWidth||videoTiming?.width||720,
    videoHeight:video?.videoHeight||videoTiming?.height||1280
  });

  let analysisGeometry=cameraGeometry;
  if(video&&cameraGeometry?.method!=='planar_reference'){
    try{
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const decoded=await VideoTimingService.seekAndCaptureFrame(video,releaseFrame,analysisFps,canvas,events.release!.timeSec);
      if(decoded.imageData){analysisGeometry=estimateImageLines(decoded.imageData);hooks.onCameraGeometry(analysisGeometry);}
    }catch{hooks.onProgress(55,'幾何影像擷取不可用，沿用既有模型估算，不中斷手動分析');}
  }
  hooks.onTrack(validationResult.videoTrack,validationResult.metrics);

  // 步驟 4: 相機透視與尺度校正 (Perspective / Scale Calibrated Estimate)
  await pause(220);
  hooks.onProgress(72,`【步驟 4/6】執行 Perspective / Scale Calibrated Estimate：校正${biometrics.hasMound?'標準投手丘(+25.4cm)':'平地牛棚'}、身高${biometrics.pitcherHeightCm}cm、跨步${biometrics.effectiveStrideDistanceCm}cm，解算實測 IVB / HB...`);

  // 步驟 5: 球種鎖定 -> 速度窗口 -> 觀測位移反查 RPM / Spin Axis -> 出手角微調
  await pause(220);
  hooks.onProgress(88,`【步驟 5/6】鎖定球種【${selectedPitchType}】➔ 原始影像觀測與投影候選比較；資料庫提供旋轉參數...`);

  // 步驟 6: Gravity + Drag + Magnus 物理重建 MODEL TRACK 與閉環驗證
  await pause(200);
  hooks.onProgress(96,'【步驟 6/6】數值積分資料庫候選並比對影像；匹配殘差不是獨立準確度驗證...');

  const isManualUsed=analysisHasSourceFrames&&Boolean(manualAnchor?.point1&&manualAnchor?.point2);
  const conf=calculateUnifiedConfidence({
    fps:analysisFps,
    totalVideoFrames,
    releaseFrame,
    gloveFrame,
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
  const computed=matchPitchData(velocityKmh,flightSeconds,selectedPitchType,cameraViewMode,PITCH_DATABASE,releaseFrame,gloveFrame,biometrics,validationResult.videoTrack,validationResult.metrics,conf,analysisFps,eventView.engineTimingBridge,strictPitchTypeMode,allowCrossTypeFallback,isManualUsed,input.autoDetectConfidence,analysisGeometry||undefined,sourceTimesValid&&videoTiming?.timeBase==='timestamp'?videoTiming.timestamps:undefined);
  // Time-source presentation only; confidence formulas and numerical scores stay unchanged.
  computed.confidence_scores.quality_notes=computed.confidence_scores.quality_notes.map(note=>note.startsWith('飛行時間 ')?`事件時差 ${flightSeconds.toFixed(6)}s；品質評分沿用原始影格跨度，不把90Hz位置當觀測`:note);
  if(!analysisHasSourceFrames){
    computed.confidence_scores.quality_notes=computed.confidence_scores.quality_notes.map(note=>note.includes('幀率影片')?'來源 FPS 未確認，不能推斷影格解析度。':note);
    if(computed.observed_metrics)computed.observed_metrics.details=computed.observed_metrics.details.map(note=>note.startsWith('實測飛行時間：')?`手動媒體事件時差：${flightSeconds.toFixed(6)}s；不依賴來源 FPS。`:note);
    computed.confidence_scores.quality_notes.push(`${sourceTimesValid?'事件未對應來源影格':'來源 FPS／PTS 未確認'}：以播放器事件秒數執行模型估算；時間槽不是原始影格，無新增實測追蹤點。`);
  }
  computed.event_times={releaseTimeSec:events.release!.timeSec,catchTimeSec:events.glove!.timeSec};
  computed.original_flight_frames=originalFlightFrames;
  computed.tracking_evidence=sparseResult?.evidence??{sourceFrames:0,attemptedFrames:0,verifiedFrames:0,unverifiedFrames:0,observationCount:0,excludedFrames:0,trackFound:false,trackReliable:false,reason:trackingMessage};
  computed.confidence_scores.quality_notes.push(trackingMessage);
  const detections=(sparseResult?.observations||[]).filter(p=>p.timestamp>=events.release!.timeSec&&p.timestamp<=events.glove!.timeSec);
  return {status:'done',result:computed,velocityKmh,flightSeconds,flightFrames,detections,trackingRan:Boolean(sparseResult)};
}
