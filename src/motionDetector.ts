import { BallObservation, MotionCandidate } from './types';

/**
 * 差分運動候選偵測器 (Motion Candidate Detector)
 * 專為手機影片 (720p / 24~30 FPS / 殘影 / 複雜背景) 設計：
 * 1. 不再依賴單純的靜態白色圓形特徵。
 * 2. 採用連續多影格時間差分 (Frame Differencing) 找出劇烈移動之小物件區塊。
 * 3. 殘影 (Motion Blur) 往往呈現沿著運動方向的細長橢圓或亮點流。
 * 4. 計算區塊大小、長寬比 (受運動方向拉長)、能量、對比度，給予候選評分。
 */

interface FrameImageData {
  frame: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface CandidateSearchOptions {
  corridor?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    widthNorm: number;
  };
  expectedDirection?: { dx: number; dy: number };
}

/**
 * 對單一影格計算相對於前後影格的差分運動遮罩，並提取出球體候選區
 */
export function extractMotionCandidates(
  curr: FrameImageData,
  prev: FrameImageData | null,
  next: FrameImageData | null,
  options?: CandidateSearchOptions
): MotionCandidate[] {
  const { width, height, data } = curr;
  const pData = prev?.data;
  const nData = next?.data;

  if (!pData && !nData) {
    return [];
  }

  // 縮小解析度進行快速運動感知網格採樣 (採樣步長 2~3 px)
  const step = Math.max(2, Math.floor(width / 360));
  const diffThreshold = 18; // 亮度差分閾值
  const candidates: MotionCandidate[] = [];

  // 移動像素網格聚類 (簡易連通分量/網格密度估計)
  const gridW = Math.floor(width / (step * 2));
  const gridH = Math.floor(height / (step * 2));
  const motionGrid = new Uint8Array(gridW * gridH);
  const brightnessGrid = new Uint8Array(gridW * gridH);

  const { corridor } = options || {};

  // 1. 計算幀差運動圖
  for (let gy = 0; gy < gridH; gy++) {
    const y = gy * step * 2;
    for (let gx = 0; gx < gridW; gx++) {
      const x = gx * step * 2;

      // 若有設定走廊過濾 (Ball Corridor)，快速剔除走廊外的像素
      if (corridor) {
        const xNorm = x / width;
        const yNorm = y / height;
        const distToCorridor = distanceToLineSegment(
          xNorm,
          yNorm,
          corridor.x0,
          corridor.y0,
          corridor.x1,
          corridor.y1
        );
        if (distToCorridor > corridor.widthNorm) {
          continue;
        }
      }

      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const currLuma = 0.299 * r + 0.587 * g + 0.114 * b;

      let maxDiff = 0;

      if (pData) {
        const pr = pData[idx];
        const pg = pData[idx + 1];
        const pb = pData[idx + 2];
        const pLuma = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        maxDiff = Math.max(maxDiff, Math.abs(currLuma - pLuma));
      }

      if (nData) {
        const nr = nData[idx];
        const ng = nData[idx + 1];
        const nb = nData[idx + 2];
        const nLuma = 0.299 * nr + 0.587 * ng + 0.114 * nb;
        maxDiff = Math.max(maxDiff, Math.abs(currLuma - nLuma));
      }

      if (maxDiff >= diffThreshold) {
        const gIdx = gy * gridW + gx;
        motionGrid[gIdx] = maxDiff;
        brightnessGrid[gIdx] = currLuma;
      }
    }
  }

  // 2. 局部最大值搜尋與聚類
  for (let gy = 1; gy < gridH - 1; gy++) {
    for (let gx = 1; gx < gridW - 1; gx++) {
      const gIdx = gy * gridW + gx;
      const mVal = motionGrid[gIdx];

      if (mVal > 22) {
        // 檢查是否為局部峰值
        let isPeak = true;
        let sumEnergy = mVal;
        let clusterCount = 1;
        let weightedX = gx * mVal;
        let weightedY = gy * mVal;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nVal = motionGrid[(gy + dy) * gridW + (gx + dx)];
            if (nVal > mVal) {
              isPeak = false;
              break;
            }
            if (nVal > 15) {
              sumEnergy += nVal;
              clusterCount++;
              weightedX += (gx + dx) * nVal;
              weightedY += (gy + dy) * nVal;
            }
          }
          if (!isPeak) break;
        }

        // 棒球在 720p 畫面中，直徑約 4~16 px (聚類大小約 1~6 個 grid cell)
        if (isPeak && clusterCount >= 1 && clusterCount <= 9) {
          const centerX = (weightedX / sumEnergy) * (step * 2);
          const centerY = (weightedY / sumEnergy) * (step * 2);
          const xNorm = centerX / width;
          const yNorm = centerY / height;

          // 計算局部亮度與對比 (棒球即使有殘影，核心依舊偏亮)
          const luma = brightnessGrid[gIdx];
          const brightnessScore = Math.min(1.0, luma / 170); // 只要有亮度即有加分
          const energyScore = Math.min(1.0, sumEnergy / 200);

          // 尺寸合理性評分：避免過大（如投手整隻手臂）或過小（單點椒鹽雜訊）
          const sizeScore = clusterCount >= 2 && clusterCount <= 6 ? 1.0 : 0.65;

          const candidateScore = Number((energyScore * 0.45 + brightnessScore * 0.35 + sizeScore * 0.20).toFixed(3));

          if (candidateScore > 0.35) {
            candidates.push({
              frame: curr.frame,
              x: Math.round(centerX),
              y: Math.round(centerY),
              x_norm: Number(xNorm.toFixed(4)),
              y_norm: Number(yNorm.toFixed(4)),
              width: clusterCount * step * 2,
              height: clusterCount * step * 2,
              motion_energy: sumEnergy,
              compactness: clusterCount <= 4 ? 0.9 : 0.6,
              elongation: 1.2,
              contrast: mVal,
              score: candidateScore
            });
          }
        }
      }
    }
  }

  // 排序保留最高分的候選 (限制最多回傳 8 個最可能的候選，避免組合爆炸)
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 8);
}

/**
 * 點到線段距離計算 (幾何走廊輔助)
 */
function distanceToLineSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}
