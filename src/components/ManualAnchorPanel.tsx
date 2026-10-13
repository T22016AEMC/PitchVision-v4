import React from 'react';
import { Target, HelpCircle, Check, X, MousePointerClick, RefreshCw } from 'lucide-react';
import { ManualAnchorInput } from '../types';

interface ManualAnchorPanelProps {
  currentFrame: number;
  manualAnchor: ManualAnchorInput | null;
  onSetPoint1: (frame: number, xNorm: number, yNorm: number) => void;
  onSetPoint2: (frame: number, xNorm: number, yNorm: number) => void;
  onClearAnchors: () => void;
  isSelectingPoint: 1 | 2 | null;
  onStartSelectingPoint: (ptIndex: 1 | 2) => void;
  onCancelSelecting: () => void;
  videoFps?: number;
}

export const ManualAnchorPanel: React.FC<ManualAnchorPanelProps> = ({
  currentFrame,
  manualAnchor,
  onSetPoint1,
  onSetPoint2,
  onClearAnchors,
  isSelectingPoint,
  onStartSelectingPoint,
  onCancelSelecting,
  videoFps = 24
}) => {
  const p1 = manualAnchor?.point1;
  const p2 = manualAnchor?.point2;

  const isComplete = Boolean(p1 && p2);

  return (
    <div className="bg-[#0b1329]/95 border border-cyan-500/40 rounded-xl p-3.5 space-y-3 text-xs shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-cyan-950 border border-cyan-500/50 flex items-center justify-center text-cyan-400">
            <Target className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="font-bold text-slate-100 flex items-center gap-1.5">
              <span>人工雙錨點模式 (Manual Anchor Mode)</span>
              <span className="text-[10px] bg-cyan-950 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/30">
                2 點標定
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              手機 720p/24 FPS 若 AI 找不到球，只需在影片點選 2 個位置，系統自動建立真實中間軌跡
            </div>
          </div>
        </div>

        {isComplete && (
          <button
            type="button"
            onClick={onClearAnchors}
            className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1 font-mono px-2 py-1 rounded bg-slate-900 border border-slate-700 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            清除重設
          </button>
        )}
      </div>

      {/* 提示訊息 */}
      {isSelectingPoint && (
        <div className="bg-amber-950/60 border border-amber-500/50 rounded-lg p-2.5 flex items-center justify-between text-amber-200 animate-pulse">
          <div className="flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-amber-400" />
            <span>請直接在上方影片中<strong>點擊棒球位置</strong>，將設定為【錨點 {isSelectingPoint} (F{currentFrame})】</span>
          </div>
          <button
            type="button"
            onClick={onCancelSelecting}
            className="px-2 py-0.5 rounded bg-amber-900 text-amber-100 text-[11px] hover:bg-amber-800"
          >
            取消
          </button>
        </div>
      )}

      {/* 雙錨點卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {/* Point 1: 早期或初見點 */}
        <div className={`p-2.5 rounded-lg border transition-all ${
          p1
            ? 'bg-slate-900/90 border-cyan-500/50'
            : isSelectingPoint === 1
            ? 'bg-cyan-950/60 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
            : 'bg-slate-950/60 border-slate-800'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-cyan-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              錨點 1 (出手附近 / 首次看見球)
            </span>
            {p1 ? (
              <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                <Check className="w-3.5 h-3.5" /> 已標定
              </span>
            ) : (
              <span className="text-slate-500 text-[10px]">待設定</span>
            )}
          </div>

          {p1 ? (
            <div className="text-[11px] text-slate-300 font-mono space-y-0.5">
              <div>影格: <strong className="text-cyan-300">F{p1.frame}</strong> ({(p1.frame / videoFps).toFixed(2)}s)</div>
              <div className="text-slate-400 text-[10px]">座標: ({Math.round(p1.x_norm * 100)}%, {Math.round(p1.y_norm * 100)}%)</div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">
              將影片暫停在球剛離開手或首次看見球的影格
            </div>
          )}

          <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between">
            <button
              type="button"
              onClick={() => onStartSelectingPoint(1)}
              className={`w-full py-1 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                isSelectingPoint === 1
                  ? 'bg-cyan-500 text-slate-950 shadow'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              <span>{p1 ? '重新點擊定位' : `在當前 (F${currentFrame}) 點擊定位`}</span>
            </button>
          </div>
        </div>

        {/* Point 2: 晚期或進手套前點 */}
        <div className={`p-2.5 rounded-lg border transition-all ${
          p2
            ? 'bg-slate-900/90 border-amber-500/50'
            : isSelectingPoint === 2
            ? 'bg-amber-950/60 border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
            : 'bg-slate-950/60 border-slate-800'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-amber-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              錨點 2 (進手套前 / 最後看見球)
            </span>
            {p2 ? (
              <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                <Check className="w-3.5 h-3.5" /> 已標定
              </span>
            ) : (
              <span className="text-slate-500 text-[10px]">待設定</span>
            )}
          </div>

          {p2 ? (
            <div className="text-[11px] text-slate-300 font-mono space-y-0.5">
              <div>影格: <strong className="text-amber-300">F{p2.frame}</strong> ({(p2.frame / videoFps).toFixed(2)}s)</div>
              <div className="text-slate-400 text-[10px]">座標: ({Math.round(p2.x_norm * 100)}%, {Math.round(p2.y_norm * 100)}%)</div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">
              將影片暫停在球接近打者/手套或最後清楚可見的影格
            </div>
          )}

          <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between">
            <button
              type="button"
              onClick={() => onStartSelectingPoint(2)}
              className={`w-full py-1 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                isSelectingPoint === 2
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              <span>{p2 ? '重新點擊定位' : `在當前 (F${currentFrame}) 點擊定位`}</span>
            </button>
          </div>
        </div>
      </div>

      {isComplete && (
        <div className="bg-emerald-950/50 border border-emerald-500/40 rounded-lg p-2 text-[11px] text-emerald-300 flex items-center justify-between">
          <span>
            雙錨點設定完成！飛行區間跨越 <strong>{Math.abs(p2.frame - p1.frame)} 影格</strong>，系統將自動進行短缺插值並建立 VIDEO TRACK。
          </span>
        </div>
      )}
    </div>
  );
};
