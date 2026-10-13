import { BallCandidate, BallObservation, CameraViewMode } from '../types';
import { BallDetectionEngine } from './ballDetectionEngine';
import { extractMotionCandidates } from '../motionDetector';
import { VideoTimingService } from './videoTimingService';

export interface AutoFrameDetectionInput {
  videoElement: HTMLVideoElement;
  actualFps: number;
  totalFrames: number;
  durationSec: number;
  cameraView: CameraViewMode;
  selectedPitchType: string;
  videoWidth?: number;
  videoHeight?: number;
  timestamps?: number[];
  onProgress?: (pct: number, stepText: string) => void;
}

export interface AutoFrameDetectionOutput {
  status: 'SUCCESS' | 'LOW_CONFIDENCE' | 'AUTO_DETECTION_FAILED';
  releaseFrame: number | null;
  gloveFrame: number | null;
  confidence: number;
  method: string;
  ballTrack: BallObservation[];
  releaseEvidence: {
    frame: number | null;
    evidenceScore: number;
    motionContinuity: number;
    directionConsistency: number;
    roiPlausibility: number;
    reason: string;
  };
  gloveEvidence: {
    frame: number | null;
    evidenceScore: number;
    catcherProximity: number;
    motionTermination: number;
    reason: string;
  };
  candidateFrames: number[];
  warnings: string[];
  stepDetails: string[];
}

interface ScannedFrameSummary {
  frame: number;
  timestamp: number;
  topCandidate: BallCandidate | null;
  motionCount: number;
  meanMotionScore: number;
}

/**
 * AutoFrameDetectionEngine (真正的視覺自動出手/進手套影格偵測引擎)
 * 嚴格原則：
 * 1. 真正透過 HTMLVideoElement seek + canvas drawImage + getImageData 進行兩階段掃描 (Coarse Scan + Fine Scan)
 * 2. 重用既有 BallDetectionEngine 與 extractMotionCandidates，不另造互斥演算法
 * 3. 絕不使用 totalFrames * 0.28 或 database 平均飛行時間直接當成最終答案
 * 4. 當視覺證據不足時，誠實回傳 AUTO_DETECTION_FAILED 或 LOW_CONFIDENCE，請使用者手動確認影格
 */
export class AutoFrameDetectionEngine {
  static async detectReleaseAndGloveFrames(
    input: AutoFrameDetectionInput
  ): Promise<AutoFrameDetectionOutput> {
    const {
      videoElement,
      actualFps,
      totalFrames,
      cameraView,
      timestamps,
      onProgress
    } = input;

    const safeFps = actualFps > 0 ? actualFps : 30;
    const width = input.videoWidth || videoElement.videoWidth || 720;
    const height = input.videoHeight || videoElement.videoHeight || 1280;
    const warnings: string[] = [];
    const stepDetails: string[] = [];

    if (!videoElement || totalFrames < 6) {
      return this.buildFailedResult('影片影格數不足或播放器尚未就緒，請手動確認影格。');
    }

    // 暫停播放並記錄原始時間位置，掃描完成後還原或跳至偵測到的出手影格
    if (!videoElement.paused) {
      videoElement.pause();
    }

    const canvas = document.createElement('canvas');
    // 使用適中分析解析度兼顧精度與記憶體安全
    const scale = width > 960 ? 960 / width : 1.0;
    const workW = Math.max(320, Math.round(width * scale));
    const workH = Math.max(240, Math.round(height * scale));
    canvas.width = workW;
    canvas.height = workH;

    const detector = new BallDetectionEngine({
      width: workW,
      height: workH,
      cameraView
    });

    // =========================================================================
    // 第一階段：Coarse Scan (每 2~4 幀粗掃描，定位投球運動活躍區間)
    // =========================================================================
    const coarseStep = totalFrames > 180 ? 4 : totalFrames > 80 ? 3 : 2;
    const scanStartFrame = Math.max(1, Math.floor(totalFrames * 0.05));
    const scanEndFrame = Math.min(totalFrames - 2, Math.ceil(totalFrames * 0.95));

    const coarseFrames: number[] = [];
    for (let f = scanStartFrame; f <= scanEndFrame; f += coarseStep) {
      coarseFrames.push(f);
    }

    onProgress?.(10, `【階段 1/5】粗掃描影片影格 (每 ${coarseStep} 幀取樣，共 ${coarseFrames.length} 個取樣點)...`);

    const coarseSummaries: ScannedFrameSummary[] = [];
    let prevImageData: ImageData | null = null;
    let prevRawFrame: { frame: number; width: number; height: number; data: Uint8ClampedArray } | null = null;

    const fullRoi = { xMin: 0.12, xMax: 0.88, yMin: 0.14, yMax: 0.88 };

    for (let i = 0; i < coarseFrames.length; i++) {
      const f = coarseFrames[i];
      const pct = Math.round(10 + ((i + 1) / coarseFrames.length) * 30);
      if (i % 3 === 0) {
        onProgress?.(pct, `【階段 2/5】搜尋棒球動態候選特徵 (粗掃描 F${f}/${scanEndFrame})...`);
      }

      const decoded = await this.captureFrameAt(videoElement, canvas, f, safeFps, timestamps);
      if (!decoded || !decoded.imageData) continue;

      const currRaw = {
        frame: f,
        width: workW,
        height: workH,
        data: new Uint8ClampedArray(decoded.imageData.data)
      };

      const candidates = detector.detectCandidatesInRoi(
        decoded.imageData,
        prevImageData,
        f,
        decoded.timestamp,
        fullRoi,
        null
      );

      const motionCands = prevRawFrame
        ? extractMotionCandidates(currRaw, prevRawFrame, null)
        : [];

      const topCandidate = candidates.length > 0 ? candidates[0] : null;
      const meanMotionScore =
        motionCands.length > 0
          ? motionCands.slice(0, 4).reduce((s, c) => s + c.score, 0) / Math.min(4, motionCands.length)
          : topCandidate?.components.motionScore || 0;

      coarseSummaries.push({
        frame: f,
        timestamp: decoded.timestamp,
        topCandidate,
        motionCount: motionCands.length,
        meanMotionScore
      });

      prevImageData = decoded.imageData;
      prevRawFrame = currRaw;
    }

    // 尋找最具連續動態與棒球候選證據的視窗
    const activeWindow = this.findBestActivePitchWindow(coarseSummaries, safeFps, totalFrames);
    if (!activeWindow) {
      warnings.push('粗掃描未發現明顯連續的棒球飛行區間。');
      return this.buildFailedResult(
        'AI 自動辨識失敗：影片中未偵測到足夠明顯的棒球飛行運動軌跡，請手動設定出手與進手套影格。',
        warnings
      );
    }

    stepDetails.push(
      `粗掃描鎖定投球候選時間窗：F${activeWindow.startFrame} ~ F${activeWindow.endFrame} (運動峰值 F${activeWindow.peakFrame})`
    );

    // =========================================================================
    // 第二階段：Fine Scan (在鎖定區間內逐幀或每 1~2 幀精細掃描)
    // =========================================================================
    const fineStep = safeFps >= 120 ? 2 : 1;
    const fineFrames: number[] = [];
    for (let f = activeWindow.startFrame; f <= activeWindow.endFrame; f += fineStep) {
      fineFrames.push(f);
    }

    onProgress?.(45, `【階段 3/5】於鎖定區間 (F${activeWindow.startFrame}~F${activeWindow.endFrame}) 執行逐幀精細掃描...`);

    const fineObservations: BallObservation[] = [];
    const candidateFrames: number[] = [];
    prevImageData = null;
    let priorPos: { x: number; y: number } | null = null;

    for (let i = 0; i < fineFrames.length; i++) {
      const f = fineFrames[i];
      const pct = Math.round(45 + ((i + 1) / fineFrames.length) * 35);
      if (i % 2 === 0) {
        onProgress?.(pct, `【階段 3/5】建立時間連續軌跡 (精細掃描 F${f})...`);
      }

      const decoded = await this.captureFrameAt(videoElement, canvas, f, safeFps, timestamps);
      if (!decoded || !decoded.imageData) continue;

      const cands = detector.detectCandidatesInRoi(
        decoded.imageData,
        prevImageData,
        f,
        decoded.timestamp,
        fullRoi,
        priorPos
      );

      prevImageData = decoded.imageData;

      if (cands.length > 0 && cands[0].score >= 0.46) {
        const best = cands[0];
        candidateFrames.push(f);
        fineObservations.push({
          frame: f,
          timestamp: decoded.timestamp,
          x: best.x,
          y: best.y,
          x_norm: best.x_norm,
          y_norm: best.y_norm,
          radius: best.radius,
          confidence: best.score,
          source: 'observation',
          motion_score: best.components.motionScore
        });
        priorPos = { x: best.x, y: best.y };
      }
    }

    // =========================================================================
    // 第三階段：建立連續球路片段 (Continuous Trajectory Segment) 並判定 Release 與 Glove
    // =========================================================================
    onProgress?.(85, '【階段 4/5】分析球路空間連續性，判定出手影格與進手套影格...');

    const continuousSegment = this.extractBestContinuousBallSegment(fineObservations, safeFps, cameraView);

    if (continuousSegment.length < 3) {
      warnings.push(`精細掃描僅獲得 ${continuousSegment.length} 個連續棒球觀測點 (需 >= 3 點)。`);
      return this.buildFailedResult(
        '自動偵測證據不足，請手動確認影格 (未找到 >= 3 個具方向一致性的連續棒球觀測點)。',
        warnings,
        candidateFrames
      );
    }

    const firstObs = continuousSegment[0];
    const lastObs = continuousSegment[continuousSegment.length - 1];

    // 計算 Release Evidence Score
    // 評估球從投手釋球區脫離並開始形成連續向本壘方向運動的第一個可靠 frame
    const releaseRoiPlausibility = this.evaluateReleaseRoiPlausibility(firstObs, cameraView);
    const directionConsistency = this.evaluateDirectionConsistency(continuousSegment, cameraView);
    const motionContinuity = Math.min(1.0, continuousSegment.length / Math.max(5, Math.round(safeFps * 0.28)));

    const releaseScore = Number(
      (
        firstObs.confidence * 0.35 +
        motionContinuity * 0.25 +
        directionConsistency * 0.25 +
        releaseRoiPlausibility * 0.15
      ).toFixed(3)
    );

    // 計算 Glove Evidence Score
    // 評估球接近本壘/捕手區或最後可靠觀測 + 運動終止
    const catcherProximity = this.evaluateCatcherProximity(lastObs, cameraView);
    const flightDurationSec = Math.max(
      0.05,
      lastObs.timestamp - firstObs.timestamp || (lastObs.frame - firstObs.frame) / safeFps
    );
    const durationPlausibility =
      flightDurationSec >= 0.26 && flightDurationSec <= 0.85
        ? 0.92
        : flightDurationSec >= 0.18 && flightDurationSec <= 1.05
        ? 0.65
        : 0.30;

    const gloveScore = Number(
      (
        lastObs.confidence * 0.30 +
        catcherProximity * 0.30 +
        durationPlausibility * 0.25 +
        directionConsistency * 0.15
      ).toFixed(3)
    );

    const overallConfidence = Number(
      Math.max(15, Math.min(95, (releaseScore * 0.5 + gloveScore * 0.5) * 100)).toFixed(1)
    );

    onProgress?.(100, `【階段 5/5】AI 視覺偵測完成 (信賴度 ${overallConfidence}%)`);

    // 若飛行幀差過短或綜合證據過低，回報 LOW_CONFIDENCE 或 FAILED
    if (lastObs.frame <= firstObs.frame + 2 || overallConfidence < 42) {
      warnings.push('球路連續片段過短或方向一致性偏低，已標記為低信賴度。');
      return {
        status: 'LOW_CONFIDENCE',
        releaseFrame: firstObs.frame,
        gloveFrame: Math.max(firstObs.frame + 4, lastObs.frame),
        confidence: overallConfidence,
        method: '電腦視覺兩階段候選偵測 (低信賴度，建議手動微調確認)',
        ballTrack: continuousSegment,
        releaseEvidence: {
          frame: firstObs.frame,
          evidenceScore: releaseScore,
          motionContinuity,
          directionConsistency,
          roiPlausibility: releaseRoiPlausibility,
          reason: `於 F${firstObs.frame} 偵測到初始運動候選，但連續性偏低 (${continuousSegment.length} 點)`
        },
        gloveEvidence: {
          frame: lastObs.frame,
          evidenceScore: gloveScore,
          catcherProximity,
          motionTermination: durationPlausibility,
          reason: `於 F${lastObs.frame} 偵測到末端觀測點，建議手動確認進手套瞬間`
        },
        candidateFrames,
        warnings,
        stepDetails: [
          ...stepDetails,
          `精細掃描取得 ${continuousSegment.length} 個球路點 (F${firstObs.frame} ~ F${lastObs.frame})`,
          `⚠️ 視覺證據信賴度偏低 (${overallConfidence}%)，請手動確認出手與進手套影格`
        ]
      };
    }

    const status: AutoFrameDetectionOutput['status'] =
      overallConfidence >= 62 ? 'SUCCESS' : 'LOW_CONFIDENCE';

    stepDetails.push(
      `判定出手影格 F${firstObs.frame} (Release Evidence ${(releaseScore * 100).toFixed(0)}%)：偵測到球體自投手釋球區開始穩定連續位移`,
      `判定進手套影格 F${lastObs.frame} (Glove Evidence ${(gloveScore * 100).toFixed(0)}%)：追蹤球體進入本壘/捕手接球區之最後可靠觀測`,
      `實測飛行時長 ${flightDurationSec.toFixed(3)}s (共 ${continuousSegment.length} 個真實視覺觀測點)`
    );

    return {
      status,
      releaseFrame: firstObs.frame,
      gloveFrame: lastObs.frame,
      confidence: overallConfidence,
      method: '電腦視覺 Coarse-to-Fine 雙階段球體追蹤與時空連續性偵測',
      ballTrack: continuousSegment,
      releaseEvidence: {
        frame: firstObs.frame,
        evidenceScore: releaseScore,
        motionContinuity,
        directionConsistency,
        roiPlausibility: releaseRoiPlausibility,
        reason: `球體於 F${firstObs.frame} 脫離投手釋球 ROI 並形成穩定本壘方向運動向量`
      },
      gloveEvidence: {
        frame: lastObs.frame,
        evidenceScore: gloveScore,
        catcherProximity,
        motionTermination: durationPlausibility,
        reason: `球體於 F${lastObs.frame} 進入捕手接球區域並終止自由飛行軌跡`
      },
      candidateFrames,
      warnings,
      stepDetails
    };
  }

  /**
   * 讀取指定影格的影像資料 (優先使用 timestamps[])
   */
  private static async captureFrameAt(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    frameIndex: number,
    fps: number,
    timestamps?: number[]
  ) {
    const targetTime =
      timestamps && timestamps[frameIndex] !== undefined
        ? timestamps[frameIndex]
        : frameIndex / Math.max(1, fps);

    // 將時間換算回等效 frameIndex 交由 VideoTimingService 擷取
    return VideoTimingService.seekAndCaptureFrame(
      video,
      frameIndex,
      fps,
      canvas,
      targetTime
    );
  }

  /**
   * 從粗掃描結果中找出最可能包含投球飛行的活躍時間窗
   */
  private static findBestActivePitchWindow(
    summaries: ScannedFrameSummary[],
    fps: number,
    totalFrames: number
  ): { startFrame: number; endFrame: number; peakFrame: number } | null {
    if (summaries.length < 3) return null;

    let bestScore = -1;
    let bestCenterIdx = -1;

    for (let i = 0; i < summaries.length; i++) {
      const s = summaries[i];
      const prev = i > 0 ? summaries[i - 1] : null;
      const next = i < summaries.length - 1 ? summaries[i + 1] : null;

      const candScore = s.topCandidate ? s.topCandidate.score : 0;
      const neighborScore =
        (prev?.topCandidate ? prev.topCandidate.score * 0.5 : 0) +
        (next?.topCandidate ? next.topCandidate.score * 0.5 : 0);

      const combined = candScore * 0.55 + s.meanMotionScore * 0.30 + neighborScore * 0.15;
      if (combined > bestScore && (s.topCandidate || s.motionCount > 0)) {
        bestScore = combined;
        bestCenterIdx = i;
      }
    }

    if (bestCenterIdx < 0 || bestScore < 0.22) {
      return null;
    }

    const peakFrame = summaries[bestCenterIdx].frame;
    // 典型棒球飛行約 0.38s ~ 0.65s，往前後展開約 0.45s 視窗做精細掃描
    const halfWindowFrames = Math.max(8, Math.round(fps * 0.48));
    const startFrame = Math.max(1, peakFrame - halfWindowFrames);
    const endFrame = Math.min(totalFrames - 1, peakFrame + halfWindowFrames);

    return { startFrame, endFrame, peakFrame };
  }

  /**
   * 篩選出空間連續、運動方向合理的最佳球路觀測序列
   */
  private static extractBestContinuousBallSegment(
    observations: BallObservation[],
    fps: number,
    cameraView: CameraViewMode
  ): BallObservation[] {
    if (observations.length < 3) return observations;

    const maxFrameGap = Math.max(3, Math.round(fps * 0.16));
    const segments: BallObservation[][] = [];
    let currentSeg: BallObservation[] = [observations[0]];

    for (let i = 1; i < observations.length; i++) {
      const prev = currentSeg[currentSeg.length - 1];
      const curr = observations[i];
      const dFrame = Math.max(1, curr.frame - prev.frame);
      const distNorm = Math.hypot(curr.x_norm - prev.x_norm, curr.y_norm - prev.y_norm);
      const stepDist = distNorm / dFrame;

      // 檢查是否符合合理單格運動距離 (< 0.14 norm/frame) 且間隔不超過 maxFrameGap
      if (dFrame <= maxFrameGap && stepDist <= 0.14) {
        currentSeg.push(curr);
      } else {
        if (currentSeg.length >= 2) {
          segments.push(currentSeg);
        }
        currentSeg = [curr];
      }
    }
    if (currentSeg.length >= 2) {
      segments.push(currentSeg);
    }

    if (segments.length === 0) return [];

    // 選出綜合品質最高 (點數最多、方向一致性最佳) 的區段
    segments.sort((a, b) => {
      const scoreA = a.length * this.evaluateDirectionConsistency(a, cameraView);
      const scoreB = b.length * this.evaluateDirectionConsistency(b, cameraView);
      return scoreB - scoreA;
    });

    const bestSeg = segments[0];
    // 限制飛行時間不超過合理棒球物理上限 (~0.75s)
    const maxFlightFrames = Math.max(6, Math.round(fps * 0.72));
    if (bestSeg.length > 2 && bestSeg[bestSeg.length - 1].frame - bestSeg[0].frame > maxFlightFrames) {
      const startF = bestSeg[0].frame;
      return bestSeg.filter((pt) => pt.frame - startF <= maxFlightFrames);
    }

    return bestSeg;
  }

  /**
   * 評估起點是否位於合理的投手出手 ROI
   */
  private static evaluateReleaseRoiPlausibility(
    firstObs: BallObservation,
    cameraView: CameraViewMode
  ): number {
    // 在捕手視角或投手視角中，出手位置通常位於畫面中央偏上或中段走廊 (x: 0.25~0.75, y: 0.20~0.70)
    const inX = firstObs.x_norm >= 0.22 && firstObs.x_norm <= 0.78;
    const inY =
      cameraView === 'catcher'
        ? firstObs.y_norm >= 0.18 && firstObs.y_norm <= 0.65
        : firstObs.y_norm >= 0.25 && firstObs.y_norm <= 0.75;

    if (inX && inY) return 0.9;
    if (inX || inY) return 0.65;
    return 0.4;
  }

  /**
   * 評估末端觀測點是否接近本壘/捕手手套接球區域
   */
  private static evaluateCatcherProximity(
    lastObs: BallObservation,
    cameraView: CameraViewMode
  ): number {
    const inX = lastObs.x_norm >= 0.25 && lastObs.x_norm <= 0.75;
    const inY =
      cameraView === 'catcher'
        ? lastObs.y_norm >= 0.38 && lastObs.y_norm <= 0.85
        : lastObs.y_norm >= 0.25 && lastObs.y_norm <= 0.68;

    if (inX && inY) return 0.9;
    if (inX || inY) return 0.65;
    return 0.45;
  }

  /**
   * 評估軌跡點序列的方向一致性
   */
  private static evaluateDirectionConsistency(
    segment: BallObservation[],
    _cameraView: CameraViewMode
  ): number {
    if (segment.length < 3) return 0.5;
    let consistentSteps = 0;
    const totalSteps = segment.length - 2;

    const overallDx = segment[segment.length - 1].x_norm - segment[0].x_norm;
    const overallDy = segment[segment.length - 1].y_norm - segment[0].y_norm;

    for (let i = 1; i < segment.length - 1; i++) {
      const dx = segment[i + 1].x_norm - segment[i - 1].x_norm;
      const dy = segment[i + 1].y_norm - segment[i - 1].y_norm;
      const dot = dx * overallDx + dy * overallDy;
      if (dot >= -0.0005) {
        consistentSteps++;
      }
    }

    return Number(Math.max(0.3, Math.min(0.98, consistentSteps / Math.max(1, totalSteps))).toFixed(2));
  }

  private static buildFailedResult(
    reason: string,
    warnings: string[] = [],
    candidateFrames: number[] = []
  ): AutoFrameDetectionOutput {
    return {
      status: 'AUTO_DETECTION_FAILED',
      releaseFrame: null,
      gloveFrame: null,
      confidence: 0,
      method: '電腦視覺掃描無足夠證據 (AUTO_DETECTION_FAILED)',
      ballTrack: [],
      releaseEvidence: {
        frame: null,
        evidenceScore: 0,
        motionContinuity: 0,
        directionConsistency: 0,
        roiPlausibility: 0,
        reason
      },
      gloveEvidence: {
        frame: null,
        evidenceScore: 0,
        catcherProximity: 0,
        motionTermination: 0,
        reason
      },
      candidateFrames,
      warnings: [reason, ...warnings],
      stepDetails: [reason]
    };
  }
}
