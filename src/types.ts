/**
 * PitchVision Unified Types
 * 嚴格區分三種資料屬性：
 * A. VIDEO EVIDENCE (VIDEO MEASURED / VIDEO DERIVED)
 * B. DATABASE PRIOR (Synthetic Reference Dataset / Public Video / Real Measurement)
 * C. MODEL INFERENCE (DATABASE ESTIMATED / MODEL ESTIMATED)
 */

export type CameraViewMode = 'catcher' | 'pitcher_rear';

// 初始設置：投手環境與生物力學參數
export interface PitcherBiometrics {
  hasMound: boolean; // 是否有投手丘 (true: 標準10吋/25.4cm, false: 平地/室內牛棚 0cm)
  pitcherHeightCm: number; // 投手身高 (cm, 例如 178cm)
  strideOption: 'ai_auto' | 'manual'; // 跨步距離選項：AI 自動推算 或 手動輸入
  manualStrideDistanceCm?: number; // 選填自訂跨步距離 (cm)
  effectiveStrideDistanceCm: number; // 實際帶入計算之跨步距離 (cm, 例如 146cm)
  strideRatioPct: number; // 跨步佔身高比例 (例如 82.0%)
  calculatedExtensionM: number; // 換算出之出手延伸量 (m, 例如 1.84m)
  effectiveTravelDistanceM: number; // 出手點至捕手進手套之實測有效距離 (m, 例如 17.5m)
}

// 空間距離設置
export interface PitchDistanceConfig {
  standardMoundToPlateM: number; // 18.44m (60 ft 6 in)
  standardReleaseToGloveM: number; // 17.5m
  calibratedDistanceM: number;
  userDefinedDistanceM?: number;
  isCalibrated: boolean;
  distanceType: 'standard_mound' | 'camera_calibrated' | 'user_defined';
}

// 影格解碼與時間戳結構 (FrameDecoder)
export interface DecodedVideoFrame {
  frameIndex: number;
  timestamp: number; // 精確秒數 (以 video.currentTime / requestVideoFrameCallback 為準)
  imageData?: ImageData | null;
  width?: number;
  height?: number;
}

// 影片時序分析 (VideoTiming)
export interface VideoTiming {
  actualFps: number;
  fpsSource: 'measured_rvfc' | 'container_metadata' | 'container_timestamps' | 'user_supplied' | 'estimated';
  averageFps?: number;
  containerFps?: number;
  timingReliable?: boolean;
  timingWarning?: string;
  seekPrecision?: string;
  totalFrames: number;
  durationSec: number;
  isVFR: boolean; // Variable Frame Rate
  timeBase: 'timestamp' | 'fps_derived';
  timestamps: number[]; // 逐影格時間戳 (若可用)
}

// 影片品質評估 (VideoQuality)
export interface VideoQuality {
  fps: number;
  resolution: string;
  isResolutionAdequate: boolean;
  motionBlurRisk: 'low' | 'moderate' | 'high' | 'severe';
  exposureQuality: 'good' | 'underexposed' | 'overexposed' | 'fair';
  cameraStabilityScore: number; // 0 ~ 100
  expectedBallPixelSize: number; // 2 ~ 14 px
  backgroundComplexity: 'clean' | 'moderate' | 'cluttered_net' | 'stadium_crowd';
  qualityScore: number; // 0 ~ 100
  warnings: string[];
}

// 出手點證據與候選
export interface ReleaseCandidate {
  frame: number;
  timestamp: number;
  confidence: number;
  evidence: {
    ballEmergence: number; // 0.0 ~ 1.0
    handSeparation: number; // 0.0 ~ 1.0
    motionChange: number; // 0.0 ~ 1.0
    temporalConsistency: number; // 0.0 ~ 1.0
  };
  reason: string;
}

// 棒球候選點 (BallCandidate) - 統一候選評分
export interface BallCandidate {
  frame: number;
  timestamp: number;
  x: number; // 像素座標
  y: number;
  x_norm: number; // 0.0 ~ 1.0
  y_norm: number;
  radius: number;
  width: number;
  height: number;
  score: number; // 綜合 candidate score (0 ~ 1.0)
  components: {
    appearanceScore: number;
    motionScore: number;
    temporalScore: number;
    spatialScore: number;
    sizeScore: number;
    continuityScore: number;
    backgroundPenalty: number;
    jumpPenalty: number;
  };
  isOutlier?: boolean;
}

// 棒球真實觀測點 (BallObservation)
export interface BallObservation {
  frame: number;
  timestamp: number;
  x: number; // 像素座標
  y: number; // 像素座標
  x_norm: number; // 0.0 ~ 1.0
  y_norm: number; // 0.0 ~ 1.0
  radius: number;
  confidence: number; // 0.0 ~ 1.0
  source: 'observation' | 'manual_anchor' | 'interpolated';
  is_outlier?: boolean;
  blur_detected?: boolean;
  motion_score?: number;
  cluster_size?: number;
  dx?: number;
  dy?: number;
}

// 追蹤軌跡點 (BaseballTrackPoint)
export interface BaseballTrackPoint {
  frame: number;
  timestamp: number;
  x: number;
  y: number;
  x_norm: number;
  y_norm: number;
  radius: number;
  confidence: number;
  source: 'vision' | 'interpolated';
  is_outlier?: boolean;
  blur_detected?: boolean;
}

// 追蹤狀態
export type TrackStatus =
  | 'NOT_STARTED'
  | 'SEARCHING'
  | 'TRACKING'
  | 'PARTIAL_TRACK'
  | 'VALID_TRACK'
  | 'TRACK_LOST'
  | 'INSUFFICIENT_EVIDENCE';

// 影片真實量測特徵
export interface VideoTrackMetrics {
  horizontal_movement_2d_norm: number;
  vertical_movement_2d_norm: number;
  total_movement_2d_norm: number;
  horizontal_movement_2d_px: number;
  vertical_movement_2d_px: number;
  total_movement_2d_px: number;
  trajectory_curvature_score: number;
  vision_detected_frames_count: number;
  interpolated_frames_count: number;
  tracking_ratio_pct: number;
  tracking_quality_status: 'reliable' | 'insufficient' | 'degraded';
  first_seen_frame?: number;
  last_seen_frame?: number;
  visible_end_frame?: number;
  is_manual_anchored?: boolean;
  mean_observation_confidence?: number;
  forward_backward_agreement_pct?: number;
}

// 軌跡驗證結果
export interface TrajectoryValidation {
  status: 'valid' | 'insufficient_evidence';
  failureReason?: string;
  realObservationCount: number;
  interpolatedCount: number;
  outlierCount: number;
  meanConfidence: number;
  maxGapFrames: number;
  forwardBackwardAgreementPct: number;
  firstReliableBallFrame: number | null;
  lastReliableBallFrame: number | null;
  catchFrame: number | null;
}

// 數據庫單筆紀錄 (Database Record with Provenance)
export interface PitchRecord {
  physical_id?: string;
  id: number;
  pitch_type: string;
  code: string;
  velocity_kmh: number;
  spin_rate_rpm: number;
  spin_axis: string;
  spin_axis_decimal: number;
  spin_efficiency_pct: number;
  ivb_inch: number;
  hb_inch: number;
  vertical_break_cm?: number;
  horizontal_break_cm?: number;
  flight_time_sec: number;
  standard_distance_m: number;
  camera_view?: CameraViewMode;
  release_frame?: number;
  glove_frame?: number;
  flight_frames?: number;
  trajectory_frames?: DatabaseFrameTrajectoryPoint[];

  // 數據來源與溯源 (Provenance)
  source_type?: 'real_measurement' | 'synthetic' | 'public_video' | 'mixed';
  source_label?: string;
  source_url?: string;
  provenance?: string;
  quality_score?: number;
  pitcher_hand?: 'RHP' | 'LHP';
}

export interface DatabaseFrameTrajectoryPoint {
  frame: number;
  rel_frame: number;
  t_sec: number;
  z_m: number;
  x_cm: number;
  y_cm: number;
  x_norm: number;
  y_norm: number;
  v_kmh: number;
  spin_rpm: number;
}

// 數據庫匹配候選
export interface DatabaseMatchCandidate {
  physical_id?: string;
  rank: number;
  pitch_type: string;
  code: string;
  similarity_score: number; // 0 ~ 100 (特徵相似度，非準確率)
  velocity_kmh: number;
  velocity_similarity: number;
  spin_rate_rpm: number;
  spin_axis: string;
  spin_axis_decimal: number;
  spin_efficiency_pct: number;
  ivb_inch: number;
  hb_inch: number;
  record_id: number;
  source_type?: string;
  source_label?: string;
  velocity_error?: number;
  movement_error?: number;
  total_error?: number;
  physics_consistency_score?: number;
  interpolation_weight?: number;
}

// 獨立模組比對結果
export interface VelocityMatchModuleResult {
  matched_record: PitchRecord;
  db_baseline_velocity: number;
  measured_velocity: number;
  velocity_similarity: number;
  flight_time_sec: number;
  flight_frames: number;
}

export interface SpinMovementMatchModuleResult {
  matched_record: PitchRecord;
  db_baseline_spin: number;
  db_baseline_axis: string;
  db_baseline_axis_decimal: number;
  db_baseline_efficiency: number;
  db_baseline_ivb: number;
  db_baseline_hb: number;
  spin_similarity: number;
}

// 3D 空間校正結構
export interface SpatialCalibrationInfo {
  camera_geometry?: import('./services/cameraGeometry').CameraGeometry;
  biometrics?: PitcherBiometrics;
  mound_height_cm: number;
  detected_pitcher_side: 'RHP' | 'LHP';
  arm_slot_angle_deg: number;
  arm_slot_name: string;
  mound_stance_offset_cm: number;
  release_height_cm: number;
  release_side_cm: number;
  release_extension_m: number;
  effective_travel_distance_m: number;
  downward_slope_deg: number;
  perspective_homography_factor: number;
  view_angle_azimuth_deg: number;
  view_angle_elevation_deg: number;
  view_alignment_status: string;
  homography_matrix_3x3?: number[][];
  calibration_status: string;
  is_aligned_to_database: boolean;
  is_true_homography?: boolean;
}

// 物理模型軌跡點 (MODEL TRACK)
export interface TrajectoryPoint {
  frame: number;
  timestamp_sec?: number;
  x_norm: number;
  y_norm: number;
  radius: number;
  depth_z: number;
  world_x_cm: number;
  world_y_cm: number;
  confidence: number;
  source: 'vision' | 'interpolated' | 'model';
  is_outlier?: boolean;
}

// 手動雙錨點定義 (Manual Anchor Mode)
export interface ManualAnchorInput {
  point1: {
    frame: number;
    x_norm: number;
    y_norm: number;
  };
  point2: {
    frame: number;
    x_norm: number;
    y_norm: number;
  };
}

// 統一可信度系統指標
export interface UnifiedConfidenceScores {
  video_quality_confidence: number;
  release_frame_confidence: number;
  catch_frame_confidence: number;
  baseball_tracking_confidence: number;
  trajectory_confidence: number;
  database_match_confidence: number;
  velocity_confidence?: number;
  movement_confidence?: number;
  spin_confidence?: number;
  trajectory_fit_confidence?: number;
  overall_confidence: number; // 綜合品質指標 (非統計機率)
  quality_notes: string[];
}

// 綜合匹配輸出結果 (MatchResult)
export interface MatchResult extends PitchRecord {
  physical_id?:string;
  projection_match?:{used:boolean;rmse_px?:number;pool_count:number;geometry_method?:string;reason?:string;observation_count?:number;rpm_distinguishable?:boolean;ambiguity_count?:number};
  visual_observations?:BaseballTrackPoint[];
  tracking_evidence?:{sourceFrames:number;attemptedFrames:number;verifiedFrames:number;unverifiedFrames:number;observationCount:number;excludedFrames:number;trackFound:boolean;trackReliable:boolean;reason:string};
  movement_definition?:string;
  raw_database_movement?:{ivb_inch:number;hb_inch:number};
  matched_pitch_type: string;
  estimated_velocity_kmh: number;
  similarity_score: number; // 特徵相似度 (0 ~ 100)
  flight_time_sec: number;
  flight_frames: number;
  release_frame?: number;
  glove_frame?: number;

  velocity_module?: VelocityMatchModuleResult;
  spin_movement_module?: SpinMovementMatchModuleResult;

  db_baseline_velocity: number;
  ai_correction_velocity: number;
  db_baseline_spin: number;
  ai_correction_spin: number;
  spin_rate_calibration_reason?: string;

  db_baseline_axis: string;
  db_baseline_axis_decimal: number;
  ai_correction_axis_minutes: number;
  spin_axis_calibration_reason?: string;

  db_baseline_ivb: number;
  ai_correction_ivb: number;
  db_baseline_hb: number;
  ai_correction_hb: number;
  calibration_notes?: string;
  spatial_calibration?: SpatialCalibrationInfo;

  // 雙軌徹底分開：VIDEO TRACK vs MODEL TRACK
  video_track?: BaseballTrackPoint[];
  model_track?: TrajectoryPoint[];
  trajectory_points?: TrajectoryPoint[]; // 舊相容別名 (等同 model_track)
  video_track_status?: TrackStatus;
  video_track_failure_reason?: string;
  video_metrics?: VideoTrackMetrics;
  confidence_scores?: UnifiedConfidenceScores;
  top_candidates?: DatabaseMatchCandidate[];

  // 數據來源標籤
  source_velocity?: 'VIDEO MEASURED' | 'VIDEO DERIVED' | 'DATABASE ESTIMATED' | 'MODEL ESTIMATED';
  source_rpm?: 'VIDEO MEASURED' | 'DATABASE ESTIMATED' | 'MODEL ESTIMATED' | 'MOVEMENT-INFERRED' | 'DATABASE ESTIMATED / MOVEMENT-INFERRED';
  source_spin_axis?: 'VIDEO MEASURED' | 'DATABASE ESTIMATED' | 'MODEL ESTIMATED' | 'MOVEMENT-INFERRED' | 'DATABASE ESTIMATED / MOVEMENT-INFERRED';
  source_spin_efficiency?: 'VIDEO MEASURED' | 'DATABASE ESTIMATED' | 'MODEL ESTIMATED';
  source_ivb?: 'VIDEO DERIVED' | 'MODEL ESTIMATED' | 'DATABASE ESTIMATED' | 'VIDEO DERIVED / CALIBRATED ESTIMATE' | 'VIDEO DERIVED / 2D' | 'LEGACY MODEL PRIOR / UNCALIBRATED' | 'CONDITIONED 3D ESTIMATE' | 'CANDIDATE RK4 / SPINLESS REFERENCE';
  source_hb?: 'VIDEO DERIVED' | 'MODEL ESTIMATED' | 'DATABASE ESTIMATED' | 'VIDEO DERIVED / CALIBRATED ESTIMATE' | 'VIDEO DERIVED / 2D' | 'LEGACY MODEL PRIOR / UNCALIBRATED' | 'CONDITIONED 3D ESTIMATE' | 'CANDIDATE RK4 / SPINLESS REFERENCE';

  // 影格與時間戳
  first_reliable_ball_frame?: number | null;
  last_reliable_ball_frame?: number | null;
  catch_frame?: number | null; // 允許 NULL
  actual_video_fps?: number;
  release_timestamp?: number | null;
  catch_timestamp?: number | null;

  // 新增：位移觀測、反查推估、不確定度、軌跡擬合與分析依據
  observed_metrics?: ObservedPhysicsMetrics;
  trajectory_fit?: TrajectoryFitMetrics;
  uncertainty?: MeasurementUncertainty;
  analysis_basis?: AnalysisBasisInfo;
  is_cross_type_fallback?: boolean;
  is_insufficient_pitch_type_data?: boolean;
  strict_pitch_type_mode?: boolean;
  filtered_candidate_count?: number;
  effective_velocity_window_kmh?: number;
  reconstructed_ivb_inch?: number;
  reconstructed_hb_inch?: number;

  // 證據摘要與說明 (Answer "Why")
  evidence_summary?: {
    videoEvidenceText: string;
    databasePriorText: string;
    modelInferenceText: string;
    overallEvidenceQuality: 'High' | 'Medium' | 'Low' | 'Insufficient';
    whyExplanation: string[];
  };
}

// 實測物理位移特徵 (Physics Measurement Engine Output)
export interface ObservedPhysicsMetrics {
  raw_ivb_inch?: number;
  raw_hb_inch?: number;
  movement_valid?: boolean;
  movement_limitation?: string;
  measured_velocity_kmh: number;
  flight_time_sec: number;
  horizontal_movement_2d_px: number;
  vertical_movement_2d_px: number;
  calibrated_horizontal_movement_cm: number;
  calibrated_vertical_movement_cm: number;
  observed_ivb_inch: number;
  observed_hb_inch: number;
  observed_release_angle_deg: number;
  is_release_angle_estimated: boolean;
  trajectory_quality_score: number;
  tracking_ratio_pct: number;
  velocity_uncertainty_kmh: number;
  movement_uncertainty_inch: number;
  movement_source: 'VIDEO DERIVED / CALIBRATED ESTIMATE' | 'VIDEO DERIVED / 2D' | 'LEGACY MODEL PRIOR / UNCALIBRATED' | 'CONDITIONED 3D ESTIMATE';
  details: string[];
}

// 軌跡擬合誤差 (Forward Validation: VIDEO TRACK vs MODEL TRACK)
export interface TrajectoryFitMetrics {
  rmse_px: number;
  mean_error_px: number;
  max_error_px: number;
  max_deviation_px?: number;
  fit_score: number; // 0 ~ 100
  fit_quality: 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'POOR' | 'High Fit' | 'Moderate Fit' | 'Low Fit' | 'NOT_VALIDATED';
  compared_points_count: number;
  compared_frames_count?: number;
  summary: string;
}

// 模型不確定度量化 (Estimated Uncertainty)
export interface MeasurementUncertainty {
  velocity_range: string; // e.g. "±1.5 km/h"
  spin_rate_range: string; // e.g. "±180 RPM"
  spin_axis_range: string; // e.g. "±0:15"
  ivb_range: string; // e.g. "±1.2\""
  hb_range: string; // e.g. "±1.0\""
  velocity_plus_minus_kmh?: number;
  spin_rate_plus_minus_rpm?: number;
  ivb_plus_minus_inch?: number;
  hb_plus_minus_inch?: number;
  spin_rate_min: number;
  spin_rate_max: number;
  uncertainty_basis: string;
}

// 分析依據 (Analysis Basis / Measurement Basis)
export interface AnalysisBasisInfo {
  velocity: {
    source: string;
    description: string;
  };
  movement: {
    source: string;
    description: string;
  };
  spin_rate: {
    source: string;
    description: string;
  };
  spin_axis: {
    source: string;
    description: string;
  };
  release_angle: {
    source: string;
    description: string;
  };
  database: {
    source: string;
    totalRecords: number;
    matchedTypeRecords: number;
    velocityWindowKmh?: number;
    isCrossTypeFallback: boolean;
    isInsufficientPitchTypeData?: boolean;
  };
  forward_validation: {
    source: string;
    description: string;
    fitQuality: TrajectoryFitMetrics['fit_quality'];
    fitScore: number;
  };
}

// 資料庫位移比對設定 (Configurable Parameters)
export interface MovementMatcherConfig {
  velocityWeight: number; // 預設 0.30
  ivbWeight: number; // 預設 0.40
  hbWeight: number; // 預設 0.30
  initialVelocityWindowKmh: number; // 預設 ±3.5 km/h
  maxVelocityWindowKmh: number; // 預設 ±12.0 km/h
  topNCandidates: number; // 預設 3
}

// 出手角度修正設定 (Release Angle Correction Config)
export interface ReleaseAngleCorrectionConfig {
  rpmCorrectionPerDegree: number; // e.g. 6.5 RPM / deg
  axisCorrectionMinutesPerDegree: number; // e.g. 0.8 min / deg
  maxRpmCorrection: number; // e.g. 65 RPM (微調參數，絕不主導)
  maxAxisCorrectionMinutes: number; // e.g. 12 min
}

// 運動候選區塊 (舊相容)
export interface MotionCandidate {
  frame: number;
  x: number;
  y: number;
  x_norm: number;
  y_norm: number;
  width: number;
  height: number;
  motion_energy: number;
  compactness: number;
  elongation: number;
  contrast: number;
  score: number;
}
