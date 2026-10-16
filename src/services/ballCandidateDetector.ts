/**
 * BallCandidateDetector & Visual Evidence Service
 * 負責：
 * 1. 嚴格遵守 ACCURACY > COVERAGE：寧可判定無證據，絕不捏造點
 * 2. 高解析 Pitching ROI 裁切與多尺度分析 (Multi-scale candidate search)
 * 3. 綜合評估特徵：
 *    - local brightness
 *    - local contrast
 *    - blob response (拉普拉斯/高斯差分形狀響應)
 *    - edge response
 *    - motion response (幀差運動特徵)
 *    - size plausibility (2~12px)
 *    - background rejection (長時期靜止或固定線條排除)
 * 4. 產出 Ball Evidence Score
 */

export interface CandidateRegion {
  minXNorm: number;
  maxXNorm: number;
  minYNorm: number;
  maxYNorm: number;
}

export interface BallVisualCandidate {
  x: number; // 像素座標
  y: number; // 像素座標
  xNorm: number; // 0.0 ~ 1.0
  yNorm: number; // 0.0 ~ 1.0
  radius: number;
  evidenceScore: number; // 0.0 ~ 1.0 綜合證據分數
  localContrast: number;
  brightness: number;
  motionResponse: number;
  blobCircularity: number;
  isPassedGate: boolean;
}

export interface CandidateSearchContext {
  width: number;
  height: number;
  actualFps: number;
  currentFrame: number;
  roi?: CandidateRegion;
  predictedPos?: { xNorm: number; yNorm: number; radiusNorm: number };
  staticBackgroundMask?: Uint8Array; // 靜態背景遮罩
}

/**
 * 在原始影格影像資料中執行高解析 ROI 多特徵候選球偵測
 */
export function detectBallCandidatesInFrame(
  currentImageData: Uint8ClampedArray,
  prevImageData: Uint8ClampedArray | null,
  nextImageData: Uint8ClampedArray | null,
  context: CandidateSearchContext
): BallVisualCandidate[] {
  const { width, height, roi, predictedPos } = context;

  // 1. 定位 ROI 像素範圍
  const minX = roi ? Math.max(2, Math.floor(roi.minXNorm * width)) : 2;
  const maxX = roi ? Math.min(width - 3, Math.ceil(roi.maxXNorm * width)) : width - 3;
  const minY = roi ? Math.max(2, Math.floor(roi.minYNorm * height)) : 2;
  const maxY = roi ? Math.min(height - 3, Math.ceil(roi.maxYNorm * height)) : height - 3;

  const candidates: BallVisualCandidate[] = [];

  // 步長採樣 (1 ~ 2 px 高精度)
  const step = 1; // Small balls can occupy only 2–3 source pixels.

  for (let y = minY + 4; y < maxY - 4; y += step) {
    for (let x = minX + 4; x < maxX - 4; x += step) {
      const idx = (y * width + x) * 4;
      const r = currentImageData[idx];
      const g = currentImageData[idx + 1];
      const b = currentImageData[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;

      // 棒球必要候選特徵之一：具有足夠明亮度或局部反差
      if (luma < 90) continue;

      // 計算局部對比度 (與半徑 3~6px 環狀背景比對)
      let surroundLuma = 0;
      let count = 0;
      const sampleRadii = [3, 5];
      for (const rad of sampleRadii) {
        const top = ((y - rad) * width + x) * 4;
        const btm = ((y + rad) * width + x) * 4;
        const lft = (y * width + (x - rad)) * 4;
        const rgt = (y * width + (x + rad)) * 4;
        surroundLuma += (
          0.299 * (currentImageData[top] + currentImageData[btm] + currentImageData[lft] + currentImageData[rgt]) +
          0.587 * (currentImageData[top + 1] + currentImageData[btm + 1] + currentImageData[lft + 1] + currentImageData[rgt + 1]) +
          0.114 * (currentImageData[top + 2] + currentImageData[btm + 2] + currentImageData[lft + 2] + currentImageData[rgt + 2])
        ) / 4;
        count++;
      }
      const avgSurround = surroundLuma / Math.max(1, count);
      const localContrast = Math.max(0, luma - avgSurround);

      if (localContrast < 18) continue; // 排除無反差平坦區域

      // 計算時間差分運動響應 (Motion Response)
      let motionResp = 0;
      if (prevImageData) {
        const pLuma = 0.299 * prevImageData[idx] + 0.587 * prevImageData[idx + 1] + 0.114 * prevImageData[idx + 2];
        motionResp = Math.max(motionResp, Math.abs(luma - pLuma));
      }
      if (nextImageData) {
        const nLuma = 0.299 * nextImageData[idx] + 0.587 * nextImageData[idx + 1] + 0.114 * nextImageData[idx + 2];
        motionResp = Math.max(motionResp, Math.abs(luma - nLuma));
      }

      // 如果完全沒有運動響應且周圍靜態，極可能是背景固定高亮反光物體 (Background Rejection)
      if (prevImageData && nextImageData && motionResp < 12) {
        continue;
      }

      const xNorm = x / width;
      const yNorm = y / height;

      // 如果有預測位置走廊 (Corridor / Prediction Distance)
      let predDistPenalty = 0;
      if (predictedPos) {
        const dist = Math.hypot(xNorm - predictedPos.xNorm, yNorm - predictedPos.yNorm);
        predDistPenalty = Math.min(.08,dist/Math.max(.01,predictedPos.radiusNorm)*.04);
      }

      // Measure local bright support rather than assigning a constant shape score.
      // Compact ellipses include motion streaks; broad clothing/lines lose support.
      let mass=0,mx=0,my=0,xx=0,yy=0,xy=0,area=0;
      for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
        const j=((y+dy)*width+x+dx)*4,value=(currentImageData[j]+currentImageData[j+1]+currentImageData[j+2])/3;
        const weight=Math.max(0,value-avgSurround-12);if(!weight)continue;
        mass+=weight;mx+=dx*weight;my+=dy*weight;xx+=dx*dx*weight;yy+=dy*dy*weight;xy+=dx*dy*weight;area++;
      }
      if(!mass||area>65)continue;
      const cx=mx/mass,cy=my/mass,a=xx/mass-cx*cx,d=yy/mass-cy*cy,bxy=xy/mass-cx*cy;
      const delta=Math.hypot(a-d,2*bxy),minor=Math.max(0,(a+d-delta)/2),major=Math.max(.1,(a+d+delta)/2);
      const circularity=Math.sqrt((minor+.15)/(major+.15));
      if(circularity<.12||context.staticBackgroundMask?.[y*width+x])continue;

      // 計算特徵得分 (Ball Evidence Score)
      const normContrast = Math.min(1.0, localContrast / 60);
      const normBrightness = Math.min(1.0, luma / 220);
      const normMotion = Math.min(1.0, motionResp / 50);

      const evidenceScore = Math.max(
        0,
          Number((normContrast * 0.30 + normBrightness * 0.15 + normMotion * 0.40 + circularity * .15 - predDistPenalty).toFixed(3))
      );

      // 嚴格門檻：只有綜合證據分數 >= 0.45 才能列為候選點
      const isPassedGate = evidenceScore >= 0.45;

      candidates.push({
        x:x+cx,
        y:y+cy,
        xNorm: (x+cx)/width,
        yNorm: (y+cy)/height,
        radius: Math.max(1,Math.sqrt(area/Math.PI)),
        evidenceScore,
        localContrast,
        brightness: luma,
        motionResponse: motionResp,
        blobCircularity: circularity,
        isPassedGate
      });
    }
  }

  // 非極大值抑制 (Non-Maximum Suppression) 避免同一物體重複選取
  candidates.sort((a, b) => b.evidenceScore - a.evidenceScore);
  const filtered: BallVisualCandidate[] = [];
  const minDistancePx = Math.max(3, width * 0.004);

  for (const c of candidates) {
    if (!c.isPassedGate) continue;
    const isTooClose = filtered.some((f) => Math.hypot(f.x - c.x, f.y - c.y) < minDistancePx);
    if (!isTooClose) {
      filtered.push(c);
      if (filtered.length >= 24) break;
    }
  }

  return filtered;
}

/** Reuse the same detector in overlapping strips so mobile input/paint can run. */
export async function detectBallCandidatesCooperatively(current:Uint8ClampedArray,previous:Uint8ClampedArray|null,next:Uint8ClampedArray|null,context:CandidateSearchContext,isCancelled?:()=>boolean){
 const candidates:BallVisualCandidate[]=[];
 for(let top=6;top<context.height-7;top+=80){
  if(isCancelled?.())throw new DOMException('分析設定已變更','AbortError');
  const bottom=Math.min(context.height-7,top+80);
  candidates.push(...detectBallCandidatesInFrame(current,previous,next,{...context,roi:{minXNorm:0,maxXNorm:1,minYNorm:(top-4)/context.height,maxYNorm:(bottom+4)/context.height}}));
  await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 candidates.sort((a,b)=>b.evidenceScore-a.evidenceScore);
 const selected:BallVisualCandidate[]=[];
 for(const c of candidates){if(selected.every(p=>Math.hypot(p.x-c.x,p.y-c.y)>=Math.max(3,context.width*.004)))selected.push(c);if(selected.length===24)break;}
 return selected;
}
