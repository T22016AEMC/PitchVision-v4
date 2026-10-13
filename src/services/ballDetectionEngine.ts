import { BallCandidate, BallObservation, CameraViewMode, ManualAnchorInput } from '../types';
import { isCompactBrightRegion } from './compactBallAppearance';
import { motionForeground } from './motionForeground';

export interface BallDetectionEngineOptions {
  width: number;
  height: number;
  cameraView: CameraViewMode;
  manualAnchor?: ManualAnchorInput;
  expectedBallRadiusPx?: number;
}

/**
 * BallDetectionEngine
 * 統一的棒球候選點與外觀/運動特徵評分引擎
 * 綜合評分：
 * ballScore = appearanceScore + motionScore + temporalScore + spatialScore + sizeScore + continuityScore - backgroundPenalty - jumpPenalty
 */
export class BallDetectionEngine {
  private width: number;
  private height: number;
  private cameraView: CameraViewMode;
  private manualAnchor?: ManualAnchorInput;
  private expectedRadius: number;

  constructor(options: BallDetectionEngineOptions) {
    this.width = options.width || 720;
    this.height = options.height || 1280;
    this.cameraView = options.cameraView || 'catcher';
    this.manualAnchor = options.manualAnchor;
    this.expectedRadius = options.expectedBallRadiusPx || Math.max(3, Math.min(12, Math.round(this.width * 0.009)));
  }

  /**
   * 計算特定 ROI 內之候選評分
   */
  detectCandidatesInRoi(
    currImage: ImageData,
    prevImage: ImageData | null,
    frameIndex: number,
    timestamp: number,
    roi: { xMin: number; xMax: number; yMin: number; yMax: number },
    priorPosition?: { x: number; y: number } | null
  ): BallCandidate[] {
    const candidates: BallCandidate[] = [];
    const w = currImage.width;
    const h = currImage.height;
    const currData = currImage.data;
    const prevData = prevImage?.data;
    const movingBody=motionForeground(currImage,prevImage).bounds;

    const xStart = Math.max(0, Math.floor(roi.xMin * w));
    const xEnd = Math.min(w, Math.ceil(roi.xMax * w));
    const yStart = Math.max(0, Math.floor(roi.yMin * h));
    const yEnd = Math.min(h, Math.ceil(roi.yMax * h));

    const step = 4; // Coarse-to-fine step

    for (let y = yStart; y < yEnd - step; y += step) {
      for (let x = xStart; x < xEnd - step; x += step) {
        const idx = (y * w + x) * 4;
        const r = currData[idx];
        const g = currData[idx + 1];
        const b = currData[idx + 2];

        // 1. Appearance: 亮度與棒球偏白特徵
        const brightness = (r + g + b) / 3.0;
        if (brightness < 125) continue; // 過暗非白球

        const colorDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        if (colorDiff > 45) continue; // 高彩度 (非白球，例如紅衣、藍網)

        const appearanceScore = Math.min(1.0, (brightness / 255.0) * 0.8 + (1.0 - colorDiff / 50.0) * 0.2);

        // 2. Motion: 幀差動態特徵
        let motionScore = 0.5;
        if (prevData) {
          const pr = prevData[idx];
          const pg = prevData[idx + 1];
          const pb = prevData[idx + 2];
          const frameDiff = (Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb)) / 3.0;
          motionScore = Math.min(1.0, frameDiff / 60.0);
        }

        if (prevData && motionScore < 0.25) continue;
        const rr = Math.max(3, Math.round(this.expectedRadius));
        let ring = 0, samples = 0;
        for (const [ox,oy] of [[-rr,0],[rr,0],[0,-rr],[0,rr]]) {
          const xx=Math.max(0,Math.min(w-1,x+ox)), yy=Math.max(0,Math.min(h-1,y+oy)), ii=(yy*w+xx)*4;
          ring+=(currData[ii]+currData[ii+1]+currData[ii+2])/3;samples++;
        }
        if (brightness-ring/samples < 12) continue;
        if (!isCompactBrightRegion(currImage,x,y,this.expectedRadius*2)) continue;
        if(movingBody&&x/w>=movingBody.xMin&&x/w<=movingBody.xMax&&y/h>=movingBody.yMin&&y/h<=movingBody.yMax)continue;
        // 3. Spatial & Pitch Corridor: 與預測走廊的距離
        let spatialScore = 0.8;
        let jumpPenalty = 0.0;
        const xNorm = x / w;
        const yNorm = y / h;

        if (priorPosition) {
          const dxNorm = Math.abs(xNorm - priorPosition.x / w);
          const dyNorm = Math.abs(yNorm - priorPosition.y / h);
          const distNorm = Math.sqrt(dxNorm * dxNorm + dyNorm * dyNorm);

          // 棒球單幀位移在 0.01 ~ 0.12 之間為合理範圍
          if (distNorm > 0.20) {
            jumpPenalty = 0.45;
            spatialScore = 0.2;
          } else if (distNorm > 0.10) {
            spatialScore = 0.5;
            jumpPenalty = 0.15;
          } else {
            spatialScore = 1.0 - distNorm * 4;
          }
        }

        // 4. Background Penalty: 排除網子、看台橫條紋
        let backgroundPenalty = 0.0;
        // 畫面最頂部通常為記分板或看台
        if (yNorm < 0.12 || yNorm > 0.90) {
          backgroundPenalty += 0.35;
        }

        // 5. Size & Compactness: 圓形局部對比
        const sizeScore = 0.85;
        const temporalScore = 0.8;
        const continuityScore = priorPosition ? 0.9 : 0.6;

        const totalScore = Math.max(
          0.0,
          Math.min(
            1.0,
            appearanceScore * 0.30 +
              motionScore * 0.25 +
              spatialScore * 0.25 +
              temporalScore * 0.10 +
              sizeScore * 0.10 -
              backgroundPenalty -
              jumpPenalty
          )
        );

        if (totalScore >= 0.45) {
          candidates.push({
            frame: frameIndex,
            timestamp,
            x,
            y,
            x_norm: Number(xNorm.toFixed(4)),
            y_norm: Number(yNorm.toFixed(4)),
            radius: this.expectedRadius,
            width: this.expectedRadius * 2,
            height: this.expectedRadius * 2,
            score: Number(totalScore.toFixed(3)),
            components: {
              appearanceScore: Number(appearanceScore.toFixed(2)),
              motionScore: Number(motionScore.toFixed(2)),
              temporalScore: Number(temporalScore.toFixed(2)),
              spatialScore: Number(spatialScore.toFixed(2)),
              sizeScore: Number(sizeScore.toFixed(2)),
              continuityScore: Number(continuityScore.toFixed(2)),
              backgroundPenalty: Number(backgroundPenalty.toFixed(2)),
              jumpPenalty: Number(jumpPenalty.toFixed(2))
            }
          });
        }
      }
    }

    // 依分數降冪排序，並過濾過近重複點
    candidates.sort((a, b) => b.score - a.score);
    return this.clusterAndFilterCandidates(candidates);
  }

  /**
   * 非極大值抑制 (NMS) 與群集過濾
   */
  private clusterAndFilterCandidates(rawList: BallCandidate[], maxRadiusPx: number = 20): BallCandidate[] {
    const filtered: BallCandidate[] = [];
    for (const cand of rawList) {
      const tooClose = filtered.some((f) => {
        const dx = f.x - cand.x;
        const dy = f.y - cand.y;
        return Math.sqrt(dx * dx + dy * dy) < maxRadiusPx;
      });
      if (!tooClose) {
        filtered.push(cand);
        if (filtered.length >= 8) break; // 最多保留前 8 個候選點
      }
    }
    return filtered;
  }
}
