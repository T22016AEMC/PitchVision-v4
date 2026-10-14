import React from 'react';

interface FrameSlidersCardProps {
  releaseFrame: number;
  gloveFrame: number;
  visibleEndFrame?: number;
  totalVideoFrames: number;
  fps?: number;
  timingConfirmed?: boolean;
  selectionOnly?: boolean;
  timestamps?: number[];
  aiReleaseFrame?: number | null;
  aiGloveFrame?: number | null;
  disabled?: boolean;
  onChangeReleaseFrame: (frame: number) => void;
  onChangeGloveFrame: (frame: number) => void;
  onChangeVisibleEndFrame?: (frame: number) => void;
  onSeekVideoFrame?: (frame: number) => void;
}

export const FrameSlidersCard: React.FC<FrameSlidersCardProps> = ({
  releaseFrame,
  gloveFrame,
  visibleEndFrame,
  totalVideoFrames,
  fps = NaN,
  timingConfirmed = false,
  selectionOnly = false,
  timestamps,
  aiReleaseFrame,
  aiGloveFrame,
  disabled = false,
  onChangeReleaseFrame,
  onChangeGloveFrame,
  onChangeVisibleEndFrame,
  onSeekVideoFrame,
}) => {
  const maxAvailable = totalVideoFrames > 0 ? totalVideoFrames - 1 : 0;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : NaN;

  const handleReleaseChange = (val: number) => {
    if (disabled || !Number.isFinite(val)) return;
    const clamped = Math.max(0, Math.min(val, maxAvailable));
    onChangeReleaseFrame(clamped);
    if (onSeekVideoFrame) {
      onSeekVideoFrame(clamped);
    }
  };

  const handleGloveChange = (val: number) => {
    if (disabled || !Number.isFinite(val)) return;
    const clamped = Math.max(0, Math.min(val, maxAvailable));
    onChangeGloveFrame(clamped);
    if (onSeekVideoFrame) {
      onSeekVideoFrame(clamped);
    }
  };

  const isOrderValid = gloveFrame > releaseFrame;
  const flightDiff = gloveFrame - releaseFrame;
  const flightSec =
    timestamps &&
    timestamps[gloveFrame] !== undefined &&
    timestamps[releaseFrame] !== undefined &&
    timestamps[gloveFrame] > timestamps[releaseFrame]
      ? timestamps[gloveFrame] - timestamps[releaseFrame]
      : flightDiff / safeFps;

  return (
    <div className={`bg-[#0b1329]/90 border border-slate-800/90 rounded-2xl p-4 shadow-lg transition-opacity ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      {disabled && (
        <div className="mb-3 text-[11.5px] text-amber-300/90 bg-amber-950/30 border border-amber-500/20 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
          <span>目前處理中，完成後可繼續調整。</span>
        </div>
      )}

      {/* Frame Status Overview */}
      <div className="mb-3.5 pb-2.5 border-b border-slate-800/70 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-300 font-semibold">出手／進手套設定：</span>
          <span className="text-slate-400 font-mono text-[11px]">{selectionOnly?'暫選時間位置，非已確認影格；確認 FPS 後重新選格':'兩個影格可獨立調整'}</span>
        </div>
        <div>
          {isOrderValid ? (
            <span className="text-emerald-400 font-mono font-medium text-[11.5px] bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded">
              {timingConfirmed ? `飛行間隔：${flightDiff} 位置 · ${flightSec.toFixed(3)} 秒` : '時間資料待確認'}
            </span>
          ) : (
            <span className="text-amber-400 font-mono text-[11px] bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded">
              ⚠️ 提示: 進手套影格需大於出手影格以推算球速
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Left Column: 自定義出手影格 (Release Frame) - 完全獨立 */}
        <div className="space-y-2 bg-slate-900/50 p-3 rounded-xl border border-red-950/40">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <span className="text-red-400 font-bold text-xs sm:text-[13px] flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
              {selectionOnly?'出手時間位置':'出手影格 F'}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleReleaseChange(releaseFrame - 1)}
                disabled={disabled || releaseFrame <= 0}
                className="w-11 h-11 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold flex items-center justify-center disabled:opacity-40"
                title="出手影格 -1 幀"
              >
                -
              </button>
              <input
                type="number"
                min={0}
                max={maxAvailable}
                value={releaseFrame}
                onChange={(e) => handleReleaseChange(Number(e.target.value))}
                className="w-14 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-red-400 font-mono font-bold text-center text-xs focus:outline-none focus:border-red-500"
              />
              <button
                type="button"
                onClick={() => handleReleaseChange(releaseFrame + 1)}
                disabled={disabled || releaseFrame >= maxAvailable}
                className="w-11 h-11 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold flex items-center justify-center disabled:opacity-40"
                title="出手影格 +1 幀"
              >
                +
              </button>
            </div>
          </div>

          <div className="relative pt-1 pb-0.5">
            <input
              id="slider-release-frame"
              type="range"
              min={0}
              max={maxAvailable}
              value={releaseFrame}
              onChange={(e) => handleReleaseChange(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-red-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-0.5">
            <span className="text-slate-500">0</span>
            {aiReleaseFrame !== undefined && aiReleaseFrame !== null ? (
              <span className="text-slate-400">AI建議參考: F{aiReleaseFrame}</span>
            ) : (
              <span className="text-slate-500">連動影片跳格</span>
            )}
            <span className="text-slate-500">{maxAvailable}</span>
          </div>
        </div>

        {/* Right Column: 自定義進手套影格 (Glove Frame) - 完全獨立 */}
        <div className="space-y-2 bg-slate-900/50 p-3 rounded-xl border border-amber-950/40">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <span className="text-amber-400 font-bold text-xs sm:text-[13px] flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"></span>
              {selectionOnly?'進手套時間位置':'進手套影格 F'}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleGloveChange(gloveFrame - 1)}
                disabled={disabled || gloveFrame <= 0}
                className="w-11 h-11 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold flex items-center justify-center disabled:opacity-40"
                title="進手套影格 -1 幀"
              >
                -
              </button>
              <input
                type="number"
                min={0}
                max={maxAvailable}
                value={gloveFrame}
                onChange={(e) => handleGloveChange(Number(e.target.value))}
                className="w-14 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-amber-400 font-mono font-bold text-center text-xs focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => handleGloveChange(gloveFrame + 1)}
                disabled={disabled || gloveFrame >= maxAvailable}
                className="w-11 h-11 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold flex items-center justify-center disabled:opacity-40"
                title="進手套影格 +1 幀"
              >
                +
              </button>
            </div>
          </div>

          <div className="relative pt-1 pb-0.5">
            <input
              id="slider-glove-frame"
              type="range"
              min={0}
              max={maxAvailable}
              value={gloveFrame}
              onChange={(e) => handleGloveChange(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-0.5">
            <span className="text-slate-500">0</span>
            {aiGloveFrame !== undefined && aiGloveFrame !== null ? (
              <span className="text-slate-400">AI建議參考: F{aiGloveFrame}</span>
            ) : (
              <span className="text-slate-500">連動影片跳格</span>
            )}
            <span className="text-slate-500">{maxAvailable}</span>
          </div>
        </div>
      </div>

      {/* Visible End Frame (球最後可見影格) 輔助設定 */}
      {visibleEndFrame !== undefined && onChangeVisibleEndFrame && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            <span>球體最後可見影格 (Visible End Frame):</span>
            <span className="font-mono text-cyan-300 font-bold">F{visibleEndFrame}</span>
            <span className="text-[11px] text-slate-500">(接球者不完整在畫面時，此點為最後可靠視覺終點)</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChangeVisibleEndFrame(Math.max(releaseFrame + 1, visibleEndFrame - 1))}
              disabled={disabled || visibleEndFrame <= releaseFrame + 1}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs disabled:opacity-40"
            >
              -1
            </button>
            <button
              type="button"
              onClick={() => onChangeVisibleEndFrame(Math.min(maxAvailable, visibleEndFrame + 1))}
              disabled={disabled || visibleEndFrame >= maxAvailable}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs disabled:opacity-40"
            >
              +1
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
