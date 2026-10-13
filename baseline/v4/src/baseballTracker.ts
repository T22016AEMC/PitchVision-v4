import { BallObservation, ManualAnchorInput } from './types';
import { extractMotionCandidates } from './motionDetector';

export interface SparseTrackingOptions {
  releaseFrame: number;
  visibleEndFrame?: number;
  catchFrame?: number | null;
  fps: number;
  cameraView: 'catcher' | 'pitcher_rear';
  manualAnchor?: ManualAnchorInput;
  onProgress?: (progressPct: number, currentFrame: number, stageText: string) => void;
}

export interface SparseTrackingResult {
  observations: BallObservation[];
  visibleEndFrame: number;
  firstSeenFrame: number;
  lastSeenFrame: number;
  status: 'reliable' | 'sparse' | 'insufficient_evidence';
  statusMessage: string;
}

function captureFrameCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  frame: number,
  timeSec: number
): Promise<{ frame: number; width: number; height: number; data: Uint8ClampedArray } | null> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({
          frame,
          width: canvas.width,
          height: canvas.height,
          data: imgData.data
        });
      } catch {
        resolve(null);
      }
    };

    video.addEventListener('seeked', onSeeked);
    const safeTime = Math.max(0, Math.min(video.duration || 100, timeSec));
    video.currentTime = safeTime;
  });
}

/**
 * 核心稀疏追蹤引擎 (FPS-Aware Temporal Ball Tracking)
 * 1. 嚴格遵守 ACCURACY > COVERAGE。
 * 2. 嚴禁手動兩點直接連線當成球路（手動錨點作為空間提示搜尋真實球影像證據）。
 * 3. 搜尋半徑、位移依 actualFps 動態調整（24, 30, 60, 120, 240 FPS）。
 * 4. 至少需要 >= 3 個具有真實視覺證據之觀測點。
 */
export async function trackBaseballSparse(
  videoElement: HTMLVideoElement,
  options: SparseTrackingOptions
): Promise<SparseTrackingResult> {
  const {
    releaseFrame,
    visibleEndFrame: inputEndFrame,
    catchFrame,
    fps,
    cameraView,
    manualAnchor,
    onProgress
  } = options;

  const w = videoElement.videoWidth || 720;
  const h = videoElement.videoHeight || 1280;

  // 掃描終點影格（不猜測，最高約 0.8 秒飛行上限）
  const maxScanSec = 0.8;
  const maxScanFrames = Math.round(fps * maxScanSec);
  const searchEndFrame = inputEndFrame || (catchFrame ? catchFrame : Math.min(Math.round((videoElement.duration || 6) * fps), releaseFrame + maxScanFrames));
  const totalScanFrames = Math.max(1, searchEndFrame - releaseFrame + 1);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return {
      observations: [],
      visibleEndFrame: searchEndFrame,
      firstSeenFrame: releaseFrame,
      lastSeenFrame: releaseFrame,
      status: 'insufficient_evidence',
      statusMessage: '無法建立 Canvas 影像讀取環境'
    };
  }

  // 逐幀擷取影像 buffer
  const frameBuffers: Array<{ frame: number; width: number; height: number; data: Uint8ClampedArray } | null> = [];

  for (let f = releaseFrame; f <= searchEndFrame; f++) {
    const pct = Math.round(((f - releaseFrame) / totalScanFrames) * 35);
    if (onProgress) onProgress(pct, f, `讀取影格 (F${f} @ ${fps}FPS)...`);

    // 使用 actual timestamp: f / fps
    const frameData = await captureFrameCanvas(videoElement, canvas, ctx, f, f / fps);
    frameBuffers.push(frameData);
  }

  // 差分候選抽取
  if (onProgress) onProgress(40, releaseFrame, '執行高解析差分運動偵測...');
  const candidatesPerFrame = new Map<number, Array<{
    frame: number;
    x: number;
    y: number;
    x_norm: number;
    y_norm: number;
    width: number;
    height: number;
    score: number;
    motion_energy: number;
  }>>();

  // 手動錨點提示走廊（若有使用者設定錨點，用來引導精確 ROI，而非直接連線）
  let corridorOption: any = undefined;
  if (manualAnchor?.point1 && manualAnchor?.point2) {
    corridorOption = {
      corridor: {
        x0: manualAnchor.point1.x_norm,
        y0: manualAnchor.point1.y_norm,
        x1: manualAnchor.point2.x_norm,
        y1: manualAnchor.point2.y_norm,
        widthNorm: 0.12 // 限制在錨點連線周圍 12% 走廊搜尋真實球影像
      }
    };
  }

  for (let i = 0; i < frameBuffers.length; i++) {
    const curr = frameBuffers[i];
    if (!curr) continue;
    const prev = i > 0 ? frameBuffers[i - 1] : null;
    const next = i < frameBuffers.length - 1 ? frameBuffers[i + 1] : null;

    const cands = extractMotionCandidates(curr, prev, next, corridorOption);
    if (cands.length > 0) {
      candidatesPerFrame.set(curr.frame, cands);
    }
  }

  // 雙向時間走廊鏈接與真實視覺證據審查
  if (onProgress) onProgress(65, releaseFrame, '雙向時間走廊連續性檢驗...');

  // 依 actualFps 自適應每幀預期位移
  // 例如 24 FPS: 棒球飛行 ~14 幀，每幀 y_norm 位移約 0.03 ~ 0.05
  // 60 FPS: 棒球飛行 ~35 幀，每幀 y_norm 位移約 0.012 ~ 0.02
  const expectedDisplacementPerFrame = (1.0 / Math.max(12, fps)) * (cameraView === 'catcher' ? 1.0 : 0.85);
  const searchRadiusNorm = Math.max(0.08, Math.min(0.25, expectedDisplacementPerFrame * 3.5));

  const validObservations: BallObservation[] = [];

  // 尋找高信賴種子 (Highest score evidence)
  let bestSeed: { frame: number; cand: any } | null = null;
  candidatesPerFrame.forEach((cands, f) => {
    for (const c of cands) {
      if (!bestSeed || c.score > bestSeed.cand.score) {
        bestSeed = { frame: f, cand: c };
      }
    }
  });

  if (bestSeed && bestSeed.cand.score >= 0.48) {
    const seed = bestSeed.cand;
    validObservations.push({
      frame: bestSeed.frame,
      timestamp: Number((bestSeed.frame / fps).toFixed(4)),
      x: seed.x,
      y: seed.y,
      x_norm: seed.x_norm,
      y_norm: seed.y_norm,
      radius: Math.max(3, Math.min(12, Math.round(seed.width / 2))),
      confidence: seed.score,
      source: 'observation',
      motion_score: seed.motion_energy
    });

    const seedF = bestSeed.frame;

    // 前向追蹤 (Forward Tracking)
    let lastPt = seed;
    let lastF = seedF;
    let avgVx = 0;
    let avgVy = cameraView === 'catcher' ? expectedDisplacementPerFrame : -expectedDisplacementPerFrame;

    for (let f = seedF + 1; f <= searchEndFrame; f++) {
      const cands = candidatesPerFrame.get(f);
      if (!cands || cands.length === 0) continue;

      const fDelta = f - lastF;
      const predX = lastPt.x_norm + avgVx * fDelta;
      const predY = lastPt.y_norm + avgVy * fDelta;

      let bestMatch: any = null;
      let minDis = searchRadiusNorm * fDelta;

      for (const c of cands) {
        const d = Math.hypot(c.x_norm - predX, c.y_norm - predY);
        // 方向性檢查
        const dirConsistent = cameraView === 'catcher' ? (c.y_norm >= lastPt.y_norm - 0.02) : true;
        if (d < minDis && dirConsistent) {
          minDis = d;
          bestMatch = c;
        }
      }

      if (bestMatch && bestMatch.score >= 0.42) {
        const actualDx = (bestMatch.x_norm - lastPt.x_norm) / fDelta;
        const actualDy = (bestMatch.y_norm - lastPt.y_norm) / fDelta;
        avgVx = avgVx * 0.35 + actualDx * 0.65;
        avgVy = avgVy * 0.35 + actualDy * 0.65;

        lastPt = bestMatch;
        lastF = f;

        validObservations.push({
          frame: f,
          timestamp: Number((f / fps).toFixed(4)),
          x: bestMatch.x,
          y: bestMatch.y,
          x_norm: bestMatch.x_norm,
          y_norm: bestMatch.y_norm,
          radius: Math.max(3, Math.min(12, Math.round(bestMatch.width / 2))),
          confidence: Number(bestMatch.score.toFixed(3)),
          source: 'observation',
          motion_score: bestMatch.motion_energy
        });
      }
    }

    // 後向驗證 (Backward Tracking toward release)
    lastPt = seed;
    lastF = seedF;
    for (let f = seedF - 1; f >= releaseFrame; f--) {
      const cands = candidatesPerFrame.get(f);
      if (!cands || cands.length === 0) continue;

      const fDelta = lastF - f;
      const predX = lastPt.x_norm - avgVx * fDelta;
      const predY = lastPt.y_norm - avgVy * fDelta;

      let bestMatch: any = null;
      let minDis = searchRadiusNorm * fDelta;

      for (const c of cands) {
        const d = Math.hypot(c.x_norm - predX, c.y_norm - predY);
        if (d < minDis) {
          minDis = d;
          bestMatch = c;
        }
      }

      if (bestMatch && bestMatch.score >= 0.42) {
        lastPt = bestMatch;
        lastF = f;

        validObservations.unshift({
          frame: f,
          timestamp: Number((f / fps).toFixed(4)),
          x: bestMatch.x,
          y: bestMatch.y,
          x_norm: bestMatch.x_norm,
          y_norm: bestMatch.y_norm,
          radius: Math.max(3, Math.min(12, Math.round(bestMatch.width / 2))),
          confidence: Number(bestMatch.score.toFixed(3)),
          source: 'observation',
          motion_score: bestMatch.motion_energy
        });
      }
    }
  }

  // 嚴格排序
  validObservations.sort((a, b) => a.frame - b.frame);

  // 檢驗真實觀測數量 (最高準則：ACCURACY > COVERAGE，少於 3 點視為證據不足)
  if (validObservations.length < 3) {
    if (onProgress) onProgress(100, searchEndFrame, '視覺證據不足 (真實觀測點 < 3)');
    return {
      observations: validObservations,
      visibleEndFrame: searchEndFrame,
      firstSeenFrame: validObservations[0]?.frame || releaseFrame,
      lastSeenFrame: validObservations[validObservations.length - 1]?.frame || releaseFrame,
      status: 'insufficient_evidence',
      statusMessage: validObservations.length === 0
        ? 'Insufficient visual evidence：在目前設定影格間未找到足夠清晰的棒球動態特徵'
        : `Insufficient visual evidence：僅檢測到 ${validObservations.length} 個離散點，未達可靠重構門檻 (>=3 點)`
    };
  }

  const firstSeen = validObservations[0].frame;
  const lastSeen = validObservations[validObservations.length - 1].frame;

  if (onProgress) {
    onProgress(100, lastSeen, `追蹤完成：獲取 ${validObservations.length} 個真實視覺觀測點 (F${firstSeen} ~ F${lastSeen})`);
  }

  return {
    observations: validObservations,
    visibleEndFrame: lastSeen,
    firstSeenFrame: firstSeen,
    lastSeenFrame: lastSeen,
    status: 'reliable',
    statusMessage: `取得 ${validObservations.length} 個實測觀測點 (F${firstSeen} ~ F${lastSeen})，通過真實性檢驗。`
  };
}
