import React from 'react';
import {PitchEstimates,Origin,EstimateItem} from '../services/pitchEstimates';
import {MatchResult} from '../types';

// Presentation only: the numbers come from the 5.0.3 geometry stage (pitchEstimates). Every card says where its number comes from
// (影像量測／物理模型推算／資料庫先驗), shows its uncertainty range, and marks estimated values with 「推估」.
const originClass:Record<Origin,string>={'影像量測':'tag-video','物理模型推算':'tag-model','資料庫先驗':'tag-db'};

function Card({item,id}:{item:EstimateItem;id:string}){
  return <div id={id} className="metric-card" data-estimated={item.estimated?'1':'0'}>
    <div className="flex items-start justify-between gap-2"><span className="text-xs text-slate-400">{item.label}{item.estimated&&<span className="ml-1 text-amber-300">推估</span>}</span>
      <span className="flex flex-wrap gap-1 justify-end">{item.origin.map(o=><span key={o} className={`tag ${originClass[o]}`}>{o}</span>)}</span></div>
    <p className={`mt-1 font-black font-mono text-white break-words ${item.key==='camera'?'text-sm':'text-2xl'}`}>{item.value}{item.unit&&<span className="ml-1 text-sm font-semibold text-slate-400">{item.unit}</span>}</p>
    {item.range&&<p className="text-xs text-cyan-200">不確定範圍 {item.range}</p>}
    {item.note&&<p className="text-[11px] text-slate-400 mt-1">{item.note}</p>}
  </div>;
}

const KEYS:EstimateItem['key'][]=['speedAvg','speedRelease','distance','release','glove','ivb','hb','angle','height','camera'];

export function GeometryCards({estimates,result,ranges,showTypes=true}:{estimates:PitchEstimates;result:MatchResult;ranges?:boolean;showTypes?:boolean}){
  void ranges;
  const fallback=estimates.status==='fallback';
  const legacyTypes=Array.from(new Set((result.top_candidates??[]).map(c=>c.pitch_type))).slice(0,3);
  const items=KEYS.map(k=>estimates.items.find(i=>i.key===k)).filter((i):i is EstimateItem=>Boolean(i));
  return <div id="geometry-cards" data-status={estimates.status} className="space-y-3">
    {fallback&&<div id="geometry-fallback" role="status" className="card border-amber-500/40 text-amber-100 text-sm space-y-1">
      <p className="font-bold">相機為推測</p>
      <p className="text-xs">{estimates.reasons.length?estimates.reasons.join('；'):'自動校正信心不足'}。數字沿用舊版標準相機推測，距離改用沒有捕手的先驗，並附範圍。</p>
    </div>}
    {estimates.status==='low_confidence'&&<p id="geometry-lowconf" className="card border-amber-500/40 text-amber-100 text-xs">校正信心偏低：{estimates.reasons.join('；')}</p>}
    {estimates.notes.length>0&&<p id="geometry-notes" className="card text-xs text-slate-300">{estimates.notes.join('；')}</p>}
    {showTypes&&<div id="geometry-pitch-types" className="card space-y-2">
      <h3 className="card-title">球種（前三名與相對可能性）</h3>
      {estimates.pitchTypes?<>
        <ol className="space-y-1.5">{estimates.pitchTypes.top3.map((t,i)=><li key={t.pitchType} className="flex items-center gap-2 text-sm" data-rank={i+1}>
          <span className="w-5 text-slate-400 font-mono">{i+1}</span><span className="flex-1 font-semibold">{t.pitchType}</span>
          <span className="font-mono text-cyan-200">{Math.round(t.probability*100)}%</span></li>)}</ol>
        {estimates.pitchTypes.hard&&<p className="text-xs text-amber-200">難以區分：{estimates.pitchTypes.hardReason}。影片裡球速與位移的差異不足以判定，請當作候選。</p>}
        <p className="text-[11px] text-slate-400">依球速範圍與位移範圍，對照資料庫候選（資料庫先驗）；可能性是相對值，不是量測。</p>
      </>:<>
        <ol className="space-y-1">{legacyTypes.map((t,i)=><li key={t} className="text-sm"><span className="text-slate-400 font-mono mr-2">{i+1}</span>{t}</li>)}</ol>
        <p className="text-xs text-amber-200">沒有足夠的影像證據計算相對可能性，只列出資料庫最相似的候選。</p></>}
    </div>}
    <div className="grid grid-cols-2 gap-2">{items.map(i=><Card key={i.key} id={`geo-${i.key}`} item={i}/>)}</div>
    <p className="text-[11px] text-slate-400">單鏡頭影片量不到距離與尺度：距離、出手高度與相機位置以先驗為主；範圍是依這支影片與先驗算出的 90% 區間，不是儀器讀數。轉速、轉軸與轉動效率仍不能由單鏡頭唯一決定。</p>
  </div>;
}
