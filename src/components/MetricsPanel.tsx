import React from 'react';
import { MatchResult } from '../types';
import { Gauge, Compass, Activity, Zap, TrendingUp, HelpCircle, CheckCircle2, GitFork, ShieldCheck, AlertTriangle } from 'lucide-react';

interface MetricsPanelProps {
  compact?: boolean;
  result?: MatchResult;
  matchedResult?: MatchResult;
  calcVelocity?: number;
  flightSeconds?: number;
  flightFrames?: number;
  standardDistance?: number;
}

export const MetricsPanel: React.FC<MetricsPanelProps> = ({
  compact=false,
  result,
  matchedResult,
  standardDistance = 17.5
}) => {
  const activeResult = matchedResult || result;

  if (!activeResult) {
    return (
      <div className="p-8 text-center bg-slate-950/60 border border-dashed border-slate-800 rounded-xl text-slate-400 text-xs space-y-3">
        <div className="w-12 h-12 rounded-xl overflow-hidden border border-orange-500/30 mx-auto shadow-md shadow-orange-500/20 bg-slate-900 flex items-center justify-center">
          <img
            src="/flaming_jet_baseball.jpg"
            alt="PitchVision Flaming Baseball"
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="font-bold text-slate-200 text-sm">
          等待上傳影片並自定義影格後啟動數據庫比對
        </div>
        <div className="text-[11px] text-slate-400 max-w-sm mx-auto text-left bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-1.5 leading-relaxed">
          <div className="font-semibold text-cyan-300">📋 投球數據分析流程：</div>
          <div>1. 於左側上傳投球影片（支援 24/30/60/120+ FPS，系統自動探測真實幀率與時間戳）</div>
          <div>2. 使用「AI 自動搜尋出手 / 進手套」或自主設定【出手影格】與【進手套影格】</div>
          <div>3. 系統依時間、距離與可用幾何約束分析；尺度不足時保留模型參考，不能視為實測位移。</div>
          <div>4. 於同球種【Synthetic Physics Reference Dataset】反查 RPM 與 Spin Axis 並執行物理重建閉環驗證</div>
        </div>
      </div>
    );
  }

  const {
    matched_pitch_type,
    estimated_velocity_kmh,
    spin_rate_rpm,
    spin_axis,
    spin_axis_decimal,
    spin_efficiency_pct,
    ivb_inch,
    hb_inch,
    flight_time_sec,
    similarity_score
  } = activeResult;

  const velMph = estimated_velocity_kmh * 0.621371;
  const bauerUnits = velMph > 0 ? (spin_rate_rpm / velMph).toFixed(1) : '22.5';
  const ivbSign = ivb_inch >= 0 ? '+' : '';
  const hbSign = hb_inch >= 0 ? '+' : '';
  const clockDeg = ((spin_axis_decimal % 12) / 12) * 360;

  return (
    <div id={compact?"metrics-panel-root":"science-metrics-root"} className={`space-y-4 ${compact?"metrics-compact":""}`}>
      {activeResult.observed_metrics&&!activeResult.observed_metrics.movement_valid&&<div className="p-3 rounded border border-amber-600 text-xs text-amber-200">幾何／追蹤未充分約束：下方位移與旋轉為原模型參考，並非精確量測。原始未截限 IVB {activeResult.observed_metrics.raw_ivb_inch?.toFixed(1)} / HB {activeResult.observed_metrics.raw_hb_inch?.toFixed(1)} 吋；顯示值若受限不得視為實測。{activeResult.observed_metrics.movement_limitation}</div>}
      <div className="science-detail">
      {/* 核心架構橫幅：嚴格遵循三類資料分流 */}
      <div className="bg-gradient-to-r from-blue-950/80 via-slate-900 to-indigo-950/80 border border-blue-500/30 rounded-xl p-3 text-xs space-y-1.5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-white flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            PitchVision 數據分流體系 (VIDEO DERIVED / CALIBRATED ESTIMATE / DATABASE INFERRED)
          </span>
          <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/30">
            Synthetic Physics Prior 1,080 筆
          </span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          {activeResult.calibration_notes || '以 PitchVision Synthetic Physics Reference Dataset (1,080 筆) 為基準，分離影片實測證據與物理模型推估。'}
        </p>
      </div>

      </div>

      {/* 軌跡狀態警示：若實測點不足，明確標示 INSUFFICIENT EVIDENCE，禁止偽造直連 */}
      {activeResult.video_track_status === 'INSUFFICIENT_EVIDENCE' && (
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200 space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>VIDEO TRACK 視覺證據不足 (INSUFFICIENT EVIDENCE)</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            系統恪遵「ACCURACY &gt; COVERAGE」原則，實測觀測點不足 (需 &ge; 3 個獨立實測點)，絕不以兩點直線或假拋物線冒充球路。
          </p>
        </div>
      )}

      {/* Insufficient Pitch Type Data 明確警示 (當 Strict Pitch Type Mode 開啟且該球種無資料時) */}
      {activeResult.is_insufficient_pitch_type_data && (
        <div className="bg-rose-950/60 border border-rose-500/60 rounded-xl p-3 text-xs text-rose-200 space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-rose-300">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>❌ 指定球種資料不足，無法可靠反推 RPM / Spin Axis (STRICT MODE)</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            目前處於 <strong>Strict Pitch Type Mode</strong>，且參考資料庫中無符合該指定球種之樣本。系統拒絕偷偷混用其他球種，若需跨球種廣義比對，請勾選「允許 Cross-Type Fallback」。
          </p>
        </div>
      )}

      {/* Cross-Type Fallback 明確警示 (當使用者明確啟用跨球種備援時) */}
      {activeResult.is_cross_type_fallback && (
        <div className="bg-rose-950/50 border border-rose-500/50 rounded-xl p-3 text-xs text-rose-200 space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-rose-300">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>⚠️ Cross-Type Fallback 跨球種備援比對啟用</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            指定球種於當前視角參考資料庫中無直接符合紀錄，已依您的設定啟用 <strong>Cross-Type Fallback</strong> 並调降反推信心度。
          </p>
        </div>
      )}

      {/* Pitch Header Badge */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold text-sm">
            {activeResult.code || 'P'}
          </div>
          <div>
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
              球種鎖定位移反查 ({activeResult.camera_view === 'catcher' ? '捕手視角' : '投手後方'})
            </div>
            <div className="text-base font-bold text-white flex items-center flex-wrap gap-2">
              {matched_pitch_type}
              <span className="text-xs font-normal text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30">
                {activeResult.is_cross_type_fallback ? 'Cross-Type Fallback' : `同球種樣本 ${activeResult.filtered_candidate_count ?? 120} 筆`}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-slate-400">位移/球速匹配度</div>
          <div className="text-lg font-black text-blue-400 font-mono">
            {similarity_score}%
          </div>
        </div>
      </div>

      <div className="science-detail">
      {/* 資料來源透明化三柱對照卡 (Evidence vs Prior vs Inference) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs space-y-2.5 shadow-sm">
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
          <span className="flex items-center gap-1.5 text-slate-200">
            <GitFork className="w-3.5 h-3.5 text-cyan-400" />
            核心準則：位移是觀測值，RPM / Spin Axis 是反推結果
          </span>
          <span className="text-emerald-400 font-mono text-[10px] bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            來源透明 • 嚴拒混淆
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-[11px]">
          {/* Column 1: Video Evidence */}
          <div className="bg-slate-950/80 border border-emerald-500/30 rounded-lg p-2 space-y-1">
            <div className="text-emerald-400 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              A. {activeResult.observed_metrics?.movement_valid?'CONDITIONED VIDEO EVIDENCE':'TIME / LEGACY PRIOR'}
            </div>
            <div className="text-[10px] text-slate-300">
              • 球速: <span className="text-white font-bold">{estimated_velocity_kmh} km/h</span>
            </div>
            <div className="text-[10px] text-slate-400">
              • {activeResult.observed_metrics?.movement_valid?'條件重建位移':'先驗位移參考'}: IVB {ivbSign}{ivb_inch}" / HB {hbSign}{hb_inch}"
            </div>
          </div>

          {/* Column 2: Database Prior */}
          <div className="bg-slate-950/80 border border-purple-500/30 rounded-lg p-2 space-y-1">
            <div className="text-purple-400 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
              B. DATABASE PRIOR
            </div>
            <div className="text-[10px] text-slate-300">
              • 候選加權: <span className="text-white font-bold">{activeResult.db_baseline_spin} RPM</span>
            </div>
            <div className="text-[10px] text-slate-400">
              • 鎖定球種 + 速度與位移多維反查
            </div>
          </div>

          {/* Column 3: Model Inference */}
          <div className="bg-slate-950/80 border border-amber-500/30 rounded-lg p-2 space-y-1">
            <div className="text-amber-400 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              C. MODEL INFERENCE
            </div>
            <div className="text-[10px] text-slate-300">
              • 反推轉軸: <span className="text-amber-300 font-bold">{spin_axis}</span>
            </div>
            <div className="text-[10px] text-slate-400">
              • 循環內插 + 出手角修正 + 前向驗證
            </div>
          </div>
        </div>
      </div>

      </div>

      {/* The 5 Core Metrics */}
      <div className="grid grid-cols-1 gap-3">
        {/* Metric 1: Velocity */}
        <div id="metric-card-velocity" className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 transition-all hover:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span className="flex items-center gap-1.5">
              <Gauge className="w-4 h-4 text-emerald-400" />
              1. 平均球速 (Distance / Time)
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9.5px] font-mono uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded font-bold">
                {activeResult.source_velocity || 'VIDEO DERIVED'}
              </span>
              <span className="text-[10px] bg-blue-950/80 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded font-mono">
                {activeResult.standard_distance_m || standardDistance}m {activeResult.observed_metrics?.movement_valid ? '幾何條件距離' : '先驗估算距離'}
              </span>
            </div>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl font-black text-white tracking-tight font-mono">
              {estimated_velocity_kmh}
            </span>
            <span className="text-base font-medium text-slate-400">km/h</span>
            {activeResult.uncertainty && (
              <span className="text-xs font-mono text-emerald-300 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30">
                ±{activeResult.uncertainty.velocity_plus_minus_kmh} km/h
              </span>
            )}
            <span className="text-xs font-mono text-slate-500 ml-1">
              ({velMph.toFixed(1)} mph)
            </span>
          </div>
          <div className="text-xs text-slate-400 font-medium mt-1 flex flex-wrap items-center gap-2">
            <span>DB候選基準: <strong className="text-blue-300 font-mono">{activeResult.db_baseline_velocity} km/h</strong></span>
            <span className="text-slate-600">|</span>
            <span>飛行時間: <strong className="text-emerald-300 font-mono">{flight_time_sec.toFixed(3)}s</strong></span>
          </div>
        </div>

        {/* Metric 2: Spin Rate (MOVEMENT-INFERRED) */}
        <div id="metric-card-spin-rate" className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 transition-all hover:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span className="flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-cyan-400" />
              2. 位移反推轉速 (Spin Rate)
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9.5px] font-mono uppercase bg-purple-950/80 text-purple-300 border border-purple-500/40 px-1.5 py-0.5 rounded font-bold">
                {activeResult.source_rpm || 'DATABASE ESTIMATED / MOVEMENT-INFERRED'}
              </span>
            </div>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl font-black text-white tracking-tight font-mono">
              {spin_rate_rpm.toLocaleString()}
            </span>
            <span className="text-base font-medium text-slate-400">RPM</span>
            {activeResult.uncertainty && (
              <span className="text-xs font-mono text-purple-300 bg-purple-950/50 px-2 py-0.5 rounded border border-purple-500/30">
                {activeResult.uncertainty.spin_rate_range}（模型敏感度／先驗，非實測信賴區間）
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 font-medium mt-1 flex flex-wrap items-center gap-2">
            <span>候選加權初值: <strong className="text-cyan-300 font-mono">{activeResult.db_baseline_spin} RPM</strong></span>
            <span className="text-slate-600">|</span>
            <span>出手角修正: <strong className="text-amber-300 font-mono">{activeResult.ai_correction_spin && activeResult.ai_correction_spin >= 0 ? `+${activeResult.ai_correction_spin}` : activeResult.ai_correction_spin || 0} RPM</strong></span>
            <span className="text-slate-600">|</span>
            <span>Bauer Units: <strong className="text-white font-mono">{bauerUnits}</strong></span>
          </div>
          {activeResult.spin_rate_calibration_reason && (
            <div className="text-[10.5px] text-cyan-400/90 bg-cyan-950/40 px-2 py-1 rounded mt-1.5 border border-cyan-500/20">
              ⚡ {activeResult.spin_rate_calibration_reason}
            </div>
          )}
        </div>

        {/* Metric 3: Spin Axis (MOVEMENT-INFERRED Circular Interpolation) */}
        <div id="metric-card-spin-axis" className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 transition-all hover:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span className="flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-amber-400" />
              3. 位移反推轉軸 (Spin Axis)
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9.5px] font-mono uppercase bg-amber-950/80 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-bold">
                {activeResult.source_spin_axis || 'DATABASE ESTIMATED / MOVEMENT-INFERRED'}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-3xl font-black text-amber-400 tracking-tight font-mono">
                  {spin_axis}
                </span>
                {activeResult.uncertainty && (
                  <span className="text-xs font-mono text-amber-300 bg-amber-950/50 px-2 py-0.5 rounded border border-amber-500/30">
                    {activeResult.uncertainty.spin_axis_range}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                幾何圓周角度 <span className="font-mono text-amber-300">{((spin_axis_decimal % 12) * 30).toFixed(0)}°</span> (候選圓周平均: {activeResult.db_baseline_axis || spin_axis})
              </div>
            </div>

            {/* Visual Spin Clock */}
            <div className="relative w-14 h-14 rounded-full border-2 border-amber-500/40 flex items-center justify-center bg-slate-950 shadow-inner">
              <div className="absolute top-0.5 text-[8px] font-bold text-slate-500">12</div>
              <div className="absolute right-1 text-[8px] font-bold text-slate-500">3</div>
              <div className="absolute bottom-0.5 text-[8px] font-bold text-slate-500">6</div>
              <div className="absolute left-1 text-[8px] font-bold text-slate-500">9</div>
              <div
                className="absolute w-0.5 h-5 bg-amber-400 rounded-full origin-bottom shadow-sm"
                style={{
                  transform: `translateY(-50%) rotate(${clockDeg}deg)`,
                  bottom: '50%'
                }}
              />
              <div className="w-2 h-2 rounded-full bg-amber-300 z-10 ring-2 ring-slate-900"></div>
            </div>
          </div>
          {activeResult.spin_axis_calibration_reason && (
            <div className="text-[10.5px] text-amber-400/90 bg-amber-950/40 px-2 py-1 rounded mt-2 border border-amber-500/20">
              🧭 {activeResult.spin_axis_calibration_reason}
            </div>
          )}
        </div>

        {/* Metric 4: Spin Efficiency */}
        <div id="metric-card-spin-efficiency" className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 transition-all hover:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-emerald-400" />
              4. 轉速效率 (Spin Efficiency)
            </span>
            <span className="text-[9.5px] font-mono uppercase bg-purple-950/80 text-purple-300 border border-purple-500/40 px-1.5 py-0.5 rounded font-bold">
              {activeResult.source_spin_efficiency || 'DATABASE ESTIMATED'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-400 tracking-tight font-mono">
              {spin_efficiency_pct.toFixed(1)}
            </span>
            <span className="text-base font-medium text-slate-400">%</span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, spin_efficiency_pct))}%` }}
            />
          </div>
        </div>

        {/* Metric 5: Break (Observed / Calibrated Physical Movement) */}
        <div id="metric-card-break" className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 transition-all hover:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-purple-400" />
              5. 觀測垂直 / 水平位移 (IVB / HB)
            </span>
            <span className="text-[9.5px] font-mono uppercase bg-indigo-950/80 text-indigo-300 border border-indigo-500/40 px-1.5 py-0.5 rounded font-bold">
              {activeResult.source_ivb || 'VIDEO DERIVED / CALIBRATED ESTIMATE'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
              <div className="text-[11px] text-slate-400 font-medium">IVB 垂直揚力位移</div>
              <div className="text-xl font-black text-purple-300 font-mono">
                {ivbSign}{ivb_inch}" <span className="text-xs font-normal text-slate-400">({activeResult.vertical_break_cm} cm)</span>
              </div>
              <div className="text-[10px] text-slate-500">
                扣除重力下墜偏量 {activeResult.uncertainty ? `(±${activeResult.uncertainty.ivb_plus_minus_inch}")` : ''}
              </div>
            </div>
            <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
              <div className="text-[11px] text-slate-400 font-medium">HB 水平橫移位移</div>
              <div className="text-xl font-black text-indigo-300 font-mono">
                {hbSign}{hb_inch}" <span className="text-xs font-normal text-slate-400">({activeResult.horizontal_break_cm} cm)</span>
              </div>
              <div className="text-[10px] text-slate-500">
                側向尾勁位移量 {activeResult.uncertainty ? `(±${activeResult.uncertainty.hb_plus_minus_inch}")` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="science-detail">
      {/* 前向閉環驗證 (Forward Validation: VIDEO TRACK vs MODEL TRACK) */}
      {activeResult.trajectory_fit && (
        <div id="forward-validation-card" className="bg-slate-900/90 border border-indigo-500/40 rounded-xl p-3.5 text-xs space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span className="flex items-center gap-1.5 text-indigo-300">
              <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
              <span>前向物理閉環驗證 (VIDEO TRACK vs MODEL TRACK Fit)</span>
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
              activeResult.trajectory_fit.fit_quality === 'High Fit'
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                : activeResult.trajectory_fit.fit_quality === 'Moderate Fit'
                ? 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300'
                : 'bg-amber-950/80 border-amber-500/50 text-amber-300'
            }`}>
              {activeResult.trajectory_fit.fit_quality} ({activeResult.trajectory_fit.fit_score}%)
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">軌跡均方根誤差 (RMSE)</div>
              <div className="text-indigo-300 font-bold font-mono text-sm">
                {activeResult.trajectory_fit.fit_quality === 'NOT_VALIDATED' ? '未驗證' : `${activeResult.trajectory_fit.rmse_px} px`}
              </div>
            </div>
            <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">最大單幀偏差</div>
              <div className="text-amber-300 font-bold font-mono text-sm">
                {activeResult.trajectory_fit.fit_quality === 'NOT_VALIDATED' ? '未驗證' : `${activeResult.trajectory_fit.max_deviation_px} px`}
              </div>
            </div>
            <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">對齊驗證幀數</div>
              <div className="text-emerald-300 font-bold font-mono text-sm">
                {activeResult.trajectory_fit.compared_frames_count} 幀
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-950/50 p-2 rounded border border-slate-800/80">
            🔄 {activeResult.trajectory_fit.summary}
          </div>
        </div>
      )}

      </div>

      <div className="science-detail">
      {/* Analysis Basis (分析依據與來源透明總表) */}
      {activeResult.analysis_basis && (
        <div id="analysis-basis-card" className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 text-xs space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-200">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              Analysis Basis (各指標計算依據與資料來源)
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              觀測 vs 反推 嚴格區隔
            </span>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-300 font-semibold">• Velocity (球速): <code className="text-emerald-300 font-mono">{activeResult.analysis_basis.velocity.source}</code></span>
              <span className="text-slate-400 text-[10.5px]">{activeResult.analysis_basis.velocity.description}</span>
            </div>
            <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-300 font-semibold">• Movement (IVB/HB): <code className="text-indigo-300 font-mono">{activeResult.analysis_basis.movement.source}</code></span>
              <span className="text-slate-400 text-[10.5px]">{activeResult.analysis_basis.movement.description}</span>
            </div>
            <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-300 font-semibold">• Spin Rate (轉速): <code className="text-purple-300 font-mono">{activeResult.analysis_basis.spin_rate.source}</code></span>
              <span className="text-slate-400 text-[10.5px]">{activeResult.analysis_basis.spin_rate.description}</span>
            </div>
            <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-300 font-semibold">• Spin Axis (轉軸): <code className="text-amber-300 font-mono">{activeResult.analysis_basis.spin_axis.source}</code></span>
              <span className="text-slate-400 text-[10.5px]">{activeResult.analysis_basis.spin_axis.description}</span>
            </div>
            <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-300 font-semibold">• Release Angle (出手角): <code className="text-cyan-300 font-mono">{activeResult.analysis_basis.release_angle.source}</code></span>
              <span className="text-slate-400 text-[10.5px]">{activeResult.analysis_basis.release_angle.description}</span>
            </div>
          </div>
        </div>
      )}

      </div>

      {/* VIDEO TRACK (實測手機影像軌跡) 指標區塊 */}
      {activeResult.video_metrics && (
        <div id="video-track-metrics-card" className="bg-slate-900/90 border border-cyan-500/40 rounded-xl p-3.5 text-xs space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span className="flex items-center gap-1.5 text-cyan-300">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              <span>VIDEO TRACK (影片真實觀測軌跡) 指標</span>
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
              activeResult.video_track_status === 'VALID_TRACK'
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                : 'bg-amber-950/80 border-amber-500/50 text-amber-300'
            }`}>
              {activeResult.video_track_status === 'VALID_TRACK' ? 'VALID TRACK' : 'INSUFFICIENT EVIDENCE'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">有效觀測點</div>
              <div className="text-cyan-300 font-bold font-mono text-sm">
                {activeResult.video_metrics.vision_detected_frames_count} 幀
              </div>
              <div className="text-[10px] text-slate-500">
                覆蓋率 {activeResult.video_metrics.tracking_ratio_pct}%
              </div>
            </div>

            <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">短缺插值補點</div>
              <div className="text-amber-300 font-bold font-mono text-sm">
                {activeResult.video_metrics.interpolated_frames_count} 幀
              </div>
              <div className="text-[10px] text-slate-500">
                僅補短缺口，拒絕直連
              </div>
            </div>

            <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">畫面總位移</div>
              <div className="text-white font-bold font-mono text-sm">
                {activeResult.video_metrics.total_movement_2d_px} px
              </div>
              <div className="text-[10px] text-slate-500">
                ΔX: {activeResult.video_metrics.horizontal_movement_2d_px}px / ΔY: {activeResult.video_metrics.vertical_movement_2d_px}px
              </div>
            </div>

            <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">雙向協商一致性</div>
              <div className="text-emerald-300 font-bold font-mono text-sm">
                {activeResult.video_metrics.forward_backward_agreement_pct !== undefined ? `${activeResult.video_metrics.forward_backward_agreement_pct}%` : '未獨立量測'}
              </div>
              <div className="text-[10px] text-slate-500">
                雙向追蹤重合度
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unified Confidence Scores Engine Panel (客觀品質分數，非統計機率) */}
      {activeResult.confidence_scores && (
        <div id="confidence-engine-panel" className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 text-xs space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span className="flex items-center gap-1.5 text-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>多維度信賴與不確定度評估 (Confidence & Uncertainty)</span>
            </span>
            <span className="text-[10px] font-mono text-cyan-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              綜合信賴：{activeResult.confidence_scores.overall_confidence}% (系統品質，非機率)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2 text-center">
              <div className="text-[10px] text-slate-400">球速信賴度</div>
              <div className="text-sm font-bold text-emerald-400 font-mono">
                {activeResult.confidence_scores.velocity_confidence ?? activeResult.confidence_scores.video_quality_confidence}%
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2 text-center">
              <div className="text-[10px] text-slate-400">位移量測信賴度</div>
              <div className="text-sm font-bold text-indigo-400 font-mono">
                {activeResult.confidence_scores.movement_confidence ?? activeResult.confidence_scores.baseball_tracking_confidence}%
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2 text-center">
              <div className="text-[10px] text-slate-400">RPM/Axis 反推信賴</div>
              <div className="text-sm font-bold text-purple-400 font-mono">
                {activeResult.confidence_scores.spin_confidence ?? activeResult.confidence_scores.database_match_confidence}%
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2 text-center">
              <div className="text-[10px] text-slate-400">閉環軌跡擬合度</div>
              <div className="text-sm font-bold text-cyan-400 font-mono">
                {activeResult.confidence_scores.trajectory_fit_confidence ?? 80}%
              </div>
            </div>
          </div>

          {activeResult.confidence_scores.quality_notes && activeResult.confidence_scores.quality_notes.length > 0 && (
            <div className="text-[10.5px] text-slate-400 bg-slate-950/40 p-2 rounded border border-slate-800/80 leading-relaxed space-y-1">
              {activeResult.confidence_scores.quality_notes.map((note, idx) => (
                <div key={idx}>💡 {note}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="science-detail">
      {/* Top N Database Match Candidates (with Interpolation Weights & Physics Consistency) */}
      {activeResult.top_candidates && activeResult.top_candidates.length > 0 && (
        <div id="top-candidates-panel" className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <GitFork className="w-3.5 h-3.5 text-blue-400" />
              同球種位移反查 Top {activeResult.top_candidates.length} 加權候選球路
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              依 Velocity + IVB + HB 綜合距離加權內插
            </span>
          </div>

          <div className="space-y-1.5">
            {activeResult.top_candidates.map((cand) => (
              <div
                key={cand.record_id}
                className={`p-2 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-all ${
                  cand.rank === 1
                    ? 'bg-blue-950/40 border-blue-500/40 text-blue-200'
                    : 'bg-slate-950/50 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    cand.rank === 1 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {cand.rank}
                  </span>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs">{cand.pitch_type}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {cand.velocity_kmh} km/h • {cand.spin_rate_rpm} RPM • {cand.spin_axis}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      IVB: <span className="text-slate-200">{cand.ivb_inch}"</span> | HB: <span className="text-slate-200">{cand.hb_inch}"</span>
                      {cand.total_error !== undefined && (
                        <span> | 總誤差: <span className="text-amber-300">{cand.total_error}</span></span>
                      )}
                      {cand.physics_consistency_score !== undefined && (
                        <span> | 物理一致: <span className="text-emerald-300">{cand.physics_consistency_score}%</span></span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-right shrink-0">
                  {cand.interpolation_weight !== undefined && (
                    <span className="text-[10px] font-mono bg-purple-950/80 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">
                      權重 {(cand.interpolation_weight * 100).toFixed(1)}%
                    </span>
                  )}
                  <div className="font-mono font-bold text-xs text-cyan-400">
                    {cand.similarity_score}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

      <div className="science-detail">
      {/* Answer Why: 運動科學球路物理分析解讀 */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs text-slate-300">
        <div className="font-semibold text-white flex items-center gap-1.5 text-xs">
          <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
          運動科學證據摘要 (Evidence & Inference Explanation)
        </div>
        {activeResult.evidence_summary?.whyExplanation ? (
          <ul className="space-y-1.5 text-slate-400 text-[11.5px] leading-relaxed">
            {activeResult.evidence_summary.whyExplanation.map((line, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1.5 text-slate-400 text-[11.5px] leading-relaxed">
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span><strong>垂直位移 (IVB)</strong>：{ivbSign}{ivb_inch} 吋 (VIDEO DERIVED / CALIBRATED ESTIMATE)。</span>
            </li>
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span><strong>水平位移 (HB)</strong>：{hbSign}{hb_inch} 吋 (VIDEO DERIVED / CALIBRATED ESTIMATE)。</span>
            </li>
          </ul>
        )}
      </div>
      </div>

    </div>
  );
};
