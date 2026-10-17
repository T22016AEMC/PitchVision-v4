import React from 'react';

export type Step='video'|'mark'|'analyze'|'result';
const STEPS:{id:Step;label:string}[]=[{id:'video',label:'影片'},{id:'mark',label:'標記'},{id:'analyze',label:'分析'},{id:'result',label:'結果'}];

export function StepNav({step,reachable,busy,onSelect}:{step:Step;reachable:Record<Step,boolean>;busy:boolean;onSelect:(step:Step)=>void}){
  return <ol id="step-nav" aria-label="分析步驟" className="mx-auto max-w-[480px] px-2 pb-2 grid grid-cols-4 gap-1">
    {STEPS.map((s,i)=>{const current=s.id===step;return <li key={s.id}>
      <button type="button" id={`step-${s.id}`} aria-current={current?'step':undefined} disabled={!reachable[s.id]||busy} onClick={()=>onSelect(s.id)}
        className={`step-tab ${current?'step-current':reachable[s.id]?'step-open':''}`}>
        <span className="step-num">{i+1}</span><span>{s.label}</span>
      </button>
    </li>;})}
  </ol>;
}
