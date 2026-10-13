import { VideoTiming } from '../types';

export function hasUsableSourceTimes(timing: VideoTiming | null | undefined): boolean {
  if (!timing || !['container_timestamps', 'container_metadata', 'user_supplied'].includes(timing.fpsSource)) return false;
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
