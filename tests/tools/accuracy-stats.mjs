// Small shared statistics helpers for the accuracy reports.
export const finite=a=>a.filter(v=>Number.isFinite(v));
export function stats(values){
  const a=finite(values);if(!a.length)return {n:0};
  const abs=a.map(Math.abs),mean=a.reduce((s,v)=>s+v,0)/a.length;
  const sorted=[...abs].sort((x,y)=>x-y),q=p=>sorted[Math.min(sorted.length-1,Math.floor(p*(sorted.length-1)+.5))];
  const r=v=>Math.round(v*1000)/1000;
  return {n:a.length,mean:r(mean),meanAbs:r(abs.reduce((s,v)=>s+v,0)/a.length),rms:r(Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length)),median:r(q(.5)),p90:r(q(.9)),max:r(sorted.at(-1))};
}
export const rate=a=>a.length?Math.round(a.filter(Boolean).length/a.length*1000)/10:null;
/** Group rows by key(row) and summarise a numeric field of each. */
export function groupStats(rows,key,field){
  const g={};for(const r of rows){const k=key(r);(g[k]??=[]).push(field(r));}
  return Object.fromEntries(Object.entries(g).map(([k,v])=>[k,stats(v)]));
}
