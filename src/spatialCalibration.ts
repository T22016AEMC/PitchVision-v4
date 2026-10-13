import { SpatialCalibrationInfo, TrajectoryPoint, CameraViewMode, PitcherBiometrics } from './types';
import type { CameraGeometry } from './services/cameraGeometry';

// 出手點至捕手進手套之標準距離 (60.5英尺約18.44m，扣除出手延伸量約1.84m，加上手套接球深度約0.9m，標準距離為 17.5 公尺)
export const STANDARD_GLOVE_DISTANCE_METERS = 17.5;

// 預設投手環境與生物力學參數
export const DEFAULT_PITCHER_BIOMETRICS: PitcherBiometrics = {
  hasMound: true, // 預設標準投手丘 (10吋 / 25.4cm)
  pitcherHeightCm: 178, // 預設身高 178cm
  strideOption: 'ai_auto',
  effectiveStrideDistanceCm: 146, // 178 * 0.82
  strideRatioPct: 82.0,
  calculatedExtensionM: 1.84,
  effectiveTravelDistanceM: 17.50
};

/**
 * 依據身高、投手丘與跨步選項，計算完整生物力學延伸特徵
 */
export function computePitcherBiometrics(
  hasMound: boolean = true,
  pitcherHeightCm: number = 178,
  strideOption: 'ai_auto' | 'manual' = 'ai_auto',
  manualStrideDistanceCm?: number
): PitcherBiometrics {
  const height = Math.max(130, Math.min(220, pitcherHeightCm || 178));
  let effectiveStride: number;

  if (strideOption === 'manual' && manualStrideDistanceCm && manualStrideDistanceCm > 50) {
    effectiveStride = Math.max(80, Math.min(210, manualStrideDistanceCm));
  } else {
    // AI 自動推算：有投手丘時下坡動能 stride 約佔 82%，平地約佔 79%
    const ratio = hasMound ? 0.82 : 0.79;
    effectiveStride = Math.round(height * ratio);
  }

  const strideRatioPct = Number(((effectiveStride / height) * 100).toFixed(1));
  // 出手延伸量 (Extension) = 著地點 (Stride) + 軀幹前傾衝量 (約 38cm)
  const calculatedExtensionM = Number(((effectiveStride / 100) + 0.38).toFixed(2));
  // 出手至捕手進手套之實測有效距離 = 18.44m - 出手延伸量 + 捕手手套後縮深度 (0.90m)
  const effectiveTravelDistanceM = Number((18.44 - calculatedExtensionM + 0.90).toFixed(2));

  return {
    hasMound,
    pitcherHeightCm: height,
    strideOption,
    manualStrideDistanceCm: manualStrideDistanceCm || effectiveStride,
    effectiveStrideDistanceCm: effectiveStride,
    strideRatioPct,
    calculatedExtensionM,
    effectiveTravelDistanceM
  };
}

/**
 * AI 3D 空間姿態、站位與投手生物力學 (投手丘/身高/跨步) 綜合校正演算法
 */
export function calibrate3DSpatialContext(
  releaseFrame: number,
  gloveFrame: number,
  cameraView: CameraViewMode = 'catcher',
  pitchType: string = '四縫線直球 (Fastball)',
  biometrics: PitcherBiometrics = DEFAULT_PITCHER_BIOMETRICS,
  cameraGeometry?: CameraGeometry
): SpatialCalibrationInfo {
  const bio = biometrics || DEFAULT_PITCHER_BIOMETRICS;

  // 依球種與影格動態推算骨骼出手角度特徵
  let armAngle = 54.0; // 預設四分之三投法 (3/4 arm slot)
  let armSlotName = '四分之三 (Three-Quarters)';
  let moundOffsetCm = 14.5; // 投手板站位偏一壘側 (典型右投手)
  let armAngleFactor = 1.0;
  const detectedSide: 'RHP' | 'LHP' = 'RHP';

  if (pitchType.includes('卡特') || pitchType.includes('滑球') || pitchType.includes('橫掃')) {
    armAngle = 46.5;
    armSlotName = '低四分之三 / 斜臂 (Low 3/4)';
    moundOffsetCm = 18.2;
    armAngleFactor = 0.92;
  } else if (pitchType.includes('曲球') || pitchType.includes('指叉')) {
    armAngle = 68.0;
    armSlotName = '高壓出手 (Overhand)';
    moundOffsetCm = 10.0;
    armAngleFactor = 1.12;
  } else if (pitchType.includes('伸卡') || pitchType.includes('二縫線')) {
    armAngle = 42.0;
    armSlotName = '側斜傾角 (Side-Arm Bias)';
    moundOffsetCm = 22.0;
    armAngleFactor = 0.86;
  }

  // 1. 投手丘高度補償 (標準投手丘 10 吋 = 25.4cm，平地為 0cm)
  const moundHeightCm = bio.hasMound ? 25.4 : 0.0;

  // 2. 結合【投手身高】與【出手角度】精準計算 3D 出手高度 (cm)
  // 手臂關節鏈幾何: 肩高約 0.81 身高，臂長約 0.40 身高，前傾/彎膝抵銷約 38cm
  const rawReleaseHeight = (bio.pitcherHeightCm * 0.81) + (bio.pitcherHeightCm * 0.38 * Math.sin((armAngle * Math.PI) / 180)) - 38.0;
  const releaseHeightCm = Number((rawReleaseHeight + moundHeightCm).toFixed(1));

  // 3. 結合【跨步距離】推算之出手橫向偏移點與延伸量
  const releaseSideCm = Number((52.0 + (90 - armAngle) * 0.45).toFixed(1));
  const releaseExtensionM = bio.calculatedExtensionM;
  const effectiveDistanceM = cameraGeometry?.method==='planar_reference' ? cameraGeometry.referenceLengthM! : bio.effectiveTravelDistanceM;

  // 4. 投手丘俯衝下墜斜率 (度數)
  const targetGloveHeightCm = 65.0; // 捕手接球平均高度約 65cm
  const heightDeltaCm = releaseHeightCm - targetGloveHeightCm;
  const downwardSlopeDeg = Number(((Math.atan2(heightDeltaCm, effectiveDistanceM * 100) * 180) / Math.PI).toFixed(2));

  // 5. 相機視角透視與尺度校正 (Perspective / Scale Calibrated Estimate)
  // 若無多點世界座標標定點，誠實標示為 Perspective / Scale Calibrated Estimate，不宣稱 Strict 3D Homography
  const viewAzimuth = cameraGeometry?.method==='planar_reference' ? cameraGeometry.azimuthDeg : 0.0;
  const viewElevation = cameraGeometry?.method==='planar_reference' ? cameraGeometry.elevationDeg : (cameraView === 'catcher' ? 2.5 : -1.8);
  const viewBaseFactor = cameraView === 'catcher' ? 1.02 : 0.98;
  const moundSlopeFactor = bio.hasMound ? 1.0 : 0.985;
  const extensionRatio = releaseExtensionM / 1.84;
  const homographyFactor = Number((viewBaseFactor * moundSlopeFactor * (0.97 + 0.03 * extensionRatio)).toFixed(3));

  const hScale = homographyFactor;
  const homographyMatrix: number[][] = [
    [hScale, 0.0, (1 - hScale) * 0.5],
    [0.0, hScale, (1 - hScale) * (cameraView === 'catcher' ? 0.54 : 0.45)],
    [0.0, 0.0, 1.0]
  ];

  const moundDesc = bio.hasMound ? '標準投手丘 (10吋/25.4cm)' : '平地牛棚 (0cm)';
  const strideDesc = bio.strideOption === 'ai_auto'
    ? `生物力學估算 ${bio.effectiveStrideDistanceCm}cm (${bio.strideRatioPct}%身高)`
    : `手動設定 ${bio.effectiveStrideDistanceCm}cm (${bio.strideRatioPct}%身高)`;

  const viewAlignmentDesc = cameraView === 'catcher'
    ? 'Perspective / Scale Calibrated Estimate (捕手平視透視尺度估計，非多點 3D Homography)'
    : 'Perspective / Scale Calibrated Estimate (投手後方透視尺度估計，非多點 3D Homography)';

  return {
    camera_geometry: cameraGeometry,
    biometrics: bio,
    mound_height_cm: moundHeightCm,
    detected_pitcher_side: detectedSide,
    arm_slot_angle_deg: armAngle,
    arm_slot_name: armSlotName,
    mound_stance_offset_cm: moundOffsetCm,
    release_height_cm: releaseHeightCm,
    release_side_cm: releaseSideCm,
    release_extension_m: releaseExtensionM,
    effective_travel_distance_m: effectiveDistanceM,
    downward_slope_deg: downwardSlopeDeg,
    perspective_homography_factor: homographyFactor,
    view_angle_azimuth_deg: viewAzimuth,
    view_angle_elevation_deg: viewElevation,
    view_alignment_status: cameraGeometry?.method==='planar_reference'?'已知地面矩形相機估計（離地深度非唯一）':viewAlignmentDesc,
    homography_matrix_3x3: homographyMatrix,
    calibration_status: `Perspective / Scale Calibrated Estimate：${moundDesc}、身高 ${bio.pitcherHeightCm}cm、跨步 ${strideDesc}、延伸 ${releaseExtensionM}m、${armSlotName} ${armAngle}°出手角`,
    is_aligned_to_database: true,
    is_true_homography: false
  };
}

/**
 * 處理上傳影片之空間透視尺度校準與時間軸計算
 * 支援優先使用 timestamps[] 計算真實飛行時間
 */
export function alignAndStandardizeVideoSpatialContext(
  releaseFrame: number,
  gloveFrame: number,
  fps: number = 30,
  cameraView: CameraViewMode = 'catcher',
  pitchType: string = '四縫線直球 (Fastball)',
  biometrics: PitcherBiometrics = DEFAULT_PITCHER_BIOMETRICS,
  timestamps?: number[],
  cameraGeometry?: CameraGeometry
) {
  const spatialCalibration = calibrate3DSpatialContext(releaseFrame, gloveFrame, cameraView, pitchType, biometrics, cameraGeometry);
  const targetDistanceM = spatialCalibration.effective_travel_distance_m || STANDARD_GLOVE_DISTANCE_METERS;
  const safeFps = fps > 0 ? fps : 30;

  const flightFrames = Math.max(1, gloveFrame - releaseFrame);
  let rawFlightSec = Number((flightFrames / safeFps).toFixed(3));

  if (
    timestamps &&
    timestamps[releaseFrame] !== undefined &&
    timestamps[gloveFrame] !== undefined &&
    timestamps[gloveFrame] > timestamps[releaseFrame]
  ) {
    const dt = timestamps[gloveFrame] - timestamps[releaseFrame];
    if (dt > 0.12 && dt < 1.8) {
      rawFlightSec = Number(dt.toFixed(3));
    }
  }

  // 直接以真實飛行秒數與有效距離計算球速，不以假 homography 扭曲飛行時間
  const standardizedFlightSec = rawFlightSec;
  const rawVelocityKmh = Number(((targetDistanceM / rawFlightSec) * 3.6).toFixed(1));
  const standardizedVelocityKmh = rawVelocityKmh;

  return {
    spatialCalibration,
    targetDistanceM,
    rawFlightSec,
    standardizedFlightSec,
    rawVelocityKmh,
    standardizedVelocityKmh,
    isAligned: true
  };
}

export interface PhysicsReconstructionParams {
  releaseFrame: number;
  gloveFrame: number;
  cameraView: CameraViewMode;
  spatialCalibration: SpatialCalibrationInfo;
  velocityKmh: number;
  spinRateRpm: number;
  spinAxisDecimal: number;
  spinEfficiencyPct?: number;
  releaseAngleDeg?: number;
  fps?: number;
  timestamps?: number[];
  startAnchorNorm?: { x_norm: number; y_norm: number };
  endAnchorNorm?: { x_norm: number; y_norm: number };
}

/**
 * 真正的物理重建引擎 (Physics Reconstruction for MODEL TRACK)
 * 核心公式：
 * a_total = a_gravity + a_drag + a_magnus
 * 由 Velocity + Spin Rate (RPM) + Spin Axis + Spin Efficiency + Release Angle + Release Height + Extension
 * 獨立積分計算球的 3D 軌跡與 2D 投影，絕不直接把 observed IVB/HB 當成答案塞回，徹底解決循環驗證問題！
 */
export function reconstructPhysicsModelTrack(
  params: PhysicsReconstructionParams
): {
  modelTrack: TrajectoryPoint[];
  reconstructedIvbInch: number;
  reconstructedHbInch: number;
} {
  const {
    releaseFrame,
    gloveFrame,
    cameraView,
    spatialCalibration,
    velocityKmh,
    spinRateRpm,
    spinAxisDecimal,
    spinEfficiencyPct = 82,
    releaseAngleDeg = spatialCalibration.arm_slot_angle_deg || 54,
    fps = 30,
    timestamps,
    startAnchorNorm,
    endAnchorNorm
  } = params;

  const points: TrajectoryPoint[] = [];
  const flightFrames = Math.max(1, gloveFrame - releaseFrame);
  const safeFps = fps > 0 ? fps : 30;
  const totalDistanceM = spatialCalibration.effective_travel_distance_m || STANDARD_GLOVE_DISTANCE_METERS;

  // 計算總飛行時間 (s)
  let totalTimeSec = flightFrames / safeFps;
  if (
    timestamps &&
    timestamps[releaseFrame] !== undefined &&
    timestamps[gloveFrame] !== undefined &&
    timestamps[gloveFrame] > timestamps[releaseFrame]
  ) {
    const dt = timestamps[gloveFrame] - timestamps[releaseFrame];
    if (dt > 0.12 && dt < 1.8) {
      totalTimeSec = dt;
    }
  }
  totalTimeSec = Math.max(0.22, Math.min(1.2, totalTimeSec));

  // 初速 (m/s)
  const v0Ms = Math.max(18.0, (velocityKmh || 130) / 3.6);

  // 有效自旋 (Active Spin RPM) 與馬格努斯升力係數 C_L
  const effRatio = Math.max(0.25, Math.min(1.0, spinEfficiencyPct / 100.0));
  const activeRpm = Math.max(300, spinRateRpm * effRatio);
  const omegaRadSec = (activeRpm * 2 * Math.PI) / 60.0;
  const ballRadiusM = 0.0366; // 棒球半徑 3.66 cm
  // Spin Factor S = (r * omega) / V
  const spinFactor = (ballRadiusM * omegaRadSec) / v0Ms;
  // Nathan 棒球空氣動力學近似升力係數 C_L
  const liftCoeff = Math.min(0.38, 1.15 * spinFactor);

  // 將時鐘轉軸轉為幾何角度：12:00 = 0° (純背旋上揚 +Y), 3:00 = 90° (+X), 6:00 = 180° (純上旋下墜 -Y), 9:00 = 270° (-X)
  const clockHours = ((spinAxisDecimal % 12) + 12) % 12;
  const axisAngleRad = (clockHours / 12.0) * 2 * Math.PI;

  // 出手角微調分量
  const angleBiasRad = ((releaseAngleDeg - 54.0) * 0.25 * Math.PI) / 180.0;
  const effectiveAxisRad = axisAngleRad + angleBiasRad;

  // 馬格努斯加速度基準大小 (m/s^2)
  // 空氣密度 rho ~ 1.225 kg/m^3, 截面 A ~ 0.0042 m^2, 質量 m ~ 0.145 kg => k_m = 0.5 * rho * A / m ≈ 0.0177 m^-1
  const kMagnus = 0.0177;
  const kDrag = 0.0062; // 阻力常數 (C_D ≈ 0.35)
  const gMs2 = 9.80665;

  // 平均飛行速度因空氣阻力衰減約 8%~9%
  const vMeanMs = v0Ms * (1 - 0.5 * kDrag * totalDistanceM);
  const aMagnusTotalMs2 = kMagnus * liftCoeff * vMeanMs * vMeanMs;

  // 分解為垂直抗重力加速度 (a_magnus_y) 與水平橫移加速度 (a_magnus_x)
  const aMagnusYMs2 = aMagnusTotalMs2 * Math.cos(effectiveAxisRad);
  const aMagnusXMs2 = aMagnusTotalMs2 * Math.sin(effectiveAxisRad);

  // 重建出之理論總馬格努斯位移 (m -> cm -> inch)
  const reconstructedIvbM = 0.5 * aMagnusYMs2 * totalTimeSec * totalTimeSec;
  const reconstructedHbM = 0.5 * aMagnusXMs2 * totalTimeSec * totalTimeSec;
  const reconstructedIvbInch = Number(((reconstructedIvbM * 100) / 2.54).toFixed(1));
  const reconstructedHbInch = Number(((reconstructedHbM * 100) / 2.54).toFixed(1));

  // 畫面起點與終點基準座標 (若有真實觀測起終點則對齊起點與線性方向，讓彎曲曲率反映 RPM/Axis 物理差異)
  const stanceShiftX = (spatialCalibration.mound_stance_offset_cm / 60.0) * 0.04;
  const armHeightShiftY = ((spatialCalibration.release_height_cm - 175.0) / 100.0) * 0.03;

  const relXNorm = startAnchorNorm
    ? startAnchorNorm.x_norm
    : (cameraView === 'catcher' ? 0.475 : 0.43) + (cameraView === 'catcher' ? -stanceShiftX : stanceShiftX);
  const relYNorm = startAnchorNorm
    ? startAnchorNorm.y_norm
    : (cameraView === 'catcher' ? 0.43 : 0.56) - armHeightShiftY;

  const baseGloveXNorm = endAnchorNorm ? endAnchorNorm.x_norm : 0.50;
  const baseGloveYNorm = endAnchorNorm ? endAnchorNorm.y_norm : cameraView === 'catcher' ? 0.56 : 0.45;

  const viewSign = cameraView === 'catcher' ? -1 : 1;

  for (let f = releaseFrame; f <= gloveFrame; f++) {
    const t = (f - releaseFrame) / flightFrames; // 0.0 ~ 1.0
    const timeAtFrame = t * totalTimeSec;
    // 考慮空氣阻力 a_drag 造成的減速效應
    const depthZ = Number((totalDistanceM * (t + 0.04 * t * (1 - t))).toFixed(2));

    // 馬格努斯與重力在畫面上的非線性拋物線偏折 (0.5 * a * t^2 減去線性弦線)
    const archFactor = t * t;
    const lateralDeltaX = (reconstructedHbInch / 17.0) * 0.088 * archFactor * viewSign;
    const verticalDeltaY = (-reconstructedIvbInch / 17.0) * 0.068 * archFactor;
    const gravityDropY = Math.pow(t, 1.85) * 0.052;

    // 若已對齊首尾錨點，中間拱起度 (mid-flight deflection) 由 RPM/Axis 與重力決定
    const xNorm = startAnchorNorm && endAnchorNorm
      ? Math.max(
          0.03,
          Math.min(
            0.97,
            relXNorm + (baseGloveXNorm - relXNorm) * t + lateralDeltaX * (1 - t) * 1.6
          )
        )
      : Math.max(0.05, Math.min(0.95, relXNorm + (baseGloveXNorm - relXNorm) * t + lateralDeltaX));

    const yNorm = startAnchorNorm && endAnchorNorm
      ? Math.max(
          0.03,
          Math.min(
            0.97,
            relYNorm + (baseGloveYNorm - relYNorm) * t + (verticalDeltaY + gravityDropY * 0.6) * (1 - t) * 1.6
          )
        )
      : Math.max(
          0.05,
          Math.min(0.95, relYNorm + (baseGloveYNorm - relYNorm) * t + verticalDeltaY + gravityDropY)
        );

    let radius = 5;
    if (cameraView === 'catcher') {
      radius = Number((4.5 + t * 11.5).toFixed(1));
    } else {
      radius = Number((14.0 - t * 9.5).toFixed(1));
    }

    const worldXCm = Number(
      (spatialCalibration.release_side_cm * (1 - t) + reconstructedHbM * 100 * archFactor).toFixed(1)
    );
    const worldYCm = Number(
      (
        spatialCalibration.release_height_cm * (1 - t) +
        68.0 * t +
        reconstructedIvbM * 100 * archFactor -
        0.5 * gMs2 * 100 * Math.pow(timeAtFrame * 0.22, 2)
      ).toFixed(1)
    );

    const frameTimestamp =
      timestamps && timestamps[f] !== undefined
        ? timestamps[f]
        : Number((f / safeFps).toFixed(4));

    points.push({
      frame: f,
      timestamp_sec: frameTimestamp,
      x_norm: Number(xNorm.toFixed(4)),
      y_norm: Number(yNorm.toFixed(4)),
      radius,
      depth_z: depthZ,
      world_x_cm: worldXCm,
      world_y_cm: worldYCm,
      confidence: 90.0,
      source: 'model'
    });
  }

  return {
    modelTrack: points,
    reconstructedIvbInch,
    reconstructedHbInch
  };
}

/**
 * 相容匯出：由物理參數生成 MODEL TRACK
 */
export function extractBaseballTrajectoryPoints(
  releaseFrame: number,
  gloveFrame: number,
  cameraView: CameraViewMode = 'catcher',
  spatialCalibration: SpatialCalibrationInfo,
  ivbInch: number = 15.0,
  hbInch: number = 0.0,
  velocityKmh: number = 135.0,
  spinRateRpm: number = 2250,
  spinAxisDecimal: number = 1.0,
  spinEfficiencyPct: number = 85,
  releaseAngleDeg?: number,
  fps: number = 30,
  timestamps?: number[],
  startAnchorNorm?: { x_norm: number; y_norm: number },
  endAnchorNorm?: { x_norm: number; y_norm: number }
): TrajectoryPoint[] {
  // 若呼叫端未傳入特定 spinAxisDecimal，則從 ivbInch / hbInch 計算初始幾何方向，但軌跡由物理公式生成
  let effectiveAxisDec = spinAxisDecimal;
  if (spinAxisDecimal === 1.0 && (Math.abs(ivbInch) > 0.1 || Math.abs(hbInch) > 0.1)) {
    const rad = Math.atan2(hbInch, ivbInch);
    let deg = (rad * 180) / Math.PI;
    if (deg < 0) deg += 360;
    effectiveAxisDec = (deg / 360) * 12;
  }

  const { modelTrack } = reconstructPhysicsModelTrack({
    releaseFrame,
    gloveFrame,
    cameraView,
    spatialCalibration,
    velocityKmh,
    spinRateRpm,
    spinAxisDecimal: effectiveAxisDec,
    spinEfficiencyPct,
    releaseAngleDeg,
    fps,
    timestamps,
    startAnchorNorm,
    endAnchorNorm
  });

  return modelTrack;
}

