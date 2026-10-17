import React from 'react';
import {Sparkles,Loader2,AlertTriangle,CheckCircle,RotateCcw} from 'lucide-react';
import type {AutoFrameDetectionOutput} from '../services/autoFrameDetectionEngine';

export function AutoDetectPanel({canRun,busy,running,progress,stageText,result,canAdopt,onRun,onStop,onAdopt,onSeek}:{
  canRun:boolean;busy:boolean;running:boolean;progress:number;stageText:string;result:AutoFrameDetectionOutput|null;canAdopt:boolean;
  onRun:()=>void;onStop:()=>void;onAdopt:()=>void;onSeek:(frame:number)=>void;
}){
  return <details className="card" open={running||Boolean(result)}>
    <summary className="card-title">AI 自動搜尋出手／進手套（選用）</summary>
    <div className="mt-3 space-y-2 text-sm">
      <p className="text-xs text-slate-400">逐格讀取影像搜尋棒球候選；結果需人工確認，不會自動覆蓋你的標記。</p>
      <div className="grid grid-cols-1 gap-2">
        <button id="btn-ai-auto-detect-frames" type="button" disabled={busy||!canRun} onClick={onRun} className="btn-secondary">
          {running?<><Loader2 className="w-4 h-4 animate-spin"/>{stageText||'AI 視覺掃描中...'} ({progress}%)</>:<><Sparkles className="w-4 h-4"/>開始自動搜尋</>}
        </button>
        {running&&<button id="stop-auto-detection" type="button" onClick={onStop} className="btn-secondary">停止自動辨識，使用手動模式</button>}
        {canAdopt&&!running&&<button type="button" onClick={onAdopt} className="btn-secondary"><RotateCcw className="w-4 h-4"/>採用／恢復候選影格（需人工確認）</button>}
      </div>
      {!canRun&&<p className="text-xs text-amber-200">需要已確認的影片時間資訊才能自動搜尋。</p>}
      {running&&<div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden"><div className="bg-cyan-400 h-full rounded-full transition-all duration-200" style={{width:`${progress}%`}}/></div>}
      {result&&!running&&<div className={`p-3 rounded-xl border text-xs space-y-1.5 ${result.status==='AUTO_DETECTION_FAILED'?'bg-rose-950/40 border-rose-500/50 text-rose-200':result.status==='LOW_CONFIDENCE'?'bg-amber-950/40 border-amber-500/50 text-amber-200':'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'}`}>
        <p className="font-bold flex items-center gap-1.5">
          {result.status==='AUTO_DETECTION_FAILED'?<><AlertTriangle className="w-4 h-4"/>自動辨識失敗，請手動確認影格</>:result.status==='LOW_CONFIDENCE'?<><AlertTriangle className="w-4 h-4"/>完成（低信心，建議手動微調）</>:<><CheckCircle className="w-4 h-4"/>自動搜尋完成</>}
        </p>
        <p className="font-mono">信心 {result.confidence}%</p>
        {result.status!=='AUTO_DETECTION_FAILED'&&<p className="font-mono break-words">候選起點 F{result.releaseFrame}（Evidence {result.releaseEvidence.evidenceScore}）· 候選終點 F{result.gloveFrame}（Evidence {result.gloveEvidence.evidenceScore}）· 連續候選 {result.ballTrack.length} 點（非已確認離手／進手套）</p>}
        {result.warnings.map((w,i)=><p key={i}>• {w}</p>)}
        {result.candidateFrames.length>0&&<label className="block">查看候選影格（不覆蓋設定）<select aria-label="查看候選影格" className="field mt-1" defaultValue="" onChange={e=>onSeek(Number(e.target.value))}><option value="" disabled>選擇影格</option>{Array.from(new Set(result.candidateFrames)).map(f=><option key={f} value={f}>F{f}</option>)}</select></label>}
      </div>}
    </div>
  </details>;
}
