import { CameraGeometry } from './services/cameraGeometry';
import { inferActiveSpin, measureConditionedMovement, forwardProjectedModel } from './services/conditionedPhysics';
import {
  PitchRecord,
  MatchResult,
  CameraViewMode,
  VelocityMatchModuleResult,
  SpinMovementMatchModuleResult,
  SpatialCalibrationInfo,
  TrajectoryPoint,
  PitcherBiometrics,
  DatabaseMatchCandidate,
  BaseballTrackPoint,
  VideoTrackMetrics,
  UnifiedConfidenceScores,
  AnalysisBasisInfo
} from './types';
import pitchDatabaseRaw from './pitchDatabase.json';
import {
  calibrate3DSpatialContext,
  alignAndStandardizeVideoSpatialContext,
  reconstructPhysicsModelTrack,
  STANDARD_GLOVE_DISTANCE_METERS,
  DEFAULT_PITCHER_BIOMETRICS
} from './spatialCalibration';
import { calculateUnifiedConfidence } from './confidenceEngine';
import { PhysicsMeasurementEngine } from './services/physicsMeasurementEngine';
import { MovementDatabaseMatcher } from './services/movementDatabaseMatcher';
import { SpinInferenceEngine } from './services/spinInferenceEngine';
import { TrajectoryFitEngine } from './services/trajectoryFitEngine';

/* 
 * Spin Rate / Spin Axis are inferred from pitch-type constrained velocity + observed movement + database reference matching, 
 * with release-angle correction and trajectory-fit validation. 
 * They are not directly measured from ordinary video unless explicit visual spin evidence is available. 
 */

export const PITCH_DATABASE: PitchRecord[] = (pitchDatabaseRaw as any[]).map((r) => ({
  ...r,
  source_type: r.source_type || 'synthetic',
  source_label: r.source_label || 'PitchVision Synthetic Physics Reference Dataset (Synthetic Physics Prior)',
  quality_score: r.quality_score || 80
}));

export const PITCH_TYPE_OPTIONS = [
  "🤖 AI 全數據庫自動辨識",
  "四縫線直球 (Fastball)",
  "二縫線/伸卡球 (Sinker)",
  "卡特球 (Cutter)",
  "滑球 (Slider)",
  "橫掃球 (Sweeper)",
  "曲球 (Curveball)",
  "彈指曲球 (Knuckle Curve)",
  "變速球 (Changeup)",
  "指叉球 (Splitter)"
];

export const STANDARD_DISTANCE_METERS = 17.5; // 標準出手點至捕手進手套距離 17.5 公尺

export interface FrameDetectionResult {
  status?: 'SUCCESS' | 'LOW_CONFIDENCE' | 'AUTO_DETECTION_FAILED' | 'REFERENCE_ESTIMATE';
  releaseFrame: number;
  gloveFrame: number;
  confidence: number;
  method: string;
  dbBaselineFrames: number;
  aiCorrectionFrames: number;
  stepDetails?: string[];
  warnings?: string[];
}

/**
 * 依綜合特徵距離排序並取得最相似的資料庫樣本 (委託 MovementDatabaseMatcher 嚴格執行球種過濾)
 * 嚴格原則：Similarity 為特徵相似度 (0~100)，不代表統計準確率
 */
export function getTopDatabaseCandidates(
  targetVelocity: number,
  selectedPitchType: string = "🤖 AI 全數據庫自動辨識",
  cameraView: CameraViewMode = 'catcher',
  db: PitchRecord[] = PITCH_DATABASE,
  limit: number = 3
): DatabaseMatchCandidate[] {
  const matchResult = MovementDatabaseMatcher.matchCandidates({
    observedVelocityKmh: targetVelocity,
    observedIvbInch: 15.0,
    observedHbInch: 0.0,
    selectedPitchType,
    cameraView,
    db,
    config: { topNCandidates: limit }
  });
  return matchResult.candidates;
}

export function formatClockTime(decimalHours: number): string {
  let normalized = decimalHours;
  while (normalized > 12.5) normalized -= 12.0;
  while (normalized < 0.5) normalized += 12.0;
  let h = Math.floor(normalized);
  let m = Math.round((normalized - h) * 60);
  if (m >= 60) {
    h += 1;
    m -= 60;
  }
  if (h === 0) h = 12;
  if (h > 12) h -= 12;
  return `${h}:${m < 10 ? '0' : ''}${m}`;
}

/**
 * 參考時間軸初始區間估計 (Reference Estimate)
 * 注意：此函式僅作為未執行電腦視覺掃描前的資料庫參考估計 (Reference Estimate)，絕不可冒充為 AI 視覺偵測結果。
 * 真正的 AI 視覺偵測由 AutoFrameDetectionEngine.detectReleaseAndGloveFrames() 負責。
 */
export function analyzePitchFramesFrameByFrame(
  totalFrames: number,
  fps: number = 30,
  selectedPitchType: string = "🤖 AI 全數據庫自動辨識",
  cameraView: CameraViewMode = 'catcher'
): FrameDetectionResult {
  const safeFps = fps > 0 ? fps : 30;
  let targetRecords = PITCH_DATABASE.filter(r => r.camera_view === cameraView);
  if (targetRecords.length === 0) targetRecords = PITCH_DATABASE;

  if (selectedPitchType && selectedPitchType !== "🤖 AI 全數據庫自動辨識") {
    const matched = targetRecords.filter(r => r.pitch_type.includes(selectedPitchType) || selectedPitchType.includes(r.pitch_type));
    if (matched.length > 0) targetRecords = matched;
  }

  const avgDbFlightSec = targetRecords.reduce((acc, cur) => acc + cur.flight_time_sec, 0) / targetRecords.length;
  const dbBaselineFrames = Math.max(5, Math.round(safeFps * avgDbFlightSec));

  const estRelease = Math.min(Math.round(totalFrames * 0.25), Math.max(3, Math.round(safeFps * 0.35)));
  const estGlove = Math.min(totalFrames - 1, estRelease + dbBaselineFrames);

  return {
    status: 'REFERENCE_ESTIMATE',
    releaseFrame: estRelease,
    gloveFrame: estGlove,
    confidence: 55.0,
    method: 'Reference Estimate (基於時間軸與 Synthetic Physics Prior 之初始參考區間)',
    dbBaselineFrames,
    aiCorrectionFrames: 0,
    stepDetails: [
      `【Reference Estimate】依據探測幀率 ${safeFps.toFixed(1)} FPS 換算參考飛行影格數: ${dbBaselineFrames} 幀 (${avgDbFlightSec.toFixed(3)}s)`,
      `【提示】可點擊「AI 自動搜尋出手 / 進手套」啟動真實影片視覺掃描，或直接手動微調影格`
    ]
  };
}

/**
 * 計算球速與飛行秒數 (優先使用 timestamps[] 真實時間戳，其次使用 frame / actualFps)
 */
export function calculateVelocity(
  releaseFrame: number,
  gloveFrame: number,
  fps: number = 30,
  distanceMeters: number = STANDARD_GLOVE_DISTANCE_METERS,
  timestamps?: number[]
): { velocityKmh: number; flightSeconds: number; flightFrames: number } {
  const safeFps = fps > 0 ? fps : 30;
  const flightFrames = Math.max(1, gloveFrame - releaseFrame);
  let flightSeconds = flightFrames / safeFps;

  if (
    timestamps &&
    timestamps.length > gloveFrame &&
    timestamps[releaseFrame] !== undefined &&
    timestamps[gloveFrame] !== undefined &&
    timestamps[gloveFrame] > timestamps[releaseFrame]
  ) {
    const dt = timestamps[gloveFrame] - timestamps[releaseFrame];
    if (Number.isFinite(dt) && dt > 0) {
      flightSeconds = dt;
    }
  }

  const velocityMs = distanceMeters / flightSeconds;
  const velocityKmh = Number((velocityMs * 3.6).toFixed(1));
  return {
    velocityKmh,
    flightSeconds,
    flightFrames
  };
}

/**
 * 獨立模組 1: 球速估算比對模組 (Velocity Matching Module)
 */
export function matchVelocityModule(
  queryVelocity: number,
  queryFlightTime: number,
  selectedPitchType: string = "🤖 AI 全數據庫自動辨識",
  cameraView: CameraViewMode = 'catcher',
  db: PitchRecord[] = PITCH_DATABASE
): VelocityMatchModuleResult {
  let filteredDb = db.filter(d => !d.camera_view || d.camera_view === cameraView);
  if (filteredDb.length === 0) filteredDb = db;

  if (selectedPitchType && selectedPitchType !== "🤖 AI 全數據庫自動辨識") {
    const pitchFiltered = filteredDb.filter(
      (d) => d.pitch_type.includes(selectedPitchType) || selectedPitchType.includes(d.pitch_type)
    );
    if (pitchFiltered.length > 0) filteredDb = pitchFiltered;
  }

  const vMin = 70.0;
  const vMax = 155.0;
  const tMin = 0.35;
  const tMax = 0.85;

  const normQV = Math.max(0, Math.min(1, (queryVelocity - vMin) / (vMax - vMin)));
  const normQT = Math.max(0, Math.min(1, (queryFlightTime - tMin) / (tMax - tMin)));

  let bestMatch = filteredDb[0] || db[0];
  let minDistance = Infinity;

  for (const item of filteredDb) {
    const normDbV = Math.max(0, Math.min(1, (item.velocity_kmh - vMin) / (vMax - vMin)));
    const normDbT = Math.max(0, Math.min(1, (item.flight_time_sec - tMin) / (tMax - tMin)));

    const dist = Math.sqrt(
      0.75 * Math.pow(normQV - normDbV, 2) +
      0.25 * Math.pow(normQT - normDbT, 2)
    );

    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = item;
    }
  }

  const velocitySim = Number(
    (Math.max(25.0, Math.min(95.0, (1 - minDistance * 0.8) * 100))).toFixed(1)
  );

  return {
    matched_record: bestMatch,
    db_baseline_velocity: bestMatch.velocity_kmh,
    measured_velocity: queryVelocity,
    velocity_similarity: velocitySim,
    flight_time_sec: queryFlightTime,
    flight_frames: Math.max(1, Math.round(queryFlightTime * 30))
  };
}

/**
 * @deprecated LEGACY MODULE - 僅供向下相容保留，不再參與正式 RPM / Spin Axis 推論。
 * 正式版本之 RPM 與 Spin Axis 唯一權威來源為 MovementDatabaseMatcher + SpinInferenceEngine。
 */
export function matchSpinMovementModule(
  queryVelocity: number,
  selectedPitchType: string = "🤖 AI 全數據庫自動辨識",
  cameraView: CameraViewMode = 'catcher',
  db: PitchRecord[] = PITCH_DATABASE
): SpinMovementMatchModuleResult {
  let filteredDb = db.filter(d => !d.camera_view || d.camera_view === cameraView);
  if (filteredDb.length === 0) filteredDb = db;

  if (selectedPitchType && selectedPitchType !== "🤖 AI 全數據庫自動辨識") {
    const pitchFiltered = filteredDb.filter(
      (d) => d.pitch_type.includes(selectedPitchType) || selectedPitchType.includes(d.pitch_type)
    );
    if (pitchFiltered.length > 0) filteredDb = pitchFiltered;
  }

  const bestSpinRecord = filteredDb[0] || db[0];

  return {
    matched_record: bestSpinRecord,
    db_baseline_spin: bestSpinRecord.spin_rate_rpm,
    db_baseline_axis: bestSpinRecord.spin_axis,
    db_baseline_axis_decimal: bestSpinRecord.spin_axis_decimal,
    db_baseline_efficiency: bestSpinRecord.spin_efficiency_pct,
    db_baseline_ivb: bestSpinRecord.ivb_inch,
    db_baseline_hb: bestSpinRecord.hb_inch,
    spin_similarity: 75.0
  };
}

/**
 * 權威核心管線：「觀測位移反查轉速與轉軸 + 物理重建閉環驗證」 (Movement-Inferred Pipeline)
 * 流程：
 * 觀測物理量測 (Velocity + IVB/HB) -> 球種第一級過濾 (Strict Mode) -> 動態速度窗口 -> 多維位移比對 ->
 * Top-N 候選加權內插 & 圓周轉軸平均 -> 出手角微調 -> 獨立物理重建 (Gravity + Drag + Magnus) -> VIDEO TRACK vs MODEL TRACK 擬合驗證
 */
export function calibrateWithAIVisual(
  velModuleResult: VelocityMatchModuleResult,
  spinModuleResult: SpinMovementMatchModuleResult,
  cameraView: CameraViewMode = 'catcher',
  releaseFrame: number = 24,
  gloveFrame: number = 66,
  spatialCalibInfo?: SpatialCalibrationInfo,
  biometrics?: PitcherBiometrics,
  videoTrack?: BaseballTrackPoint[],
  videoMetrics?: VideoTrackMetrics,
  confidenceScores?: UnifiedConfidenceScores,
  fps: number = 30,
  timestamps?: number[],
  selectedPitchType: string = "🤖 AI 全數據庫自動辨識",
  db: PitchRecord[] = PITCH_DATABASE,
  strictPitchTypeMode: boolean = true,
  allowCrossTypeFallback: boolean = false,
  isManualAnchorUsed: boolean = false,
  autoDetectionConfidence?: number
): MatchResult {
  const { matched_record: velRec, measured_velocity } = velModuleResult;
  const bio = spatialCalibInfo?.biometrics || biometrics || DEFAULT_PITCHER_BIOMETRICS;
  const spatialCalib = spatialCalibInfo || calibrate3DSpatialContext(releaseFrame, gloveFrame, cameraView, velRec.pitch_type, bio);

  // ===========================================================================
  // STEP 1: 實測物理運動量測 (Physics Measurement Engine)
  // ===========================================================================
  const observedPhysics = PhysicsMeasurementEngine.measureObservedPhysics({
    videoTrack: videoTrack || [],
    releaseFrame,
    gloveFrame,
    actualFps: fps,
    cameraView,
    spatialCalibration: spatialCalib,
    videoMetrics,
    videoWidth: spatialCalib.camera_geometry?.width || 720,
    videoHeight: spatialCalib.camera_geometry?.height || 1280,
    timestamps
  });

  const effectiveVelocity = observedPhysics.measured_velocity_kmh || measured_velocity;
  const effectiveFlightSec = observedPhysics.flight_time_sec;
  const observedIvb = observedPhysics.observed_ivb_inch;
  const observedHb = observedPhysics.observed_hb_inch;

  // ===========================================================================
  // STEP 2: 球種第一級過濾 + 速度窗口 + 多維位移比對 (Movement Database Matcher)
  // ===========================================================================
  const matcherResult = MovementDatabaseMatcher.matchCandidates({
    observedVelocityKmh: effectiveVelocity,
    observedIvbInch: observedIvb,
    observedHbInch: observedHb,
    selectedPitchType,
    cameraView,
    db,
    strictPitchTypeMode,
    allowCrossTypeFallback
  });

  const candidates = matcherResult.candidates;
  const primaryCandidate = candidates[0] || spinModuleResult.matched_record;

  // ===========================================================================
  // STEP 3: 循環加權內插與出手角修正 (Spin Inference Engine - 唯一權威來源)
  // ===========================================================================
  const spinInference = SpinInferenceEngine.inferSpinParameters({
    candidates,
    observedReleaseAngleDeg: observedPhysics.observed_release_angle_deg,
    isReleaseAngleEstimated: observedPhysics.is_release_angle_estimated,
    referenceReleaseAngleDeg: spatialCalib.arm_slot_angle_deg || 54.0,
    movementUncertaintyInch: observedPhysics.movement_uncertainty_inch,
    velocityUncertaintyKmh: observedPhysics.velocity_uncertainty_kmh
  });

  let finalSpin = spinInference.finalSpinRateRpm;
  let finalSpinAxis = spinInference.finalSpinAxis;
  let finalAxisDecimal = spinInference.finalSpinAxisDecimal;
  const finalEfficiency = spinInference.inferredEfficiencyPct;

  let conditioned: ReturnType<typeof measureConditionedMovement> | null=null;
  if(observedPhysics.movement_valid && spatialCalib.camera_geometry?.method==='planar_reference') {
    conditioned=measureConditionedMovement(videoTrack||[],spatialCalib.camera_geometry,timestamps?.[releaseFrame]??releaseFrame/fps,effectiveFlightSec,spatialCalib.effective_travel_distance_m);
    const physical=inferActiveSpin(conditioned.ax,conditioned.ay,effectiveVelocity,finalEfficiency);
    const accelerationError=conditioned.uncertainty*0.0254*2/(effectiveFlightSec*effectiveFlightSec);
    if(physical && Math.hypot(conditioned.ax,conditioned.ay)>2*accelerationError){finalSpin=Math.round(physical.rpm/10)*10;finalAxisDecimal=physical.axisDecimal;finalSpinAxis=formatClockTime(finalAxisDecimal);
      spinInference.uncertainty.spin_rate_range='Efficiency先驗條件下的RPM；總RPM不可唯一解';
      spinInference.uncertainty.uncertainty_basis=physical.basis+'；'+conditioned.basis;
      const axisMinutes=Math.atan2(accelerationError,Math.hypot(conditioned.ax,conditioned.ay))*360/Math.PI;
      spinInference.uncertainty.spin_axis_range=`±${axisMinutes.toFixed(1)}時鐘分鐘（殘差/像素敏感度，非完整信賴區間）`;
      spinInference.uncertainty.ivb_range=spinInference.uncertainty.hb_range=`±${conditioned.uncertainty.toFixed(1)}吋（合成敏感度）`;
    }else{conditioned=null;observedPhysics.movement_valid=false;observedPhysics.details.push('Magnus合力超出既有CL模型適用範圍，保留先驗反推並降低信心');}
  }
  // ===========================================================================
  // STEP 4: 真正的物理重建 (Physics Reconstruction: Gravity + Drag + Magnus)
  // 由 Velocity + Inferred RPM + Inferred Spin Axis + Release Angle 獨立積分生成 MODEL TRACK
  // 絕不直接拿 observedIvb / observedHb 當作 MODEL TRACK 的答案！
  // ===========================================================================
  const activeVideoTrack = (videoTrack || []).filter(
    (pt) => pt.frame >= releaseFrame && pt.frame <= gloveFrame
  );

  const startAnchorNorm =
    activeVideoTrack.length >= 2
      ? { x_norm: activeVideoTrack[0].x_norm, y_norm: activeVideoTrack[0].y_norm }
      : undefined;
  const endAnchorNorm =
    activeVideoTrack.length >= 2
      ? {
          x_norm: activeVideoTrack[activeVideoTrack.length - 1].x_norm,
          y_norm: activeVideoTrack[activeVideoTrack.length - 1].y_norm
        }
      : undefined;

  let {
    modelTrack,
    reconstructedIvbInch,
    reconstructedHbInch
  } = reconstructPhysicsModelTrack({
    releaseFrame,
    gloveFrame,
    cameraView,
    spatialCalibration: spatialCalib,
    velocityKmh: effectiveVelocity,
    spinRateRpm: finalSpin,
    spinAxisDecimal: finalAxisDecimal,
    spinEfficiencyPct: finalEfficiency,
    releaseAngleDeg: observedPhysics.observed_release_angle_deg,
    fps,
    timestamps,
    startAnchorNorm,
    endAnchorNorm
  });

  if(conditioned && spatialCalib.camera_geometry){const forward=forwardProjectedModel(spatialCalib.camera_geometry,conditioned,spatialCalib.effective_travel_distance_m,effectiveFlightSec,finalSpin,finalAxisDecimal,finalEfficiency,releaseFrame,gloveFrame,fps,timestamps);modelTrack=forward.modelTrack;reconstructedIvbInch=forward.reconstructedIvbInch;reconstructedHbInch=forward.reconstructedHbInch;}
  // ===========================================================================
  // STEP 5: 前向閉環驗證 (Forward Validation: VIDEO TRACK vs PHYSICS MODEL TRACK)
  // ===========================================================================
  const trajectoryFit = TrajectoryFitEngine.evaluateTrajectoryFit({
    videoTrack: activeVideoTrack,
    modelTrack,
    videoWidth: spatialCalib.camera_geometry?.width || 720,
    videoHeight: spatialCalib.camera_geometry?.height || 1280
  });

  // 計算綜合特徵相似度與候選平均物理一致性
  const avgSimilarity = candidates.length > 0
    ? Number((candidates.reduce((sum, c) => sum + c.similarity_score, 0) / candidates.length).toFixed(1))
    : 45.0;
  const avgPhysicsConsistency = candidates.length > 0
    ? Number((candidates.reduce((sum, c) => sum + (c.physics_consistency_score ?? 85), 0) / candidates.length).toFixed(1))
    : 65.0;
  const rpmDiffs = candidates.map((c) => Math.abs(c.spin_rate_rpm - spinInference.baseSpinRateRpm));
  const candidateSpreadRpm = rpmDiffs.length > 0 ? Math.max(...rpmDiffs) : 150;

  // 多維動態信賴評估引擎 (12 項指標動態結算)
  const confScores = calculateUnifiedConfidence({
    fps,
    totalVideoFrames: gloveFrame + 10,
    releaseFrame,
    gloveFrame,
    isUserConfirmedFrames: true,
    isManualAnchorUsed,
    autoDetectionConfidence,
    videoMetrics,
    dbSimilarityScore: avgSimilarity,
    candidateSpreadRpm,
    trajectoryFitScore: trajectoryFit.fit_score,
    trajectoryRmsePx: trajectoryFit.rmse_px,
    movementUncertaintyInch: observedPhysics.movement_uncertainty_inch,
    velocityUncertaintyKmh: observedPhysics.velocity_uncertainty_kmh,
    isCrossTypeFallback: matcherResult.isCrossTypeFallback,
    isInsufficientPitchTypeData: matcherResult.isInsufficientPitchTypeData,
    physicsConsistencyScore: avgPhysicsConsistency,
    isReleaseAngleEstimated: observedPhysics.is_release_angle_estimated,
    cameraCalibrationQuality: (spatialCalib.camera_geometry?.quality || 0.2) * 100
  });

  // ===========================================================================
  // STEP 6: 組裝 Analysis Basis 與最終結果
  // ===========================================================================
  if(!observedPhysics.movement_valid){confScores.movement_confidence=Math.min(confScores.movement_confidence||0,35);confScores.spin_confidence=Math.min(confScores.spin_confidence||0,30);confScores.overall_confidence=Math.min(confScores.overall_confidence,40);confScores.quality_notes.push(observedPhysics.movement_limitation||"幾何約束不足");}
  if(spatialCalib.camera_geometry?.method!=='planar_reference'){confScores.velocity_confidence=Math.min(confScores.velocity_confidence||0,50);confScores.quality_notes.push('距離為身高/跨步先驗推估，速度區間未含距離系統誤差。');}
  const hasRealTrack = Boolean(
    videoTrack &&
    videoTrack.filter(p=>p.source==='vision').length >= 4 &&
    videoMetrics?.tracking_quality_status === 'reliable'
  );

  const analysisBasis: AnalysisBasisInfo = {
    velocity: {
      source: 'VIDEO DERIVED',
      description: `影片選取時間差 ${effectiveFlightSec.toFixed(3)}s；距離 ${spatialCalib.effective_travel_distance_m}m (${spatialCalib.camera_geometry?.method==='planar_reference'?'使用者已知平面尺度':'身高/跨步先驗估算'})，時間敏感度不含距離誤差`
    },
    movement: {
      source: observedPhysics.movement_source,
      description: observedPhysics.movement_limitation || '需確認尺度與深度約束'
    },
    spin_rate: {
      source: conditioned?'PHYSICS-CONDITIONED SPIN / EFFICIENCY PRIOR':'DATABASE PRIOR / LEGACY MANUAL INFERENCE',
      description: `Pitch Type + Velocity (±${matcherResult.effectiveVelocityWindowKmh} km/h) + Movement Database Matching (Top ${candidates.length} weighted interpolation + Release Angle correction)`
    },
    spin_axis: {
      source: conditioned?'PHYSICS-CONDITIONED DIRECTION':'DATABASE PRIOR / LEGACY MANUAL INFERENCE',
      description: `Pitch Type + Movement Direction + Database Matching (Circular sin/cos weighted interpolation)`
    },
    release_angle: {
      source: observedPhysics.is_release_angle_estimated ? 'MODEL ESTIMATED' : 'VIDEO DERIVED',
      description: conditioned?'已知平面+深度假設下的初始速度方向，非唯一3D實測':observedPhysics.is_release_angle_estimated
        ? `影像初期觀測點不足，依投手生物力學與臂槽先驗 (${spatialCalib.arm_slot_name} ${observedPhysics.observed_release_angle_deg.toFixed(1)}°) 估算`
        : `由出手初段影像運動切線向量測量 (${observedPhysics.observed_release_angle_deg.toFixed(1)}°)`
    },
    database: {
      source: 'PitchVision Synthetic Physics Reference Dataset (Synthetic Physics Prior)',
      totalRecords: db.length,
      matchedTypeRecords: matcherResult.matchedRecordCount,
      velocityWindowKmh: matcherResult.effectiveVelocityWindowKmh,
      isCrossTypeFallback: matcherResult.isCrossTypeFallback,
      isInsufficientPitchTypeData: matcherResult.isInsufficientPitchTypeData
    },
    forward_validation: {
      source: 'PHYSICS RECONSTRUCTION (Gravity + Drag + Magnus)',
      description: `${trajectoryFit.summary} (物理重建位移: IVB ${reconstructedIvbInch >= 0 ? '+' : ''}${reconstructedIvbInch}", HB ${reconstructedHbInch >= 0 ? '+' : ''}${reconstructedHbInch}")`,
      fitQuality: trajectoryFit.fit_quality,
      fitScore: trajectoryFit.fit_score
    }
  };

  const whyExplanation: string[] = [
    `【球速 (Velocity)】: ${effectiveVelocity} km/h (${(effectiveVelocity * 0.621371).toFixed(1)} mph, 飛行 ${effectiveFlightSec.toFixed(3)}s) [VIDEO DERIVED]`,
    `【觀測位移 (Movement)】: IVB ${observedIvb >= 0 ? '+' : ''}${observedIvb}" / HB ${observedHb >= 0 ? '+' : ''}${observedHb}" [${observedPhysics.movement_source}]`,
    `【反推轉速 (Estimated Spin Rate)】: ≈ ${finalSpin} RPM (${spinInference.uncertainty.spin_rate_range})，由同球種速度窗口 (±${matcherResult.effectiveVelocityWindowKmh} km/h) 內 Top ${candidates.length} 筆樣本加權內插並經出手角微調 [MOVEMENT-INFERRED]`,
    `【反推轉軸 (Estimated Spin Axis)】: ≈ ${finalSpinAxis} (${spinInference.uncertainty.spin_axis_range})，經圓周向量平均 (Circular Interpolation) 推得 [MOVEMENT-INFERRED]`,
    `【物理重建閉環驗證 (Physics Reconstruction)】: 以 RPM ${finalSpin} + Axis ${finalSpinAxis} + Gravity + Drag + Magnus 生成 MODEL TRACK；${trajectoryFit.fit_quality==='NOT_VALIDATED'?'無足夠觀測，RMSE未驗證':`RMSE = ${trajectoryFit.rmse_px}px (${trajectoryFit.fit_quality})`}`,
    `【參考資料集 (Database Source)】: PitchVision Synthetic Physics Reference Dataset (Synthetic Physics Prior, 同球種候選 ${matcherResult.matchedRecordCount} 筆)`
  ];

  return {
    id: ('record_id' in primaryCandidate ? primaryCandidate.record_id : primaryCandidate.id) || 1,
    pitch_type: selectedPitchType !== "🤖 AI 全數據庫自動辨識" ? selectedPitchType : primaryCandidate.pitch_type,
    code: primaryCandidate.code || 'FF',
    camera_view: cameraView,
    standard_distance_m: spatialCalib.effective_travel_distance_m || STANDARD_GLOVE_DISTANCE_METERS,
    velocity_kmh: effectiveVelocity,
    spin_rate_rpm: finalSpin,
    spin_axis: finalSpinAxis,
    spin_axis_decimal: finalAxisDecimal,
    spin_efficiency_pct: finalEfficiency,
    ivb_inch: observedIvb,
    hb_inch: observedHb,
    vertical_break_cm: Number((observedIvb * 2.54).toFixed(1)),
    horizontal_break_cm: Number((observedHb * 2.54).toFixed(1)),
    matched_pitch_type: selectedPitchType !== "🤖 AI 全數據庫自動辨識" ? selectedPitchType : primaryCandidate.pitch_type,
    estimated_velocity_kmh: effectiveVelocity,
    similarity_score: Math.min(96.0, avgSimilarity),
    flight_time_sec: effectiveFlightSec,
    flight_frames: Math.max(1, gloveFrame - releaseFrame),
    release_frame: releaseFrame,
    glove_frame: gloveFrame,

    velocity_module: velModuleResult,
    spin_movement_module: spinModuleResult,

    db_baseline_velocity: primaryCandidate.velocity_kmh,
    ai_correction_velocity: Number((effectiveVelocity - primaryCandidate.velocity_kmh).toFixed(1)),
    db_baseline_spin: spinInference.baseSpinRateRpm,
    ai_correction_spin: conditioned?finalSpin-spinInference.baseSpinRateRpm:spinInference.rpmCorrectionApplied,
    spin_rate_calibration_reason: conditioned?'條件3D的Magnus合力約束有效RPM；總RPM使用Efficiency先驗，非唯一解':`Angle correction applied: 出手角 ${observedPhysics.observed_release_angle_deg.toFixed(1)}° 修正 ${spinInference.rpmCorrectionApplied >= 0 ? '+' : ''}${spinInference.rpmCorrectionApplied} RPM (主體由 Top ${candidates.length} 候選位移反查加權內插)`,

    db_baseline_axis: spinInference.baseSpinAxis,
    db_baseline_axis_decimal: spinInference.baseSpinAxisDecimal,
    ai_correction_axis_minutes: conditioned?Math.round((((finalAxisDecimal-spinInference.baseSpinAxisDecimal+18)%12)-6)*60):spinInference.axisCorrectionMinutesApplied,
    spin_axis_calibration_reason: conditioned?'條件重建的側向／垂直Magnus合力方向；深度、尺度與Efficiency假設仍有限制':`Angle correction applied: 出手角修正 ${spinInference.axisCorrectionMinutesApplied >= 0 ? '+' : ''}${spinInference.axisCorrectionMinutesApplied} 分鐘 (主體由圓周幾何平均推算)`,

    db_baseline_ivb: primaryCandidate.ivb_inch,
    ai_correction_ivb: Number((observedIvb - primaryCandidate.ivb_inch).toFixed(1)),
    db_baseline_hb: primaryCandidate.hb_inch,
    ai_correction_hb: Number((observedHb - primaryCandidate.hb_inch).toFixed(1)),
    calibration_notes: observedPhysics.movement_valid ? "已知平面+時間/深度條件估計；非唯一真實3D" : "未完成度量標定：保留原手動模型參考，IVB/HB與RPM/Axis不可視為實測。",
    spatial_calibration: spatialCalib,
    trajectory_points: modelTrack,
    top_candidates: candidates,

    // 雙軌徹底分開：VIDEO TRACK vs MODEL TRACK
    video_track: hasRealTrack ? (videoTrack || []) : [],
    model_track: modelTrack,
    video_metrics: videoMetrics,
    confidence_scores: confScores,

    // 嚴格落實數據來源標籤
    source_velocity: 'VIDEO DERIVED',
    source_rpm: conditioned?'MODEL ESTIMATED':'DATABASE ESTIMATED',
    source_spin_axis: conditioned?'MODEL ESTIMATED':'DATABASE ESTIMATED',
    source_spin_efficiency: 'DATABASE ESTIMATED',
    source_ivb: observedPhysics.movement_source,
    source_hb: observedPhysics.movement_source,

    first_reliable_ball_frame: videoMetrics?.first_seen_frame ?? releaseFrame,
    last_reliable_ball_frame: videoMetrics?.last_seen_frame ?? gloveFrame,
    catch_frame: gloveFrame,
    video_track_status: hasRealTrack ? 'VALID_TRACK' : 'INSUFFICIENT_EVIDENCE',

    // 新增模組結果
    observed_metrics: observedPhysics,
    trajectory_fit: trajectoryFit,
    uncertainty: spinInference.uncertainty,
    analysis_basis: analysisBasis,
    is_cross_type_fallback: matcherResult.isCrossTypeFallback,
    is_insufficient_pitch_type_data: matcherResult.isInsufficientPitchTypeData,
    strict_pitch_type_mode: strictPitchTypeMode,
    filtered_candidate_count: matcherResult.matchedRecordCount,
    effective_velocity_window_kmh: matcherResult.effectiveVelocityWindowKmh,
    reconstructed_ivb_inch: reconstructedIvbInch,
    reconstructed_hb_inch: reconstructedHbInch,

    evidence_summary: {
      videoEvidenceText: hasRealTrack
        ? `觀測到 ${videoTrack?.length || 0} 個實測影格，覆蓋率 ${videoMetrics?.tracking_ratio_pct || 0}%`
        : '實測視覺觀測點不足 (< 3 個獨立觀測點)，不偽造軌跡',
      databasePriorText: `比對 PitchVision Synthetic Physics Reference Dataset (Synthetic Physics Prior)，特徵相似度 ${avgSimilarity}%`,
      modelInferenceText: 'RPM、Spin Axis 由位移反查推估；MODEL TRACK 由 Gravity + Drag + Magnus 獨立物理重建並與 VIDEO TRACK 進行閉環驗證',
      overallEvidenceQuality: hasRealTrack && confScores.overall_confidence >= 70 ? 'High' : (hasRealTrack ? 'Medium' : 'Low'),
      whyExplanation
    }
  };
}

/**
 * 完整雙模組分開比對總入口函式
 */
export function matchPitchData(
  queryVelocity: number,
  queryFlightTime: number,
  selectedPitchType: string = "🤖 AI 全數據庫自動辨識",
  cameraView: CameraViewMode = 'catcher',
  db: PitchRecord[] = PITCH_DATABASE,
  releaseFrame: number = 24,
  gloveFrame: number = 66,
  biometrics: PitcherBiometrics = DEFAULT_PITCHER_BIOMETRICS,
  videoTrack?: BaseballTrackPoint[],
  videoMetrics?: VideoTrackMetrics,
  confidenceScores?: UnifiedConfidenceScores,
  fps: number = 30,
  timestamps?: number[],
  strictPitchTypeMode: boolean = true,
  allowCrossTypeFallback: boolean = false,
  isManualAnchorUsed: boolean = false,
  autoDetectionConfidence?: number,
  cameraGeometry?: CameraGeometry
): MatchResult {
  const spatialStandardization = alignAndStandardizeVideoSpatialContext(
    releaseFrame,
    gloveFrame,
    fps,
    cameraView,
    selectedPitchType,
    biometrics,
    timestamps,
    cameraGeometry
  );

  spatialStandardization.spatialCalibration.camera_geometry=cameraGeometry;
  if(cameraGeometry?.method==='planar_reference'){
    spatialStandardization.spatialCalibration.view_angle_azimuth_deg=cameraGeometry.azimuthDeg;
    spatialStandardization.spatialCalibration.view_angle_elevation_deg=cameraGeometry.elevationDeg;
    spatialStandardization.spatialCalibration.calibration_status='已知平面相機估計；離地球深度仍需假設';
  }
  const effectiveVelocity = spatialStandardization.standardizedVelocityKmh || queryVelocity;
  const effectiveFlightTime = spatialStandardization.standardizedFlightSec || queryFlightTime;

  const velModResult = matchVelocityModule(
    effectiveVelocity,
    effectiveFlightTime,
    selectedPitchType,
    cameraView,
    db
  );

  const spinModResult = matchSpinMovementModule(
    effectiveVelocity,
    selectedPitchType,
    cameraView,
    db
  );

  return calibrateWithAIVisual(
    velModResult,
    spinModResult,
    cameraView,
    releaseFrame,
    gloveFrame,
    spatialStandardization.spatialCalibration,
    biometrics,
    videoTrack,
    videoMetrics,
    confidenceScores,
    fps,
    timestamps,
    selectedPitchType,
    db,
    strictPitchTypeMode,
    allowCrossTypeFallback,
    isManualAnchorUsed,
    autoDetectionConfidence
  );
}

