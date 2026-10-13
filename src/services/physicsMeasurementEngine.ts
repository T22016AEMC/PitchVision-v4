import { measureConditionedMovement } from './conditionedPhysics';
import {
  BaseballTrackPoint,
  CameraViewMode,
  SpatialCalibrationInfo,
  VideoTrackMetrics,
  ObservedPhysicsMetrics
} from '../types';

export interface PhysicsMeasurementInput {
  videoTrack: BaseballTrackPoint[];
  releaseFrame: number;
  gloveFrame: number;
  actualFps: number;
  cameraView: CameraViewMode;
  spatialCalibration: SpatialCalibrationInfo;
  videoMetrics?: VideoTrackMetrics;
  timestamps?: number[];
  videoWidth?: number;
  videoHeight?: number;
}

/**
 * 物理運動量測引擎 (Physical Movement Measurement Engine)
 * 責任：
 * 1. 嚴格從 VIDEO TRACK (真實影像軌跡) 提取觀測位移、飛行時間與初速
 * 2. 結合 Camera / Spatial Calibration 將像素位移 (pixel movement) 轉換為物理位移 (cm / inches)
 * 3. 計算觀測 IVB (Induced Vertical Break) 與 HB (Horizontal Break)
 * 4. 評估量測品質與不確定度 (Uncertainty)
 * 
 * 核心準則：
 * 「位移是觀測值，RPM / Spin Axis 是反推結果。」
 * 若無立體雙相機或雷達，標示為 "VIDEO DERIVED / CALIBRATED ESTIMATE"，絕不冒充儀器直測。
 */
export class PhysicsMeasurementEngine {
  /**
   * 執行全流程物理量測與校準分析
   */
  static measureObservedPhysics(input: PhysicsMeasurementInput): ObservedPhysicsMetrics {
    const {
      videoTrack = [],
      releaseFrame,
      gloveFrame,
      actualFps = 30,
      cameraView = 'catcher',
      spatialCalibration,
      videoMetrics,
      timestamps,
      videoWidth = 720,
      videoHeight = 1280
    } = input;

    const details: string[] = [];
    const safeFps = actualFps > 0 ? actualFps : 30;

    // 1. 計算精確飛行時間 (優先使用逐影格時間戳，若無則依實際 FPS 換算)
    const flightTimeSec = this.calculateObservedFlightTime(
      releaseFrame,
      gloveFrame,
      safeFps,
      timestamps
    );
    details.push(`實測飛行時間：${flightTimeSec.toFixed(3)}s (基於 ${safeFps.toFixed(1)} FPS 逐格時間軸)`);

    // 2. 計算實測球速 (以 3D 空間校準後之真實出手延伸與捕手深度為距離基準)
    const travelDistanceM = spatialCalibration.effective_travel_distance_m || 17.50;
    const { measuredVelocityKmh, velocityUncertaintyKmh } = this.calculateObservedVelocity(
      flightTimeSec,
      travelDistanceM,
      releaseFrame,
      gloveFrame
    );
    details.push(`實測換算球速：${measuredVelocityKmh} km/h (標準化距離 ${travelDistanceM}m, 估計不確定度 ±${velocityUncertaintyKmh} km/h)`);

    // 3. 提取有效時間軸區間內的影像軌跡點
    const activeTrack = videoTrack.filter(
      (pt) => pt.frame >= releaseFrame && pt.frame <= gloveFrame
    );
    const realObsPoints = activeTrack.filter(
      (pt) => pt.source === 'vision'
    );

    // 4. 計算 2D 像素位移 (Pixel Trajectory & Movement)
    let horizPx = videoMetrics?.horizontal_movement_2d_px || 0;
    let vertPx = videoMetrics?.vertical_movement_2d_px || 0;

    if (activeTrack.length >= 2) {
      const firstPt = activeTrack[0];
      const lastPt = activeTrack[activeTrack.length - 1];
      horizPx = lastPt.x - firstPt.x;
      vertPx = lastPt.y - firstPt.y;
    }

    // 5. 透過 Spatial / Camera Calibration 將 Pixel Movement 映射至 Physical Movement (cm)
    let {
      calibratedHorizontalMovementCm,
      calibratedVerticalMovementCm,
      observedIvbInch,
      observedHbInch,
      movementSource
    } = this.calculateCalibratedMovement(
      horizPx,
      vertPx,
      activeTrack,
      flightTimeSec,
      cameraView,
      spatialCalibration,
      videoWidth,
      videoHeight
    );

    const rawIvb=observedIvbInch,rawHb=observedHbInch;
    let movementValid=false,calibratedUncertainty:number|null=null,calibratedAngle:number|null=null,limitation='無已知尺度與深度：原模型受限估計僅供手動參考，不能當量測';
    if(spatialCalibration.camera_geometry?.method==='planar_reference' && realObsPoints.length>=4) {
      try {
        const measurement=measureConditionedMovement(activeTrack,spatialCalibration.camera_geometry,timestamps?.[releaseFrame]??releaseFrame/safeFps,flightTimeSec,travelDistanceM);
        if(measurement.valid){observedIvbInch=measurement.ivb;observedHbInch=measurement.hb;movementValid=true;calibratedUncertainty=measurement.uncertainty;calibratedAngle=Math.atan2(measurement.yFit.coeff[1],travelDistanceM/flightTimeSec)*180/Math.PI;limitation=measurement.basis;}
        else limitation='條件3D重建殘差／加速度不合理：保留原模型參考，不宣稱物理量測';
      } catch(error) {limitation=error instanceof Error?error.message:'幾何重建失敗';}
    }
    if(!movementValid){observedIvbInch=Number(Math.max(-50/2.54,Math.min(65/2.54,rawIvb)).toFixed(1));observedHbInch=Number(Math.max(-75/2.54,Math.min(75/2.54,rawHb)).toFixed(1));}
    calibratedHorizontalMovementCm=observedHbInch*2.54;calibratedVerticalMovementCm=observedIvbInch*2.54;
    details.push(`原始未截限估算 IVB ${rawIvb.toFixed(1)} / HB ${rawHb.toFixed(1)} 吋；${limitation}`);
    // 6. 出手仰角 (Release Angle) 估算
    let { releaseAngleDeg, isReleaseAngleEstimated } = this.estimateReleaseAngle(
      activeTrack,
      releaseFrame,
      spatialCalibration,
      cameraView
    );
    if(calibratedAngle!==null){releaseAngleDeg=calibratedAngle;isReleaseAngleEstimated=true;}

    // 7. 量測品質與不確定度量化
    const trackingRatio = videoMetrics?.tracking_ratio_pct ?? Math.round((realObsPoints.length / Math.max(1, gloveFrame - releaseFrame + 1)) * 100);
    let { trajectoryQualityScore, movementUncertaintyInch } = this.calculateMovementUncertainty(
      realObsPoints.length,
      trackingRatio,
      videoMetrics?.trajectory_curvature_score || 0,
      activeTrack.length
    );
    if(calibratedUncertainty!==null)movementUncertaintyInch=calibratedUncertainty;
    else movementUncertaintyInch=Math.max(movementUncertaintyInch,Math.abs(rawIvb-observedIvbInch),Math.abs(rawHb-observedHbInch));
    details.push('球速不確定度只反映約一影格事件時間敏感度，不包括未知距離誤差，不是統計信賴區間');

    details.push(
      `畫面總位移: ΔX ${horizPx}px, ΔY ${vertPx}px 經透視校正至 IVB ${observedIvbInch >= 0 ? '+' : ''}${observedIvbInch}" / HB ${observedHbInch >= 0 ? '+' : ''}${observedHbInch}" (來源: ${movementSource})`
    );

    return {
      raw_ivb_inch: rawIvb,raw_hb_inch:rawHb,movement_valid:movementValid,movement_limitation:limitation,
      measured_velocity_kmh: measuredVelocityKmh,
      flight_time_sec: flightTimeSec,
      horizontal_movement_2d_px: horizPx,
      vertical_movement_2d_px: vertPx,
      calibrated_horizontal_movement_cm: calibratedHorizontalMovementCm,
      calibrated_vertical_movement_cm: calibratedVerticalMovementCm,
      observed_ivb_inch: observedIvbInch,
      observed_hb_inch: observedHbInch,
      observed_release_angle_deg: releaseAngleDeg,
      is_release_angle_estimated: isReleaseAngleEstimated,
      trajectory_quality_score: trajectoryQualityScore,
      tracking_ratio_pct: trackingRatio,
      velocity_uncertainty_kmh: velocityUncertaintyKmh,
      movement_uncertainty_inch: movementUncertaintyInch,
      movement_source: movementValid?'CONDITIONED 3D ESTIMATE':'LEGACY MODEL PRIOR / UNCALIBRATED',
      details
    };
  }

  /**
   * 1. 擷取有效區間內之實測軌跡點 (calculateObservedTrajectory)
   */
  static calculateObservedTrajectory(
    videoTrack: BaseballTrackPoint[],
    releaseFrame: number,
    gloveFrame: number
  ): {
    activeTrack: BaseballTrackPoint[];
    visionPoints: BaseballTrackPoint[];
    horizPx: number;
    vertPx: number;
  } {
    const activeTrack = (videoTrack || []).filter(
      (pt) => pt.frame >= releaseFrame && pt.frame <= gloveFrame
    );
    const visionPoints = activeTrack.filter((pt) => pt.source === 'vision');
    let horizPx = 0;
    let vertPx = 0;
    if (activeTrack.length >= 2) {
      const firstPt = activeTrack[0];
      const lastPt = activeTrack[activeTrack.length - 1];
      horizPx = Number((lastPt.x - firstPt.x).toFixed(1));
      vertPx = Number((lastPt.y - firstPt.y).toFixed(1));
    }
    return { activeTrack, visionPoints, horizPx, vertPx };
  }

  /**
   * 計算實測飛行時間 (秒)
   */
  static calculateObservedFlightTime(
    releaseFrame: number,
    gloveFrame: number,
    fps: number,
    timestamps?: number[]
  ): number {
    const flightFrames = Math.max(1, gloveFrame - releaseFrame);

    // 優先使用精確逐格時間戳
    if (
      timestamps &&
      timestamps.length > gloveFrame &&
      timestamps[releaseFrame] !== undefined &&
      timestamps[gloveFrame] !== undefined
    ) {
      const dt = timestamps[gloveFrame] - timestamps[releaseFrame];
      if (dt > 0) {
        return Number(dt.toFixed(3));
      }
    }

    return Number((flightFrames / fps).toFixed(3));
  }

  /**
   * 2. 計算實測球速與速度量測不確定度 (calculateObservedVelocity)
   */
  static calculateObservedVelocity(
    flightTimeSec: number,
    distanceM: number,
    releaseFrame: number,
    gloveFrame: number
  ): { measuredVelocityKmh: number; velocityUncertaintyKmh: number } {
    const safeTime = flightTimeSec;
    if(!Number.isFinite(safeTime)||safeTime<=0)throw Error("無效飛行時間");
    const speedMs = distanceM / safeTime;
    const measuredVelocityKmh = Number((speedMs * 3.6).toFixed(1));

    // 時間不確定度約為 ±0.5 幀 (快門曝光取樣誤差)
    const flightFrames = Math.max(1, gloveFrame - releaseFrame);
    const fractionalUncertainty = 1 / flightFrames;
    const velocityUncertaintyKmh = Number(
      (measuredVelocityKmh * fractionalUncertainty).toFixed(1)
    );

    return {
      measuredVelocityKmh,
      velocityUncertaintyKmh
    };
  }

  /**
   * 3. 計算觀測物理位移 (calculateObservedMovement)
   * 流程：VIDEO TRACK -> Camera geometry / scale calibration -> World coordinate estimate -> IVB / HB
   */
  static calculateObservedMovement(
    horizPx: number,
    vertPx: number,
    flightTimeSec: number,
    cameraView: CameraViewMode,
    spatialCalib: SpatialCalibrationInfo,
    videoWidth: number = 720,
    videoHeight: number = 1280,
    hasValidTrack: boolean = true
  ): {
    calibratedHorizontalMovementCm: number;
    calibratedVerticalMovementCm: number;
    observedIvbInch: number;
    observedHbInch: number;
    movementSource: 'VIDEO DERIVED / CALIBRATED ESTIMATE' | 'VIDEO DERIVED / 2D';
  } {
    const observedHbInch = this.estimateHB(
      horizPx,
      cameraView,
      spatialCalib,
      videoWidth
    );
    const observedIvbInch = this.estimateIVB(
      vertPx,
      flightTimeSec,
      spatialCalib,
      videoHeight
    );

    // 若無有效球路追蹤點或未完成空間尺度對齊，標示為 VIDEO DERIVED / 2D
    const movementSource: 'VIDEO DERIVED / CALIBRATED ESTIMATE' | 'VIDEO DERIVED / 2D' =
      hasValidTrack && spatialCalib.is_aligned_to_database
        ? 'VIDEO DERIVED / CALIBRATED ESTIMATE'
        : 'VIDEO DERIVED / 2D';

    return {
      calibratedHorizontalMovementCm: Number((observedHbInch * 2.54).toFixed(1)),
      calibratedVerticalMovementCm: Number((observedIvbInch * 2.54).toFixed(1)),
      observedIvbInch,
      observedHbInch,
      movementSource
    };
  }

  /**
   * 4. 估算抗重力垂直位移 (estimateIVB - Induced Vertical Break in inches)
   * 注意：重力沿世界垂直方向 (World Vertical Axis)，需考慮相機仰俯角 (view_angle_elevation_deg)
   * 與投手丘下傾坡度 (downward_slope_deg) 投影後再扣除重力自由下墜 (0.5 * g * t^2)
   */
  static estimateIVB(
    vertPx: number,
    flightTimeSec: number,
    spatialCalib: SpatialCalibrationInfo,
    videoHeight: number = 1280
  ): number {
    const hFactor = spatialCalib.perspective_homography_factor || 1.0;
    const elevRad = ((spatialCalib.view_angle_elevation_deg || 0) * Math.PI) / 180.0;
    const cosElev = Math.max(0.85, Math.cos(elevRad));

    // 結合出手高度與接球高度差推導垂直視覺尺度
    const releaseHeightCm = spatialCalib.release_height_cm || 178.0;
    const targetGloveHeightCm = 65.0;
    const expectedGeometricDropCm = Math.max(80.0, releaseHeightCm - targetGloveHeightCm);

    // 畫面平均垂直尺度 (px / cm)，經相機仰角餘弦校正
    const pxPerCmY = ((videoHeight * 0.22) / expectedGeometricDropCm) * cosElev * hFactor;

    // 世界垂直軸方向之純重力自由落體下墜量 (cm): 0.5 * g * t^2
    const gravityDropCm = 0.5 * 980.665 * Math.pow(flightTimeSec, 2);

    // 影像觀測垂直位移轉換至世界垂直座標 (扣除相機仰角造成的幾何視差)
    const slopeOffsetCm = Math.tan(((spatialCalib.downward_slope_deg || 3.5) * Math.PI) / 180.0) * 18.0;
    const worldObservedDropCm = vertPx / Math.max(0.8, pxPerCmY) + slopeOffsetCm;

    // 抗重力垂直位移 (IVB) = 純重力下墜量 - 經幾何校正之實測下墜量
    const ivbCm = gravityDropCm - worldObservedDropCm;
    const clampedIvbCm = ivbCm;
    return Number((clampedIvbCm / 2.54).toFixed(1));
  }

  /**
   * 5. 估算水平橫向位移 (estimateHB - Horizontal Break in inches)
   * 將 Camera-relative horizontal displacement 結合相機方位角、投手板站位偏移 (mound_stance_offset_cm)
   * 轉換至世界水平座標
   */
  static estimateHB(
    horizPx: number,
    cameraView: CameraViewMode,
    spatialCalib: SpatialCalibrationInfo,
    videoWidth: number = 720
  ): number {
    const hFactor = spatialCalib.perspective_homography_factor || 1.0;
    const azimuthRad = ((spatialCalib.view_angle_azimuth_deg || 0) * Math.PI) / 180.0;
    const cosAzimuth = Math.max(0.85, Math.cos(azimuthRad));

    // 相機座標系轉世界座標系方向與透視尺度
    const viewDirectionSign = cameraView === 'catcher' ? 1.0 : -1.0;
    const pxPerCmX = ((videoWidth * 0.16) / 43.18) * cosAzimuth * hFactor; // 本壘板寬度 17 吋 = 43.18 cm 為尺度基準

    // 扣除投手站位至本壘中線的初始橫向幾何直線分量
    const stanceLinearComponentCm = ((spatialCalib.mound_stance_offset_cm || 14.5) * 0.12) * viewDirectionSign;
    const rawHbCm = (horizPx / Math.max(0.8, pxPerCmX)) * viewDirectionSign - stanceLinearComponentCm;

    const clampedHbCm = rawHbCm;
    return Number((clampedHbCm / 2.54).toFixed(1));
  }

  /**
   * 6. 計算軌跡追蹤信賴分數 (calculateTrajectoryConfidence)
   */
  static calculateTrajectoryConfidence(
    obsCount: number,
    trackingRatio: number,
    curvatureScore: number = 0
  ): number {
    let quality = 45;
    if (obsCount >= 10 && trackingRatio >= 75) {
      quality = 90;
    } else if (obsCount >= 6 && trackingRatio >= 50) {
      quality = 78;
    } else if (obsCount >= 3) {
      quality = 62;
    } else if (obsCount >= 1) {
      quality = 38;
    } else {
      quality = 22;
    }
    if (curvatureScore > 85 && obsCount >= 3) {
      quality = Math.min(95, quality + 4);
    }
    return quality;
  }

  /**
   * 內部呼叫包裝
   */
  private static calculateCalibratedMovement(
    horizPx: number,
    vertPx: number,
    track: BaseballTrackPoint[],
    flightTimeSec: number,
    cameraView: CameraViewMode,
    spatialCalib: SpatialCalibrationInfo,
    videoWidth: number,
    videoHeight: number
  ) {
    const hasValidTrack = track.filter((pt) => pt.source === 'vision').length >= 3;
    return this.calculateObservedMovement(
      horizPx,
      vertPx,
      flightTimeSec,
      cameraView,
      spatialCalib,
      videoWidth,
      videoHeight,
      hasValidTrack
    );
  }

  /**
   * 出手角度 (Release Angle) 估計
   * 若初期影格具備足夠實測點，則量測初始運動切線向量；若不足則標示為 estimated
   */
  private static estimateReleaseAngle(
    track: BaseballTrackPoint[],
    releaseFrame: number,
    spatialCalib: SpatialCalibrationInfo,
    cameraView: CameraViewMode
  ): { releaseAngleDeg: number; isReleaseAngleEstimated: boolean } {
    const earlyPoints = track.filter(
      (pt) => pt.frame >= releaseFrame && pt.frame <= releaseFrame + 4 && pt.source === 'vision'
    );

    if (earlyPoints.length >= 2) {
      const p1 = earlyPoints[0];
      const p2 = earlyPoints[earlyPoints.length - 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const angle = Math.atan2(Math.abs(dy), Math.abs(dx) + 0.001) * (180 / Math.PI);
      const calibratedAngle = Number(Math.max(25.0, Math.min(85.0, angle)).toFixed(1));

      return {
        releaseAngleDeg: calibratedAngle,
        isReleaseAngleEstimated: false
      };
    }

    // 影片初期觀測點不足，使用空間與生物力學出手角
    const fallbackAngle = spatialCalib.arm_slot_angle_deg || 54.0;
    return {
      releaseAngleDeg: fallbackAngle,
      isReleaseAngleEstimated: true
    };
  }

  /**
   * 7. 量化位移量測不確定度 (calculateMovementUncertainty)
   */
  static calculateMovementUncertainty(
    obsCount: number,
    trackingRatio: number,
    curvatureScore: number = 0,
    _totalTrackPoints: number = 0
  ): { trajectoryQualityScore: number; movementUncertaintyInch: number } {
    const quality = this.calculateTrajectoryConfidence(obsCount, trackingRatio, curvatureScore);

    // 不確定度區間 (吋)
    const uncertaintyInch = Number(
      Math.max(0.7, Math.min(3.0, (100 - quality) * 0.035)).toFixed(1)
    );

    return {
      trajectoryQualityScore: quality,
      movementUncertaintyInch: uncertaintyInch
    };
  }
}
