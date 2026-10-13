import { BaseballTrackPoint, BallObservation, VideoTrackMetrics } from './types';

/**
 * 軌跡重建與短缺補點處理器 (Trajectory Reconstruction & Interpolation)
 * 核心準則：
 * 1. VIDEO TRACK 只能來自：實際影片觀測 (observation) + 合理 short-gap interpolation。
 * 2. 絕不用 MODEL TRACK 冒充 VIDEO TRACK。
 * 3. 處理手機 24 FPS / 30 FPS 之時間間隙：
 *    - 於相鄰觀測點間，利用 2D 樣條或運動學位移進行 short gap interpolation。
 *    - 明確標記 source: 'observation' 或 source: 'interpolated'。
 * 4. 計算 VideoTrackMetrics，包含可見終點、有效幀率、位移量等。
 */

export interface TrajectoryReconstructOptions {
  observations: BallObservation[];
  releaseFrame: number;
  visibleEndFrame: number;
  fps: number;
  videoWidth?: number;
  videoHeight?: number;
  isManualAnchored?: boolean;
}

export function reconstructVideoTrack(
  options: TrajectoryReconstructOptions
): {
  videoTrack: BaseballTrackPoint[];
  videoMetrics: VideoTrackMetrics;
} {
  const {
    observations,
    releaseFrame,
    visibleEndFrame,
    fps,
    videoWidth = 720,
    videoHeight = 1280,
    isManualAnchored = false
  } = options;

  if (!observations || observations.length === 0) {
    return {
      videoTrack: [],
      videoMetrics: {
        horizontal_movement_2d_norm: 0,
        vertical_movement_2d_norm: 0,
        total_movement_2d_norm: 0,
        horizontal_movement_2d_px: 0,
        vertical_movement_2d_px: 0,
        total_movement_2d_px: 0,
        trajectory_curvature_score: 0,
        vision_detected_frames_count: 0,
        interpolated_frames_count: 0,
        tracking_ratio_pct: 0,
        tracking_quality_status: 'insufficient',
        visible_end_frame: visibleEndFrame,
        is_manual_anchored: false
      }
    };
  }

  // 排序觀測點
  const sortedObs = [...observations].sort((a, b) => a.frame - b.frame);
  const firstFrame = sortedObs[0].frame;
  const lastFrame = sortedObs[sortedObs.length - 1].frame;

  const trackPoints: BaseballTrackPoint[] = [];
  let obsCount = 0;
  let interpCount = 0;

  // 快速映射
  const obsMap = new Map<number, BallObservation>();
  for (const obs of sortedObs) {
    obsMap.set(obs.frame, obs);
  }

  // 1. 在首尾可見影格之間建立連續的時間軌跡點
  for (let f = firstFrame; f <= lastFrame; f++) {
    const directObs = obsMap.get(f);

    if (directObs) {
      trackPoints.push({
        frame: f,
        timestamp: Number((f / fps).toFixed(3)),
        x: directObs.x,
        y: directObs.y,
        x_norm: directObs.x_norm,
        y_norm: directObs.y_norm,
        radius: directObs.radius,
        confidence: directObs.confidence,
        source: 'vision' // 實測觀測點
      });
      obsCount++;
    } else {
      // 尋找前後最近的觀測點進行運動插值 (Short Gap Interpolation)
      let prevObs: BallObservation | null = null;
      let nextObs: BallObservation | null = null;

      for (let i = sortedObs.length - 1; i >= 0; i--) {
        if (sortedObs[i].frame < f) {
          prevObs = sortedObs[i];
          break;
        }
      }
      for (let i = 0; i < sortedObs.length; i++) {
        if (sortedObs[i].frame > f) {
          nextObs = sortedObs[i];
          break;
        }
      }

      if (prevObs && nextObs) {
        const gap = nextObs.frame - prevObs.frame;
        // 容許最多 10 幀的短缺補點（在 24 FPS 下約 0.4 秒）
        if (gap <= 10) {
          const t = (f - prevObs.frame) / gap;
          // 平滑插值 (加權微調考慮重力微微下墜)
          const interpX = prevObs.x_norm + (nextObs.x_norm - prevObs.x_norm) * t;
          // 加速前進與輕微拋物弧線插值
          const arcDrop = Math.sin(t * Math.PI) * 0.008;
          const interpY = prevObs.y_norm + (nextObs.y_norm - prevObs.y_norm) * t + arcDrop;
          const interpR = prevObs.radius + (nextObs.radius - prevObs.radius) * t;
          const interpConf = Number((Math.min(prevObs.confidence, nextObs.confidence) * 0.85).toFixed(2));

          trackPoints.push({
            frame: f,
            timestamp: Number((f / fps).toFixed(3)),
            x: Math.round(interpX * videoWidth),
            y: Math.round(interpY * videoHeight),
            x_norm: Number(interpX.toFixed(4)),
            y_norm: Number(interpY.toFixed(4)),
            radius: Number(interpR.toFixed(1)),
            confidence: interpConf,
            source: 'interpolated' // 明確標記為插值點
          });
          interpCount++;
        }
      }
    }
  }

  // 2. 計算 2D 實際觀測位移指標
  let horizNorm = 0;
  let vertNorm = 0;
  let totalNorm = 0;
  let horizPx = 0;
  let vertPx = 0;
  let totalPx = 0;
  let curvatureScore = 0;

  if (trackPoints.length >= 2) {
    const startPt = trackPoints[0];
    const endPt = trackPoints[trackPoints.length - 1];

    horizNorm = Number((endPt.x_norm - startPt.x_norm).toFixed(4));
    vertNorm = Number((endPt.y_norm - startPt.y_norm).toFixed(4));
    totalNorm = Number(Math.hypot(horizNorm, vertNorm).toFixed(4));

    horizPx = endPt.x - startPt.x;
    vertPx = endPt.y - startPt.y;
    totalPx = Math.round(Math.hypot(horizPx, vertPx));

    // 計算二階微分離散度 (曲度)
    if (trackPoints.length >= 3) {
      let maxDev = 0;
      for (let i = 1; i < trackPoints.length - 1; i++) {
        const t = i / (trackPoints.length - 1);
        const lineX = startPt.x_norm + horizNorm * t;
        const lineY = startPt.y_norm + vertNorm * t;
        const dev = Math.hypot(trackPoints[i].x_norm - lineX, trackPoints[i].y_norm - lineY);
        maxDev = Math.max(maxDev, dev);
      }
      curvatureScore = Number((Math.min(100, maxDev * 600)).toFixed(1));
    }
  }

  const totalFlightFrames = Math.max(1, visibleEndFrame - releaseFrame + 1);
  const trackingRatio = Math.round((obsCount / totalFlightFrames) * 100);

  let status: 'reliable' | 'insufficient' | 'degraded' = 'reliable';
  if (isManualAnchored) {
    status = obsCount >= 2 ? 'reliable' : 'insufficient';
  } else if (obsCount < 3) {
    status = 'insufficient';
  } else if (obsCount < 5 || trackingRatio < 35) {
    status = 'degraded';
  }

  const videoMetrics: VideoTrackMetrics = {
    horizontal_movement_2d_norm: horizNorm,
    vertical_movement_2d_norm: vertNorm,
    total_movement_2d_norm: totalNorm,
    horizontal_movement_2d_px: horizPx,
    vertical_movement_2d_px: vertPx,
    total_movement_2d_px: totalPx,
    trajectory_curvature_score: curvatureScore,
    vision_detected_frames_count: obsCount,
    interpolated_frames_count: interpCount,
    tracking_ratio_pct: trackingRatio,
    tracking_quality_status: status,
    first_seen_frame: firstFrame,
    last_seen_frame: lastFrame,
    visible_end_frame: visibleEndFrame,
    is_manual_anchored: isManualAnchored
  };

  return {
    videoTrack: trackPoints,
    videoMetrics
  };
}
