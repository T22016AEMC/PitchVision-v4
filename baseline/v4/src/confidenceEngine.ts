import { UnifiedConfidenceScores, VideoTrackMetrics } from './types';

export interface ConfidenceInput {
  fps: number;
  totalVideoFrames: number;
  releaseFrame: number;
  gloveFrame: number;
  isUserConfirmedFrames: boolean;
  isManualAnchorUsed?: boolean;
  autoDetectionConfidence?: number;
  videoMetrics?: VideoTrackMetrics;
  dbSimilarityScore?: number;
  candidateSpreadRpm?: number;
  trajectoryFitScore?: number;
  trajectoryRmsePx?: number;
  movementUncertaintyInch?: number;
  velocityUncertaintyKmh?: number;
  isCrossTypeFallback?: boolean;
  isInsufficientPitchTypeData?: boolean;
  physicsConsistencyScore?: number;
  isReleaseAngleEstimated?: boolean;
  cameraCalibrationQuality?: number;
}

/**
 * 統一可信度評估引擎 (Unified Confidence Engine)
 * 嚴格納入 12 項動態品質指標，禁止回傳固定常數分數：
 * 1. Ball detection quality
 * 2. Tracking ratio
 * 3. Vision observation count
 * 4. Interpolation ratio
 * 5. Camera calibration quality (Perspective / Scale vs 3D Homography)
 * 6. Movement uncertainty
 * 7. Velocity uncertainty
 * 8. Database candidate similarity
 * 9. Candidate spread
 * 10. Physics consistency
 * 11. Trajectory fit error (VIDEO TRACK vs PHYSICS MODEL TRACK)
 * 12. Release angle reliability & Manual Anchor frame confidence
 */
export function calculateUnifiedConfidence(input: ConfidenceInput): UnifiedConfidenceScores {
  const {
    fps,
    releaseFrame,
    gloveFrame,
    isUserConfirmedFrames,
    isManualAnchorUsed = false,
    autoDetectionConfidence,
    videoMetrics,
    dbSimilarityScore = 72,
    candidateSpreadRpm = 90,
    trajectoryFitScore,
    trajectoryRmsePx,
    movementUncertaintyInch = 1.5,
    velocityUncertaintyKmh = 1.5,
    isCrossTypeFallback = false,
    isInsufficientPitchTypeData = false,
    physicsConsistencyScore = 85,
    isReleaseAngleEstimated = false,
    cameraCalibrationQuality = 72
  } = input;

  const notes: string[] = [];

  // 1. 影片與時間解析度品質
  const safeFps = Math.max(12, fps);
  let vidQuality = Math.round(Math.min(95, Math.max(32, 35 + Math.log2(safeFps / 15) * 22)));
  if (safeFps >= 115) {
    notes.push(`高幀率影片 (${safeFps.toFixed(1)} FPS)，時間取樣解析度優異`);
  } else if (safeFps >= 55) {
    notes.push(`中高速運動影片 (${safeFps.toFixed(1)} FPS)，時間解析度良好`);
  } else {
    notes.push(`標準/低幀率影片 (${safeFps.toFixed(1)} FPS)，曝光快門時間步長較大`);
  }

  // 2. 出手與進手套影格可信度 (若使用手動錨點或手動指定，降低 Frame Detection Confidence，但與球體追蹤品質獨立)
  const flightFrames = Math.max(1, gloveFrame - releaseFrame);
  const flightSec = flightFrames / safeFps;

  let baseFrameConf =
    autoDetectionConfidence !== undefined && autoDetectionConfidence > 0
      ? autoDetectionConfidence
      : isUserConfirmedFrames
      ? 74
      : 58;

  if (isManualAnchorUsed) {
    baseFrameConf = Math.min(baseFrameConf, 64);
    notes.push('已套用手動錨點 (Manual Anchor)：Frame Detection 自動偵測信心度調降，但保留走廊內實測球體追蹤品質');
  }

  let relConf = Math.round(baseFrameConf - velocityUncertaintyKmh * 2.5);
  let catchConf = Math.round(baseFrameConf - velocityUncertaintyKmh * 2.5);

  if (flightSec < 0.28 || flightSec > 0.85) {
    relConf = Math.min(relConf, 42);
    catchConf = Math.min(catchConf, 42);
    notes.push(`飛行時間 (${flightSec.toFixed(3)}s) 超出常規物理範圍 (0.28s ~ 0.85s)，Frame Detection 信心度顯著調降`);
  } else {
    notes.push(`飛行時間 ${flightSec.toFixed(3)}s (球速不確定度 ±${velocityUncertaintyKmh} km/h)`);
  }

  relConf = Math.max(20, Math.min(94, relConf));
  catchConf = Math.max(20, Math.min(94, catchConf));

  // 3. 棒球追蹤可信度 (依據實測觀測點數、覆蓋率、插值比例、平均觀測分數動態計算)
  let trackConf = 22;
  if (videoMetrics) {
    const obsCount = videoMetrics.vision_detected_frames_count || 0;
    const interpCount = videoMetrics.interpolated_frames_count || 0;
    const trackRatio = videoMetrics.tracking_ratio_pct || 0;
    const meanObsConf = (videoMetrics.mean_observation_confidence || 0.5) * 100;
    const interpRatio = obsCount + interpCount > 0 ? interpCount / (obsCount + interpCount) : 1.0;

    if (obsCount >= 3 && videoMetrics.tracking_quality_status !== 'insufficient') {
      const obsScore = Math.min(35, obsCount * 3.2);
      const ratioScore = trackRatio * 0.28;
      const appScore = meanObsConf * 0.25;
      const interpPenalty = interpRatio * 18;
      trackConf = Math.round(Math.max(28, Math.min(95, 15 + obsScore + ratioScore + appScore - interpPenalty)));
      notes.push(
        `實測視覺追蹤：${obsCount} 個真實觀測點、覆蓋率 ${trackRatio}%、插值比例 ${(interpRatio * 100).toFixed(0)}%`
      );
    } else if (obsCount >= 1) {
      trackConf = Math.round(24 + obsCount * 8);
      notes.push(`僅取得 ${obsCount} 個稀疏觀測點 (< 3 點門檻)，視覺證據不足`);
    } else {
      trackConf = 18;
      notes.push('未偵測到有效棒球實測點 (INSUFFICIENT EVIDENCE)');
    }
  }

  // 4. 物理重建與前向閉環擬合可信度 (Trajectory Fit: VIDEO TRACK vs PHYSICS MODEL TRACK)
  let trajConf = 35;
  if (trajectoryFitScore !== undefined) {
    trajConf = Math.round(
      trajectoryFitScore * 0.8 + (cameraCalibrationQuality * 0.2)
    );
    if (trajectoryRmsePx !== undefined && trajectoryRmsePx > 35) {
      trajConf = Math.max(20, trajConf - 15);
      notes.push(`VIDEO TRACK 與 PHYSICS MODEL TRACK 閉環誤差較大 (RMSE ${trajectoryRmsePx}px)，降低模型擬合信心度`);
    } else if (trajectoryRmsePx !== undefined && trajectoryRmsePx > 0) {
      notes.push(`前向物理重建擬合驗證：RMSE ${trajectoryRmsePx}px (擬合評分 ${trajectoryFitScore}%)`);
    }
  } else if (videoMetrics && videoMetrics.vision_detected_frames_count >= 3) {
    const agreement = videoMetrics.forward_backward_agreement_pct || 72;
    trajConf = Math.round(agreement * 0.68 + cameraCalibrationQuality * 0.2);
  }
  trajConf = Math.max(18, Math.min(95, trajConf));

  // 5. 資料庫反推與候選收斂可信度 (考慮相似度、候選離散度、物理一致性、出手角估計狀態)
  const spreadPenalty = Math.min(22, Math.max(0, (candidateSpreadRpm - 50) * 0.08));
  const releaseAnglePenalty = isReleaseAngleEstimated ? 5 : 0;
  let dbConf = Number(
    Math.max(
      18,
      Math.min(
        94,
        dbSimilarityScore * 0.65 + physicsConsistencyScore * 0.35 - spreadPenalty - releaseAnglePenalty
      )
    ).toFixed(1)
  );

  if (isCrossTypeFallback) {
    dbConf = Math.min(dbConf, 46);
    notes.push('⚠️ 已啟用 Cross-Type Fallback 跨球種備援，RPM/Axis 反推信心度顯著調降');
  }
  if (isInsufficientPitchTypeData) {
    dbConf = 15;
    notes.push('❌ 指定球種參考資料不足，無法可靠反推 RPM / Spin Axis');
  }

  // 6. 分項信心度與綜合結算
  const velocityConfidence = Number(
    Math.max(25, Math.min(95, (vidQuality * 0.4 + relConf * 0.3 + catchConf * 0.3) - velocityUncertaintyKmh * 3)).toFixed(1)
  );
  const movementConfidence = Number(
    Math.max(20, Math.min(94, trackConf * 0.6 + cameraCalibrationQuality * 0.4 - movementUncertaintyInch * 6)).toFixed(1)
  );
  const spinConfidence = Number(
    Math.max(18, Math.min(92, dbConf * 0.55 + movementConfidence * 0.25 + trajConf * 0.20)).toFixed(1)
  );

  const rawOverall =
    velocityConfidence * 0.20 +
    movementConfidence * 0.28 +
    spinConfidence * 0.27 +
    trajConf * 0.25;

  const overall = Number(Math.max(16, Math.min(94, rawOverall)).toFixed(1));

  return {
    video_quality_confidence: vidQuality,
    release_frame_confidence: relConf,
    catch_frame_confidence: catchConf,
    baseball_tracking_confidence: trackConf,
    trajectory_confidence: trajConf,
    database_match_confidence: dbConf,
    velocity_confidence: velocityConfidence,
    movement_confidence: movementConfidence,
    spin_confidence: spinConfidence,
    trajectory_fit_confidence: trajConf,
    overall_confidence: overall,
    quality_notes: notes
  };
}
