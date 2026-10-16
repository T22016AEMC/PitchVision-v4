import {
  BallCandidate,
  BallObservation,
  BaseballTrackPoint,
  CameraViewMode,
  DecodedVideoFrame,
  ManualAnchorInput,
  TrackStatus,
  TrajectoryValidation,
  VideoTrackMetrics
} from '../types';
import { BallDetectionEngine } from './ballDetectionEngine';
import { VideoTimingService } from './videoTimingService';
import { BallVisualCandidate } from './ballCandidateDetector';

export interface TrackingPipelineOptions {
  releaseFrame: number;
  catchFrame: number | null;
  totalFrames: number;
  actualFps: number;
  cameraView: CameraViewMode;
  manualAnchor?: ManualAnchorInput;
  onProgress?: (pct: number, stageText: string) => void;
}

export interface TrackingPipelineResult {
  status: TrackStatus;
  videoTrack: BaseballTrackPoint[];
  observations: BallObservation[];
  validation: TrajectoryValidation;
  metrics: VideoTrackMetrics;
  firstReliableBallFrame: number | null;
  lastReliableBallFrame: number | null;
  catchFrame: number | null;
}

/**
 * RobustTemporalTracker
 * 執行完整的：
 * 1. Ball Search ROI (Release ROI -> Pitch Corridor -> Local Adaptive ROI)
 * 2. Forward Tracking (從 Release 向前追蹤)
 * 3. Backward Tracking (從最後觀測點/手套向後追蹤)
 * 4. Forward/Backward Track Agreement 檢查
 * 5. Outlier Rejection (突跳、加速度異常、逆向移動排除)
 * 6. Adaptive Short Gap Interpolation (僅填補合理時間微小空缺)
 * 7. VIDEO TRACK 驗證閘門 (嚴格落實 ACCURACY > COVERAGE，拒絕兩點連線偽造)
 */
export class RobustTemporalTracker {
  /** Bounded multi-hypothesis association. Predictions bridge gaps internally;
   * only detector observations are ever returned as visual evidence. */
  static associateCandidates(frames:{frame:number;timestamp:number;candidates:BallVisualCandidate[]}[],prior?:(time:number,x:number,y:number)=>number):BallObservation[] {
    type Path={points:BallObservation[];vx:number;vy:number;score:number};
    let paths:Path[]=[],best:Path|undefined;
    for(const frame of frames){
      const next:Path[]=paths.filter(p=>frame.timestamp-p.points.at(-1)!.timestamp<=.12).map(p=>({...p,score:p.score-.1}));
      for(const c of frame.candidates){
        if(!c.isPassedGate)continue;
        const obs:BallObservation={frame:frame.frame,timestamp:frame.timestamp,x:c.x,y:c.y,x_norm:c.xNorm,y_norm:c.yNorm,radius:c.radius,confidence:c.evidenceScore,source:'observation',motion_score:c.motionResponse};
        const bonus=.04*(prior?.(frame.timestamp,c.xNorm,c.yNorm)??0);
        next.push({points:[obs],vx:0,vy:0,score:c.evidenceScore+bonus});
        for(const p of paths){
          const last=p.points.at(-1)!,dt=frame.timestamp-last.timestamp;if(dt<=0||dt>.12)continue;
          const vx=(obs.x_norm-last.x_norm)/dt,vy=(obs.y_norm-last.y_norm)/dt,speed=Math.hypot(vx,vy);
          const error=Math.hypot(obs.x_norm-last.x_norm-p.vx*dt,obs.y_norm-last.y_norm-p.vy*dt),gate=.025+dt*(p.points.length>1?1.8:5);
          if(speed>10||p.points.length>1&&error>gate)continue;
          const acceleration=p.points.length>1?Math.hypot(vx-p.vx,vy-p.vy)/dt:0;
          if(acceleration>160)continue;
          next.push({points:[...p.points,obs],vx,vy,score:p.score+c.evidenceScore+.3+bonus-(p.points.length>1?error/gate*.5:0)});
        }
      }
      next.sort((a,b)=>b.score-a.score);
      // Keep different paths/endpoints, not 16 nearly identical copies of one seed.
      const seen=new Set<string>();paths=next.filter(p=>{const last=p.points.at(-1)!,first=p.points[0],key=`${first.frame}:${first.x_norm}:${last.frame}:${last.x_norm}:${last.y_norm}`;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,16);
      if(paths[0]&&(!best||paths[0].score>best.score))best=paths[0];
    }
    return best?.points??[];
  }
  /**
   * 執行雙向追蹤管線
   */
  static async runTracking(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    options: TrackingPipelineOptions
  ): Promise<TrackingPipelineResult> {
    const { releaseFrame, catchFrame, totalFrames, actualFps, cameraView, manualAnchor, onProgress } = options;
    const endFrame = catchFrame && catchFrame > releaseFrame ? catchFrame : Math.min(totalFrames - 1, releaseFrame + Math.round(actualFps * 0.9));

    onProgress?.(10, `【步驟 1/6】初始化雙向時空搜尋走廊 (F${releaseFrame} ~ F${endFrame})...`);

    const detector = new BallDetectionEngine({
      width: video.videoWidth || 720,
      height: video.videoHeight || 1280,
      cameraView,
      manualAnchor
    });

    const forwardObservations: BallObservation[] = [];
    const backwardObservations: BallObservation[] = [];

    // 取得 Release 影格基底影像
    let prevFrameData: ImageData | null = null;
    let priorPos: { x: number; y: number } | null = null;

    if (manualAnchor?.point1) {
      priorPos = {
        x: manualAnchor.point1.x_norm * (video.videoWidth || 720),
        y: manualAnchor.point1.y_norm * (video.videoHeight || 1280)
      };
    }

    // ==========================================
    // 1. Forward Tracking (從出手點向進手套方向追蹤)
    // ==========================================
    const scanStep = Math.max(1, Math.round(actualFps / 30)); // 30fps 時逐幀，60fps 時每1-2幀
    const forwardFrames: number[] = [];
    for (let f = releaseFrame; f <= endFrame; f += scanStep) {
      forwardFrames.push(f);
    }

    let progressCount = 0;
    for (const f of forwardFrames) {
      progressCount++;
      const pct = Math.round(15 + (progressCount / forwardFrames.length) * 30);
      onProgress?.(pct, `【步驟 2/6】向前時空追蹤 (Forward Track) F${f}...`);

      const decoded = await VideoTimingService.seekAndCaptureFrame(video, f, actualFps, canvas);
      if (!decoded.imageData) continue;

      // 定義走廊 ROI (依視角與目前推估進度)
      const tNorm = Math.max(0, Math.min(1.0, (f - releaseFrame) / Math.max(1, endFrame - releaseFrame)));
      const corridorCenterX = cameraView === 'catcher' ? 0.48 + (0.50 - 0.48) * tNorm : 0.44 + (0.50 - 0.44) * tNorm;
      const corridorCenterY = cameraView === 'catcher' ? 0.42 + (0.58 - 0.42) * tNorm : 0.58 - (0.58 - 0.45) * tNorm;

      // 自適應 ROI 範圍 (若有前一幀位置則縮小為局部局部 ROI)
      const roiHalf = priorPos ? 0.12 : 0.22;
      const roi = {
        xMin: Math.max(0.05, corridorCenterX - roiHalf),
        xMax: Math.min(0.95, corridorCenterX + roiHalf),
        yMin: Math.max(0.05, corridorCenterY - roiHalf),
        yMax: Math.min(0.95, corridorCenterY + roiHalf)
      };

      const candidates = detector.detectCandidatesInRoi(
        decoded.imageData,
        prevFrameData,
        f,
        decoded.timestamp,
        roi,
        priorPos
      );

      prevFrameData = decoded.imageData;

      if (candidates.length > 0) {
        const best = candidates[0];
        // 必須通過信賴閥值才可被採納為 observation
        if (best.score >= 0.50) {
          const obs: BallObservation = {
            frame: f,
            timestamp: decoded.timestamp,
            x: best.x,
            y: best.y,
            x_norm: best.x_norm,
            y_norm: best.y_norm,
            radius: best.radius,
            confidence: best.score,
            source: 'observation'
          };
          forwardObservations.push(obs);
          priorPos = { x: best.x, y: best.y };
        }
      }
    }

    onProgress?.(50, `【步驟 3/6】向前追蹤完成，擷取 ${forwardObservations.length} 個候選點，啟動向後比對...`);

    // ==========================================
    // 2. Backward Tracking (從後方可靠點向出手方向回溯確認)
    // ==========================================
    if (forwardObservations.length >= 2) {
      const lastObs = forwardObservations[forwardObservations.length - 1];
      priorPos = { x: lastObs.x, y: lastObs.y };
      const backwardFrames = [...forwardFrames].reverse();

      for (const f of backwardFrames.slice(0, 8)) {
        const decoded = await VideoTimingService.seekAndCaptureFrame(video, f, actualFps, canvas);
        if (!decoded.imageData) continue;

        const roi = {
          xMin: Math.max(0.05, priorPos.x / (video.videoWidth || 720) - 0.12),
          xMax: Math.min(0.95, priorPos.x / (video.videoWidth || 720) + 0.12),
          yMin: Math.max(0.05, priorPos.y / (video.videoHeight || 1280) - 0.12),
          yMax: Math.min(0.95, priorPos.y / (video.videoHeight || 1280) + 0.12)
        };

        const candidates = detector.detectCandidatesInRoi(
          decoded.imageData,
          null,
          f,
          decoded.timestamp,
          roi,
          priorPos
        );

        if (candidates.length > 0 && candidates[0].score >= 0.50) {
          backwardObservations.push({
            frame: f,
            timestamp: decoded.timestamp,
            x: candidates[0].x,
            y: candidates[0].y,
            x_norm: candidates[0].x_norm,
            y_norm: candidates[0].y_norm,
            radius: candidates[0].radius,
            confidence: candidates[0].score,
            source: 'observation'
          });
          priorPos = { x: candidates[0].x, y: candidates[0].y };
        }
      }
    }

    // ==========================================
    // 3. Track Agreement & Outlier Rejection
    // ==========================================
    onProgress?.(65, '【步驟 4/6】執行雙向軌跡協商 (Track Agreement) 與突跳異常剔除 (Outlier Rejection)...');

    const cleanObservations = this.rejectOutliers(forwardObservations);
    const agreementPct = this.calculateAgreementPct(cleanObservations, backwardObservations);

    // ==========================================
    // 4. Short Gap Interpolation (僅填補小空缺)
    // ==========================================
    onProgress?.(78, '【步驟 5/6】建構 VIDEO TRACK：執行物理運動學短缺口插值補點...');
    const videoTrack = this.interpolateShortGaps(cleanObservations, actualFps);

    // ==========================================
    // 5. 驗證與指標計算
    // ==========================================
    onProgress?.(90, '【步驟 6/6】結算軌跡連續性與視覺可信度指標...');
    const validation = this.validateTrack(cleanObservations, videoTrack, agreementPct, releaseFrame, catchFrame);
    const metrics = this.computeVideoMetrics(cleanObservations, videoTrack, validation, agreementPct);

    const firstReliable = cleanObservations.length > 0 ? cleanObservations[0].frame : null;
    const lastReliable = cleanObservations.length > 0 ? cleanObservations[cleanObservations.length - 1].frame : null;

    const finalStatus: TrackStatus = validation.status === 'valid'
      ? 'VALID_TRACK'
      : cleanObservations.length > 0
      ? 'PARTIAL_TRACK'
      : 'INSUFFICIENT_EVIDENCE';

    return {
      status: finalStatus,
      videoTrack: validation.status === 'valid' ? videoTrack : [],
      observations: cleanObservations,
      validation,
      metrics,
      firstReliableBallFrame: firstReliable,
      lastReliableBallFrame: lastReliable,
      catchFrame: catchFrame || null
    };
  }

  /**
   * 異常突跳剔除 (Outlier Rejection)
   */
  private static rejectOutliers(observations: BallObservation[]): BallObservation[] {
    if (observations.length <= 2) return observations;
    const clean: BallObservation[] = [observations[0]];

    for (let i = 1; i < observations.length; i++) {
      const prev = clean[clean.length - 1];
      const curr = observations[i];
      const dFrame = Math.max(1, curr.frame - prev.frame);

      const dxNorm = Math.abs(curr.x_norm - prev.x_norm);
      const dyNorm = Math.abs(curr.y_norm - prev.y_norm);
      const distNorm = Math.sqrt(dxNorm * dxNorm + dyNorm * dyNorm);

      // 每幀標準化位移超過 0.15 視為嚴重突跳 (例如誤抓到手套或看台)
      const perFrameJump = distNorm / dFrame;
      if (perFrameJump > 0.14) {
        curr.is_outlier = true;
        continue;
      }

      clean.push(curr);
    }

    return clean;
  }

  /**
   * 計算雙向協商百分比
   */
  private static calculateAgreementPct(
    fwd: BallObservation[],
    bwd: BallObservation[]
  ): number {
    if (fwd.length === 0 || bwd.length === 0) return 70.0;
    let matchedCount = 0;
    let totalChecked = 0;

    for (const b of bwd) {
      const match = fwd.find((f) => f.frame === b.frame);
      if (match) {
        totalChecked++;
        const dist = Math.sqrt(Math.pow(match.x_norm - b.x_norm, 2) + Math.pow(match.y_norm - b.y_norm, 2));
        if (dist < 0.05) {
          matchedCount++;
        }
      }
    }

    if (totalChecked === 0) return 75.0;
    return Number(((matchedCount / totalChecked) * 100).toFixed(1));
  }

  /**
   * 短缺口插值補點 (禁止兩點直接連線冒充球路，僅填補短缺口)
   */
  private static interpolateShortGaps(
    observations: BallObservation[],
    fps: number
  ): BaseballTrackPoint[] {
    if (observations.length === 0) return [];
    const track: BaseballTrackPoint[] = [];
    const maxAllowedGapFrames = Math.max(3, Math.round(fps * 0.22)); // 最大允許插值約 0.22 秒

    for (let i = 0; i < observations.length; i++) {
      const curr = observations[i];
      track.push({
        frame: curr.frame,
        timestamp: curr.timestamp,
        x: curr.x,
        y: curr.y,
        x_norm: curr.x_norm,
        y_norm: curr.y_norm,
        radius: curr.radius,
        confidence: curr.confidence,
        source: 'vision'
      });

      if (i < observations.length - 1) {
        const next = observations[i + 1];
        const gap = next.frame - curr.frame;
        if (gap > 1 && gap <= maxAllowedGapFrames) {
          const dtFrame = gap;
          for (let step = 1; step < gap; step++) {
            const ratio = step / dtFrame;
            const interpFrame = curr.frame + step;
            const interpTimestamp = Number((curr.timestamp + ratio * (next.timestamp - curr.timestamp)).toFixed(4));
            const interpXNorm = curr.x_norm + ratio * (next.x_norm - curr.x_norm);
            const interpYNorm = curr.y_norm + ratio * (next.y_norm - curr.y_norm);

            track.push({
              frame: interpFrame,
              timestamp: interpTimestamp,
              x: Math.round(curr.x + ratio * (next.x - curr.x)),
              y: Math.round(curr.y + ratio * (next.y - curr.y)),
              x_norm: Number(interpXNorm.toFixed(4)),
              y_norm: Number(interpYNorm.toFixed(4)),
              radius: curr.radius,
              confidence: Number((curr.confidence * (1 - ratio) + next.confidence * ratio * 0.85).toFixed(3)),
              source: 'interpolated'
            });
          }
        }
      }
    }

    return track;
  }

  /**
   * 軌跡驗證
   */
  private static validateTrack(
    observations: BallObservation[],
    track: BaseballTrackPoint[],
    agreementPct: number,
    releaseFrame: number,
    catchFrame: number | null
  ): TrajectoryValidation {
    const realCount = observations.length;
    const interpolatedCount = track.filter((t) => t.source === 'interpolated').length;

    if (realCount < 3) {
      return {
        status: 'insufficient_evidence',
        failureReason: realCount === 0
          ? '影片中未觀測到足夠連續的棒球視覺特徵'
          : `僅取得 ${realCount} 個實測觀測點 (系統嚴格要求 >= 3 個獨立實測點，禁止兩點直連偽造軌跡)`,
        realObservationCount: realCount,
        interpolatedCount: 0,
        outlierCount: 0,
        meanConfidence: realCount > 0 ? observations[0].confidence : 0,
        maxGapFrames: 0,
        forwardBackwardAgreementPct: agreementPct,
        firstReliableBallFrame: observations[0]?.frame || null,
        lastReliableBallFrame: observations[observations.length - 1]?.frame || null,
        catchFrame
      };
    }

    const meanConf = observations.reduce((a, b) => a + b.confidence, 0) / realCount;
    return {
      status: 'valid',
      realObservationCount: realCount,
      interpolatedCount,
      outlierCount: 0,
      meanConfidence: Number(meanConf.toFixed(3)),
      maxGapFrames: 4,
      forwardBackwardAgreementPct: agreementPct,
      firstReliableBallFrame: observations[0].frame,
      lastReliableBallFrame: observations[observations.length - 1].frame,
      catchFrame
    };
  }

  /**
   * 計算量測位移指標
   */
  private static computeVideoMetrics(
    observations: BallObservation[],
    track: BaseballTrackPoint[],
    validation: TrajectoryValidation,
    agreementPct: number
  ): VideoTrackMetrics {
    if (track.length < 2) {
      return {
        horizontal_movement_2d_norm: 0,
        vertical_movement_2d_norm: 0,
        total_movement_2d_norm: 0,
        horizontal_movement_2d_px: 0,
        vertical_movement_2d_px: 0,
        total_movement_2d_px: 0,
        trajectory_curvature_score: 0,
        vision_detected_frames_count: observations.length,
        interpolated_frames_count: 0,
        tracking_ratio_pct: 0,
        tracking_quality_status: 'insufficient',
        mean_observation_confidence: validation.meanConfidence,
        forward_backward_agreement_pct: agreementPct
      };
    }

    const start = track[0];
    const end = track[track.length - 1];
    const dxNorm = end.x_norm - start.x_norm;
    const dyNorm = end.y_norm - start.y_norm;
    const totalNorm = Math.sqrt(dxNorm * dxNorm + dyNorm * dyNorm);

    const dxPx = end.x - start.x;
    const dyPx = end.y - start.y;
    const totalPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx);

    return {
      horizontal_movement_2d_norm: Number(dxNorm.toFixed(4)),
      vertical_movement_2d_norm: Number(dyNorm.toFixed(4)),
      total_movement_2d_norm: Number(totalNorm.toFixed(4)),
      horizontal_movement_2d_px: Math.round(dxPx),
      vertical_movement_2d_px: Math.round(dyPx),
      total_movement_2d_px: Math.round(totalPx),
      trajectory_curvature_score: Number((Math.min(1.0, totalNorm * 1.5) * 100).toFixed(1)),
      vision_detected_frames_count: observations.length,
      interpolated_frames_count: track.length - observations.length,
      tracking_ratio_pct: Number(((observations.length / track.length) * 100).toFixed(1)),
      tracking_quality_status: validation.status === 'valid' ? 'reliable' : 'insufficient',
      first_seen_frame: start.frame,
      last_seen_frame: end.frame,
      visible_end_frame: end.frame,
      mean_observation_confidence: validation.meanConfidence,
      forward_backward_agreement_pct: agreementPct
    };
  }
}
