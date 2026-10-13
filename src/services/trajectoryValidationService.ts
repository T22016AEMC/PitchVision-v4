import { assessTrackEvidence } from './trackEvidence';
import { BallObservation, BaseballTrackPoint, VideoTrackMetrics } from '../types';

/**
 * TrajectoryValidationService
 * 遵守最高準則：ACCURACY > COVERAGE
 * 
 * 核心規範：
 * 1. 至少需要 >= 3 個獨立 real vision observations。
 * 2. 只有通過 mean confidence 與 trajectory consistency，VIDEO TRACK 才能為 'valid'。
 * 3. 嚴禁兩點直接連線冒充球路。
 * 4. 嚴禁預設拋物線/直線/模型軌跡冒充 VIDEO TRACK。
 * 5. Interpolation 只能補有限的短缺口 (Gap <= allowedMaxGap)。
 * 6. 若證據不足，必須明確回傳 status: 'insufficient_evidence'，不可強造結果。
 */

export interface ValidationInput {
  observations: BallObservation[];
  releaseFrame: number;
  lastReliableBallFrame?: number;
  catchFrame?: number | null;
  actualFps: number;
  videoWidth: number;
  videoHeight: number;
}

export interface TrajectoryValidationResult {
  status: 'valid' | 'insufficient_evidence';
  failureReason?: string;
  videoTrack: BaseballTrackPoint[];
  metrics: VideoTrackMetrics;
  realObservationCount: number;
  interpolatedCount: number;
  outlierCount: number;
  meanConfidence: number;
  maxGapFrames: number;
  firstReliableBallFrame: number | null;
  lastReliableBallFrame: number | null;
  catchFrame: number | null;
}

export function validateAndReconstructVideoTrack(
  input: ValidationInput
): TrajectoryValidationResult {
  const {
    observations,
    releaseFrame,
    lastReliableBallFrame: inputLastFrame,
    catchFrame: inputCatchFrame,
    actualFps,
    videoWidth,
    videoHeight
  } = input;

  // 1. 篩選純視覺實測觀察點 (source === 'observation')
  const visionObs = observations
    .filter((o) => o.source === 'observation' && o.confidence >= 0.45)
    .sort((a, b) => a.frame - b.frame);

  const realObservationCount = visionObs.length;

  // 門檻：至少需要 >= 3 個獨立 vision observations
  if (realObservationCount < 3) {
    const reason = realObservationCount === 0
      ? 'Insufficient visual evidence：影片中未偵測到足夠連續的真實棒球視覺特徵'
      : `Insufficient visual evidence：僅取得 ${realObservationCount} 個視覺觀測點 (系統嚴格要求 >= 3 個獨立實測點，禁止兩點直接連線偽造軌跡)`;

    return {
      status: 'insufficient_evidence',
      failureReason: reason,
      videoTrack: [],
      metrics: {
        horizontal_movement_2d_norm: 0,
        vertical_movement_2d_norm: 0,
        total_movement_2d_norm: 0,
        horizontal_movement_2d_px: 0,
        vertical_movement_2d_px: 0,
        total_movement_2d_px: 0,
        trajectory_curvature_score: 0,
        vision_detected_frames_count: realObservationCount,
        interpolated_frames_count: 0,
        tracking_ratio_pct: 0,
        tracking_quality_status: 'insufficient',
        visible_end_frame: inputLastFrame || releaseFrame,
        is_manual_anchored: false
      },
      realObservationCount,
      interpolatedCount: 0,
      outlierCount: 0,
      meanConfidence: realObservationCount > 0 ? visionObs[0].confidence : 0,
      maxGapFrames: 0,
      firstReliableBallFrame: visionObs[0]?.frame || null,
      lastReliableBallFrame: visionObs[visionObs.length - 1]?.frame || null,
      catchFrame: inputCatchFrame || null
    };
  }

  // 2. 檢驗觀測點間隙與時間連續性 (Temporal & Trajectory Consistency)
  let maxGap = 0;
  // FPS 動態調整允許的最大補點間隙 (約 0.25 秒)
  const allowedMaxGap = Math.max(2, Math.round(actualFps * 0.08));

  for (let i = 0; i < visionObs.length - 1; i++) {
    const gap = visionObs[i + 1].frame - visionObs[i].frame;
    if (gap > maxGap) {
      maxGap = gap;
    }
  }

  // 檢查平均信賴度
  const sumConf = visionObs.reduce((acc, cur) => acc + cur.confidence, 0);
  const meanConfidence = Number((sumConf / realObservationCount).toFixed(3));

  const evidence = assessTrackEvidence(visionObs, actualFps);
  if (meanConfidence < 0.50 || !evidence.valid) {
    return {
      status: 'insufficient_evidence',
      failureReason: `軌跡閘門：${evidence.reasons.join("、")}；Insufficient visual evidence：觀測點平均信賴度不足 (${(meanConfidence * 100).toFixed(1)}% < 50.0%)`,
      videoTrack: [],
      metrics: {
        horizontal_movement_2d_norm: 0,
        vertical_movement_2d_norm: 0,
        total_movement_2d_norm: 0,
        horizontal_movement_2d_px: 0,
        vertical_movement_2d_px: 0,
        total_movement_2d_px: 0,
        trajectory_curvature_score: 0,
        vision_detected_frames_count: realObservationCount,
        interpolated_frames_count: 0,
        tracking_ratio_pct: 0,
        tracking_quality_status: 'insufficient',
        visible_end_frame: visionObs[visionObs.length - 1].frame,
        is_manual_anchored: false
      },
      realObservationCount,
      interpolatedCount: 0,
      outlierCount: 0,
      meanConfidence,
      maxGapFrames: maxGap,
      firstReliableBallFrame: visionObs[0].frame,
      lastReliableBallFrame: visionObs[visionObs.length - 1].frame,
      catchFrame: inputCatchFrame || null
    };
  }

  // 3. 通過嚴格門檻：建構乾淨的 VIDEO TRACK (僅由 vision + 允許限額 short gap interpolation 組成)
  const firstFrame = visionObs[0].frame;
  const lastFrame = visionObs[visionObs.length - 1].frame;

  const obsMap = new Map<number, BallObservation>();
  for (const obs of visionObs) {
    obsMap.set(obs.frame, obs);
  }

  const trackPoints: BaseballTrackPoint[] = [];
  let interpolatedCount = 0;
  let outlierCount = 0;

  for (let f = firstFrame; f <= lastFrame; f++) {
    const direct = obsMap.get(f);
    if (direct) {
      trackPoints.push({
        frame: f,
        timestamp: direct.timestamp,
        x: direct.x,
        y: direct.y,
        x_norm: direct.x_norm,
        y_norm: direct.y_norm,
        radius: direct.radius,
        confidence: direct.confidence,
        source: 'vision'
      });
    } else {
      // 搜尋前後最近實測觀測點進行短距離運動學插值
      let prevObs: BallObservation | null = null;
      let nextObs: BallObservation | null = null;

      for (let i = visionObs.length - 1; i >= 0; i--) {
        if (visionObs[i].frame < f) {
          prevObs = visionObs[i];
          break;
        }
      }
      for (let i = 0; i < visionObs.length; i++) {
        if (visionObs[i].frame > f) {
          nextObs = visionObs[i];
          break;
        }
      }

      if (prevObs && nextObs) {
        const gap = nextObs.frame - prevObs.frame;
        if (gap <= allowedMaxGap) {
          const t = (f - prevObs.frame) / gap;
          const interpX = prevObs.x_norm + (nextObs.x_norm - prevObs.x_norm) * t;
          const interpY = prevObs.y_norm + (nextObs.y_norm - prevObs.y_norm) * t;

          trackPoints.push({
            frame: f,
            timestamp: prevObs.timestamp + (nextObs.timestamp - prevObs.timestamp) * t,
            x: Math.round(interpX * videoWidth),
            y: Math.round(interpY * videoHeight),
            x_norm: Number(interpX.toFixed(4)),
            y_norm: Number(interpY.toFixed(4)),
            radius: prevObs.radius,
            confidence: Number(((prevObs.confidence + nextObs.confidence) * 0.45).toFixed(3)),
            source: 'interpolated'
          });
          interpolatedCount++;
        }
      }
    }
  }

  // 4. 計算 2D 實際量測位移
  const pStart = trackPoints[0];
  const pEnd = trackPoints[trackPoints.length - 1];
  const dxPx = Math.abs(pEnd.x - pStart.x);
  const dyPx = Math.abs(pEnd.y - pStart.y);
  const totalPx = Math.round(Math.hypot(dxPx, dyPx));

  const dxNorm = Number(Math.abs(pEnd.x_norm - pStart.x_norm).toFixed(4));
  const dyNorm = Number(Math.abs(pEnd.y_norm - pStart.y_norm).toFixed(4));
  const totalNorm = Number(Math.hypot(dxNorm, dyNorm).toFixed(4));

  const totalFlightFrames = Math.max(1, lastFrame - firstFrame + 1);
  const trackingRatio = Number(((realObservationCount / totalFlightFrames) * 100).toFixed(1));

  return {
    status: 'valid',
    videoTrack: trackPoints,
    metrics: {
      horizontal_movement_2d_norm: dxNorm,
      vertical_movement_2d_norm: dyNorm,
      total_movement_2d_norm: totalNorm,
      horizontal_movement_2d_px: dxPx,
      vertical_movement_2d_px: dyPx,
      total_movement_2d_px: totalPx,
      trajectory_curvature_score: evidence.score * 100,
      vision_detected_frames_count: realObservationCount,
      interpolated_frames_count: interpolatedCount,
      tracking_ratio_pct: trackingRatio,
      tracking_quality_status: 'reliable',
      first_seen_frame: firstFrame,
      last_seen_frame: lastFrame,
      visible_end_frame: lastFrame,
      is_manual_anchored: false
    },
    realObservationCount,
    interpolatedCount,
    outlierCount,
    meanConfidence,
    maxGapFrames: maxGap,
    firstReliableBallFrame: firstFrame,
    lastReliableBallFrame: lastFrame,
    catchFrame: inputCatchFrame || null
  };
}
