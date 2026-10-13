import React, { useState } from 'react';
import { PitchRecord } from '../types';
import { X, Search, Download, FileCode, Database, Check } from 'lucide-react';

interface DatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: PitchRecord[];
}

export const DatabaseModal: React.FC<DatabaseModalProps> = ({ isOpen, onClose, database }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('ALL');
  const [selectedView, setSelectedView] = useState<'ALL' | 'catcher' | 'pitcher_rear'>('ALL');
  const [copiedAppPy, setCopiedAppPy] = useState(false);

  if (!isOpen) return null;

  const pitchTypes = Array.from(new Set(database.map((d) => d.pitch_type)));

  const filtered = database.filter((d) => {
    const matchesSearch =
      d.pitch_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.id.toString() === searchTerm;
    const matchesType = selectedType === 'ALL' || d.pitch_type === selectedType;
    const matchesView = selectedView === 'ALL' || d.camera_view === selectedView;
    return matchesSearch && matchesType && matchesView;
  });

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(database, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'amateur_pitch_database_1080.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyAppPyInstructions = () => {
    navigator.clipboard.writeText('streamlit run app.py');
    setCopiedAppPy(true);
    setTimeout(() => setCopiedAppPy(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                PitchVision Synthetic Physics Reference Dataset (Synthetic Physics Prior) - 1,080 筆樣本瀏覽器
                <span className="text-xs font-normal text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded-full border border-cyan-500/30">
                  捕手 540 筆 ｜ 投手 540 筆
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                物理合成參考資料集 (Synthetic Physics Prior)：涵蓋 9 種球種，每球種於捕手視角與投手後方視角各 60 筆，球速 80~140 km/h、轉速 1000~2500 RPM
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={downloadJson}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              下載 JSON (1080 筆)
            </button>
            <button
              onClick={copyAppPyInstructions}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              {copiedAppPy ? <Check className="w-3.5 h-3.5" /> : <FileCode className="w-3.5 h-3.5" />}
              {copiedAppPy ? '已複製指令！' : '複製 streamlit 執行指令'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-3 border-b border-slate-800 bg-slate-900/60 flex flex-wrap gap-2 items-center justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜尋球種、代碼或 ID (如: 滑球, SL, #42)..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <select
              value={selectedView}
              onChange={(e) => setSelectedView(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">全部視角 (1080 筆)</option>
              <option value="catcher">🧤 捕手平視視角 (540 筆)</option>
              <option value="pitcher_rear">⚾ 投手後方視角 (540 筆)</option>
            </select>

            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">全部球種 (9 種)</option>
              {pitchTypes.map((pt) => (
                <option key={pt} value={pt}>
                  {pt}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-slate-400">
            符合條件：<strong className="text-white">{filtered.length}</strong> / 1,080 筆
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto p-2">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-2.5 font-semibold">ID</th>
                <th className="p-2.5 font-semibold">視角</th>
                <th className="p-2.5 font-semibold">球種 (Code)</th>
                <th className="p-2.5 font-semibold">球速 (km/h)</th>
                <th className="p-2.5 font-semibold">出手 / 進手套</th>
                <th className="p-2.5 font-semibold">轉速 (RPM)</th>
                <th className="p-2.5 font-semibold">轉軸時鐘</th>
                <th className="p-2.5 font-semibold">轉速效率 (%)</th>
                <th className="p-2.5 font-semibold">垂直位移 (IVB)</th>
                <th className="p-2.5 font-semibold">水平位移 (HB)</th>
                <th className="p-2.5 font-semibold">飛行時間 (s)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filtered.slice(0, 150).map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="p-2.5 text-slate-500">#{row.id}</td>
                  <td className="p-2.5 font-sans">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${row.camera_view === 'catcher' ? 'bg-amber-950/60 text-amber-300 border-amber-500/30' : 'bg-blue-950/60 text-blue-300 border-blue-500/30'}`}>
                      {row.camera_view === 'catcher' ? '🧤 捕手視角' : '⚾ 投手後方'}
                    </span>
                  </td>
                  <td className="p-2.5 font-sans font-medium text-slate-200">
                    {row.pitch_type}{' '}
                    <span className="text-[10px] text-blue-400 bg-blue-950/80 px-1 py-0.5 rounded">
                      {row.code}
                    </span>
                  </td>
                  <td className="p-2.5 text-white font-bold">{row.velocity_kmh}</td>
                  <td className="p-2.5 text-xs">
                    <span className="text-red-400">F{row.release_frame ?? 102}</span>
                    <span className="text-slate-600 mx-1">→</span>
                    <span className="text-amber-400">F{row.glove_frame ?? (row.release_frame ? row.release_frame + Math.round(row.flight_time_sec * 60) : 145)}</span>
                  </td>
                  <td className="p-2.5 text-cyan-400">{row.spin_rate_rpm.toLocaleString()}</td>
                  <td className="p-2.5 text-amber-400">{row.spin_axis}</td>
                  <td className="p-2.5 text-emerald-400">{row.spin_efficiency_pct}%</td>
                  <td className="p-2.5 text-purple-300">
                    {row.ivb_inch >= 0 ? `+${row.ivb_inch}` : row.ivb_inch}"
                  </td>
                  <td className="p-2.5 text-indigo-300">
                    {row.hb_inch >= 0 ? `+${row.hb_inch}` : row.hb_inch}"
                  </td>
                  <td className="p-2.5 text-slate-400">{row.flight_time_sec}s</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 150 && (
            <div className="p-3 text-center text-xs text-slate-500 border-t border-slate-800">
              為求瀏覽流暢，已載入前 150 筆資料，可使用上方篩選器檢索完整 1,080 筆，或下載 JSON。
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
