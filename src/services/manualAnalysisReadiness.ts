import { VideoTiming } from '../types';
import { SelectedEvents, describePosition, selectEvent } from './analysisTimeline';

// Explicit user confirmation adapts event indices while preserving selected seconds.
// It does not modify container PTS or claim new decoded observations.
export function confirmCfrTiming<T extends VideoTiming>(timing: T, fps: number, events: SelectedEvents) {
  if (!Number.isFinite(fps) || fps < 1 || fps > 1000) throw Error('FPS 須為 1 至 1000 的有效數值。');
  if (!Number.isFinite(timing.durationSec) || timing.durationSec <= 0) throw Error('影片時長無效，無法確認 FPS。');
  const count = Math.ceil(timing.durationSec * fps);
  if (count < 2 || count > 600000) throw Error('CFR 時間軸位置數超出可用範圍，請確認影片時長與 FPS。');
  const timestamps = Array.from({length: count}, (_, i) => i / fps);
  const remap = (event: SelectedEvents['release']) => {
    if (!event) return null;
    if (!Number.isFinite(event.timeSec) || event.timeSec < 0 || event.timeSec > timestamps.at(-1)!) throw Error('已選事件超出 CFR 可定位範圍，請調整事件時間後再確認 FPS。');
    return {...selectEvent(describePosition(timestamps, event.timeSec, true), timestamps), kind: 'cfr_assumed' as const};
  };
  return {
    timing: {...timing, actualFps: fps, fpsSource: 'user_supplied' as const, timingReliable: true, isVFR: false, totalFrames: count, timestamps, timeBase: 'fps_derived' as const, timingWarning: '使用者確認 CFR 假設；位置數並非已驗證的原始影格數，解碼與事件精度仍受來源限制。'},
    events: {release: remap(events.release), glove: remap(events.glove)}
  };
}

export function hasUsableSourceTimes(timing: VideoTiming | null | undefined): boolean {
  if (!timing || !['container_timestamps', 'container_metadata', 'user_supplied'].includes(timing.fpsSource)) return false;
  if(!Number.isFinite(timing.actualFps)||timing.actualFps<=0||timing.totalFrames!==timing.timestamps.length)return false;
  return timing.timestamps.length >= 2 && timing.timestamps.every((t, i, a) => Number.isFinite(t) && t >= 0 && (!i || t > a[i - 1]));
}

export function manualAnalysisReason(loaded: boolean, busy: boolean, autoBusy: boolean, timing: VideoTiming | null, release: number, glove: number, sourceTimesValid=hasUsableSourceTimes(timing)): string | null {
  if (!loaded) return '請先載入可播放的影片。';
  if (busy) return '分析正在執行。';
  if (autoBusy) return '自動辨識正在讀取影片；可先停止，再使用手動分析。';
  if (!sourceTimesValid) return '影片時間表不可用，請輸入並按下「確認 FPS」，採用明示的 CFR 時間假設。';
  if (!Number.isInteger(release) || !Number.isInteger(glove) || release < 0 || glove >= timing!.timestamps.length || glove <= release) return '請設定有效出手與進手套時間，且進手套必須晚於出手。';
  if(timing!.timestamps[glove]>timing!.durationSec+1e-6)return '選取的來源時間超出可播放時長，請重新確認事件時間。';
  return null;
}
