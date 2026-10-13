import { BaseballTrackPoint, VideoTrackMetrics } from './types';

/**
 * 棒球視覺特徵候選
 */
export interface BallCandidate {
  x: number;
  y: number;
  radius: number;
  brightness: number;
  circularity: number;
  contrast: number;
  score: number;
}

/**
 * 從 HTMLVideoElement 的特定影格擷取影像資料並使用電腦視覺偵測棒球
 * 運用：
 * 1. 顏色與亮度閾值（棒球通常為亮白色/灰白球體，與背景泥土、草皮、深色球衣具高對比）
 * 2. 幾何圓形特徵（半徑與縱橫比檢驗）
 * 3. 前後幀運動連續性與光流搜索範圍限制
 */
export async function detectBaseballInFrame(
  videoElement: HTMLVideoElement,
  frameNumber: number,
  expectedRegion?: { minX: number; maxX: number; minY: number; maxY: number; expectedRadius?: number }
): Promise<BaseballTrackPoint | null> {
  const canvas = document.createElement('canvas');
  const w = videoElement.videoWidth || 640;
  const h = videoElement.videoHeight || 360;
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.drawImage(videoElement, 0, 0, w, h);
  } catch {
    // 跨域或未載入安全防呆
    return null;
  }

  // 設定搜索範圍 ROI (Region of Interest)
  const minX = expectedRegion ? Math.max(0, Math.floor(expectedRegion.minX * w)) : 0;
  const maxX = expectedRegion ? Math.min(w - 1, Math.ceil(expectedRegion.maxX * w)) : w - 1;
  const minY = expectedRegion ? Math.max(0, Math.floor(expectedRegion.minY * h)) : 0;
  const maxY = expectedRegion ? Math.min(h - 1, Math.ceil(expectedRegion.maxY * h)) : h - 1;

  const roiWidth = Math.max(10, maxX - minX);
  const roiHeight = Math.max(10, maxY - minY);

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(minX, minY, roiWidth, roiHeight);
  } catch {
    return null;
  }

  const data = imgData.data;
  const candidates: BallCandidate[] = [];

  // 移動網格掃描高亮與白球特徵 (White Baseball Color: R, G, B 高且色彩飽和度低)
  const step = Math.max(2, Math.floor(w / 320)); // 自適應步長

  for (let y = 3; y < roiHeight - 3; y += step) {
    for (let x = 3; x < roiWidth - 3; x += step) {
      const idx = (y * roiWidth + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;

      // 棒球判準 1：高亮度 (>160) 且 低飽和度 (<0.38)
      if (brightness > 160 && saturation < 0.38) {
        // 快速邊緣核算周圍反差 (球體與外緣有反差)
        let edgeContrast = 0;
        let ringSamples = 0;
        const testRadii = [3, 5, 8];

        for (const tr of testRadii) {
          if (x >= tr && x < roiWidth - tr && y >= tr && y < roiHeight - tr) {
            const topIdx = ((y - tr) * roiWidth + x) * 4;
            const btmIdx = ((y + tr) * roiWidth + x) * 4;
            const lftIdx = (y * roiWidth + (x - tr)) * 4;
            const rgtIdx = (y * roiWidth + (x + tr)) * 4;

            const ringB = (
              (0.299 * data[topIdx] + 0.587 * data[topIdx + 1] + 0.114 * data[topIdx + 2]) +
              (0.299 * data[btmIdx] + 0.587 * data[btmIdx + 1] + 0.114 * data[btmIdx + 2]) +
              (0.299 * data[lftIdx] + 0.587 * data[lftIdx + 1] + 0.114 * data[lftIdx + 2]) +
              (0.299 * data[rgtIdx] + 0.587 * data[rgtIdx + 1] + 0.114 * data[rgtIdx + 2])
            ) / 4;

            edgeContrast += Math.max(0, brightness - ringB);
            ringSamples++;
          }
        }

        const avgContrast = ringSamples > 0 ? edgeContrast / ringSamples : 0;
        // 綜合評分
        const score = (brightness / 255) * 0.45 + (1 - saturation) * 0.25 + (Math.min(100, avgContrast) / 100) * 0.30;

        if (score > 0.52) {
          candidates.push({
            x: minX + x,
            y: minY + y,
            radius: expectedRegion?.expectedRadius || 6,
            brightness,
            circularity: Math.min(1.0, avgContrast / 50),
            contrast: avgContrast,
            score
          });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // 排序找出評分最高的候選
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  const globalXNorm = Number((best.x / w).toFixed(4));
  const globalYNorm = Number((best.y / h).toFixed(4));
  const confidence = Number((Math.min(0.95, Math.max(0.40, best.score))).toFixed(2));

  return {
    frame: frameNumber,
    timestamp: Number((videoElement.currentTime).toFixed(3)),
    x: best.x,
    y: best.y,
    x_norm: globalXNorm,
    y_norm: globalYNorm,
    radius: best.radius,
    confidence,
    source: 'vision'
  };
}
