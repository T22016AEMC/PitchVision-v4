import React from 'react';
import { VideoQualityAssessment } from '../services/videoMetadataService';
import { AlertTriangle, CheckCircle2, Video, Film, Eye, ShieldAlert } from 'lucide-react';

interface VideoQualityCardProps {
  assessment: VideoQualityAssessment | null;
  videoFileName: string;
  actualFps: number;
}

export const VideoQualityCard: React.FC<VideoQualityCardProps> = ({
  assessment,
  videoFileName,
  actualFps
}) => {
  if (!assessment) return null;

  const isLowFps = actualFps < 30;

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-xs space-y-2.5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Film className="w-3.5 h-3.5 text-cyan-400" />
          <span>影片品質客觀評估 (Video Quality Gate)</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
          assessment.qualityScore >= 75
            ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
            : assessment.qualityScore >= 55
            ? 'bg-amber-950/80 border-amber-500/40 text-amber-300'
            : 'bg-red-950/80 border-red-500/40 text-red-300'
        }`}>
          品質評分: {assessment.qualityScore} 分
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
          <div className="text-[10px] text-slate-400">真實幀率 (actualFPS)</div>
          <div className={`font-mono font-bold text-sm ${isLowFps ? 'text-amber-400' : 'text-cyan-400'}`}>
            {actualFps} FPS
          </div>
          <div className="text-[9.5px] text-slate-500">
            {isLowFps ? '低速手機直拍' : actualFps >= 60 ? '高速流暢' : '標準幀率'}
          </div>
        </div>

        <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
          <div className="text-[10px] text-slate-400">解析度 (Resolution)</div>
          <div className="font-mono font-bold text-sm text-white">
            {assessment.resolution}
          </div>
          <div className="text-[9.5px] text-slate-500">
            {assessment.isResolutionAdequate ? '解析度足夠' : '細節受限'}
          </div>
        </div>

        <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
          <div className="text-[10px] text-slate-400">動態殘影風險</div>
          <div className={`font-bold text-xs uppercase ${
            assessment.motionBlurRisk === 'low'
              ? 'text-emerald-400'
              : assessment.motionBlurRisk === 'moderate'
              ? 'text-blue-400'
              : assessment.motionBlurRisk === 'high'
              ? 'text-amber-400'
              : 'text-red-400'
          }`}>
            {assessment.motionBlurRisk}
          </div>
          <div className="text-[9.5px] text-slate-500">高速位移模糊</div>
        </div>

        <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
          <div className="text-[10px] text-slate-400">預期棒球像素</div>
          <div className="font-mono font-bold text-sm text-purple-300">
            ~{assessment.expectedBallPixelSize} px
          </div>
          <div className="text-[9.5px] text-slate-500">畫面等效半徑</div>
        </div>
      </div>

      {assessment.warnings.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-500/30 rounded-lg p-2 text-[10.5px] text-amber-300/90 space-y-1">
          {assessment.warnings.map((w, idx) => (
            <div key={idx} className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
