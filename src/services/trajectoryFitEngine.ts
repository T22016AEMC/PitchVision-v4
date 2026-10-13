import {
  BaseballTrackPoint,
  TrajectoryPoint,
  TrajectoryFitMetrics
} from '../types';

export interface TrajectoryFitInput {
  videoTrack: BaseballTrackPoint[];
  modelTrack: TrajectoryPoint[];
  videoWidth?: number;
  videoHeight?: number;
}

/**
 * 前向驗證與軌跡擬合比對引擎 (Forward Validation & Trajectory Fit Engine)
 * 責任：
 * 閉環校驗 (Closed-Loop Validation)：
 * VIDEO TRACK (影片真實觀測)
 *   ↓
 * 估計 RPM + Spin Axis + IVB/HB
 *   ↓
 * 物理模型重新生成 MODEL TRACK
 *   ↓
 * 與 VIDEO TRACK 比對
 *   ↓
 * 計算 Trajectory Fit Error (RMSE, Mean Error, Max Error, Fit Quality)
 *   ↓
 * 擬合極佳 -> 提高信心度；擬合偏離 -> 降低信心度
 */
export class TrajectoryFitEngine {
  static evaluateTrajectoryFit(input: TrajectoryFitInput): TrajectoryFitMetrics {
    const {
      videoTrack = [],
      modelTrack = [],
      videoWidth = 720,
      videoHeight = 1280
    } = input;

    // 建立 Model Track 的影格速查表
    const modelMap = new Map<number, TrajectoryPoint>();
    for (const pt of modelTrack) {
      modelMap.set(pt.frame, pt);
    }

    // 僅比對 VIDEO TRACK 中真實觀測到 (vision) 或插值 (interpolated) 的影格
    const errorsPx: number[] = [];
    let maxErrorPx = 0;

    for (const vPt of videoTrack) {
      const mPt = modelMap.get(vPt.frame);
      if (!mPt || vPt.source !== 'vision') continue;

      // 轉換為像素距離誤差
      const dx = (vPt.x_norm - mPt.x_norm) * videoWidth;
      const dy = (vPt.y_norm - mPt.y_norm) * videoHeight;
      const err = Math.hypot(dx, dy);

      errorsPx.push(err);
      if (err > maxErrorPx) {
        maxErrorPx = err;
      }
    }

    if (errorsPx.length < 3) {
      return {
        rmse_px: 0,
        mean_error_px: 0,
        max_error_px: 0,
        max_deviation_px: 0,
        fit_score: 0,
        fit_quality: 'NOT_VALIDATED',
        compared_points_count: errorsPx.length,
        compared_frames_count: errorsPx.length,
        summary: '不足3個獨立真實觀測重疊影格，RMSE與閉環擬合未驗證；插值不當作觀測'
      };
    }

    // 計算 RMSE (Root-Mean-Square Error)
    const sumSq = errorsPx.reduce((acc, cur) => acc + cur * cur, 0);
    const rmsePx = Number(Math.sqrt(sumSq / errorsPx.length).toFixed(1));

    // 計算平均像素誤差
    const meanErr = Number(
      (errorsPx.reduce((acc, cur) => acc + cur, 0) / errorsPx.length).toFixed(1)
    );

    // 計算擬合品質分數 (0 ~ 100)
    // 在 720x1280 解析度下，RMSE <= 12px 評為極優，25px 為良好，> 50px 為偏差較大
    const fitScore = Math.round(
      Math.max(10, Math.min(98, 100 * Math.exp(-rmsePx / 32.0)))
    );

    let fitQuality: 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'POOR' = 'MODERATE';
    if (fitScore >= 80) {
      fitQuality = 'EXCELLENT';
    } else if (fitScore >= 65) {
      fitQuality = 'GOOD';
    } else if (fitScore >= 45) {
      fitQuality = 'MODERATE';
    } else {
      fitQuality = 'POOR';
    }

    const summary = `比對 ${errorsPx.length} 個時空影格：RMSE ${rmsePx}px (均差 ${meanErr}px, 最大差 ${maxErrorPx.toFixed(1)}px)，前向擬合評定為【${fitQuality}】`;

    return {
      rmse_px: rmsePx,
      mean_error_px: meanErr,
      max_error_px: Number(maxErrorPx.toFixed(1)),
      max_deviation_px: Number(maxErrorPx.toFixed(1)),
      fit_score: fitScore,
      fit_quality: fitQuality,
      compared_points_count: errorsPx.length,
      compared_frames_count: errorsPx.length,
      summary
    };
  }
}
