import {formatSourceFps} from './services/sourceTiming';
import { SelectedEvents,SelectedEvent,PositionKind,describePosition,selectEvent,eventAnalysisView } from './services/analysisTimeline';
import { hasUsableSourceTimes, manualAnalysisReason, confirmCfrTiming } from './services/manualAnalysisReadiness';
import { ScientificInfoPanel } from './components/ScientificInfoPanel';
import { CameraGeometry, ImagePoint, calibrateGroundReference, estimateImageLines } from './services/cameraGeometry';
import { VideoTimingService } from './services/videoTimingService';
import React, { useState, useMemo, ChangeEvent, useEffect, useRef } from 'react';
import {
  PITCH_DATABASE,
  PITCH_TYPE_OPTIONS,
  STANDARD_DISTANCE_METERS,
  calculateVelocity,
  matchPitchData,
  analyzePitchFramesFrameByFrame,
  FrameDetectionResult
} from './matchingEngine';
import {
  CameraViewMode,
  PitcherBiometrics,
  BaseballTrackPoint,
  VideoTrackMetrics,
  UnifiedConfidenceScores,
  ManualAnchorInput,
  VideoTiming,
  MatchResult
} from './types';
import { computePitcherBiometrics, DEFAULT_PITCHER_BIOMETRICS } from './spatialCalibration';
import { PitchVideoPlayer } from './components/PitchVideoPlayer';
import { PitchVisualizer } from './components/PitchVisualizer';
import { MetricsPanel } from './components/MetricsPanel';
import { PitcherSetupCard } from './components/PitcherSetupCard';
import { DatabaseModal } from './components/DatabaseModal';
import { CodeViewerModal } from './components/CodeViewerModal';
import { APP_PY_CODE } from './appPyCode';
import { trackBaseballSparse } from './baseballTracker';
import { validateAndReconstructVideoTrack } from './services/trajectoryValidationService';
import { calculateUnifiedConfidence } from './confidenceEngine';
import { VideoQualityAssessment } from './services/videoMetadataService';
import { VideoQualityCard } from './components/VideoQualityCard';
import { VideoLoadService, VideoLoadStatus } from './services/videoLoadService';
import { AutoFrameDetectionEngine, AutoFrameDetectionOutput } from './services/autoFrameDetectionEngine';
import {
  UploadCloud,
  Layers,
  Sparkles,
  SlidersHorizontal,
  Database,
  FileCode,
  Terminal,
  Activity,
  CheckCircle,
  Video,
  Eye,
  RotateCcw,
  Loader2,
  AlertTriangle,
  ShieldCheck
} from 'lucide-react';

export default function App() {
  // 投手與投手丘初始生物力學參數設置
  const [biometrics, setBiometrics] = useState<PitcherBiometrics>(DEFAULT_PITCHER_BIOMETRICS);

  // Video and Frame states
  const [totalVideoFrames, setTotalVideoFrames] = useState<number>(0);
  const [videoFps, setVideoFps] = useState<number>(NaN);
  const [videoTiming, setVideoTiming] = useState<(VideoTiming & { width: number; height: number }) | null>(null);
  const [videoLoadStatus, setVideoLoadStatus] = useState<VideoLoadStatus>('idle');
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);
  const videoLoadGeneration=useRef(0);

  const [aiDetection, setAiDetection] = useState<FrameDetectionResult | null>(null);
  const [autoDetectResult, setAutoDetectResult] = useState<AutoFrameDetectionOutput | null>(null);
  const autoGeneration=useRef(0);
  const [isAutoDetectingFrames, setIsAutoDetectingFrames] = useState<boolean>(false);
  const [autoDetectProgress, setAutoDetectProgress] = useState<number>(0);
  const [autoDetectStageText, setAutoDetectStageText] = useState<string>('');

  const [events,setEvents]=useState<SelectedEvents>({release:null,glove:null});
  const [analyzedEvents,setAnalyzedEvents]=useState<SelectedEvents|null>(null);
  const [currentViewKind,setCurrentViewKind]=useState<PositionKind>('original');
  const eventView=useMemo(()=>{try{return videoTiming?eventAnalysisView(videoTiming.timestamps,events,videoTiming.durationSec):null;}catch{return null;}},[videoTiming,events]);
  const releaseFrame=eventView?.releaseFrame??events.release?.left??0,gloveFrame=eventView?.gloveFrame??events.glove?.left??0;
  const [visibleEndFrame, setVisibleEndFrame] = useState<number>(0);
  const [currentVideoFrame, setCurrentVideoFrame] = useState<number>(0);
  const [targetFrameSeek, setTargetFrameSeek] = useState<number | null>(null);
  const [scienceOpen,setScienceOpen]=useState(false);
  const [cameraGeometry,setCameraGeometry]=useState<CameraGeometry|null>(null);
  const [referencePoints,setReferencePoints]=useState<(ImagePoint|null)[]>([null,null,null,null]);
  const [referenceSelection,setReferenceSelection]=useState<number|null>(null);
  const [referenceWidth,setReferenceWidth]=useState(2);
  const [referenceLength,setReferenceLength]=useState(17.5);
  const [referenceConfirmed,setReferenceConfirmed]=useState(false);
  const [referenceFocal,setReferenceFocal]=useState<number|undefined>();
  const analysisDistance=cameraGeometry?.method==='planar_reference'?cameraGeometry.referenceLengthM!:biometrics.effectiveTravelDistanceM;
  const setEvent=(name:'release'|'glove',event:SelectedEvent)=>{setEvents(prev=>({...prev,[name]:event}));setHasAnalyzed(false);if(name==='glove')setVisibleEndFrame(event.right);setManualAnchor(prev=>prev?{...prev,[name==='release'?'point1':'point2']:undefined}:null);};
  // Preview-only positions are not source PTS or measured frames. Quantitative
  // analysis still requires the unchanged source timing validation.
  const selectionOnly = !videoTiming?.timestamps.length;
  const controlTimes = useMemo(() => {
    if (videoTiming?.timestamps.length) return videoTiming.timestamps;
    const duration = videoTiming?.durationSec ?? 0;
    if (!Number.isFinite(duration) || duration <= 0) return [];
    const intervals = Math.min(60000, Math.ceil(duration * 100));
    return Array.from({length: intervals + 1}, (_, i) => i * duration / intervals);
  }, [videoTiming]);
  const markRelease=(frame:number)=>{if(controlTimes[frame]!==undefined)setEvent('release',{...selectEvent(describePosition(controlTimes,controlTimes[frame],videoTiming?.timeBase!=='timestamp'),controlTimes),...(selectionOnly?{sourceSpanSec:NaN,previewQuality:'unavailable' as const}:{})});};
  const markGlove=(frame:number)=>{if(controlTimes[frame]!==undefined)setEvent('glove',{...selectEvent(describePosition(controlTimes,controlTimes[frame],videoTiming?.timeBase!=='timestamp'),controlTimes),...(selectionOnly?{sourceSpanSec:NaN,previewQuality:'unavailable' as const}:{})});};
  const showScience=()=>{setScienceOpen(true);requestAnimationFrame(()=>document.getElementById('science-center')?.scrollIntoView());};

  // 手動雙錨點模式 (Manual Anchor Mode - 作為輔助走廊，不直接取代整條球路)
  const [manualAnchor, setManualAnchor] = useState<ManualAnchorInput | null>(null);
  const [isSelectingPoint, setIsSelectingPoint] = useState<1 | 2 | null>(null);

  // 球種設定與 Strict Mode 控制
  const [selectedPitchType, setSelectedPitchType] = useState<string>(
    '四縫線直球 (Fastball)'
  );
  const [strictPitchTypeMode, setStrictPitchTypeMode] = useState<boolean>(true);
  const [allowCrossTypeFallback, setAllowCrossTypeFallback] = useState<boolean>(false);

  const [cameraViewMode, setCameraViewMode] = useState<CameraViewMode>('catcher');
  const [userVideoUrl, setUserVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>('');

  // 分析狀態管理
  const analysisInputGeneration=useRef(0);
  const [completedResult,setCompletedResult]=useState<MatchResult|null>(null);
  const [useExistingTracking,setUseExistingTracking]=useState(false);
  const [manualFpsDraft,setManualFpsDraft]=useState('30');
  const [hasAnalyzed, setHasAnalyzed] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);
  const [analysisStepText, setAnalysisStepText] = useState<string>('');

  // 棒球視覺追蹤與信賴評估狀態
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const [videoTrack, setVideoTrack] = useState<BaseballTrackPoint[]>([]);
  const [videoMetrics, setVideoMetrics] = useState<VideoTrackMetrics | null>(null);
  const [confidenceScores, setConfidenceScores] = useState<UnifiedConfidenceScores | null>(null);
  const [videoQuality, setVideoQuality] = useState<VideoQualityAssessment | null>(null);
  const [rightColumnTab, setRightColumnTab] = useState<'metrics' | 'visualizer'>('metrics');

  // Modals
  const [isDbModalOpen, setIsDbModalOpen] = useState<boolean>(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState<boolean>(false);

  const isVideoLoaded = Boolean(userVideoUrl && videoLoadStatus === 'ready');

  const sourceTimesValid=useMemo(()=>hasUsableSourceTimes(videoTiming),[videoTiming]);
  const analysisHasSourceFrames=sourceTimesValid&&!eventView?.eventOnly;
  const analysisFps=analysisHasSourceFrames?videoFps:0; // 0 means unknown; event slots supply exact seconds.
  const analysisBlockReason=manualAnalysisReason(isVideoLoaded,isAnalyzing,isAutoDetectingFrames,videoTiming,releaseFrame,gloveFrame,sourceTimesValid,events)||(eventView?null:'請在影片下方設定出手與進手套時間。');
  useEffect(()=>{analysisInputGeneration.current++;setHasAnalyzed(false);},[selectedPitchType,cameraViewMode,biometrics,strictPitchTypeMode,allowCrossTypeFallback,events,videoTiming,userVideoUrl]);

  // Unmount cleanup for Object URL
  useEffect(() => {
    return () => {
      if (activeObjectUrlRef.current) {
        VideoLoadService.revokePreviousObjectUrl(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
    };
  }, []);

  // Load built-in 60fps demo video
  const handleLoadDemoVideo = async () => {
    try {
      const response = await fetch('/demo_pitch_sample.mp4', { method: 'HEAD' });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('video/')) {
        throw new Error('原始 V3 ZIP 未附 demo_pitch_sample.mp4，請選擇自己的投球影片。示範入口保留，補入原始影片後即可使用。');
      }
    } catch (error) {
      setVideoLoadError(error instanceof Error ? error.message : '示範影片讀取失敗，請上傳影片。');
      return;
    }
    if (activeObjectUrlRef.current) {
      VideoLoadService.revokePreviousObjectUrl(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }

    const defaultTotal = 392;
    const demoFps = 60;
    const demoDuration = 6.53;
    const demoTimestamps = Array.from({ length: defaultTotal }, (_, i) => Number((i / demoFps).toFixed(5)));

    setVideoLoadError(null);
    setVideoLoadStatus('ready');
    setTotalVideoFrames(defaultTotal);
    setVideoFps(demoFps);
    setVideoTiming({
      durationSec: demoDuration,
      timeBase: 'fps_derived',
      actualFps: demoFps,
      fpsSource: 'container_metadata',
      isVFR: false,
      totalFrames: defaultTotal,
      timestamps: demoTimestamps,
      width: 1280,
      height: 720
    });
    setVideoFileName('內建 60fps 投球示範短片 (392 影格)');
    setUserVideoUrl('demo_pitch_sample.mp4');

    setVideoQuality({
      fps: demoFps,
      exposureQuality: 'good',
      cameraStabilityScore: 85,
      backgroundComplexity: 'moderate',
      resolution: '1280x720',
      isResolutionAdequate: true,
      motionBlurRisk: 'low',
      expectedBallPixelSize: 10,
      qualityScore: 92,
      warnings: []
    });

    setEvents({release:selectEvent(describePosition(demoTimestamps,demoTimestamps[102],true),demoTimestamps),glove:selectEvent(describePosition(demoTimestamps,demoTimestamps[145],true),demoTimestamps)});
    setVisibleEndFrame(145);
    setCurrentVideoFrame(102);
    setTargetFrameSeek(102);
    setHasAnalyzed(false);
    setAiDetection(null);
    setAutoDetectResult(null);
    setVideoTrack([]);
    setVideoMetrics(null);
    setConfidenceScores(null);
    setManualAnchor(null);
    setIsSelectingPoint(null);
  };

  // 統一 Video Loading Controller：確保第一次上傳立即完成初始化並顯示，且同一支檔案重選也能觸發
  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    // 立即重設 input.value = ''，確保同一檔案再次選取時仍會觸發 change 事件
    inputEl.value = '';

    if (!file) return;
    const loadId=++videoLoadGeneration.current;

    setVideoLoadError(null);
    setVideoFps(NaN);setTotalVideoFrames(0);setVideoFileName('');setCurrentVideoFrame(0);setTargetFrameSeek(null);setVisibleEndFrame(0);
    setEvents({release:null,glove:null});setAnalyzedEvents(null);setCompletedResult(null);setCurrentViewKind('original');setUserVideoUrl(null);setVideoTiming(null);setRightColumnTab('metrics');setCameraGeometry(null);setReferencePoints([null,null,null,null]);setReferenceConfirmed(false);
    setHasAnalyzed(false);
    setAiDetection(null);
    setAutoDetectResult(null);
    setVideoTrack([]);
    setVideoMetrics(null);
    setConfidenceScores(null);
    setManualAnchor(null);
    setIsSelectingPoint(null);

    try {
      const loadResult = await VideoLoadService.loadVideoFile(
        file,
        (status) => {if(loadId===videoLoadGeneration.current)setVideoLoadStatus(status);}
      );

      if(loadId!==videoLoadGeneration.current){VideoLoadService.revokePreviousObjectUrl(loadResult.objectUrl);return;}
      activeObjectUrlRef.current = loadResult.objectUrl;

      // 單一梯次更新所有影片狀態，確保 PitchVideoPlayer 第一次掛載即擁有完整 metadata 與有效 Object URL
      setVideoFileName(loadResult.fileName);
      setTotalVideoFrames(loadResult.totalFrames);
      setVideoFps(loadResult.actualFps);setManualFpsDraft(Number.isFinite(loadResult.actualFps)?String(loadResult.actualFps):'');
      setVideoTiming({
        ...loadResult.timing,
        durationSec: loadResult.durationSec,
        timeBase: loadResult.timing.timeBase,
        actualFps: loadResult.actualFps,
        fpsSource: loadResult.fpsSource,
        isVFR: loadResult.isVFR,
        totalFrames: loadResult.totalFrames,
        timestamps: loadResult.timestamps,
        width: loadResult.width,
        height: loadResult.height
      });
      setVideoQuality(loadResult.qualityAssessment);
      setEvents({release:null,glove:null});
      setVisibleEndFrame(loadResult.initialGloveFrame);
      setCurrentVideoFrame(loadResult.initialReleaseFrame);
      setTargetFrameSeek(loadResult.initialReleaseFrame);
      setUserVideoUrl(loadResult.objectUrl);
      setVideoLoadStatus('ready');
    } catch (err: any) {
      if(loadId!==videoLoadGeneration.current)return;
      setVideoLoadStatus('failed');
      setVideoLoadError(err?.message || '影片載入失敗，請確認格式為 MP4 / MOV / WebM');
    }
  };

  // 真正的 AI 自動搜尋出手 / 進手套 (執行 Coarse-to-Fine 視覺影格掃描 + BallDetectionEngine + Temporal Track)
  const handleAiAutoDetectFrames = async () => {
    if (!isVideoLoaded || !videoTiming?.timingReliable) return;

    const videoEl = videoElementRef.current;
    if (!videoEl || videoEl.readyState < 1) {
      setVideoLoadError('影片播放器尚未就緒，請稍候片刻再執行 AI 視覺搜尋。');
      return;
    }

    const generation=++autoGeneration.current;
    setIsAutoDetectingFrames(true);
    setAutoDetectProgress(5);
    setAutoDetectStageText('掃描影片...');

    try {
      const result = await AutoFrameDetectionEngine.detectReleaseAndGloveFrames({
        videoElement: videoEl,
        actualFps: videoFps,
        totalFrames: totalVideoFrames,
        durationSec: videoTiming?.durationSec || videoEl.duration || totalVideoFrames / videoFps,
        cameraView: cameraViewMode,
        selectedPitchType,
        manualAnchor: manualAnchor||undefined,
        videoWidth: videoEl.videoWidth || videoTiming?.width || 720,
        videoHeight: videoEl.videoHeight || videoTiming?.height || 1280,
        timestamps: videoTiming?.timestamps,
        onProgress: (pct, text) => {
          if(generation!==autoGeneration.current)throw Error('使用者停止自動辨識');
          setAutoDetectProgress(pct);
          setAutoDetectStageText(text);
        }
      });

      if(generation!==autoGeneration.current)return;
      setAutoDetectResult(result);

      if (
        result.status === 'AUTO_DETECTION_FAILED' ||
        result.releaseFrame === null ||
        result.gloveFrame === null
      ) {
        // 真正失敗狀態：不覆蓋或偽造成功影格，保留目前滑桿供使用者手動調整並顯示失敗原因
        setAiDetection({
          status: 'AUTO_DETECTION_FAILED',
          releaseFrame,
          gloveFrame,
          confidence: result.confidence,
          method: result.method,
          dbBaselineFrames: Math.max(5, gloveFrame - releaseFrame),
          aiCorrectionFrames: 0,
          stepDetails: result.stepDetails,
          warnings: result.warnings
        });
      } else {
        // SUCCESS 或 LOW_CONFIDENCE：填入視覺偵測到的出手與進手套影格
        setAiDetection({
          status: result.status,
          releaseFrame: result.releaseFrame,
          gloveFrame: result.gloveFrame,
          confidence: result.confidence,
          method: result.method,
          dbBaselineFrames: result.gloveFrame - result.releaseFrame,
          aiCorrectionFrames: 0,
          stepDetails: result.stepDetails,
          warnings: result.warnings
        });
      }
    } catch (err: any) {
      if(generation!==autoGeneration.current)return;
      setAutoDetectResult({
        status: 'AUTO_DETECTION_FAILED',
        releaseFrame: null,
        gloveFrame: null,
        confidence: 0,
        method: 'AutoFrameDetectionEngine Error',
        ballTrack: [],
        releaseEvidence: {
          frame: releaseFrame,
          evidenceScore: 0,
          motionContinuity: 0,
          directionConsistency: 0,
          roiPlausibility: 0,
          reason: err?.message || '視覺分析發生例外錯誤'
        },
        gloveEvidence: {
          frame: gloveFrame,
          evidenceScore: 0,
          catcherProximity: 0,
          motionTermination: 0,
          reason: '分析中斷'
        },
        candidateFrames: [],
        warnings: ['AI 自動辨識失敗，請手動確認影格'],
        stepDetails: []
      });
    } finally {
      if(generation===autoGeneration.current)setIsAutoDetectingFrames(false);
    }
  };

  // 啟動真實電腦視覺棒球追蹤、空間校正與位移反查資料庫分析
  const handleStartAnalysis = async () => {
    if (analysisBlockReason) {setVideoLoadError(analysisBlockReason);return;}
    const inputGeneration=analysisInputGeneration.current;
    setVideoLoadError(null);setHasAnalyzed(false);
    setIsAnalyzing(true);
    videoElementRef.current?.pause();
    try {
    setAnalysisProgress(10);
    setAnalysisStepText(`【步驟 1/6】鎖定出手影格 (F${releaseFrame}) 與進手套影格 (F${gloveFrame})...`);

    // 步驟 2: 運動差分候選、時間走廊追蹤與稀疏觀測點擷取
    let sparseResult = null;
    if (useExistingTracking && analysisHasSourceFrames && videoElementRef.current) {
      setAnalysisProgress(20);
      setAnalysisStepText(`【步驟 2/6】執行 ${formatSourceFps(videoFps)} FPS 差分運動偵測與時間走廊追蹤...`);
      try {
        sparseResult = await trackBaseballSparse(videoElementRef.current, {
          releaseFrame,
          visibleEndFrame: visibleEndFrame > releaseFrame ? visibleEndFrame : gloveFrame,
          catchFrame: gloveFrame,
          fps: analysisFps,
          cameraView: cameraViewMode,
          manualAnchor: manualAnchor || undefined,
          timestamps: videoTiming?.timestamps,
          onProgress: (pct, _curF, stageText) => {
            const scaled = Math.round(20 + pct * 0.3);
            setAnalysisProgress(scaled);
            setAnalysisStepText(`【步驟 2/6】${stageText}`);
          }
        });
      } catch (err) {
        console.warn('Sparse baseball tracking fallback:', err);
      }
    }

    // 步驟 3: 嚴格執行 ACCURACY > COVERAGE 驗證閘門 (絕不用 MODEL TRACK 或兩點直連冒充 VIDEO TRACK)
    setAnalysisProgress(55);
    setAnalysisStepText('【步驟 3/6】驗證真實視覺證據：需 >= 3 個獨立觀測點，拒絕偽造直線/拋物線...');
    const effectiveVisibleEnd = sparseResult?.visibleEndFrame || visibleEndFrame || gloveFrame;
    if (sparseResult && sparseResult.visibleEndFrame) {
      setVisibleEndFrame(sparseResult.visibleEndFrame);
    }

    const validationResult = validateAndReconstructVideoTrack({
      observations: (sparseResult?.observations || []).filter(p=>p.timestamp>=events.release!.timeSec&&p.timestamp<=events.glove!.timeSec&&!(events.glove!.kind==='interpolated'&&p.frame===gloveFrame)),
      releaseFrame,
      lastReliableBallFrame: effectiveVisibleEnd,
      catchFrame: gloveFrame,
      actualFps: analysisFps,
      videoWidth: videoElementRef.current?.videoWidth || videoTiming?.width || 720,
      videoHeight: videoElementRef.current?.videoHeight || videoTiming?.height || 1280
    });

    let analysisGeometry=cameraGeometry;
    if (videoElementRef.current && cameraGeometry?.method !== 'planar_reference') {
      try {
      const canvas=document.createElement('canvas');canvas.width=videoElementRef.current.videoWidth;canvas.height=videoElementRef.current.videoHeight;
      const decoded=await VideoTimingService.seekAndCaptureFrame(videoElementRef.current,releaseFrame,analysisFps,canvas,events.release!.timeSec);
      if(decoded.imageData){analysisGeometry=estimateImageLines(decoded.imageData);setCameraGeometry(analysisGeometry);}
      } catch {setAnalysisStepText('幾何影像擷取不可用，沿用既有模型估算，不中斷手動分析');}
    }
    setVideoTrack(validationResult.videoTrack);
    setVideoMetrics(validationResult.metrics);

    // 步驟 4: 相機透視與尺度校正 (Perspective / Scale Calibrated Estimate)
    await new Promise((r) => setTimeout(r, 220));
    setAnalysisProgress(72);
    setAnalysisStepText(
      `【步驟 4/6】執行 Perspective / Scale Calibrated Estimate：校正${biometrics.hasMound ? '標準投手丘(+25.4cm)' : '平地牛棚'}、身高${biometrics.pitcherHeightCm}cm、跨步${biometrics.effectiveStrideDistanceCm}cm，解算實測 IVB / HB...`
    );

    // 步驟 5: 球種鎖定 -> 速度窗口 -> 觀測位移反查 RPM / Spin Axis -> 出手角微調
    await new Promise((r) => setTimeout(r, 220));
    setAnalysisProgress(88);
    setAnalysisStepText(
      `【步驟 5/6】鎖定球種【${selectedPitchType}】➔ 實測速度與位移反查 Synthetic Physics Reference Dataset ➔ 加權內插 RPM & 圓周轉軸...`
    );

    // 步驟 6: Gravity + Drag + Magnus 物理重建 MODEL TRACK 與閉環驗證
    await new Promise((r) => setTimeout(r, 200));
    setAnalysisProgress(96);
    setAnalysisStepText('【步驟 6/6】以反推之 RPM + Spin Axis 獨立物理重建 MODEL TRACK，與 VIDEO TRACK 結算 RMSE 閉環誤差與信賴度...');

    const isManualUsed = analysisHasSourceFrames && Boolean(manualAnchor?.point1 && manualAnchor?.point2);
    const conf = calculateUnifiedConfidence({
      fps: analysisFps,
      totalVideoFrames,
      releaseFrame,
      gloveFrame,
      isUserConfirmedFrames: true,
      isManualAnchorUsed: isManualUsed,
      autoDetectionConfidence: autoDetectResult?.confidence,
      videoMetrics: validationResult.metrics
    });
    setConfidenceScores(conf);

    if (!aiDetection && analysisHasSourceFrames) {
      const refEst = analyzePitchFramesFrameByFrame(
        totalVideoFrames,
        videoFps,
        selectedPitchType,
        cameraViewMode
      );
      setAiDetection({
        ...refEst,
        releaseFrame,
        gloveFrame
      });
    }

    if(inputGeneration!==analysisInputGeneration.current){setVideoLoadError('分析期間事件或設定已變更，請重新分析');return;}
    const computed=matchPitchData(velocityKmh,flightSeconds,selectedPitchType,cameraViewMode,PITCH_DATABASE,releaseFrame,gloveFrame,biometrics,validationResult.videoTrack,validationResult.metrics,conf,analysisFps,eventView!.engineTimingBridge,strictPitchTypeMode,allowCrossTypeFallback,isManualUsed,autoDetectResult?.confidence,analysisGeometry||undefined);
    // Time-source presentation only; confidence formulas and numerical scores stay unchanged.
    computed.confidence_scores.quality_notes=computed.confidence_scores.quality_notes.map(note=>note.startsWith('飛行時間 ')?`事件時差 ${flightSeconds.toFixed(6)}s；品質評分沿用原始影格跨度，不把90Hz位置當觀測` : note);
    if(!analysisHasSourceFrames){
      computed.confidence_scores.quality_notes=computed.confidence_scores.quality_notes.map(note=>note.includes('幀率影片')?'來源 FPS 未確認，不能推斷影格解析度。':note);
      if(computed.observed_metrics)computed.observed_metrics.details=computed.observed_metrics.details.map(note=>note.startsWith('實測飛行時間：')?`手動媒體事件時差：${flightSeconds.toFixed(6)}s；不依賴來源 FPS。`:note);
      computed.confidence_scores.quality_notes.push(`${sourceTimesValid?'事件未對應來源影格':'來源 FPS／PTS 未確認'}：以播放器事件秒數執行模型估算；時間槽不是原始影格，無新增實測追蹤點。`);
    }
    setCompletedResult(computed);setAnalyzedEvents(events);
    setAnalysisProgress(100);
    setHasAnalyzed(true);
    } catch(error) {
      setVideoLoadError(error instanceof Error?error.message:'分析失敗，請確認影格與影片');
    } finally { setIsAnalyzing(false); }
  };

  // Physical calculations prioritizing timestamps[] over frame / fps
  const {velocityKmh,flightSeconds,flightFrames}=useMemo(()=>eventView?calculateVelocity(eventView.releaseFrame,eventView.gloveFrame,analysisFps,analysisDistance,eventView.engineTimingBridge):{velocityKmh:0,flightSeconds:0,flightFrames:0},[eventView,analysisFps,analysisDistance]);

  // Match result with PitchVision Synthetic Physics Reference Dataset
  const matchedResult = hasAnalyzed ? completedResult : null;

  // 回復 AI 建議影格
  const handleResetToAiFrames = () => {
    if (aiDetection && aiDetection.releaseFrame > 0 && aiDetection.gloveFrame > aiDetection.releaseFrame) {
      markRelease(aiDetection.releaseFrame);
      markGlove(aiDetection.gloveFrame);
      setVisibleEndFrame(aiDetection.gloveFrame);
      setTargetFrameSeek(aiDetection.releaseFrame);
    }
  };

  // 滑桿變更時連動影片跳格
  const handleSeekVideoFrame = (frame: number) => {
    setTargetFrameSeek(frame);
    setCurrentVideoFrame(frame);
  };

  // 手動錨點設定處理
  const handleSetAnchorPoint = (pointIdx: 1 | 2, xNorm: number, yNorm: number) => {
    const f = currentVideoFrame;
    setManualAnchor((prev) => {
      if (pointIdx === 1) {
        return {
          point1: { frame: f, x_norm: xNorm, y_norm: yNorm },
          point2: prev?.point2
        };
      } else {
        return {
          point1: prev?.point1,
          point2: { frame: f, x_norm: xNorm, y_norm: yNorm }
        };
      }
    });
    setIsSelectingPoint(null);
  };

  const handleClearAnchors = () => {
    setManualAnchor(null);
    setIsSelectingPoint(null);
  };

  const isFpsEstimated = videoTiming?.fpsSource === 'estimated';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-orange-500 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 px-4 lg:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden border border-orange-500/40 shadow-lg shadow-orange-500/20 shrink-0 bg-slate-900 flex items-center justify-center">
            <img
              src="/flaming_jet_baseball.jpg"
              alt="PitchVision Flaming Baseball"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-amber-300 to-cyan-400">
                  PitchVision V4.3
                </span>
                <span className="text-xs sm:text-sm font-semibold text-slate-300 hidden md:inline">
                  投球物理量測與位移反查系統
                </span>
              </h1>
              <span className="text-[10px] font-mono uppercase bg-orange-500/10 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded-full font-semibold">
                80 ~ 140 km/h
              </span>
              <span className="hidden sm:inline-block text-[10px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
                Geometry / Physics Estimate
              </span>
            </div>
            <p className="text-xs text-slate-400">
              影片時間與影像候選 • 幾何條件推估 • RPM / Spin Axis 模型反推 • 觀測足夠時才驗證物理軌跡
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button id="btn-science-info" type="button" onClick={showScience} className="p-3 rounded-lg bg-slate-800 text-cyan-300">科學資訊</button>

        </div>
      </header>

      {/* Main Content Layout */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        <div className="grid grid-cols-1 gap-6 items-start">
          {/* ================================================================= */}
          {/* 左欄: 影片上傳、大尺寸純淨播放器、AI 視覺自動搜尋影格與手動微調 */}
          {/* ================================================================= */}
          <section id="left-column" className="space-y-5">
            <div className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-blue-400" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    投球影像大尺寸檢視器 (無遮擋軌跡)
                  </h2>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>
                    使用距離（推估或已知）: <strong className="text-cyan-400 font-mono">{analysisDistance}m</strong>
                  </span>
                  <span>
                    FPS:{' '}
                    <strong className="text-white font-mono">
                      {formatSourceFps(videoFps)}
                    </strong>
                    {isFpsEstimated && (
                      <span className="ml-1 text-[10px] text-amber-400 font-mono">(FPS ESTIMATED)</span>
                    )}
                    {videoTiming?.isVFR && (
                      <span className="ml-1 text-[10px] text-amber-300 font-mono">(VFR)</span>
                    )}
                  </span>
                </div>
              </div>

              {/* 1. 影片上傳器 (單一流程立即初始化並顯示) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    1. 上傳投球影片 (支援手機直拍 720p / 24~120+ FPS / MP4 / MOV 格式)
                  </label>
                  <button
                    id="btn-load-demo-video"
                    disabled={isAnalyzing || isAutoDetectingFrames || videoLoadStatus === 'processing_metadata' || videoLoadStatus === 'uploading'}
                    type="button"
                    onClick={handleLoadDemoVideo}
                    className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    載入 60fps 範例影片體驗
                  </button>
                </div>
                <div className="relative group border-2 border-dashed border-slate-700/80 hover:border-blue-500/60 rounded-xl p-3.5 transition-all bg-slate-950/40 text-center cursor-pointer">
                  <input
                    id="video-upload-input"
                    aria-label="選擇投球影片"
                    disabled={isAnalyzing || isAutoDetectingFrames || videoLoadStatus === 'processing_metadata' || videoLoadStatus === 'uploading'}
                    type="file"
                    accept="video/mp4,video/quicktime,video/mov,video/webm,video/*"
                    onChange={handleFileUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                  />
                  <div className="flex flex-col items-center justify-center gap-1 pointer-events-none">
                    {videoLoadStatus === 'uploading' || videoLoadStatus === 'processing_metadata' ? (
                      <>
                        <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                        <div className="text-xs font-semibold text-cyan-300">
                          {videoLoadStatus === 'uploading'
                            ? '正在建立 Object URL 與初始化影片串流...'
                            : '正在探測影片 Metadata、真實 FPS 與時間戳 (Timestamps)...'}
                        </div>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-5 h-5 text-blue-400 group-hover:scale-110 transition-transform" />
                        <div className="text-xs font-medium text-slate-300">
                          {isVideoLoaded ? (
                            <span className="text-emerald-400 font-semibold flex items-center gap-1 justify-center">
                              <CheckCircle className="w-3.5 h-3.5" /> 已就緒：{videoFileName} ({totalVideoFrames} {videoTiming?.timeBase==='timestamp'?'來源影格':'CFR時間位置（非實測格數）'} @ {formatSourceFps(videoFps)} FPS)
                            </span>
                          ) : userVideoUrl ? (
                            <span>影片已載入：{videoFileName}；FPS未知，請確認時間資訊。</span>
                          ) : (
                            <span>點擊或拖曳投球影片至此（上傳後單次流程立即初始化並顯示）</span>
                          )}
                        </div>
                        <div className="text-[10.5px] text-slate-500">
                          自動管理 Object URL 生命週期，支援同一檔案重複選取與 VFR 時間戳對齊
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {videoLoadError && (
                  <div className="mt-2 p-2.5 rounded-xl bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{videoLoadError}</span>
                  </div>
                )}
              </div>

              <PitcherSetupCard biometrics={biometrics} onChange={setBiometrics} recomputeBiometrics={computePitcherBiometrics}/>
              {videoTiming&&<div id="timing-status" className="text-xs rounded border border-amber-500/40 p-3">
                <p>{sourceTimesValid ? `FPS ${formatSourceFps(videoFps)} · ${videoTiming.timeBase==='timestamp'?'已確認':'使用者確認（CFR假設）'}` : '來源 FPS／PTS 未確認；可使用手動事件秒數分析。補幀與來源影格追蹤仍需時間資料。'}</p>
                <details className="mt-2 text-slate-400"><summary className="cursor-pointer">進階時間資訊</summary><p className="mt-2">來源：{videoTiming.fpsSource} · {videoTiming.isVFR?'VFR':'CFR'} · 時間基準：{videoTiming.timeBase} · {videoTiming.timingReliable?'時間表已取得':'時間未確認'} · 來源位置數：{videoTiming.timestamps.length}</p><p>{videoTiming.timingWarning}</p></details>
                {!sourceTimesValid&&<div><label>指定可信FPS（CFR假設）<input id="manual-fps" type="number" min="1" max="1000" step="0.001" value={manualFpsDraft} onChange={e=>setManualFpsDraft(e.target.value)}/></label><button id="confirm-manual-fps" disabled={isAnalyzing||isAutoDetectingFrames} onClick={()=>{
                  try {
                    const confirmed=confirmCfrTiming(videoTiming,Number(manualFpsDraft),events);
                    setVideoTiming(confirmed.timing);setVideoFps(confirmed.timing.actualFps);setTotalVideoFrames(confirmed.timing.totalFrames);
                    setEvents(confirmed.events);setVisibleEndFrame(confirmed.events.glove?.right??0);
                    setManualAnchor(null);setIsSelectingPoint(null);setAiDetection(null);setAutoDetectResult(null);
                    setVideoTrack([]);setVideoMetrics(null);setConfidenceScores(null);setAnalyzedEvents(null);setCompletedResult(null);
                    const cursor=videoElementRef.current?.currentTime??0;
                    const frame=describePosition(confirmed.timing.timestamps,Math.min(cursor,confirmed.timing.timestamps.at(-1)!),true).left;
                    setTargetFrameSeek(frame);setCurrentVideoFrame(frame);setCurrentViewKind('cfr_assumed');
                    setHasAnalyzed(false);setVideoLoadError(null);
                  } catch(error) {setVideoLoadError(error instanceof Error?error.message:'FPS 確認失敗，請檢查時間資訊。');}
                }}>確認 FPS</button></div>}
              </div>}
              {/* 2. 視角切換 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-blue-400" />
                    2. 攝影機視角切換 (低角度平視)
                  </label>
                  <span className="text-[11px] text-slate-500">
                    對應 Synthetic Physics Reference 各 540 筆樣本
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCameraViewMode('catcher')}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition-all ${
                      cameraViewMode === 'catcher'
                        ? 'bg-blue-600/20 border-blue-500 text-blue-300 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>📷 捕手平視視角 (540 筆)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCameraViewMode('pitcher_rear')}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition-all ${
                      cameraViewMode === 'pitcher_rear'
                        ? 'bg-blue-600/20 border-blue-500 text-blue-300 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>⚾ 投手後方平視視角 (540 筆)</span>
                  </button>
                </div>
              </div>

              {/* 3. 球種指定選單 + Strict Pitch Type Mode 控制 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-400" />
                    3. 指定投球球種 (第一級資料庫過濾條件)
                  </label>
                  <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    Strict Pitch Type Mode: {strictPitchTypeMode ? 'ON' : 'OFF'}
                  </span>
                </div>
                <select
                  id="pitch-type-select"
                  value={selectedPitchType}
                  onChange={(e) => setSelectedPitchType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-medium transition-colors"
                >
                  {PITCH_TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>

                {/* Strict Mode & Cross-Type Fallback 設定條 */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={strictPitchTypeMode}
                      onChange={(e) => setStrictPitchTypeMode(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-0"
                    />
                    <span className="text-slate-300 font-medium">
                      Strict Pitch Type Matching (嚴格限定同球種反查 RPM / Spin Axis)
                    </span>
                  </label>

                  {strictPitchTypeMode && (
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allowCrossTypeFallback}
                        onChange={(e) => setAllowCrossTypeFallback(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
                      />
                      <span>無資料時允許 Cross-Type Fallback</span>
                    </label>
                  )}
                </div>
              </div>

              {/* 4. 大尺寸影片播放視窗 */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Video className="w-3.5 h-3.5 text-cyan-400" />
                    4. 大尺寸影片播放視窗 (無軌跡覆蓋，確保每個影格一清二楚)
                  </span>
                  {gloveFrame > releaseFrame ? (
                    <span className="text-[11px] font-mono text-cyan-400">
                      飛行間隔: {flightFrames} 幀 ({flightSeconds}s)
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono text-amber-400">
                      待設定進手套 F &gt; 出手 F
                    </span>
                  )}
                </div>

                <PitchVideoPlayer
                  videoUrl={userVideoUrl}
                  releaseFrame={releaseFrame}
                  gloveFrame={gloveFrame}
                  totalFrames={totalVideoFrames}
                  fps={videoFps}
                  timestamps={controlTimes}
                  selectionOnly={selectionOnly}
                  timestampsArePreviewPositions={selectionOnly}
                  isFpsEstimated={isFpsEstimated}
                  viewMode={cameraViewMode}
                  velocityKmh={velocityKmh}
                  pitchName={selectedPitchType}
                  hasAnalyzed={hasAnalyzed}
                  busy={isAnalyzing||isAutoDetectingFrames}
                  targetFrameSeek={targetFrameSeek}
                  onCurrentFrameChange={(f) => setCurrentVideoFrame(f)}
                  sourceTiming={videoTiming}
                  events={events}
                  onSetEvent={(name,event)=>setEvent(name,selectionOnly?{...event,sourceSpanSec:NaN,previewQuality:'unavailable'}:event)}
                  onPositionChange={point=>setCurrentViewKind(point.kind)}
                  spatialCalibration={matchedResult?.spatial_calibration}
                  onVideoElementReady={(el) => {
                    videoElementRef.current = el;
                  }}
                  isSelectingPoint={referenceSelection !== null ? 1 : isSelectingPoint}
                  onSelectCoordinate={(x, y) => {
                    if(currentViewKind==='interpolated')return;
                    if(referenceSelection !== null){setReferencePoints(prev=>prev.map((p,i)=>i===referenceSelection?{x,y}:p));setReferenceSelection(null);return;}
                    if (isSelectingPoint) {
                      handleSetAnchorPoint(isSelectingPoint, x, y);
                    }
                  }}
                  manualPoint1={manualAnchor?.point1 || null}
                  manualPoint2={manualAnchor?.point2 || null}
                />

              </div>

              <div className="space-y-3">
              {isVideoLoaded&&<details className="border border-slate-700 p-3 rounded"><summary className="text-xs">選填校正操作</summary>

                <div className="flex flex-wrap gap-2"><button id="mark-position-1" disabled={currentViewKind==='interpolated'||isAnalyzing||isAutoDetectingFrames} onClick={()=>setIsSelectingPoint(1)}>標記首個球位置 F{currentVideoFrame}</button><button id="mark-position-2" disabled={currentViewKind==='interpolated'||isAnalyzing||isAutoDetectingFrames} onClick={()=>setIsSelectingPoint(2)}>標記末個球位置 F{currentVideoFrame}</button><button disabled={isAnalyzing||isAutoDetectingFrames} onClick={handleClearAnchors}>清除球位置</button></div>
                <label className="block text-xs">球最後可見原始索引（追蹤提示，非接球事件）<input id="visible-end-frame" disabled={isAnalyzing||isAutoDetectingFrames} type="number" min={releaseFrame} max={totalVideoFrames-1} value={visibleEndFrame} onChange={e=>setVisibleEndFrame(Math.max(releaseFrame,Math.min(totalVideoFrames-1,Number(e.target.value))))}/></label>
                <p className="text-xs">{manualAnchor?.point1?`位置1 F${manualAnchor.point1.frame}`:'位置1未設定'} / {manualAnchor?.point2?`位置2 F${manualAnchor.point2.frame}`:'位置2未設定'}</p>
                <p className="text-xs">已知矩形角點：出手端左→右→接球端右→左；請輸入實際量測尺度。</p>
                <div className="flex flex-wrap gap-2">{referencePoints.map((p,i)=><button key={i} disabled={currentViewKind==='interpolated'||isAnalyzing||isAutoDetectingFrames} onClick={()=>setReferenceSelection(i)}>幾何角點{i+1}{p?' ✓':''}</button>)}</div>
                <label>已知寬(m)<input type="number" value={referenceWidth} onChange={e=>setReferenceWidth(Number(e.target.value))}/></label>
                <label>出手端至接球端已知長(m)<input type="number" value={referenceLength} onChange={e=>setReferenceLength(Number(e.target.value))}/></label>
                <label>已校準焦距(px，選填)<input type="number" value={referenceFocal??''} onChange={e=>setReferenceFocal(Number(e.target.value)||undefined)}/></label>
                <label><input type="checkbox" checked={referenceConfirmed} onChange={e=>setReferenceConfirmed(e.target.checked)}/>已確認矩形與實際尺度</label>
                <button id="apply-camera-calibration" disabled={isAnalyzing||isAutoDetectingFrames||!referenceConfirmed||referencePoints.some(p=>!p)} onClick={()=>{try{const v=videoElementRef.current!;setCameraGeometry(calibrateGroundReference(v.videoWidth,v.videoHeight,{points:referencePoints as ImagePoint[],widthM:referenceWidth,lengthM:referenceLength,focalPx:referenceFocal}));setHasAnalyzed(false);}catch(e){setVideoLoadError(e instanceof Error?e.message:'標定失敗');}}}>套用幾何標定</button>
                <button disabled={isAnalyzing||isAutoDetectingFrames} onClick={()=>{setCameraGeometry(null);setHasAnalyzed(false);setReferenceConfirmed(false);setReferencePoints([null,null,null,null]);}}>清除幾何標定</button>
                {cameraGeometry&&<p id="camera-geometry-status" className="text-xs">{cameraGeometry.method} / {cameraGeometry.method==='planar_reference'?`yaw ${cameraGeometry.azimuthDeg.toFixed(1)}° / pitch ${cameraGeometry.elevationDeg.toFixed(1)}°`:'yaw / pitch 未估定'} / roll {cameraGeometry.rollDeg.toFixed(1)}°<br/>{cameraGeometry.limitations.join('；')}</p>}
              </details>}
              </div>
              {/* 5. 自定義出手與進手套影格調整 + 真正的 AI 自動搜尋出手 / 進手套 */}
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-orange-400" />
                    5. 出手與進手套影格設定 (支援 AI 視覺自動搜尋或手動指定)
                  </span>

                  <div className="flex items-center gap-2">
                    {isVideoLoaded && (
                      <button
                        id="btn-ai-auto-detect-frames"
                        type="button"
                        disabled={isAutoDetectingFrames || isAnalyzing || !videoTiming?.timingReliable}
                        onClick={handleAiAutoDetectFrames}
                        className="text-[11px] text-cyan-300 hover:text-white flex items-center gap-1.5 transition-colors font-semibold bg-cyan-950/80 hover:bg-cyan-900/80 border border-cyan-500/40 px-2.5 py-1 rounded-lg disabled:opacity-50"
                        title="真正逐格讀取影片 Canvas 影像，透過 BallDetectionEngine 搜尋棒球候選並判定出手與進手套影格"
                      >
                        {isAutoDetectingFrames ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                            <span>{autoDetectStageText || 'AI 視覺掃描中...'} ({autoDetectProgress}%)</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                            <span>AI 自動搜尋出手 / 進手套</span>
                          </>
                        )}
                      </button>
                    )}
                    {aiDetection && aiDetection.status !== 'AUTO_DETECTION_FAILED' && (
                      <button
                        type="button"
                        onClick={handleResetToAiFrames}
                        className="text-[11px] text-slate-400 hover:text-slate-300 flex items-center gap-1 transition-colors font-medium"
                      >
                        <RotateCcw className="w-3 h-3" />
                        採用／恢復候選影格（需人工確認）
                      </button>
                    )}
                  </div>
                </div>

                {isAutoDetectingFrames&&<button id="stop-auto-detection" onClick={()=>{autoGeneration.current++;setIsAutoDetectingFrames(false);videoElementRef.current?.pause();}}>停止自動辨識，使用手動模式</button>}
                {/* AI 自動搜尋進度面板 */}
                {isAutoDetectingFrames && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-cyan-500/40 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-cyan-300 font-semibold">
                      <span>AI 電腦視覺逐段掃描影片中 (Coarse Scan ➔ Fine Scan)</span>
                      <span className="font-mono">{autoDetectProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-cyan-400 h-full rounded-full transition-all duration-200"
                        style={{ width: `${autoDetectProgress}%` }}
                      />
                    </div>
                    <div className="text-[11px] font-mono text-slate-300">{autoDetectStageText}</div>
                  </div>
                )}

                {/* AI 自動辨識結果狀態卡 (包含真正失敗狀態 AUTO_DETECTION_FAILED 與 LOW_CONFIDENCE) */}
                {autoDetectResult && !isAutoDetectingFrames && (
                  <div
                    className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                      autoDetectResult.status === 'AUTO_DETECTION_FAILED'
                        ? 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                        : autoDetectResult.status === 'LOW_CONFIDENCE'
                        ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                        : 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span className="flex items-center gap-1.5">
                        {autoDetectResult.status === 'AUTO_DETECTION_FAILED' ? (
                          <>
                            <AlertTriangle className="w-4 h-4 text-rose-400" />
                            <span>AI 自動辨識失敗，請手動確認影格 (AUTO_DETECTION_FAILED)</span>
                          </>
                        ) : autoDetectResult.status === 'LOW_CONFIDENCE' ? (
                          <>
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                            <span>AI 自動搜尋完成 (LOW_CONFIDENCE — 建議手動確認微調)</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                            <span>AI 自動搜尋出手 / 進手套完成</span>
                          </>
                        )}
                      </span>
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-950/70 border border-slate-700">
                        Auto Detection Confidence: {autoDetectResult.confidence}%
                      </span>
                    </div>

                    {autoDetectResult.status !== 'AUTO_DETECTION_FAILED' && (
                      <div className="text-[11px] text-slate-300 font-mono">
                        候選軌跡起點: F{autoDetectResult.releaseFrame} (Evidence {autoDetectResult.releaseEvidence.evidenceScore}) ｜ 候選終點: F{autoDetectResult.gloveFrame} (Evidence {autoDetectResult.gloveEvidence.evidenceScore}) ｜ 連續候選點: {autoDetectResult.ballTrack.length} 點（非已確認離手／進手套）
                      </div>
                    )}

                    {autoDetectResult.warnings.length > 0 && (
                      <div className="text-[11px] space-y-0.5 pt-0.5">
                        {autoDetectResult.warnings.map((w, idx) => (
                          <div key={idx}>• {w}</div>
                        ))}
                      </div>
                    )}
                    {autoDetectResult.candidateFrames.length>0&&<label className="block text-xs">查看候選影格（不覆蓋設定）<select aria-label="查看候選影格" defaultValue="" onChange={e=>handleSeekVideoFrame(Number(e.target.value))}><option value="" disabled>選擇影格</option>{Array.from(new Set(autoDetectResult.candidateFrames)).map(f=><option key={f} value={f}>F{f}</option>)}</select></label>}
                  </div>
                )}

                {/* 完全解耦之雙滑桿卡片 */}

              </div>

              <label className="text-xs flex gap-2"><input id="use-existing-tracking" type="checkbox" checked={useExistingTracking} onChange={e=>setUseExistingTracking(e.target.checked)} disabled={isAnalyzing}/>另執行原有影像追蹤（選填；手動模型分析不需要）</label>
              {/* 6. 啟動位移反查與物理閉環驗證分析按鈕 */}
              <div className="pt-1 space-y-2">
                <button
                  id="btn-start-analysis"
                  onClick={handleStartAnalysis}
                  disabled={Boolean(analysisBlockReason)}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>執行實測位移反查與物理閉環驗證中 ({analysisProgress}%)...</span>
                    </>
                  ) : !isVideoLoaded ? (
                    <>
                      <Video className="w-4 h-4 text-slate-400" />
                      <span>請先於上方上傳影片後進行影格設定</span>
                    </>
                  ) : gloveFrame <= releaseFrame ? (
                    <>
                      <span>⚠️ 請調整進手套影格大於出手影格</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>🚀 啟用實測球路追蹤分析（手動時間／原模型）</span>
                    </>
                  )}
                </button>

                <p id="analysis-readiness" role="status" className="text-xs text-amber-200">{analysisBlockReason || (hasAnalyzed?'分析已完成，可修改事件後重新分析。':'手動時間設定可分析；不需執行自動辨識。')}</p>
                {isAnalyzing && (
                  <div className="mt-2.5 p-3 bg-slate-950 border border-blue-500/30 rounded-xl space-y-2 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="font-semibold text-cyan-300">實測位移解算 ➔ 資料庫反查 ➔ 物理重建驗證中</span>
                      <span className="font-mono text-cyan-400">{analysisProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full rounded-full transition-all duration-300"
                        style={{ width: `${analysisProgress}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono">
                      {analysisStepText}
                    </p>
                  </div>
                )}
              </div>

              {/* 7. 距離／時間平均球速推算說明條 */}
              <div className="text-[11.5px] text-slate-400 bg-slate-950/80 px-3 py-2 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                {hasAnalyzed ? (
                  <>
                    <span>
                      距離／時間平均球速推算：({analysisDistance}m / {flightSeconds}s) × 3.6 ={' '}
                      <strong className="text-cyan-400 font-mono text-xs">{velocityKmh} km/h</strong>
                    </span>
                    <span className="text-emerald-400 font-mono flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> 分析完成：{matchedResult?.observed_metrics?.movement_valid?'已知尺度下的條件重建':'尺度／軌跡不足，保留原手動模型參考'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-slate-400">
                      距離／時間平均球速推算：依有效飛行距離 ({analysisDistance}m / 實測飛行秒數) 計算 [VIDEO DERIVED]
                    </span>
                    <span className="text-slate-500 font-mono">
                      影格間隔: {flightFrames > 0 && !eventView?.eventOnly ? `${flightFrames} 幀` : '--'} • 總影格: {totalVideoFrames > 0 ? `${totalVideoFrames} 幀` : '--'}
                    </span>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ================================================================= */}
          {/* 右欄: 5 大核心指標與 Analysis Basis + 3D 雙軌軌跡視覺化 */}
          {/* ================================================================= */}
          <section id="right-column" className="space-y-4">
            <div className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800 mb-4 gap-2">
                <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    id="tab-metrics-analysis"
                    onClick={() => setRightColumnTab('metrics')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      rightColumnTab === 'metrics'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>5 大核心指標與反查依據</span>
                  </button>
                  <button
                    type="button"
                    id="tab-dual-track-visualizer"
                    onClick={() => setRightColumnTab('visualizer')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      rightColumnTab === 'visualizer'
                        ? 'bg-cyan-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>3D 軌跡視覺化 (雙軌對比)</span>
                  </button>
                </div>

                <span className="text-[11px] font-mono text-cyan-400">
                  Synthetic Physics Reference (1,080 筆)
                </span>
              </div>

              {hasAnalyzed&&analyzedEvents&&<p id="event-time-provenance" data-engine-flight-seconds={matchedResult?.flight_time_sec} data-events={JSON.stringify(analyzedEvents)} className="text-xs text-amber-200 mb-3">出手 {analyzedEvents.release?.timeSec.toFixed(6)}s（{analyzedEvents.release?.kind==='interpolated'?'推算':!sourceTimesValid?'媒體時間':analyzedEvents.release?.kind==='cfr_assumed'?'CFR假設':'原始'}）→進手套 {analyzedEvents.glove?.timeSec.toFixed(6)}s（{analyzedEvents.glove?.kind==='interpolated'?'推算':!sourceTimesValid?'媒體時間':analyzedEvents.glove?.kind==='cfr_assumed'?'CFR假設':'原始'}）。事件精度仍受原始間距 {(sourceTimesValid?Math.max(analyzedEvents.release?.sourceSpanSec||0,analyzedEvents.glove?.sourceSpanSec||0).toFixed(4):'未知')}s 與遮蔽限制；補幀不增加真觀測或旋轉量測精度。</p>}
              {rightColumnTab === 'metrics' ? (
                <MetricsPanel compact
                  result={matchedResult || undefined}
                  matchedResult={matchedResult || undefined}
                  calcVelocity={velocityKmh}
                  flightSeconds={flightSeconds}
                  flightFrames={flightFrames}
                  standardDistance={STANDARD_DISTANCE_METERS}
                />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span className="font-semibold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                      雙軌獨立軌跡展示 (VIDEO TRACK 影片實測點 vs MODEL TRACK 物理重建)
                    </span>
                    <span className="text-[10.5px] font-mono text-slate-400">
                      當前角度：{cameraViewMode === 'catcher' ? '捕手平視視角' : '投手後方平視視角'}
                    </span>
                  </div>

                  <PitchVisualizer
                    viewMode={cameraViewMode}
                    releaseFrame={releaseFrame}
                    gloveFrame={gloveFrame}
                    totalFrames={totalVideoFrames}
                    flightTimeSec={flightSeconds}
                    velocityKmh={velocityKmh}
                    ivbInch={matchedResult?.reconstructed_ivb_inch ?? matchedResult?.ivb_inch ?? 14.5}
                    hbInch={matchedResult?.reconstructed_hb_inch ?? matchedResult?.hb_inch ?? -6.2}
                    spinAxis={matchedResult?.spin_axis ?? '1:15'}
                    pitchName={matchedResult?.matched_pitch_type || selectedPitchType}
                    videoUrl={userVideoUrl}
                    spatialCalibration={matchedResult?.spatial_calibration}
                    videoTrack={videoTrack}
                    modelTrack={matchedResult?.model_track || matchedResult?.trajectory_points}
                  />
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Database Viewer Modal */}
      <ScientificInfoPanel open={scienceOpen} onClose={()=>{setScienceOpen(false);document.getElementById('left-column')?.scrollIntoView();}} result={matchedResult} quality={videoQuality} fileName={videoFileName} fps={videoFps} onDatabase={()=>setIsDbModalOpen(true)} onCode={()=>setIsCodeModalOpen(true)} timingNote={videoTiming?.timingWarning}/>
      <DatabaseModal
        isOpen={isDbModalOpen}
        onClose={() => setIsDbModalOpen(false)}
        database={PITCH_DATABASE}
      />

      {/* Code Viewer Modal */}
      <CodeViewerModal
        isOpen={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
        codeContent={APP_PY_CODE}
      />
    </div>
  );
}
