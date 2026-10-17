import React from 'react';
import {MatchResult} from '../types';

// Presentation only: every number below comes from the engine's MatchResult.
// Provenance tags are the engine's own source_* labels, grouped for display.
type Origin='影像量測'|'物理模型推算'|'資料庫先驗';
function origins(tag?:string):Origin[]{
  if(!tag)return ['資料庫先驗'];
  const out=new Set<Origin>();
  for(const part of tag.split('/').map(s=>s.trim().toUpperCase())){
    // VIDEO DERIVED = measured event times combined with a modelled distance or scale.
    if(part==='VIDEO MEASURED')out.add('影像量測');
    else if(part.startsWith('VIDEO')){out.add('影像量測');out.add('物理模型推算');}
    else if(part.startsWith('DATABASE')||part.startsWith('LEGACY'))out.add('資料庫先驗');
    else out.add('物理模型推算');
  }
  return [...out];
}
const originClass:Record<Origin,string>={'影像量測':'tag-video','物理模型推算':'tag-model','資料庫先驗':'tag-db'};

function Card({id,label,value,unit,range,tag,note}:{id:string;label:string;value:React.ReactNode;unit?:string;range?:string;tag?:string;note?:string}){
  return <div id={id} className="metric-card">
    <div className="flex items-start justify-between gap-2"><span className="text-xs text-slate-400">{label}</span>
      <span className="flex flex-wrap gap-1 justify-end">{origins(tag).map(o=><span key={o} className={`tag ${originClass[o]}`}>{o}</span>)}</span></div>
    <p className="mt-1 text-2xl font-black font-mono text-white break-words">{value}{unit&&<span className="ml-1 text-sm font-semibold text-slate-400">{unit}</span>}</p>
    {range&&<p className="text-xs text-cyan-200">不確定範圍 {range}</p>}
    {note&&<p className="text-[11px] text-slate-400 mt-1">{note}</p>}
    {tag&&<p className="text-[10px] font-mono text-slate-500 mt-1 break-words">{tag}</p>}
  </div>;
}

export function ResultCards({result,averageVelocityKmh,flightSeconds,distanceM}:{result:MatchResult;averageVelocityKmh:number;flightSeconds:number;distanceM:number}){
  const u=result.uncertainty;
  const spinRange=u&&Number.isFinite(u.spin_rate_min)&&Number.isFinite(u.spin_rate_max)?`${Math.round(u.spin_rate_min)}–${Math.round(u.spin_rate_max)}`:null;
  const sign=(n:number)=>`${n>=0?'+':''}${n.toFixed(1)}`;
  const reliable=Boolean(result.projection_match?.used&&result.video_track_status==='VALID_TRACK');
  return <div id="result-cards" className="space-y-3">
    <div className={`card text-sm ${reliable?'border-cyan-500/40 text-cyan-100':'border-amber-500/40 text-amber-100'}`}>
      <p className="font-bold">最相似候選：{result.matched_pitch_type}</p>
      <p className="text-xs mt-1">{reliable?'可靠影像觀測已參與匹配；結果為條件式模型，不是唯一真實重建。':'未取得可靠影像觀測：以下旋轉與位移為資料庫候選，不能當成本次實測球路。'}</p>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Card id="card-velocity" label="平均球速" value={averageVelocityKmh} unit="km/h" range={u?.velocity_range} tag={result.source_velocity} note={`${distanceM} m ÷ ${flightSeconds.toFixed(4)} s`}/>
      <Card id="card-spin" label="轉速（範圍）" value={spinRange??result.spin_rate_rpm} unit="rpm" tag={result.source_rpm} note={`候選值 ${result.spin_rate_rpm} rpm；單鏡頭不能唯一決定`}/>
      <Card id="card-axis" label="轉軸" value={result.spin_axis} range={u?.spin_axis_range} tag={result.source_spin_axis}/>
      <Card id="card-efficiency" label="轉動效率" value={result.spin_efficiency_pct} unit="%" tag={result.source_spin_efficiency} note="資料庫候選；陀螺旋轉無法由球路觀測"/>
      <Card id="card-ivb" label="垂直位移 IVB" value={sign(result.ivb_inch)} unit="吋" range={u?.ivb_range} tag={result.source_ivb}/>
      <Card id="card-hb" label="水平位移 HB" value={sign(result.hb_inch)} unit="吋" range={u?.hb_range} tag={result.source_hb}/>
    </div>
    {u?.uncertainty_basis&&<p className="text-[11px] text-slate-400">不確定度依據：{u.uncertainty_basis}</p>}
  </div>;
}
