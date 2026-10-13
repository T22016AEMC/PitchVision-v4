import { VideoTiming, DecodedVideoFrame } from '../types';

/**
 * VideoTimingService
 * 負責影片真實時間戳、FPS 測量與影格解碼，取代寫死 60 FPS 或單純依檔名猜測。
 * 遵循原則：actual timestamp > actual FPS > estimated FPS
 */
export class VideoTimingService {
  /**
   * 精確探測影片實際 FPS 與時間資訊
   */
  static async probeVideoTiming(
    video: HTMLVideoElement,
    fileName?: string
  ): Promise<VideoTiming> {
    const durationSec = video.duration && !isNaN(video.duration) ? video.duration : 5;
    // File names never supply timing. Playback cadence is only a fallback estimate.
    let detectedFps: number | null = null;
    let fpsSource: VideoTiming['fpsSource'] = 'estimated';
    if (!video.paused && 'requestVideoFrameCallback' in video) {
      detectedFps = await this.measureFpsViaRvfc(video);
      if (detectedFps && detectedFps > 10 && detectedFps <= 250) fpsSource = 'measured_rvfc';
      else detectedFps = null;
    }
    if (!detectedFps) detectedFps = 30;
    const totalFrames = Math.max(15, Math.round(durationSec * detectedFps));
    const timestamps: number[] = [];
    const frameDt = 1.0 / detectedFps;
    for (let i = 0; i < totalFrames; i++) {
      timestamps.push(Number((i * frameDt).toFixed(4)));
    }

    return {
      actualFps: detectedFps,
      timingReliable: false,
      seekPrecision: 'estimated',
      timingWarning: '無可用容器PTS：此時間軸為估計，請指定可信FPS；未確認前禁止自動事件與物理分析。',
      fpsSource,
      totalFrames,
      durationSec: Number(durationSec.toFixed(3)),
      isVFR: false,
      timeBase: fpsSource === 'measured_rvfc' ? 'timestamp' : 'fps_derived',
      timestamps
    };
  }

  /**
   * 透過 requestVideoFrameCallback 在微小播放區間內計算真實幀差
   */
  private static measureFpsViaRvfc(video: HTMLVideoElement): Promise<number | null> {
    return new Promise((resolve) => {
      const targetFrames = 10;
      const frameTimes: number[] = [];
      let handle: number;
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (handle !== undefined) video.cancelVideoFrameCallback?.(handle);
        resolve(value);
      };
      const timeoutHandle = setTimeout(() => {
        finish(null);
      }, 800);

      const callback = (_now: DOMHighResTimeStamp, metadata: { mediaTime: number }) => {
        if (settled) return;
        frameTimes.push(metadata.mediaTime);
        if (frameTimes.length >= targetFrames) {
          clearTimeout(timeoutHandle);
          const diffs: number[] = [];
          for (let i = 1; i < frameTimes.length; i++) {
            const dt = frameTimes[i] - frameTimes[i - 1];
            if (dt > 0.002 && dt < 0.2) {
              diffs.push(dt);
            }
          }
          if (diffs.length >= 4) {
            const avgDt = diffs.reduce((a, b) => a + b, 0) / diffs.length;
            if (avgDt > 0) {
              finish(1.0 / avgDt);
              return;
            }
          }
          finish(null);
        } else if ('requestVideoFrameCallback' in video) {
          // @ts-ignore
          handle = video.requestVideoFrameCallback(callback);
        }
      };

      // @ts-ignore
      handle = video.requestVideoFrameCallback(callback);
    });
  }

  /**
   * 精確解碼影格：依 frameIndex 或明確的 timestamp 取得精確時間戳與影像資料
   */
  static async seekAndCaptureFrame(
    video: HTMLVideoElement,
    frameIndex: number,
    fps: number,
    renderCanvas?: HTMLCanvasElement,
    targetTimestampOverride?: number
  ): Promise<DecodedVideoFrame> {
    const safeFps = fps > 0 ? fps : 30;
    const targetTimestamp =
      targetTimestampOverride !== undefined && Number.isFinite(targetTimestampOverride)
        ? targetTimestampOverride
        : frameIndex / safeFps;

    // 非同步定位至精確時間點
    if (Math.abs(video.currentTime - targetTimestamp) > 0.004) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('影格定位逾時，未使用舊影像冒充指定影格')); }, 3000);
        const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); };
        const done = () => { cleanup(); resolve(); };
        const fail = () => { cleanup(); reject(new Error('影片解碼失敗')); };
        video.addEventListener('seeked', done); video.addEventListener('error', fail);
        video.currentTime = Math.max(0, Math.min(video.duration || 100, targetTimestamp + 0.0005));
      });
    }

    const actualTimestamp = video.currentTime;
    let imageData: ImageData | null = null;

    if (renderCanvas && video.videoWidth > 0 && video.videoHeight > 0) {
      const targetW = renderCanvas.width > 0 ? renderCanvas.width : video.videoWidth;
      const targetH = renderCanvas.height > 0 ? renderCanvas.height : video.videoHeight;
      renderCanvas.width = targetW;
      renderCanvas.height = targetH;
      const ctx = renderCanvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, targetW, targetH);
        try {
          imageData = ctx.getImageData(0, 0, targetW, targetH);
        } catch {
          // Cross-origin restriction fallback
          imageData = null;
        }
      }
    }

    return {
      frameIndex,
      timestamp: Number(actualTimestamp.toFixed(4)),
      imageData,
      width: renderCanvas?.width || video.videoWidth || 720,
      height: renderCanvas?.height || video.videoHeight || 1280
    };
  }

  /**
   * 計算飛行秒數與球速 (嚴格以真實 timestamp 計算)
   */
  static calculateTimestampVelocity(
    releaseTimestamp: number,
    catchTimestamp: number | null,
    distanceMeters: number
  ): { flightTimeSec: number | null; velocityKmh: number | null; isMeasured: boolean } {
    if (catchTimestamp === null || catchTimestamp <= releaseTimestamp) {
      return {
        flightTimeSec: null,
        velocityKmh: null,
        isMeasured: false
      };
    }

    const flightTimeSec = Number((catchTimestamp - releaseTimestamp).toFixed(4));
    if (flightTimeSec <= 0.1 || flightTimeSec > 3.0) {
      return {
        flightTimeSec: null,
        velocityKmh: null,
        isMeasured: false
      };
    }

    const velocityMs = distanceMeters / flightTimeSec;
    const velocityKmh = Number((velocityMs * 3.6).toFixed(1));

    return {
      flightTimeSec,
      velocityKmh,
      isMeasured: true
    };
  }
}
