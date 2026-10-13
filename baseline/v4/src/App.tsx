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
  VideoTiming
} from './types';
import { computePitcherBiometrics, DEFAULT_PITCHER_BIOMETRICS } from './spatialCalibration';
import { PitchVideoPlayer } from './components/PitchVideoPlayer';
import { PitchVisualizer } from './components/PitchVisualizer';
import { FrameSlidersCard } from './components/FrameSlidersCard';
import { MetricsPanel } from './components/MetricsPanel';
import { PitcherSetupCard } from './components/PitcherSetupCard';
import { DatabaseModal } from './components/DatabaseModal';
import { CodeViewerModal } from './components/CodeViewerModal';
import { ManualAnchorPanel } from './components/ManualAnchorPanel';
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
  Maximize2,
  Minimize2,
  AlertTriangle,
  ShieldCheck
} from 'lucide-react';

export default function App() {
  // 投手與投手丘初始生物力學參數設置
  const [biometrics, setBiometrics] = useState<PitcherBiometrics>(DEFAULT_PITCHER_BIOMETRICS);

  // Video and Frame states
  const [totalVideoFrames, setTotalVideoFrames] = useState<number>(0);
  const [videoFps, setVideoFps] = useState<number>(30);
  const [videoTiming, setVideoTiming] = useState<(VideoTiming & { width: number; height: number }) | null>(null);
  const [videoLoadStatus, setVideoLoadStatus] = useState<VideoLoadStatus>('idle');
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);

  const [aiDetection, setAiDetection] = useState<FrameDetectionResult | null>(null);
  const [autoDetectResult, setAutoDetectResult] = useState<AutoFrameDetectionOutput | null>(null);
  const [isAutoDetectingFrames, setIsAutoDetectingFrames] = useState<boolean>(false);
  const [autoDetectProgress, setAutoDetectProgress] = useState<number>(0);
  const [autoDetectStageText, setAutoDetectStageText] = useState<string>('');

  const [releaseFrame, setReleaseFrame] = useState<number>(0);
  const [gloveFrame, setGloveFrame] = useState<number>(0);
  const [visibleEndFrame, setVisibleEndFrame] = useState<number>(0);
  const [currentVideoFrame, setCurrentVideoFrame] = useState<number>(0);
  const [targetFrameSeek, setTargetFrameSeek] = useState<number | null>(null);
  const [isVideoExpanded, setIsVideoExpanded] = useState<boolean>(false);

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

  const isVideoLoaded = Boolean(userVideoUrl && totalVideoFrames > 0 && videoLoadStatus === 'ready');

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

    setReleaseFrame(102);
    setGloveFrame(145);
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

    setVideoLoadError(null);
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
        (status) => setVideoLoadStatus(status)
      );

      activeObjectUrlRef.current = loadResult.objectUrl;

      // 單一梯次更新所有影片狀態，確保 PitchVideoPlayer 第一次掛載即擁有完整 metadata 與有效 Object URL
      setVideoFileName(loadResult.fileName);
      setTotalVideoFrames(loadResult.totalFrames);
      setVideoFps(loadResult.actualFps);
      setVideoTiming({
        durationSec: loadResult.durationSec,
        timeBase: loadResult.fpsSource === 'measured_rvfc' ? 'timestamp' : 'fps_derived',
        actualFps: loadResult.actualFps,
        fpsSource: loadResult.fpsSource,
        isVFR: loadResult.isVFR,
        totalFrames: loadResult.totalFrames,
        timestamps: loadResult.timestamps,
        width: loadResult.width,
        height: loadResult.height
      });
      setVideoQuality(loadResult.qualityAssessment);
      setReleaseFrame(loadResult.initialReleaseFrame);
      setGloveFrame(loadResult.initialGloveFrame);
      setVisibleEndFrame(loadResult.initialGloveFrame);
      setCurrentVideoFrame(loadResult.initialReleaseFrame);
      setTargetFrameSeek(loadResult.initialReleaseFrame);
      setUserVideoUrl(loadResult.objectUrl);
      setVideoLoadStatus('ready');
    } catch (err: any) {
      setVideoLoadStatus('failed');
      setVideoLoadError(err?.message || '影片載入失敗，請確認格式為 MP4 / MOV / WebM');
    }
  };

  // 真正的 AI 自動搜尋出手 / 進手套 (執行 Coarse-to-Fine 視覺影格掃描 + BallDetectionEngine + Temporal Track)
  const handleAiAutoDetectFrames = async () => {
    if (!isVideoLoaded) return;

    const videoEl = videoElementRef.current;
    if (!videoEl || videoEl.readyState < 1) {
      setVideoLoadError('影片播放器尚未就緒，請稍候片刻再執行 AI 視覺搜尋。');
      return;
    }

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
        videoWidth: videoEl.videoWidth || videoTiming?.width || 720,
        videoHeight: videoEl.videoHeight || videoTiming?.height || 1280,
        timestamps: videoTiming?.timestamps,
        onProgress: (pct, text) => {
          setAutoDetectProgress(pct);
          setAutoDetectStageText(text);
        }
      });

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
        setReleaseFrame(result.releaseFrame);
        setGloveFrame(result.gloveFrame);
        setVisibleEndFrame(result.gloveFrame);
        setCurrentVideoFrame(result.releaseFrame);
        setTargetFrameSeek(result.releaseFrame);

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
      setIsAutoDetectingFrames(false);
    }
  };

  // 啟動真實電腦視覺棒球追蹤、空間校正與位移反查資料庫分析
  const handleStartAnalysis = async () => {
    if (!isVideoLoaded) return;

    setIsAnalyzing(true);
    setAnalysisProgress(10);
    setAnalysisStepText(`【步驟 1/6】鎖定出手影格 (F${releaseFrame}) 與進手套影格 (F${gloveFrame})...`);

    // 步驟 2: 運動差分候選、時間走廊追蹤與稀疏觀測點擷取
    let sparseResult = null;
    if (videoElementRef.current) {
      setAnalysisProgress(20);
      setAnalysisStepText(`【步驟 2/6】執行 ${videoFps.toFixed(1)} FPS 差分運動偵測與時間走廊追蹤...`);
      try {
        sparseResult = await trackBaseballSparse(videoElementRef.current, {
          releaseFrame,
          visibleEndFrame: visibleEndFrame > releaseFrame ? visibleEndFrame : gloveFrame,
          catchFrame: gloveFrame,
          fps: videoFps,
          cameraView: cameraViewMode,
          manualAnchor: manualAnchor || undefined,
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
      observations: sparseResult?.observations || [],
      releaseFrame,
      lastReliableBallFrame: effectiveVisibleEnd,
      catchFrame: gloveFrame,
      actualFps: videoFps,
      videoWidth: videoElementRef.current?.videoWidth || videoTiming?.width || 720,
      videoHeight: videoElementRef.current?.videoHeight || videoTiming?.height || 1280
    });

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

    const isManualUsed = Boolean(manualAnchor?.point1 && manualAnchor?.point2);
    const conf = calculateUnifiedConfidence({
      fps: videoFps,
      totalVideoFrames,
      releaseFrame,
      gloveFrame,
      isUserConfirmedFrames: true,
      isManualAnchorUsed: isManualUsed,
      autoDetectionConfidence: autoDetectResult?.confidence,
      videoMetrics: validationResult.metrics
    });
    setConfidenceScores(conf);

    if (!aiDetection) {
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

    setAnalysisProgress(100);
    setIsAnalyzing(false);
    setHasAnalyzed(true);
  };

  // Physical calculations prioritizing timestamps[] over frame / fps
  const { velocityKmh, flightSeconds, flightFrames } = useMemo(() => {
    if (releaseFrame <= 0 || gloveFrame <= releaseFrame) {
      return { velocityKmh: 0, flightSeconds: 0, flightFrames: 0 };
    }
    return calculateVelocity(
      releaseFrame,
      gloveFrame,
      videoFps,
      biometrics.effectiveTravelDistanceM,
      videoTiming?.timestamps
    );
  }, [releaseFrame, gloveFrame, videoFps, biometrics.effectiveTravelDistanceM, videoTiming?.timestamps]);

  // Match result with PitchVision Synthetic Physics Reference Dataset
  const matchedResult = useMemo(() => {
    if (!hasAnalyzed || velocityKmh <= 0) return null;
    const isManualUsed = Boolean(manualAnchor?.point1 && manualAnchor?.point2);
    return matchPitchData(
      velocityKmh,
      flightSeconds,
      selectedPitchType,
      cameraViewMode,
      PITCH_DATABASE,
      releaseFrame,
      gloveFrame,
      biometrics,
      videoTrack,
      videoMetrics || undefined,
      confidenceScores || undefined,
      videoFps,
      videoTiming?.timestamps,
      strictPitchTypeMode,
      allowCrossTypeFallback,
      isManualUsed,
      autoDetectResult?.confidence
    );
  }, [
    hasAnalyzed,
    velocityKmh,
    flightSeconds,
    cameraViewMode,
    selectedPitchType,
    releaseFrame,
    gloveFrame,
    biometrics,
    videoTrack,
    videoMetrics,
    confidenceScores,
    videoFps,
    videoTiming?.timestamps,
    strictPitchTypeMode,
    allowCrossTypeFallback,
    manualAnchor,
    autoDetectResult?.confidence
  ]);

  // 回復 AI 建議影格
  const handleResetToAiFrames = () => {
    if (aiDetection && aiDetection.releaseFrame > 0 && aiDetection.gloveFrame > aiDetection.releaseFrame) {
      setReleaseFrame(aiDetection.releaseFrame);
      setGloveFrame(aiDetection.gloveFrame);
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
    const f = currentVideoFrame || releaseFrame;
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
                  PitchVision V4 Baseline
                </span>
                <span className="text-xs sm:text-sm font-semibold text-slate-300 hidden md:inline">
                  投球物理量測與位移反查系統
                </span>
              </h1>
              <span className="text-[10px] font-mono uppercase bg-orange-500/10 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded-full font-semibold">
                80 ~ 140 km/h
              </span>
              <span className="hidden sm:inline-block text-[10px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full">
                Perspective / Scale Calibrated
              </span>
            </div>
            <p className="text-xs text-slate-400">
              位移為實測觀測值 • RPM / Spin Axis 為同球種位移反查推論結果 • Gravity + Drag + Magnus 物理閉環驗證
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsVideoExpanded(!isVideoExpanded)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors ${
              isVideoExpanded
                ? 'bg-cyan-600 text-white border-cyan-500'
                : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border-slate-700/80'
            }`}
            title="擴大/還原影片播放器視窗"
          >
            {isVideoExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isVideoExpanded ? '還原雙欄' : '超大播放視窗'}</span>
          </button>

          <button
            id="btn-view-database"
            type="button"
            onClick={() => setIsDbModalOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 text-xs font-medium border border-slate-700/80 flex items-center gap-1.5 transition-colors"
          >
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">檢視</span> Synthetic 參考庫 (1,080 筆)
          </button>

          <button
            id="btn-view-code"
            type="button"
            onClick={() => setIsCodeModalOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 text-xs font-medium border border-slate-700/80 flex items-center gap-1.5 transition-colors"
          >
            <FileCode className="w-3.5 h-3.5 text-emerald-400" />
            <span>Python 原始碼</span>
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        <nav className="mobile-workflow" aria-label="分析操作步驟">
          <a href="#video-upload-input">1 選擇影片</a>
          <a href="#btn-ai-auto-detect-frames">2 辨識與校正</a>
          <a href="#btn-start-analysis">3 執行分析</a>
          <a href="#right-column">4 結果與軌跡</a>
        </nav>
        {/* Streamlit Run Banner */}
        <div className="mb-6 p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              已生成單檔 Python 原始碼 <code className="text-amber-300 font-mono">app.py</code>，在終端機直接執行：
            </span>
            <code className="bg-slate-950 px-2.5 py-1 rounded-md text-emerald-400 border border-slate-800 font-mono font-semibold">
              streamlit run app.py
            </code>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>大尺寸清晰播放器 • 球種鎖定位移反查 • PitchVision Synthetic Physics Reference Dataset (1,080 筆)</span>
          </div>
        </div>

        {/* Layout: Normal Dual Column or Expanded Video Mode */}
        <div
          className={`grid gap-6 items-start transition-all duration-300 ${
            isVideoExpanded ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[1.38fr_1fr]'
          }`}
        >
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
                    有效飛行距離: <strong className="text-cyan-400 font-mono">{biometrics.effectiveTravelDistanceM}m</strong>
                  </span>
                  <span>
                    FPS:{' '}
                    <strong className="text-white font-mono">
                      {videoFps.toFixed(1)}
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

              {/* 0. 投手丘、身高、跨步距離設定 */}
              <PitcherSetupCard
                biometrics={biometrics}
                onChange={(updated) => setBiometrics(updated)}
                recomputeBiometrics={computePitcherBiometrics}
              />

              {/* 影片品質客觀評估 (Video Quality Gate) */}
              {isVideoLoaded && videoQuality && (
                <VideoQualityCard
                  assessment={videoQuality}
                  videoFileName={videoFileName}
                  actualFps={videoFps}
                />
              )}

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
                              <CheckCircle className="w-3.5 h-3.5" /> 已就緒：{videoFileName} ({totalVideoFrames} 影格 @ {videoFps.toFixed(1)} FPS)
                            </span>
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
                  timestamps={videoTiming?.timestamps}
                  isFpsEstimated={isFpsEstimated}
                  viewMode={cameraViewMode}
                  velocityKmh={velocityKmh}
                  pitchName={selectedPitchType}
                  hasAnalyzed={hasAnalyzed}
                  targetFrameSeek={targetFrameSeek}
                  onCurrentFrameChange={(f) => setCurrentVideoFrame(f)}
                  onSetReleaseFrame={(f) => setReleaseFrame(f)}
                  onSetGloveFrame={(f) => setGloveFrame(f)}
                  spatialCalibration={matchedResult?.spatial_calibration}
                  isExpanded={isVideoExpanded}
                  onToggleExpand={() => setIsVideoExpanded(!isVideoExpanded)}
                  onVideoElementReady={(el) => {
                    videoElementRef.current = el;
                  }}
                  isSelectingPoint={isSelectingPoint}
                  onSelectCoordinate={(x, y) => {
                    if (isSelectingPoint) {
                      handleSetAnchorPoint(isSelectingPoint, x, y);
                    }
                  }}
                  manualPoint1={manualAnchor?.point1 || null}
                  manualPoint2={manualAnchor?.point2 || null}
                />
              </div>

              {/* 手動雙錨點模式 (作為搜尋走廊輔助，不取代真實視覺觀測) */}
              {isVideoLoaded && (
                <div className="pt-1">
                  <ManualAnchorPanel
                    currentFrame={currentVideoFrame || releaseFrame}
                    manualAnchor={manualAnchor}
                    onSetPoint1={(f, x, y) => {
                      setManualAnchor((prev) => ({
                        point1: { frame: f, x_norm: x, y_norm: y },
                        point2: prev?.point2
                      }));
                    }}
                    onSetPoint2={(f, x, y) => {
                      setManualAnchor((prev) => ({
                        point1: prev?.point1,
                        point2: { frame: f, x_norm: x, y_norm: y }
                      }));
                    }}
                    onClearAnchors={handleClearAnchors}
                    isSelectingPoint={isSelectingPoint}
                    onStartSelectingPoint={(pt) => setIsSelectingPoint(pt)}
                    onCancelSelecting={() => setIsSelectingPoint(null)}
                    videoFps={videoFps}
                  />
                </div>
              )}

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
                        disabled={isAutoDetectingFrames || isAnalyzing}
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
                        回復 AI 偵測點
                      </button>
                    )}
                  </div>
                </div>

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
                        偵測出手: F{autoDetectResult.releaseFrame} (Evidence {autoDetectResult.releaseEvidence.evidenceScore}) ｜ 偵測進手套: F{autoDetectResult.gloveFrame} (Evidence {autoDetectResult.gloveEvidence.evidenceScore}) ｜ 連續軌跡點: {autoDetectResult.ballTrack.length} 點
                      </div>
                    )}

                    {autoDetectResult.warnings.length > 0 && (
                      <div className="text-[11px] space-y-0.5 pt-0.5">
                        {autoDetectResult.warnings.map((w, idx) => (
                          <div key={idx}>• {w}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 完全解耦之雙滑桿卡片 */}
                <FrameSlidersCard
                  releaseFrame={releaseFrame}
                  gloveFrame={gloveFrame}
                  visibleEndFrame={visibleEndFrame}
                  totalVideoFrames={totalVideoFrames}
                  fps={videoFps}
                  timestamps={videoTiming?.timestamps}
                  aiReleaseFrame={
                    autoDetectResult?.status && autoDetectResult.status !== 'AUTO_DETECTION_FAILED'
                      ? autoDetectResult.releaseFrame
                      : aiDetection?.releaseFrame ?? null
                  }
                  aiGloveFrame={
                    autoDetectResult?.status && autoDetectResult.status !== 'AUTO_DETECTION_FAILED'
                      ? autoDetectResult.gloveFrame
                      : aiDetection?.gloveFrame ?? null
                  }
                  disabled={!isVideoLoaded}
                  onChangeReleaseFrame={(newRel) => setReleaseFrame(newRel)}
                  onChangeGloveFrame={(newGlove) => setGloveFrame(newGlove)}
                  onChangeVisibleEndFrame={(newEnd) => setVisibleEndFrame(newEnd)}
                  onSeekVideoFrame={handleSeekVideoFrame}
                />
              </div>

              {/* 6. 啟動位移反查與物理閉環驗證分析按鈕 */}
              <div className="pt-1 space-y-2">
                <button
                  id="btn-start-analysis"
                  onClick={handleStartAnalysis}
                  disabled={isAnalyzing || isAutoDetectingFrames || !isVideoLoaded || releaseFrame < 0 || gloveFrame <= releaseFrame}
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
                      <span>🚀 啟動實測球路追蹤 ＋ 同球種位移反查 RPM / Spin Axis 分析</span>
                    </>
                  )}
                </button>

                {/* 狀態提示指引 */}
                {!isVideoLoaded ? (
                  <p className="text-[11px] text-slate-500 text-center">
                    💡 提示：請先上傳投球影片（或載入示範短片），即可使用「AI 自動搜尋出手 / 進手套」或手動設定影格。
                  </p>
                ) : gloveFrame <= releaseFrame ? (
                  <p className="text-[11px] text-amber-400 text-center bg-amber-950/20 border border-amber-500/20 rounded-lg py-1 px-2 font-medium">
                    ⚠️ 提醒：目前進手套影格 (F{gloveFrame}) 需大於出手影格 (F{releaseFrame})，以計算飛行時間推算初速。
                  </p>
                ) : !hasAnalyzed && !isAnalyzing ? (
                  <p className="text-[11px] text-emerald-400/90 text-center bg-emerald-950/20 border border-emerald-500/20 rounded-lg py-1 px-2 font-medium">
                    ✨ 影格設定完畢 (出手 F{releaseFrame} ｜ 進手套 F{gloveFrame})，點擊啟動球路追蹤與位移反查分析。
                  </p>
                ) : null}

                {/* 逐格分析即時進度條與步階說明 */}
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

              {/* 7. 實測初速推算說明條 */}
              <div className="text-[11.5px] text-slate-400 bg-slate-950/80 px-3 py-2 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                {hasAnalyzed ? (
                  <>
                    <span>
                      實測初速推算：({biometrics.effectiveTravelDistanceM}m / {flightSeconds}s) × 3.6 ={' '}
                      <strong className="text-cyan-400 font-mono text-xs">{velocityKmh} km/h</strong>
                    </span>
                    <span className="text-emerald-400 font-mono flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> Perspective / Scale Calibrated Estimate ➔ 同球種位移反查完成
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-slate-400">
                      實測初速推算：依有效飛行距離 ({biometrics.effectiveTravelDistanceM}m / 實測飛行秒數) 計算 [VIDEO DERIVED]
                    </span>
                    <span className="text-slate-500 font-mono">
                      影格間隔: {flightFrames > 0 ? `${flightFrames} 幀` : '--'} • 總影格: {totalVideoFrames > 0 ? `${totalVideoFrames} 幀` : '--'}
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

              {rightColumnTab === 'metrics' ? (
                <MetricsPanel
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
