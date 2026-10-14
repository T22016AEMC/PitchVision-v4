import {normalizeSourceTiming} from './sourceTiming';
import { readMp4Timing } from './mp4Timing';
import { VideoTiming } from '../types';
import { VideoTimingService } from './videoTimingService';
import { VideoMetadataService, VideoQualityAssessment } from './videoMetadataService';

export type VideoLoadStatus = 'idle' | 'uploading' | 'processing_metadata' | 'ready' | 'failed';

export interface LoadedVideoSession {
  timing: VideoTiming;
  objectUrl: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  durationSec: number;
  actualFps: number;
  fpsSource: VideoTiming['fpsSource'];
  isFpsEstimated: boolean;
  isVFR: boolean;
  totalFrames: number;
  timestamps: number[];
  qualityAssessment: VideoQualityAssessment;
  initialReleaseFrame: number;
  initialGloveFrame: number;
}

const SUPPORTED_VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/webm',
  'video/ogg',
  'video/mov'
];

/**
 * VideoLoadService (統一影片載入與生命週期控制器)
 * 負責：
 * 1. 嚴格管理 Object URL (載入新影片前必定 revoke 舊 URL，避免記憶體洩漏與狀態殘留)
 * 2. 單次上傳完整完成：驗證 MIME -> 建立 Object URL -> offscreen video preload metadata -> 探測 FPS 與 frame count -> 回傳 ready state
 * 3. 明確區分 वास्तविक FPS 與 FPS ESTIMATED
 */
export class VideoLoadService {
  private static activeObjectUrl: string | null = null;

  /**
   * 釋放先前的 Object URL
   */
  static revokePreviousObjectUrl(urlToRevoke?: string | null): void {
    const target = urlToRevoke || this.activeObjectUrl;
    if (target && target.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(target);
      } catch (e) {
        console.warn('Failed to revoke object URL:', e);
      }
    }
    if (!urlToRevoke || urlToRevoke === this.activeObjectUrl) {
      this.activeObjectUrl = null;
    }
  }

  /**
   * 驗證是否為支援的影片檔案格式
   */
  static isSupportedVideoFile(file: File): boolean {
    if (file.type && SUPPORTED_VIDEO_MIMES.includes(file.type.toLowerCase())) {
      return true;
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ['mp4', 'mov', 'm4v', 'webm', 'ogv'].includes(ext);
  }

  /**
   * 完整單一流程載入使用者上傳之影片檔案
   */
  static async loadVideoFile(
    file: File,
    onStatusChange?: (status: VideoLoadStatus, message: string) => void
  ): Promise<LoadedVideoSession> {
    if (!this.isSupportedVideoFile(file)) {
      onStatusChange?.('failed', '不支援此影片格式，請上傳 MP4、MOV 或 WebM 影片。');
      throw new Error('不支援此影片格式，請確認檔案為 MP4 / MOV / WebM。');
    }

    onStatusChange?.('uploading', `正在讀取影片檔案 (${file.name})...`);

    // 1. 釋放前一支影片的 Object URL
    this.revokePreviousObjectUrl();

    // 2. 建立新的 Object URL
    const objectUrl = URL.createObjectURL(file);
    this.activeObjectUrl = objectUrl;

    onStatusChange?.('processing_metadata', '正在解析影片解析度、時長與時間戳 (Metadata)...');

    // 3. 建立獨立 probe video element 並等待 loadedmetadata
    const probeVideo = document.createElement('video');
    probeVideo.preload = 'metadata';
    probeVideo.muted = true;
    probeVideo.playsInline = true;

    try {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          cleanup();
          reject(new Error('影片無法讀取，逾時或編碼不支援，請確認格式。'));
        }, 10000);

        const cleanup = () => {
          window.clearTimeout(timeoutId);
          probeVideo.onloadedmetadata = null;
          probeVideo.onerror = null;
        };

        probeVideo.onloadedmetadata = () => {
          cleanup();
          resolve();
        };

        probeVideo.onerror = () => {
          cleanup();
          reject(new Error('影片無法讀取，請確認格式。'));
        };

        probeVideo.src = objectUrl;
        probeVideo.load();
      });
    } catch (err) {
      this.revokePreviousObjectUrl(objectUrl);
      const msg = err instanceof Error ? err.message : '影片無法讀取，請確認格式。';
      onStatusChange?.('failed', msg);
      throw new Error(msg);
    }

    // Some browser-recorded WebM files expose duration only after seeking to their buffered end.
    if(!Number.isFinite(probeVideo.duration)){
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('影片未提供可確認的時長，請匯出包含完整時間資訊的影片')),4000);
        const finish=(error?:Error)=>{clearTimeout(timer);probeVideo.removeEventListener('durationchange',changed);probeVideo.removeEventListener('seeked',changed);error?reject(error):resolve();};
        const changed=()=>{if(Number.isFinite(probeVideo.duration)&&probeVideo.duration>0)finish();};
        probeVideo.addEventListener('durationchange',changed);probeVideo.addEventListener('seeked',changed);probeVideo.currentTime=1e9;
      });
      probeVideo.currentTime=0;
    }
    if (!Number.isFinite(probeVideo.duration) || probeVideo.duration <= 0 || !probeVideo.videoWidth || !probeVideo.videoHeight) {
      throw new Error('影片缺少有效長度或影像軌，請改用可播放的 MP4 / MOV / WebM 檔案。');
    }
    const width = probeVideo.videoWidth || 720;
    const height = probeVideo.videoHeight || 1280;
    const durationSec =
      probeVideo.duration && Number.isFinite(probeVideo.duration) && probeVideo.duration > 0
        ? Number(probeVideo.duration.toFixed(3))
        : 5.0;

    // 4. 探測真實 FPS 與時間戳
    let timing: VideoTiming;
    try {
      const parsed=await readMp4Timing(file);
      timing = parsed?normalizeSourceTiming(parsed,durationSec):await VideoTimingService.probeVideoTiming(probeVideo);
      if (timing.timingReliable && Math.abs(timing.durationSec - durationSec) > Math.max(0.15, durationSec * 0.05)) {
        timing.timingReliable = false;
        timing.timingWarning = '容器PTS與播放器時長不一致，請人工確認時間。';
      }
    } catch (error) {
      timing = await VideoTimingService.probeVideoTiming(probeVideo);
      timing.timingWarning = (error instanceof Error ? error.message : '時間表解析失敗') + '；請指定可信FPS。';
    }
    const actualFps = timing.actualFps;
    const isFpsEstimated = !Number.isFinite(actualFps) || timing.fpsSource === 'estimated';
    const totalFrames = timing.totalFrames;

    // 5. 評估影片品質
    const qualityAssessment = VideoMetadataService.assessVideoQuality(
      width,
      height,
      Number.isFinite(actualFps)?actualFps:0,
      durationSec
    );
    if (isFpsEstimated) {
      qualityAssessment.warnings = [
        ...qualityAssessment.warnings,
        '未取得完整來源時間表，FPS未知；需明確確認CFR假設，不以推算位置當真實影格'
      ];
    }

    // 6. 預設初始檢視區間 (標示為 Reference Estimate，非 AI Detection)
    const initialReleaseFrame = totalFrames?Math.min(
      Math.round(totalFrames * 0.25),
      Math.max(2, Math.round(actualFps * 0.35))
    ):0;
    const expectedFlightFrames = totalFrames?Math.max(5, Math.round(actualFps * 0.48)):0;
    const initialGloveFrame = Math.max(0,Math.min(totalFrames - 1, initialReleaseFrame + expectedFlightFrames));

    // 清理臨時 probe element (保留 objectUrl 給主播放器)
    probeVideo.removeAttribute('src');
    probeVideo.load();

    onStatusChange?.('ready', `影片載入完成 (${width}x${height} @ ${actualFps} FPS)`);

    return {
      timing,
      objectUrl,
      fileName: file.name,
      mimeType: file.type || 'video/mp4',
      width,
      height,
      durationSec,
      actualFps,
      fpsSource: timing.fpsSource,
      isFpsEstimated,
      isVFR: timing.isVFR,
      totalFrames,
      timestamps: timing.timestamps,
      qualityAssessment,
      initialReleaseFrame,
      initialGloveFrame
    };
    } catch (error) {
      this.revokePreviousObjectUrl(objectUrl);
      const message = error instanceof Error ? error.message : '影片解析失敗。';
      onStatusChange?.('failed', message);
      throw error;
    } finally {
      probeVideo.pause();
      probeVideo.removeAttribute('src');
      probeVideo.load();
    }
  }
}
