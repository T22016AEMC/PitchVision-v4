import {formatSourceFps} from './services/sourceTiming';
import {SelectedEvents,SelectedEvent,PositionKind,describePosition,selectEvent,eventAnalysisView,sourceIndexAt} from './services/analysisTimeline';
import {hasUsableSourceTimes,manualAnalysisReason,confirmCfrTiming} from './services/manualAnalysisReadiness';
import {CameraGeometry} from './services/cameraGeometry';
import React,{useState,useMemo,ChangeEvent,useEffect,useRef} from 'react';
import type {FrameDetectionResult} from './matchingEngine';
import {CameraViewMode,PitcherBiometrics,BaseballTrackPoint,VideoTrackMetrics,UnifiedConfidenceScores,ManualAnchorInput,VideoTiming,MatchResult,PitchRecord} from './types';
import {computePitcherBiometrics,DEFAULT_PITCHER_BIOMETRICS,STANDARD_GLOVE_DISTANCE_METERS} from './spatialCalibration';
import {VideoQualityAssessment} from './services/videoMetadataService';
import {VideoLoadService,VideoLoadStatus} from './services/videoLoadService';
import type {AutoFrameDetectionOutput} from './services/autoFrameDetectionEngine';
import {PITCH_TYPE_OPTIONS} from './shellConstants';
import {loadAnalysisRuntime,EngineLoadState,AnalysisRuntime} from './engineLoader';
import {PitchVideoPlayer,OverlayPoint} from './components/PitchVideoPlayer';
import {PitchVisualizer} from './components/PitchVisualizer';
import {MetricsPanel} from './components/MetricsPanel';
import {PitcherSetupCard} from './components/PitcherSetupCard';
import {DatabaseModal} from './components/DatabaseModal';
import {CodeViewerModal} from './components/CodeViewerModal';
import {ScientificInfoPanel} from './components/ScientificInfoPanel';
import {VideoQualityCard} from './components/VideoQualityCard';
import {StepNav,Step as NavStep} from './components/StepNav';
import {ResultCards} from './components/ResultCards';
import {AutoDetectPanel} from './components/AutoDetectPanel';
import {GroundCalibration} from './components/GroundCalibration';
import {FpsDialog} from './components/FpsDialog';
import {UploadCloud,Loader2,AlertTriangle,CheckCircle,Info,ChevronRight,RotateCcw,FlaskConical} from 'lucide-react';

type Step=NavStep|'assist';
type AnalysisOutcomeDone=Extract<Awaited<ReturnType<AnalysisRuntime['runPitchAnalysis']>>,{status:'done'}>;
const APP_VERSION=typeof __APP_VERSION__==='string'?__APP_VERSION__:'dev';

export default function App() {
  const [step,setStep]=useState<Step>('video');
  const [biometrics,setBiometrics]=useState<PitcherBiometrics>(DEFAULT_PITCHER_BIOMETRICS);

  // Video and frame states
  const [totalVideoFrames,setTotalVideoFrames]=useState<number>(0);
  const [videoFps,setVideoFps]=useState<number>(NaN);
  const [videoTiming,setVideoTiming]=useState<(VideoTiming&{width:number;height:number})|null>(null);
  const [videoLoadStatus,setVideoLoadStatus]=useState<VideoLoadStatus>('idle');
  const [videoLoadError,setVideoLoadError]=useState<string|null>(null);
  const videoLoadGeneration=useRef(0);

  const [aiDetection,setAiDetection]=useState<FrameDetectionResult|null>(null);
  const [autoDetectResult,setAutoDetectResult]=useState<AutoFrameDetectionOutput|null>(null);
  const autoGeneration=useRef(0);
  const [isAutoDetectingFrames,setIsAutoDetectingFrames]=useState<boolean>(false);
  const [autoDetectProgress,setAutoDetectProgress]=useState<number>(0);
  const [autoDetectStageText,setAutoDetectStageText]=useState<string>('');

  const [events,setEvents]=useState<SelectedEvents>({release:null,glove:null});
  const [analyzedEvents,setAnalyzedEvents]=useState<SelectedEvents|null>(null);
  const [currentViewKind,setCurrentViewKind]=useState<PositionKind>('original');
  const eventView=useMemo(()=>{try{return videoTiming?eventAnalysisView(videoTiming.timestamps,events,videoTiming.durationSec):null;}catch{return null;}},[videoTiming,events]);
  const releaseFrame=eventView?.releaseFrame??events.release?.left??0,gloveFrame=eventView?.gloveFrame??events.glove?.left??0;
  const [visibleEndFrame,setVisibleEndFrame]=useState<number>(0);
  const [currentVideoFrame,setCurrentVideoFrame]=useState<number>(0);
  const [targetFrameSeek,setTargetFrameSeek]=useState<number|null>(null);
  const [scienceOpen,setScienceOpen]=useState(false);
  const [cameraGeometry,setCameraGeometry]=useState<CameraGeometry|null>(null);
  const analysisDistance=cameraGeometry?.method==='planar_reference'?cameraGeometry.referenceLengthM!:biometrics.effectiveTravelDistanceM;
  const setEvent=(name:'release'|'glove',event:SelectedEvent)=>{setEvents(prev=>({...prev,[name]:event}));setHasAnalyzed(false);if(name==='glove')setVisibleEndFrame(event.right);setManualAnchor(prev=>prev?{...prev,[name==='release'?'point1':'point2']:undefined}:null);};
  // Preview-only positions are not source PTS or measured frames. Quantitative
  // analysis still requires the unchanged source timing validation.
  const selectionOnly=!videoTiming?.timestamps.length;
  const controlTimes=useMemo(()=>{
    if(videoTiming?.timestamps.length)return videoTiming.timestamps;
    const duration=videoTiming?.durationSec??0;
    if(!Number.isFinite(duration)||duration<=0)return [];
    const intervals=Math.min(60000,Math.ceil(duration*100));
    return Array.from({length:intervals+1},(_,i)=>i*duration/intervals);
  },[videoTiming]);
  const markRelease=(frame:number)=>{if(controlTimes[frame]!==undefined)setEvent('release',{...selectEvent(describePosition(controlTimes,controlTimes[frame],videoTiming?.timeBase!=='timestamp'),controlTimes),...(selectionOnly?{sourceSpanSec:NaN,previewQuality:'unavailable' as const}:{})});};
  const markGlove=(frame:number)=>{if(controlTimes[frame]!==undefined)setEvent('glove',{...selectEvent(describePosition(controlTimes,controlTimes[frame],videoTiming?.timeBase!=='timestamp'),controlTimes),...(selectionOnly?{sourceSpanSec:NaN,previewQuality:'unavailable' as const}:{})});};

  // Manual ball positions are no longer a visible control: they are collected only by the
  // "tap the ball" prompt when the program cannot find it (see assist* below).
  const [manualAnchor,setManualAnchor]=useState<ManualAnchorInput|null>(null);

  // 球種設定與 Strict Mode 控制
  const [selectedPitchType,setSelectedPitchType]=useState<string>(PITCH_TYPE_OPTIONS[0]);
  const [strictPitchTypeMode,setStrictPitchTypeMode]=useState<boolean>(true);
  const [allowCrossTypeFallback,setAllowCrossTypeFallback]=useState<boolean>(false);

  const [cameraViewMode,setCameraViewMode]=useState<CameraViewMode>('catcher');
  const [userVideoUrl,setUserVideoUrl]=useState<string|null>(null);
  const [videoFileName,setVideoFileName]=useState<string>('');

  // 分析狀態管理
  const analysisInputGeneration=useRef(0);
  const [completedResult,setCompletedResult]=useState<MatchResult|null>(null);
  const [completedVelocity,setCompletedVelocity]=useState<{velocityKmh:number;flightSeconds:number;flightFrames:number}|null>(null);
  const [detections,setDetections]=useState<BaseballTrackPoint[]>([]);
  const [useExistingTracking,setUseExistingTracking]=useState(true);
  const [hasAnalyzed,setHasAnalyzed]=useState<boolean>(false);
  const [isAnalyzing,setIsAnalyzing]=useState<boolean>(false);
  const [analysisProgress,setAnalysisProgress]=useState<number>(0);
  const [analysisStepText,setAnalysisStepText]=useState<string>('');
  const [engineState,setEngineState]=useState<EngineLoadState>('idle');

  // 棒球視覺追蹤與信賴評估狀態
  const videoElementRef=useRef<HTMLVideoElement|null>(null);
  const activeObjectUrlRef=useRef<string|null>(null);
  const [,setVideoTrack]=useState<BaseballTrackPoint[]>([]);
  const [,setVideoMetrics]=useState<VideoTrackMetrics|null>(null);
  const [,setConfidenceScores]=useState<UnifiedConfidenceScores|null>(null);
  const [videoQuality,setVideoQuality]=useState<VideoQualityAssessment|null>(null);

  // Video page: original video (with detected-ball overlay) or the 2D animation
  const [viewTab,setViewTab]=useState<'video'|'twod'>('video');
  useEffect(()=>setViewTab('video'),[userVideoUrl]);

  // "Tap the ball" assist (only when the program could not find a reliable ball track)
  const [assistStage,setAssistStage]=useState<1|2|null>(null);
  const [assistNote,setAssistNote]=useState<string|null>(null);
  const assistFrames=useRef<{first:number;second:number}>({first:0,second:0});
  const assistFirst=useRef<NonNullable<ManualAnchorInput['point1']>|null>(null);
  const pendingOutcome=useRef<AnalysisOutcomeDone|null>(null);

  // FPS question (only when the container timing cannot be read)
  const [fpsDialogOpen,setFpsDialogOpen]=useState(false);
  const [fpsError,setFpsError]=useState<string|null>(null);

  // Modals (database and Python source are fetched on demand)
  const [isDbModalOpen,setIsDbModalOpen]=useState<boolean>(false);
  const [database,setDatabase]=useState<PitchRecord[]|null>(null);
  const [isCodeModalOpen,setIsCodeModalOpen]=useState<boolean>(false);
  const [pythonSource,setPythonSource]=useState<string|null>(null);

  const isVideoLoaded=Boolean(userVideoUrl&&videoLoadStatus==='ready');
  const busy=isAnalyzing||isAutoDetectingFrames;

  const sourceTimesValid=useMemo(()=>hasUsableSourceTimes(videoTiming),[videoTiming]);
  const needFps=Boolean(isVideoLoaded&&videoTiming&&!sourceTimesValid);
  const analysisHasSourceFrames=sourceTimesValid&&!eventView?.eventOnly;
  // Count only enumerated original PTS, never the legacy event-only bridge.
  const originalFlightFrames=sourceTimesValid&&videoTiming?.timeBase==='timestamp'&&events.release&&events.glove
    ?videoTiming.timestamps.filter(t=>t>=events.release!.timeSec&&t<=events.glove!.timeSec).length:null;
  const analysisFps=analysisHasSourceFrames?videoFps:0; // 0 means unknown; event slots supply exact seconds.
  const analysisBlockReason=manualAnalysisReason(isVideoLoaded,isAnalyzing,isAutoDetectingFrames,videoTiming,releaseFrame,gloveFrame,sourceTimesValid,events)||(eventView?null:'請先標記出手與進手套。');
  useEffect(()=>{analysisInputGeneration.current++;setHasAnalyzed(false);},[selectedPitchType,cameraViewMode,biometrics,strictPitchTypeMode,allowCrossTypeFallback,events,videoTiming,userVideoUrl]);

  useEffect(()=>()=>{
    analysisInputGeneration.current++;
    if(activeObjectUrlRef.current){VideoLoadService.revokePreviousObjectUrl(activeObjectUrlRef.current);activeObjectUrlRef.current=null;}
  },[]);

  const fullscreen=step==='mark'||step==='assist';
  useEffect(()=>{document.body.style.overflow=fullscreen?'hidden':'';return()=>{document.body.style.overflow='';};},[fullscreen]);

  const resetForNewVideo=()=>{
    setVideoFps(NaN);setTotalVideoFrames(0);setVideoFileName('');setCurrentVideoFrame(0);setTargetFrameSeek(null);setVisibleEndFrame(0);
    setEvents({release:null,glove:null});setAnalyzedEvents(null);setCompletedResult(null);setCompletedVelocity(null);setDetections([]);setCurrentViewKind('original');setUserVideoUrl(null);setVideoTiming(null);setCameraGeometry(null);
    setHasAnalyzed(false);setAiDetection(null);setAutoDetectResult(null);setVideoTrack([]);setVideoMetrics(null);setConfidenceScores(null);setManualAnchor(null);
    setAssistStage(null);setAssistNote(null);pendingOutcome.current=null;assistFirst.current=null;setFpsDialogOpen(false);setFpsError(null);
  };

  // 統一 Video Loading Controller：同一支檔案重選也能觸發
  const handleFileUpload=async(e:ChangeEvent<HTMLInputElement>)=>{
    const inputEl=e.target;
    const file=inputEl.files?.[0];
    inputEl.value='';
    if(!file)return;
    const loadId=++videoLoadGeneration.current;
    setVideoLoadError(null);
    resetForNewVideo();
    try{
      const loadResult=await VideoLoadService.loadVideoFile(file,(status)=>{if(loadId===videoLoadGeneration.current)setVideoLoadStatus(status);});
      if(loadId!==videoLoadGeneration.current){VideoLoadService.revokePreviousObjectUrl(loadResult.objectUrl);return;}
      activeObjectUrlRef.current=loadResult.objectUrl;
      setVideoFileName(loadResult.fileName);
      setTotalVideoFrames(loadResult.totalFrames);
      setVideoFps(loadResult.actualFps);
      setVideoTiming({...loadResult.timing,durationSec:loadResult.durationSec,timeBase:loadResult.timing.timeBase,actualFps:loadResult.actualFps,fpsSource:loadResult.fpsSource,isVFR:loadResult.isVFR,totalFrames:loadResult.totalFrames,timestamps:loadResult.timestamps,width:loadResult.width,height:loadResult.height});
      setVideoQuality(loadResult.qualityAssessment);
      setEvents({release:null,glove:null});
      setVisibleEndFrame(loadResult.initialGloveFrame);
      setCurrentVideoFrame(loadResult.initialReleaseFrame);
      setTargetFrameSeek(loadResult.initialReleaseFrame);
      setUserVideoUrl(loadResult.objectUrl);
      setVideoLoadStatus('ready');
    }catch(err:any){
      if(loadId!==videoLoadGeneration.current)return;
      setVideoLoadStatus('failed');
      setVideoLoadError(err?.message||'影片載入失敗，請確認格式為 MP4 / MOV / WebM');
    }
  };

  // The user states the real shooting FPS (CFR assumption); nothing is guessed on their behalf.
  const pickFps=(fps:number)=>{
    if(!videoTiming)return;
    try{
      const confirmed=confirmCfrTiming(videoTiming,fps,events);
      setVideoTiming(confirmed.timing);setVideoFps(confirmed.timing.actualFps);setTotalVideoFrames(confirmed.timing.totalFrames);
      setEvents(confirmed.events);setVisibleEndFrame(confirmed.events.glove?.right??0);
      setManualAnchor(null);setAiDetection(null);setAutoDetectResult(null);
      setVideoTrack([]);setVideoMetrics(null);setConfidenceScores(null);setAnalyzedEvents(null);setCompletedResult(null);setDetections([]);
      const cursor=videoElementRef.current?.currentTime??0;
      const frame=describePosition(confirmed.timing.timestamps,Math.min(cursor,confirmed.timing.timestamps.at(-1)!),true).left;
      setTargetFrameSeek(frame);setCurrentVideoFrame(frame);setCurrentViewKind('cfr_assumed');
      setHasAnalyzed(false);setVideoLoadError(null);setFpsError(null);setFpsDialogOpen(false);
    }catch(error){setFpsError(error instanceof Error?error.message:'FPS 確認失敗，請檢查影片。');}
  };
  const cancelFps=()=>{
    videoLoadGeneration.current++;
    if(activeObjectUrlRef.current){VideoLoadService.revokePreviousObjectUrl(activeObjectUrlRef.current);activeObjectUrlRef.current=null;}
    resetForNewVideo();setVideoLoadStatus('idle');setStep('video');
  };

  // AI 自動搜尋出手 / 進手套 (Coarse-to-Fine 視覺影格掃描；引擎按需載入)
  const handleAiAutoDetectFrames=async()=>{
    if(!isVideoLoaded||!videoTiming?.timingReliable)return;
    const videoEl=videoElementRef.current;
    if(!videoEl||videoEl.readyState<1){setVideoLoadError('影片播放器尚未就緒，請稍候片刻再執行 AI 視覺搜尋。');return;}
    const generation=++autoGeneration.current;
    setIsAutoDetectingFrames(true);setAutoDetectProgress(5);setAutoDetectStageText('載入自動辨識模組...');
    try{
      const {AutoFrameDetectionEngine}=await import('./services/autoFrameDetectionEngine');
      if(generation!==autoGeneration.current)return;
      setAutoDetectStageText('掃描影片...');
      const result=await AutoFrameDetectionEngine.detectReleaseAndGloveFrames({
        videoElement:videoEl,actualFps:videoFps,totalFrames:totalVideoFrames,
        durationSec:videoTiming?.durationSec||videoEl.duration||totalVideoFrames/videoFps,
        cameraView:cameraViewMode,selectedPitchType,manualAnchor:manualAnchor||undefined,
        videoWidth:videoEl.videoWidth||videoTiming?.width||720,videoHeight:videoEl.videoHeight||videoTiming?.height||1280,
        timestamps:videoTiming?.timestamps,
        onProgress:(pct,text)=>{if(generation!==autoGeneration.current)throw Error('使用者停止自動辨識');setAutoDetectProgress(pct);setAutoDetectStageText(text);}
      });
      if(generation!==autoGeneration.current)return;
      setAutoDetectResult(result);
      if(result.status==='AUTO_DETECTION_FAILED'||result.releaseFrame===null||result.gloveFrame===null){
        // 真正失敗：不覆蓋或偽造成功影格，保留目前設定供手動調整
        setAiDetection({status:'AUTO_DETECTION_FAILED',releaseFrame,gloveFrame,confidence:result.confidence,method:result.method,dbBaselineFrames:Math.max(5,gloveFrame-releaseFrame),aiCorrectionFrames:0,stepDetails:result.stepDetails,warnings:result.warnings});
      }else{
        setAiDetection({status:result.status,releaseFrame:result.releaseFrame,gloveFrame:result.gloveFrame,confidence:result.confidence,method:result.method,dbBaselineFrames:result.gloveFrame-result.releaseFrame,aiCorrectionFrames:0,stepDetails:result.stepDetails,warnings:result.warnings});
      }
    }catch(err:any){
      if(generation!==autoGeneration.current)return;
      setAutoDetectResult({status:'AUTO_DETECTION_FAILED',releaseFrame:null,gloveFrame:null,confidence:0,method:'AutoFrameDetectionEngine Error',ballTrack:[],
        releaseEvidence:{frame:releaseFrame,evidenceScore:0,motionContinuity:0,directionConsistency:0,roiPlausibility:0,reason:err?.message||'視覺分析發生例外錯誤'},
        gloveEvidence:{frame:gloveFrame,evidenceScore:0,catcherProximity:0,motionTermination:0,reason:'分析中斷'},
        candidateFrames:[],warnings:['AI 自動辨識失敗，請手動確認影格'],stepDetails:[]});
    }finally{
      if(generation===autoGeneration.current)setIsAutoDetectingFrames(false);
    }
  };
  const stopAutoDetect=()=>{autoGeneration.current++;setIsAutoDetectingFrames(false);videoElementRef.current?.pause();};

  const commitOutcome=(outcome:AnalysisOutcomeDone,ranEvents:SelectedEvents)=>{
    setCompletedResult(outcome.result);setCompletedVelocity({velocityKmh:outcome.velocityKmh,flightSeconds:outcome.flightSeconds,flightFrames:outcome.flightFrames});
    setDetections(outcome.detections);setAnalyzedEvents(ranEvents);
    setAnalysisProgress(100);setHasAnalyzed(true);setAssistStage(null);setAssistNote(null);pendingOutcome.current=null;
    setStep('result');
  };
  const seekTo=(frame:number)=>{setTargetFrameSeek(null);requestAnimationFrame(()=>{setTargetFrameSeek(frame);setCurrentVideoFrame(frame);});};

  // 啟動分析：按下時才載入「matchingEngine＋資料庫」分析 chunk
  const handleStartAnalysis=async(anchorOverride?:ManualAnchorInput|null)=>{
    if(analysisBlockReason){setVideoLoadError(analysisBlockReason);return;}
    const anchor=anchorOverride!==undefined?anchorOverride:manualAnchor;
    const inputGeneration=analysisInputGeneration.current,ranEvents=events;
    setVideoLoadError(null);setHasAnalyzed(false);
    setIsAnalyzing(true);
    videoElementRef.current?.pause();
    try{
      setAnalysisProgress(3);
      let runtime:AnalysisRuntime;
      try{
        setEngineState('loading');setAnalysisStepText('載入分析引擎與 1,080 筆參考資料庫（首次約 1 MB，之後使用快取）...');
        runtime=await loadAnalysisRuntime();
        setEngineState('ready');
      }catch(error){
        setEngineState('failed');
        throw new Error(`分析引擎載入失敗：${error instanceof Error?error.message:'網路中斷'}。請確認連線後再按一次「開始分析」。`);
      }
      const isCancelled=()=>inputGeneration!==analysisInputGeneration.current;
      const outcome=await runtime.runPitchAnalysis({
        videoElement:videoElementRef.current,events,eventView:eventView!,videoTiming,videoFps,totalVideoFrames,
        sourceTimesValid,analysisHasSourceFrames,analysisFps,analysisDistance,releaseFrame,gloveFrame,visibleEndFrame,originalFlightFrames,
        selectedPitchType,cameraViewMode,biometrics,strictPitchTypeMode,allowCrossTypeFallback,manualAnchor:anchor,cameraGeometry,useExistingTracking,
        hasAiDetection:Boolean(aiDetection),autoDetectConfidence:autoDetectResult?.confidence,isCancelled
      },{
        onProgress:(pct,text)=>{if(isCancelled())return;setAnalysisProgress(pct);setAnalysisStepText(text);},
        onVisibleEndFrame:setVisibleEndFrame,
        onCameraGeometry:setCameraGeometry,
        onTrack:(track,metrics)=>{setVideoTrack(track);setVideoMetrics(metrics);},
        onConfidence:setConfidenceScores,
        onAiDetection:setAiDetection
      });
      if(outcome.status==='stale'){if(outcome.message)setVideoLoadError(outcome.message);return;}
      // Ask for one tap only when tracking ran but found no reliable ball, and no tap was given yet.
      const reliable=Boolean(outcome.result.projection_match?.used&&outcome.result.video_track_status==='VALID_TRACK');
      const alreadyAssisted=Boolean(anchor?.point1&&anchor?.point2);
      if(!reliable&&outcome.trackingRan&&!alreadyAssisted&&videoTiming?.timestamps.length&&events.release&&events.glove){
        const times=videoTiming.timestamps,rel=sourceIndexAt(times,events.release.timeSec),glo=sourceIndexAt(times,events.glove.timeSec);
        const first=Math.min(rel+2,Math.max(rel,glo-1)),second=Math.max(first+1,glo-2);
        assistFrames.current={first,second};assistFirst.current=null;pendingOutcome.current=outcome;
        setAssistNote(null);setAssistStage(1);setStep('assist');seekTo(first);
        return;
      }
      commitOutcome(outcome,ranEvents);
      requestAnimationFrame(()=>window.scrollTo({top:0}));
    }catch(error){
      setVideoLoadError(error instanceof Error?error.message:'分析失敗，請確認影格與影片');
    }finally{setIsAnalyzing(false);}
  };

  const handleAssistTap=(x:number,y:number)=>{
    const frame=currentVideoFrame;
    if(assistStage===1){
      const first={frame,x_norm:x,y_norm:y};assistFirst.current=first;
      setManualAnchor({point1:first,point2:undefined});setAssistStage(2);setAssistNote(null);seekTo(assistFrames.current.second);
    }else if(assistStage===2){
      const first=assistFirst.current;
      if(!first||frame<=first.frame){setAssistNote('請換到比剛才更後面的畫面，再點一下球。');return;}
      const anchor:ManualAnchorInput={point1:first,point2:{frame,x_norm:x,y_norm:y}};
      setManualAnchor(anchor);setAssistStage(null);setAssistNote(null);setStep('analyze');
      void handleStartAnalysis(anchor);
    }
  };
  const skipAssist=()=>{if(pendingOutcome.current)commitOutcome(pendingOutcome.current,events);else setStep('result');};

  const matchedResult=hasAnalyzed?completedResult:null;

  // Detected-ball overlay for the video page (display only; shown only for an up-to-date analysis)
  const overlay=useMemo(()=>{
    if(!hasAnalyzed||!completedResult)return null;
    const pick=(p:{frame:number;timestamp:number;x_norm:number;y_norm:number}):OverlayPoint=>({frame:p.frame,timestamp:p.timestamp,x_norm:p.x_norm,y_norm:p.y_norm});
    return {observed:detections.map(pick),estimated:(completedResult.video_track??[]).filter(p=>p.source!=='vision').map(pick)};
  },[hasAnalyzed,completedResult,detections]);

  const handleResetToAiFrames=()=>{
    if(aiDetection&&aiDetection.releaseFrame>0&&aiDetection.gloveFrame>aiDetection.releaseFrame){
      markRelease(aiDetection.releaseFrame);markGlove(aiDetection.gloveFrame);
      setVisibleEndFrame(aiDetection.gloveFrame);setTargetFrameSeek(aiDetection.releaseFrame);
    }
  };
  const handleSeekVideoFrame=(frame:number)=>{setTargetFrameSeek(frame);setCurrentVideoFrame(frame);};

  const openDatabase=async()=>{
    setIsDbModalOpen(true);
    if(database)return;
    try{setEngineState(s=>s==='ready'?s:'loading');const runtime=await loadAnalysisRuntime();setEngineState('ready');setDatabase(runtime.PITCH_DATABASE);}
    catch{setEngineState('failed');setIsDbModalOpen(false);setVideoLoadError('參考資料庫載入失敗，請確認連線後再試。');}
  };
  const openCode=async()=>{
    setIsCodeModalOpen(true);
    if(pythonSource)return;
    try{setPythonSource((await import('./appPyCode')).APP_PY_CODE);}catch{setIsCodeModalOpen(false);setVideoLoadError('原始碼載入失敗，請確認連線後再試。');}
  };

  const loadingVideo=videoLoadStatus==='uploading'||videoLoadStatus==='processing_metadata';
  const bothEvents=Boolean(events.release&&events.glove);
  const reachable:Record<NavStep,boolean>={video:true,mark:isVideoLoaded,analyze:isVideoLoaded&&bothEvents,result:hasAnalyzed};
  const go=(next:NavStep)=>{if(!reachable[next]||busy)return;setStep(next);requestAnimationFrame(()=>window.scrollTo({top:0}));};
  const flightSecondsPreview=events.release&&events.glove?events.glove.timeSec-events.release.timeSec:null;
  const navStep:NavStep=step==='assist'?'analyze':step;
  const playerVariant=fullscreen?'fullscreen':step==='result'?'inline':'compact';
  const showPlayer=Boolean(userVideoUrl)&&(step==='mark'||step==='assist'||step==='analyze'||step==='result');
  const showTwoD=viewTab==='twod'&&(step==='mark'||step==='result');

  const viewButton=(mode:CameraViewMode,label:string,hint:string)=><button type="button" id={`view-${mode}`} aria-pressed={cameraViewMode===mode} disabled={busy} onClick={()=>setCameraViewMode(mode)} className={`choice ${cameraViewMode===mode?'choice-active':''}`}><span className="font-bold">{label}</span><span className="text-xs text-slate-400">{hint}</span></button>;
  const viewToggle=<div role="tablist" aria-label="影片與2D動畫" className="grid grid-cols-2 gap-2">
    <button type="button" role="tab" id="view-tab-video" aria-selected={viewTab==='video'} onClick={()=>setViewTab('video')} className={`mode-toggle ${viewTab==='video'?'mode-active':''}`}>影片</button>
    <button type="button" role="tab" id="view-tab-twod" aria-selected={viewTab==='twod'} onClick={()=>{videoElementRef.current?.pause();setViewTab('twod');}} className={`mode-toggle ${viewTab==='twod'?'mode-active':''}`}>2D 動畫</button>
  </div>;
  const twoD=<div className="space-y-2">
    {!matchedResult&&<p className="text-xs text-amber-200 card">還沒有分析結果：完成分析後，這裡會播放勝出候選的 2D 投球動畫。</p>}
    <PitchVisualizer result={matchedResult} active={showTwoD}/>
  </div>;

  return (
    <div className="app-shell min-h-dvh bg-slate-950 text-slate-100 font-sans">
      {!fullscreen&&<header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="mx-auto max-w-[480px] px-4 pt-3 pb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-black tracking-tight text-white">PitchVision <span className="text-cyan-300">手機版</span></h1>
            <p className="text-[11px] text-slate-400 truncate">影片只在本機處理，不上傳</p>
          </div>
          <button id="btn-science-info" type="button" onClick={()=>setScienceOpen(true)} className="icon-btn" aria-label="科學資訊"><FlaskConical size={20}/><span className="text-xs">科學資訊</span></button>
        </div>
        <StepNav step={navStep} reachable={reachable} busy={busy} onSelect={go}/>
      </header>}

      <main className={fullscreen?'':'mx-auto max-w-[480px] px-4 pt-4 pb-36 space-y-4'}>
        {videoLoadError&&<div id="app-error" role="alert" className={`p-3 rounded-xl bg-rose-950/90 border border-rose-500/50 text-sm text-rose-100 flex gap-2 ${fullscreen?'fixed top-16 left-3 right-3 z-[46]':''}`}><AlertTriangle className="w-5 h-5 text-rose-400 shrink-0"/><span className="min-w-0 break-words">{videoLoadError}</span></div>}

        {/* ── Step 1：選影片 ───────────────────────────── */}
        {step==='video'&&<section id="screen-video" aria-labelledby="h-video" className="space-y-4">
          <h2 id="h-video" className="screen-title">1. 選擇投球影片</h2>
          <label htmlFor="video-upload-input" className={`picker ${loadingVideo||busy?'opacity-60':''}`}>
            <input id="video-upload-input" aria-label="選擇投球影片" disabled={busy||loadingVideo} type="file" accept="video/mp4,video/quicktime,video/mov,video/webm,video/*" onChange={handleFileUpload} className="sr-only"/>
            {loadingVideo?<><Loader2 className="w-7 h-7 text-cyan-300 animate-spin"/><span className="font-bold text-cyan-200">{videoLoadStatus==='uploading'?'正在開啟影片...':'正在讀取影片資訊...'}</span></>
            :<><UploadCloud className="w-7 h-7 text-blue-300"/><span className="font-bold">{isVideoLoaded?'換一支影片':'從相簿或檔案選擇影片'}</span><span className="text-xs text-slate-400">MP4 / MOV / WebM · 影片只在本機處理</span></>}
          </label>

          {isVideoLoaded&&<div id="video-summary" className="card">
            <p className="text-sm text-emerald-300 flex items-start gap-2"><CheckCircle className="w-5 h-5 shrink-0"/><span className="min-w-0 break-all">已就緒：{videoFileName}</span></p>
            {sourceTimesValid&&<p id="video-info" className="text-xs text-slate-400 mt-1">{Number(videoFps.toFixed(2))} FPS · {totalVideoFrames} {videoTiming?.timeBase==='timestamp'?'格':'個時間位置'}{videoTiming?.isVFR?' · 變動幀率':''}</p>}
          </div>}

          <div className="card space-y-3">
            <h3 className="card-title">拍攝視角</h3>
            <div className="grid grid-cols-2 gap-2">
              {viewButton('catcher','捕手方向','從捕手後方拍向投手')}
              {viewButton('pitcher_rear','投手方向','從投手後方拍向捕手')}
            </div>
            <p className="text-xs text-slate-400">兩種視角共用 1,080 筆物理候選；攝影位置為工程先驗。</p>
          </div>
          <div className="card space-y-2">
            <label htmlFor="pitch-type-select" className="card-title block">投的球種</label>
            <select id="pitch-type-select" value={selectedPitchType} disabled={busy} onChange={e=>setSelectedPitchType(e.target.value)} className="field">
              {PITCH_TYPE_OPTIONS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
            </select>
            <p className="text-xs text-slate-400">預設由程式在整個資料庫自動辨識；知道球種時可指定，比對會更聚焦。</p>
          </div>
          {videoQuality&&<details className="card"><summary className="card-title">影片品質評估</summary><div className="mt-3"><VideoQualityCard assessment={videoQuality} videoFileName={videoFileName} actualFps={videoFps}/></div></details>}
        </section>}

        {/* ── Player：標記（全螢幕）／分析（縮小）／結果（內嵌）共用同一個 video 元素 ─── */}
        {userVideoUrl&&<section id="player-section" hidden={!showPlayer} aria-label="投球影片" className={playerVariant==='fullscreen'?'player-fixed':'space-y-3'}>
          {step==='result'&&viewToggle}
          <PitchVideoPlayer
            variant={playerVariant}
            videoUrl={userVideoUrl}
            releaseFrame={releaseFrame}
            gloveFrame={gloveFrame}
            totalFrames={totalVideoFrames}
            fps={videoFps}
            timestamps={controlTimes}
            selectionOnly={selectionOnly}
            timestampsArePreviewPositions={selectionOnly}
            viewMode={cameraViewMode}
            pitchName={selectedPitchType}
            hasAnalyzed={hasAnalyzed}
            busy={busy}
            targetFrameSeek={targetFrameSeek}
            onCurrentFrameChange={f=>setCurrentVideoFrame(f)}
            sourceTiming={videoTiming}
            events={events}
            onSetEvent={(name,event)=>setEvent(name,selectionOnly?{...event,sourceSpanSec:NaN,previewQuality:'unavailable'}:event)}
            onPositionChange={point=>setCurrentViewKind(point.kind)}
            spatialCalibration={matchedResult?.spatial_calibration}
            onVideoElementReady={el=>{videoElementRef.current=el;}}
            onTimeBaseOffset={offset=>{
              // Rebase the parsed container times onto the browser's own media timeline (once, before any marking).
              setVideoTiming(prev=>prev&&prev.timeBase==='timestamp'?{...prev,timestamps:prev.timestamps.map(t=>Math.max(0,t+offset)),timingWarning:`${prev.timingWarning??''} 起點已依瀏覽器實際呈現時間校正 ${offset.toFixed(4)} 秒。`.trim()}:prev);
            }}
            isSelectingPoint={assistStage}
            onSelectCoordinate={(x,y)=>{if(currentViewKind==='interpolated')return;if(assistStage)handleAssistTap(x,y);}}
            manualPoint1={step==='assist'?manualAnchor?.point1||null:null}
            manualPoint2={null}
            overlay={overlay}
            twoD={twoD}
            showTwoD={showTwoD}
            viewToggle={step==='mark'?viewToggle:undefined}
            onBack={step==='mark'?()=>go('video'):undefined}
            onNext={step==='mark'?()=>go('analyze'):undefined}
            assist={step==='assist'?{text:assistStage===2?'請在這一格再點一下球':'找不到球。請在這一格點一下球',onSkip:skipAssist}:null}
            menuExtra={step==='mark'?<>
              {isVideoLoaded&&<AutoDetectPanel
                canRun={Boolean(videoTiming?.timingReliable)} busy={busy} running={isAutoDetectingFrames} progress={autoDetectProgress} stageText={autoDetectStageText}
                result={autoDetectResult} canAdopt={Boolean(aiDetection&&aiDetection.status!=='AUTO_DETECTION_FAILED')}
                onRun={handleAiAutoDetectFrames} onStop={stopAutoDetect} onAdopt={handleResetToAiFrames} onSeek={handleSeekVideoFrame}/>}
              <button type="button" id="btn-science-info-menu" onClick={()=>setScienceOpen(true)} className="btn-secondary"><FlaskConical size={18}/>科學資訊</button>
            </>:undefined}
          />
          {step==='assist'&&assistNote&&<p id="assist-note" role="status" className="assist-note">{assistNote}</p>}
          {step==='mark'&&<p className="sr-only">逐格移動到球離手那一格按「標記出手」，到球進手套那一格按「標記進手套」。</p>}
        </section>}

        {/* ── Step 3：分析 ───────────────────────────── */}
        {step==='analyze'&&<section id="screen-analyze" aria-labelledby="h-analyze" className="space-y-4">
          <h2 id="h-analyze" className="screen-title">3. 確認設定並分析</h2>
          <div className="card text-sm space-y-1" id="analysis-summary">
            <p>出手 <b className="font-mono">{events.release?.timeSec.toFixed(4)}s</b> → 進手套 <b className="font-mono">{events.glove?.timeSec.toFixed(4)}s</b></p>
            <p>飛行時間 <b className="font-mono text-cyan-200">{flightSecondsPreview!==null&&flightSecondsPreview>0?flightSecondsPreview.toFixed(4):'—'} 秒</b>{originalFlightFrames!==null&&<span className="text-slate-400">（區間內原始影格 {originalFlightFrames} 張）</span>}</p>
            <p>視角 <b>{cameraViewMode==='catcher'?'捕手方向':'投手方向'}</b> · 球種 <b>{selectedPitchType}</b></p>
            <p>使用距離 <b className="font-mono">{analysisDistance} m</b><span className="text-slate-400 text-xs">（{cameraGeometry?.method==='planar_reference'?'地面矩形標定':'由身高／跨步／投手丘推導'}）</span></p>
          </div>
          <PitcherSetupCard biometrics={biometrics} onChange={setBiometrics} recomputeBiometrics={computePitcherBiometrics}/>
          <div className="card space-y-1">
            <h3 className="card-title">比對選項</h3>
            <label className="check"><input type="checkbox" checked={strictPitchTypeMode} disabled={busy} onChange={e=>setStrictPitchTypeMode(e.target.checked)}/>嚴格限定同球種反查 RPM／轉軸</label>
            {strictPitchTypeMode&&<label className="check"><input type="checkbox" checked={allowCrossTypeFallback} disabled={busy} onChange={e=>setAllowCrossTypeFallback(e.target.checked)}/>同球種無資料時允許跨球種備援</label>}
            <label className="check"><input id="use-existing-tracking" type="checkbox" checked={useExistingTracking} onChange={e=>setUseExistingTracking(e.target.checked)} disabled={isAnalyzing}/>逐格視覺追蹤（預設；證據不足時保留手動分析）</label>
          </div>
          {(isAnalyzing||engineState==='loading')&&<div id="analysis-progress" role="status" aria-live="polite" className="card space-y-2 border-blue-500/40">
            <div className="flex items-center justify-between text-sm text-cyan-200"><span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/>{engineState==='loading'?'載入分析引擎':'分析中'}</span><span className="font-mono">{analysisProgress}%</span></div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden"><div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full rounded-full transition-all duration-300" style={{width:`${analysisProgress}%`}}/></div>
            <p className="text-xs text-slate-300 break-words">{analysisStepText}</p>
          </div>}
          <p id="engine-status" data-state={engineState} className="text-xs text-slate-400">{engineState==='ready'?'分析引擎已載入。':engineState==='failed'?'分析引擎載入失敗，可再按一次開始分析重試。':'分析引擎與資料庫會在按下「開始分析」時才下載。'}</p>
        </section>}

        {/* ── Step 4：結果 ───────────────────────────── */}
        {step==='result'&&matchedResult&&<section id="result-screen" aria-labelledby="h-result" className="space-y-4">
          <h2 id="h-result" className="screen-title">4. 分析結果</h2>
          <ResultCards result={matchedResult} averageVelocityKmh={completedVelocity?.velocityKmh??matchedResult.velocity_kmh} flightSeconds={completedVelocity?.flightSeconds??matchedResult.flight_time_sec} distanceM={analysisDistance}/>
          {analyzedEvents&&<p id="event-time-provenance" data-engine-flight-seconds={matchedResult.flight_time_sec} data-events={JSON.stringify(analyzedEvents)} className="text-xs text-amber-200 card">出手 {analyzedEvents.release?.timeSec.toFixed(6)}s（{analyzedEvents.release?.kind==='interpolated'?'推算':!sourceTimesValid?'媒體時間':analyzedEvents.release?.kind==='cfr_assumed'?'CFR假設':'原始'}）→進手套 {analyzedEvents.glove?.timeSec.toFixed(6)}s（{analyzedEvents.glove?.kind==='interpolated'?'推算':!sourceTimesValid?'媒體時間':analyzedEvents.glove?.kind==='cfr_assumed'?'CFR假設':'原始'}）。事件精度仍受原始間距 {(sourceTimesValid?Math.max(analyzedEvents.release?.sourceSpanSec||0,analyzedEvents.glove?.sourceSpanSec||0).toFixed(4):'未知')}s 與遮蔽限制；補幀不增加真觀測或旋轉量測精度。</p>}
          <details id="full-metrics" className="card"><summary className="card-title">完整數據與反查依據</summary>
            <div className="mt-3"><MetricsPanel compact result={matchedResult} matchedResult={matchedResult} calcVelocity={completedVelocity?.velocityKmh} flightSeconds={completedVelocity?.flightSeconds} flightFrames={completedVelocity?.flightFrames} standardDistance={STANDARD_GLOVE_DISTANCE_METERS}/></div>
          </details>
          <p className="text-xs text-slate-400 flex gap-2"><Info className="w-4 h-4 shrink-0"/>平均球速＝距離 ÷ 出手到進手套時間；位移與旋轉為資料庫候選的物理模型值，單鏡頭無法唯一決定轉速與轉動效率。</p>
        </section>}
      </main>

      {/* ── 底部單手操作列（標記與補點畫面是全螢幕，不顯示）─── */}
      {!fullscreen&&<nav aria-label="主要操作" className="action-bar">
        <div className="mx-auto max-w-[480px] px-4 py-3 space-y-2">
          {step==='video'&&<button id="btn-next-mark" type="button" className="btn-primary" disabled={!reachable.mark||busy||needFps} onClick={()=>go('mark')}>{isVideoLoaded?<>下一步：標記出手與進手套<ChevronRight size={20}/></>:'請先選擇影片'}</button>}
          {step==='analyze'&&<>
            <p id="analysis-readiness" role="status" className="text-xs text-center text-amber-200">{analysisBlockReason||(hasAnalyzed?'分析已完成，可修改事件後重新分析。':'手動時間設定可分析；不需執行自動辨識。')}</p>
            <button id="btn-start-analysis" type="button" className="btn-primary" onClick={()=>void handleStartAnalysis()} disabled={Boolean(analysisBlockReason)}>{isAnalyzing?<><Loader2 className="w-5 h-5 animate-spin"/>{engineState==='loading'?'載入分析引擎...':`分析中 ${analysisProgress}%`}</>:'開始分析'}</button>
          </>}
          {step==='result'&&<div className="grid grid-cols-2 gap-2">
            <button id="btn-back-mark" type="button" className="btn-secondary" onClick={()=>go('mark')}><RotateCcw size={18}/>重新標記</button>
            <button id="btn-new-video" type="button" className="btn-secondary" onClick={()=>go('video')}><UploadCloud size={18}/>換影片</button>
          </div>}
        </div>
      </nav>}

      <ScientificInfoPanel open={scienceOpen} onClose={()=>setScienceOpen(false)} result={matchedResult} quality={videoQuality} fileName={videoFileName} fps={videoFps} onDatabase={openDatabase} onCode={openCode} timingNote={videoTiming?.timingWarning}
        timing={videoTiming} timingConfirmed={sourceTimesValid} onChangeFps={()=>{setScienceOpen(false);setFpsDialogOpen(true);}} version={APP_VERSION}
        advanced={<GroundCalibration video={videoElementRef.current} hasVideo={Boolean(userVideoUrl)} disabled={busy} geometry={cameraGeometry} onApply={g=>{setCameraGeometry(g);setHasAnalyzed(false);}} onClear={()=>{setCameraGeometry(null);setHasAnalyzed(false);}}/>}/>
      {(needFps||fpsDialogOpen)&&<FpsDialog error={fpsError} onPick={pickFps} onCancel={needFps?cancelFps:()=>{setFpsDialogOpen(false);setFpsError(null);}}/>}
      {isDbModalOpen&&!database&&<div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4" role="status"><p className="card text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/>載入參考資料庫...</p></div>}
      {database&&<DatabaseModal isOpen={isDbModalOpen} onClose={()=>setIsDbModalOpen(false)} database={database}/>}
      {isCodeModalOpen&&!pythonSource&&<div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4" role="status"><p className="card text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/>載入原始碼...</p></div>}
      {pythonSource&&<CodeViewerModal isOpen={isCodeModalOpen} onClose={()=>setIsCodeModalOpen(false)} codeContent={pythonSource}/>}
    </div>
  );
}
