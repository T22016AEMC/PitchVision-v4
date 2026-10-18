import React from 'react';
import {Ruler,Footprints,Mountain} from 'lucide-react';
import {PitcherBiometrics} from '../types';

interface PitcherSetupCardProps {
  biometrics:PitcherBiometrics;
  onChange:(updated:PitcherBiometrics)=>void;
  recomputeBiometrics:(hasMound:boolean,pitcherHeightCm:number,strideOption:'ai_auto'|'manual',manualStrideDistanceCm?:number)=>PitcherBiometrics;
}

function Stepper({id,label,deltas,onStep}:{id:string;label:string;deltas:number[];onStep:(d:number)=>void}){
  return <div id={id} className="grid grid-cols-4 gap-1.5">{deltas.map(d=><button key={d} type="button" aria-label={`${label} ${d>0?'+':''}${d} cm`} onClick={()=>onStep(d)} className="btn-step">{d>0?'+':''}{d}</button>)}</div>;
}

export const PitcherSetupCard:React.FC<PitcherSetupCardProps>=({biometrics,onChange,recomputeBiometrics})=>{
  const handleMoundToggle=(hasMound:boolean)=>onChange(recomputeBiometrics(hasMound,biometrics.pitcherHeightCm,biometrics.strideOption,biometrics.manualStrideDistanceCm));
  const handleHeightChange=(height:number)=>{if(!Number.isFinite(height))return;const clamped=Math.max(130,Math.min(215,height));onChange(recomputeBiometrics(biometrics.hasMound,clamped,biometrics.strideOption,biometrics.manualStrideDistanceCm));};
  const handleStrideModeChange=(mode:'ai_auto'|'manual')=>onChange(recomputeBiometrics(biometrics.hasMound,biometrics.pitcherHeightCm,mode,biometrics.manualStrideDistanceCm));
  const handleManualStrideChange=(strideCm:number)=>{if(!Number.isFinite(strideCm))return;const clamped=Math.max(80,Math.min(210,strideCm));onChange(recomputeBiometrics(biometrics.hasMound,biometrics.pitcherHeightCm,'manual',clamped));};

  return <div id="initial-pitcher-setup" className="card space-y-4">
    <div>
      <h3 className="card-title">投手與距離</h3>
      <p className="text-xs text-slate-400">身高與跨步推導出手延伸量，再推導出手到進手套的距離。</p>
    </div>

    <div className="space-y-2">
      <p className="text-sm font-semibold flex items-center gap-1.5 text-blue-200"><Ruler className="w-4 h-4"/>投手身高</p>
      <div className="flex items-center gap-2">
        <input id="input-pitcher-height" aria-label="投手身高滑桿" type="range" min="145" max="205" step="1" value={biometrics.pitcherHeightCm} onChange={e=>handleHeightChange(Number(e.target.value))} className="flex-1 accent-blue-500"/>
        <label className="flex items-center gap-1 text-sm"><input type="number" id="height-number" aria-label="投手身高 (cm)" inputMode="numeric" min="130" max="215" value={biometrics.pitcherHeightCm} onChange={e=>handleHeightChange(Number(e.target.value))} className="field w-20 text-center font-mono"/>cm</label>
      </div>
      <Stepper id="height-step-controls" label="身高" deltas={[-5,-1,1,5]} onStep={d=>handleHeightChange(biometrics.pitcherHeightCm+d)}/>
    </div>

    <div className="space-y-2">
      <p className="text-sm font-semibold flex items-center gap-1.5 text-emerald-200"><Footprints className="w-4 h-4"/>跨步距離</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" id="btn-stride-ai" aria-pressed={biometrics.strideOption==='ai_auto'} onClick={()=>handleStrideModeChange('ai_auto')} className={`choice ${biometrics.strideOption==='ai_auto'?'choice-active':''}`}>依身高估算</button>
        <button type="button" id="btn-stride-manual" aria-pressed={biometrics.strideOption==='manual'} onClick={()=>handleStrideModeChange('manual')} className={`choice ${biometrics.strideOption==='manual'?'choice-active':''}`}>手動輸入</button>
      </div>
      {biometrics.strideOption==='ai_auto'
        ?<p className="text-xs text-emerald-200">估算 {biometrics.effectiveStrideDistanceCm} cm（身高 {biometrics.strideRatioPct}%）</p>
        :<div className="space-y-2">
          <div className="flex items-center gap-2">
            <input id="input-manual-stride" aria-label="跨步距離滑桿" type="range" min="100" max="195" step="1" value={biometrics.effectiveStrideDistanceCm} onChange={e=>handleManualStrideChange(Number(e.target.value))} className="flex-1 accent-emerald-500"/>
            <label className="flex items-center gap-1 text-sm"><input type="number" id="stride-number" aria-label="跨步距離 (cm)" inputMode="numeric" min="80" max="210" value={biometrics.effectiveStrideDistanceCm} onChange={e=>handleManualStrideChange(Number(e.target.value))} className="field w-20 text-center font-mono"/>cm</label>
          </div>
          <Stepper id="stride-step-controls" label="跨步" deltas={[-5,-1,1,5]} onStep={d=>handleManualStrideChange(biometrics.effectiveStrideDistanceCm+d)}/>
          <p className="text-xs text-slate-400">佔身高 {biometrics.strideRatioPct}%</p>
        </div>}
    </div>

    <div className="space-y-2">
      <p className="text-sm font-semibold flex items-center gap-1.5 text-amber-200"><Mountain className="w-4 h-4"/>投手丘</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" id="btn-mound-no" aria-pressed={!biometrics.hasMound} onClick={()=>handleMoundToggle(false)} className={`choice ${!biometrics.hasMound?'choice-active':''}`}>平地投球</button>
        <button type="button" id="btn-mound-yes" aria-pressed={biometrics.hasMound} onClick={()=>handleMoundToggle(true)} className={`choice ${biometrics.hasMound?'choice-active':''}`}>標準投手丘 25.4 cm</button>
      </div>
    </div>

    <dl id="derived-distance" className="grid grid-cols-2 gap-2 text-sm">
      <div className="stat"><dt>出手延伸量</dt><dd>{biometrics.calculatedExtensionM} m</dd></div>
      <div className="stat"><dt>出手→進手套距離</dt><dd className="text-cyan-200">{biometrics.effectiveTravelDistanceM} m</dd></div>
    </dl>
    <p className="text-[11px] text-slate-400">距離＝18.44 m − 延伸量 + 0.90 m（V4.7 引擎公式，以標準投手板距離為基準）。身高與距離是程式校正尺度的依據，請盡量填準確。</p>
  </div>;
};
