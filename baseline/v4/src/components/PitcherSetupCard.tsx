import React from 'react';
import { Mountain, Ruler, Footprints, Sparkles, CheckCircle2, Sliders, Info } from 'lucide-react';
import { PitcherBiometrics } from '../types';

interface PitcherSetupCardProps {
  biometrics: PitcherBiometrics;
  onChange: (updated: PitcherBiometrics) => void;
  recomputeBiometrics: (
    hasMound: boolean,
    pitcherHeightCm: number,
    strideOption: 'ai_auto' | 'manual',
    manualStrideDistanceCm?: number
  ) => PitcherBiometrics;
}

export const PitcherSetupCard: React.FC<PitcherSetupCardProps> = ({
  biometrics,
  onChange,
  recomputeBiometrics
}) => {
  const handleMoundToggle = (hasMound: boolean) => {
    const updated = recomputeBiometrics(
      hasMound,
      biometrics.pitcherHeightCm,
      biometrics.strideOption,
      biometrics.manualStrideDistanceCm
    );
    onChange(updated);
  };

  const handleHeightChange = (height: number) => {
    const clamped = Math.max(130, Math.min(215, height));
    const updated = recomputeBiometrics(
      biometrics.hasMound,
      clamped,
      biometrics.strideOption,
      biometrics.manualStrideDistanceCm
    );
    onChange(updated);
  };

  const handleStrideModeChange = (mode: 'ai_auto' | 'manual') => {
    const updated = recomputeBiometrics(
      biometrics.hasMound,
      biometrics.pitcherHeightCm,
      mode,
      biometrics.manualStrideDistanceCm
    );
    onChange(updated);
  };

  const handleManualStrideChange = (strideCm: number) => {
    const clamped = Math.max(80, Math.min(210, strideCm));
    const updated = recomputeBiometrics(
      biometrics.hasMound,
      biometrics.pitcherHeightCm,
      'manual',
      clamped
    );
    onChange(updated);
  };

  return (
    <div id="initial-pitcher-setup" className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-4 space-y-3.5 shadow-md">
      {/* Card Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-xs">
            0
          </div>
          <div>
            <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>初始設置：投手環境與生物力學參數</span>
              <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-500/40 px-1.5 py-0.2 rounded font-mono">
                校正連動
              </span>
            </h3>
            <p className="text-[10.5px] text-slate-400">
              設定投手丘、身高與跨步，系統將自動同步校正 3D 空間姿態、轉速與轉軸時鐘
            </p>
          </div>
        </div>

        <div className="text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono">
          <CheckCircle2 className="w-3 h-3" />
          帶入後續校正
        </div>
      </div>

      {/* 3 Main Controls in Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 1. 是否有投手丘 (Mound Presence) */}
        <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5 text-amber-300">
              <Mountain className="w-3.5 h-3.5" />
              1. 是否有投手丘
            </span>
            <span className="text-[10.5px] font-mono text-slate-400">
              {biometrics.hasMound ? '10吋 / 25.4cm' : '0cm (平地)'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              id="btn-mound-yes"
              onClick={() => handleMoundToggle(true)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all text-center flex items-center justify-center gap-1.5 ${
                biometrics.hasMound
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <span>🏔️ 標準投手丘</span>
            </button>

            <button
              type="button"
              id="btn-mound-no"
              onClick={() => handleMoundToggle(false)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all text-center flex items-center justify-center gap-1.5 ${
                !biometrics.hasMound
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <span>🟢 平地投球</span>
            </button>
          </div>

          <div className="text-[10.5px] text-slate-400 leading-snug">
            {biometrics.hasMound
              ? '✅ 含 25.4cm 坡度落差，增加下坡重力動能與進動俯衝角'
              : 'ℹ️ 無投手丘落差 (室內牛棚/平地)，轉軸為自然垂直發力面'}
          </div>
        </div>

        {/* 2. 投手身高 (Pitcher Height) */}
        <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5 text-blue-300">
              <Ruler className="w-3.5 h-3.5" />
              2. 投手身高
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-bold font-mono text-white">
                {biometrics.pitcherHeightCm}
              </span>
              <span className="text-[10px] text-slate-400">cm</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="input-pitcher-height"
              type="range"
              min="145"
              max="205"
              step="1"
              value={biometrics.pitcherHeightCm}
              onChange={(e) => handleHeightChange(Number(e.target.value))}
              className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
            <input
              type="number"
              min="140"
              max="215"
              value={biometrics.pitcherHeightCm}
              onChange={(e) => handleHeightChange(Number(e.target.value))}
              className="w-16 bg-slate-900 border border-slate-700 text-white font-mono text-xs px-1.5 py-1 rounded text-center focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Quick presets */}
          <div className="flex items-center justify-between gap-1">
            {[170, 175, 178, 183, 188].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => handleHeightChange(h)}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                  biometrics.pitcherHeightCm === h
                    ? 'bg-blue-600 text-white font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        {/* 3. 跨步距離 (Stride Distance) - 選填，也可由AI判斷 */}
        <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5 text-emerald-300">
              <Footprints className="w-3.5 h-3.5" />
              3. 跨步距離
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              選填 / 可由AI判斷
            </span>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-2 gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[11px]">
            <button
              type="button"
              id="btn-stride-ai"
              onClick={() => handleStrideModeChange('ai_auto')}
              className={`py-1 rounded text-center font-medium transition-all flex items-center justify-center gap-1 ${
                biometrics.strideOption === 'ai_auto'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3 h-3 text-emerald-400" />
              <span>AI 自動判斷</span>
            </button>

            <button
              type="button"
              id="btn-stride-manual"
              onClick={() => handleStrideModeChange('manual')}
              className={`py-1 rounded text-center font-medium transition-all flex items-center justify-center gap-1 ${
                biometrics.strideOption === 'manual'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3 h-3 text-emerald-400" />
              <span>手動自訂</span>
            </button>
          </div>

          {biometrics.strideOption === 'ai_auto' ? (
            <div className="bg-emerald-950/30 border border-emerald-500/20 rounded p-1.5 text-[10.5px] text-emerald-300/90 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-emerald-400" />
                AI 估算：<strong>{biometrics.effectiveStrideDistanceCm} cm</strong>
              </span>
              <span className="font-mono text-[10px] text-emerald-400/80">
                約佔身高 {biometrics.strideRatioPct}%
              </span>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  id="input-manual-stride"
                  type="range"
                  min="100"
                  max="195"
                  step="1"
                  value={biometrics.effectiveStrideDistanceCm}
                  onChange={(e) => handleManualStrideChange(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
                <input
                  type="number"
                  min="80"
                  max="210"
                  value={biometrics.effectiveStrideDistanceCm}
                  onChange={(e) => handleManualStrideChange(Number(e.target.value))}
                  className="w-16 bg-slate-900 border border-slate-700 text-white font-mono text-xs px-1.5 py-1 rounded text-center focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="text-[10px] text-slate-400 flex justify-between">
                <span>佔身高比例: <strong className="text-emerald-300 font-mono">{biometrics.strideRatioPct}%</strong></span>
                <span>跨步越大 ➜ 轉速扭矩加乘</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic Biomechanical & Spatial Preview Bar */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 text-[11px] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-slate-300">
          <Info className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400">衍生物理幾何：</span>
          <span>延伸量 (Ext): <strong className="text-cyan-300 font-mono">{biometrics.calculatedExtensionM} m</strong></span>
          <span className="text-slate-600">|</span>
          <span>進手套實測距離: <strong className="text-white font-mono">{biometrics.effectiveTravelDistanceM} m</strong></span>
        </div>

        <div className="text-[10.5px] text-amber-300/90 font-medium flex items-center gap-1">
          <span>🎯 轉軸方位角 ＋ 轉速 (RPM) 均將帶入校正運算</span>
        </div>
      </div>
    </div>
  );
};
