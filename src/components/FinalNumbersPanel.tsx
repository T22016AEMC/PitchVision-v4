import React from 'react';
import type {FinalNumbers,FinalItem,FinalOrigin} from '../services/finalNumbers';

// The result page's first block (5.0.3.1): the six final numbers, each with its uncertainty range, origin and the 「推估」 mark.
// Presentation only: values come from services/finalNumbers.ts. Spin rate, axis and efficiency are database priors and are shown as
// ranges (main text), never as a precise-looking single value.
const originClass:Record<FinalOrigin,string>={'影像量測':'tag-video','物理模型推算':'tag-model','資料庫先驗':'tag-db'};
const ORDER:FinalItem['key'][]=['releaseSpeed','spinRate','spinAxis','ivb','hb','efficiency'];

function Card({item}:{item:FinalItem}){
  return <div id={`final-${item.key}`} className="metric-card" data-estimated="1" data-value={item.value} data-lo={item.lo} data-hi={item.hi}>
    <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-300 font-semibold">{item.label}</span><span className="text-[10px] text-amber-300">推估</span></div>
    <p className="mt-1 text-2xl font-black font-mono text-white break-words leading-tight"><span data-role="value">{item.display}</span>{item.unit&&<span className="ml-1 text-sm font-semibold text-slate-400">{item.unit}</span>}</p>
    <p className="text-[11px] text-cyan-200" data-role="range">範圍 {item.range}</p>
    <p className="mt-1 flex flex-wrap gap-1">{item.origin.map(o=><span key={o} className={`tag ${originClass[o]}`}>{o}</span>)}</p>
  </div>;
}

export function FinalNumbersPanel({final}:{final:FinalNumbers}){
  const items=ORDER.map(k=>final.items.find(i=>i.key===k)).filter((i):i is FinalItem=>Boolean(i));
  return <section id="final-numbers" aria-labelledby="h-final" data-status={final.status} data-mode={final.pitchTypeMode} className="space-y-2">
    <h3 id="h-final" className="card-title">投球數據</h3>
    {final.status!=='ok'&&<p id="final-lowconf" role="status" className="text-xs text-amber-200">{final.status==='fallback'?'球路資料不足：位移與旋轉只依資料庫，範圍較寬。':final.debug.conflicts.length?'影像量測與資料庫候選不一致，範圍已放寬，請當作參考。':'校正信心偏低，請當作參考。'}</p>}
    <div className="grid grid-cols-2 gap-2">{items.map(i=><Card key={i.key} item={i}/>)}</div>
    {final.pitchTypeMode==='given'
      ?<p id="pitch-type-given" className="text-xs text-slate-300">球種：{final.pitchType}（你選的；轉速、轉軸與位移只用這個球種的資料庫候選）</p>
      :final.pitchTypes&&<div id="pitch-type-top3" className="card space-y-1.5">
        <h4 className="text-xs font-semibold text-slate-300">AI 自動辨識球種（前三名）</h4>
        <ol className="space-y-1">{final.pitchTypes.top3.map((t,i)=><li key={t.pitchType} className="flex items-center gap-2 text-sm" data-rank={i+1}>
          <span className="w-4 text-slate-400 font-mono">{i+1}</span><span className="flex-1">{t.pitchType}</span><span className="font-mono text-cyan-200">{Math.round(t.probability*100)}%</span></li>)}</ol>
        {final.pitchTypes.hard&&<p id="pitch-type-hard" className="text-[11px] text-amber-200">難以區分：{final.pitchTypes.hardReason}</p>}
        <p className="text-[10px] text-slate-500">依出手速度與位移的範圍對照資料庫候選；可能性是相對值。</p>
      </div>}
    <p className="text-[10px] text-slate-500">推估＝單鏡頭影片加上物理模型與資料庫推算，不是儀器讀數；範圍為 90% 區間。</p>
  </section>;
}

/** Debug-only view of how the six numbers were formed (measured vs prior vs merged, conflicts). */
export function FinalDebug({final}:{final:FinalNumbers}){
  const d=final.debug,r=(x?:{value:number;lo:number;hi:number},n=1)=>x?`${x.value.toFixed(n)}（${x.lo.toFixed(n)}–${x.hi.toFixed(n)}）`:'—';
  return <div id="final-debug" className="card text-[11px] space-y-1 font-mono">
    <p className="font-sans font-bold text-xs">六項數據的組成</p>
    <p>影像量測：出手 {r(d.measured.releaseKmh)} km/h · 平均 {r(d.measured.avgKmh)} km/h · IVB {r(d.measured.ivbInch)} · HB {r(d.measured.hbInch)}</p>
    <p>資料庫先驗：{d.prior.candidates} 個候選，速度窗口 {d.prior.speedWindowKmh[0].toFixed(0)}–{d.prior.speedWindowKmh[1].toFixed(0)} km/h{d.prior.windowWidened?'（已放寬）':''} · IVB {r(d.prior.ivbInch)} · HB {r(d.prior.hbInch)} · 轉速 {r(d.prior.rpm,0)} · 效率 {r(d.prior.efficiencyPct,0)}</p>
    <p>候選飛行條件：距離 {d.prior.flownAt.distanceM.toFixed(2)} m、飛行 {d.prior.flownAt.flightSec.toFixed(3)} s、出手高度 {d.prior.flownAt.releaseHeightM.toFixed(2)} m</p>
    <p>合併後：IVB {r(d.merged.ivbInch)} · HB {r(d.merged.hbInch)} · 有效樣本比 {d.essRatio===null?'—':d.essRatio.toFixed(3)}</p>
    {d.conflicts.map(c=><p key={c.item} className="text-amber-200">矛盾（{c.item==='ivb'?'IVB':'HB'}，{c.kind==='disjoint'?`範圍不重疊，相距 ${c.gapInch.toFixed(1)} 吋`:c.kind==='centres_apart'?`範圍只有邊緣重疊 ${c.overlapInch.toFixed(1)} 吋，中位數差 ${c.medianDifferenceInch.toFixed(1)} 吋，彼此都不在對方範圍內`:'有效樣本比過低'}）：量測 {r(c.measured)} vs 資料庫 {r(c.prior)}；待查：{c.suspects.join('；')}</p>)}
    {d.notes.map(n=><p key={n}>{n}</p>)}
    <p>主要候選{d.mirror?'（含左右鏡像）':''}：{d.topCandidates.map(c=>`#${c.id}${c.mirrored?'鏡像':''} ${c.rpm}rpm ${c.axis} ${c.efficiencyPct}% IVB${c.ivbInch} HB${c.hbInch} (${(c.weight*100).toFixed(0)}%)`).join('；')}</p>
  </div>;
}
