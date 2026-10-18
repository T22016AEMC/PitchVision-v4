// Compare two engines' rows (tests/tools/accuracy-rows.mjs) on identical synthetic cases: mean and worst errors, by condition.
//   node tests/tools/accuracy-compare.mjs <before-rows.json> <after-rows.json> [--json out.json]
import {readFile,writeFile} from 'node:fs/promises';
import {stats} from './accuracy-stats.mjs';

export function shown(r){return r.usedFit?r.new:r.old;} // product policy: a fit that is not 'ok' shows the 5.0.2 numbers
export const METRICS={
  releaseErrFrames:r=>shown(r).events?.releaseErrFrames,
  gloveErrFrames:r=>shown(r).events?.gloveErrFrames,
  avgSpeedErrPct:r=>shown(r).speed?.avgErrPct,
  releaseSpeedErrPct:r=>r.usedFit?r.new.speed?.releaseErrPct:(r.final?.releaseSpeedErrPct??null),
  ivbErrInch:r=>shown(r).movement?.ivbErr,
  hbErrInch:r=>shown(r).movement?.hbErr,
  cameraWorldRmsCm:r=>shown(r).camera?.worldRmsCm
};
const pick=(rows,f)=>stats(rows.map(f).filter(Number.isFinite));
export function compare(before,after,metrics=Object.keys(METRICS)){
  const key=r=>r.spec.seed,A=new Map(after.rows.map(r=>[key(r),r]));
  const pairs=before.rows.filter(r=>A.has(key(r))).map(r=>({spec:r.spec,b:r,a:A.get(key(r))}));
  const sum=(sel,label)=>{
    const o={label,cases:sel.length,fitUsed:{before:sel.filter(p=>p.b.usedFit).length,after:sel.filter(p=>p.a.usedFit).length}};
    for(const m of metrics){const sb=pick(sel.map(p=>p.b),METRICS[m]),sa=pick(sel.map(p=>p.a),METRICS[m]);o[m]={before:sb&&{meanAbs:sb.meanAbs,max:sb.max,p90:sb.p90},after:sa&&{meanAbs:sa.meanAbs,max:sa.max,p90:sa.p90}};}
    return o;
  };
  const groups={overall:[pairs]};
  const by=(name,f)=>{const m=new Map();for(const p of pairs){const k=f(p.spec);if(!m.has(k))m.set(k,[]);m.get(k).push(p);}return Object.fromEntries([...m].map(([k,v])=>[k,sum(v,`${name} ${k}`)]));};
  return {overall:sum(pairs,'all'),byView:by('view',s=>s.view),byFps:by('fps',s=>s.fps),byResolution:by('res',s=>s.width>1000?'4K':'720p'),byPitch:by('pitch',s=>s.pitch),
    byFitStatusBefore:by('fit status before',s=>{const p=pairs.find(q=>q.spec.seed===s.seed);return p.b.usedFit?'used':'fallback';}),
    worst:Object.fromEntries(metrics.map(m=>[m,{before:worstOf(pairs.map(p=>p.b),m),after:worstOf(pairs.map(p=>p.a),m)}]))};
}
function worstOf(rows,m){
  const xs=rows.map(r=>({r,v:METRICS[m](r)})).filter(x=>Number.isFinite(x.v)).sort((a,b)=>Math.abs(b.v)-Math.abs(a.v)).slice(0,3);
  return xs.map(({r,v})=>({value:+v.toFixed(2),seed:r.spec.seed,view:r.spec.view,fps:r.spec.fps,res:r.spec.width>1000?'4K':'720p',pitch:r.spec.pitch,fit:r.usedFit?'used':'fallback',
    status:r.new?.status??r.new?.error,ess:r.new?.fit?.ess&&+r.new.fit.ess.toFixed(0),costPerDof:r.new?.fit?.bestCostPerDof&&+r.new.fit.bestCostPerDof.toFixed(2),stopDetected:r.new?.events?.stopDetected??null}));
}
if(process.argv[1].endsWith('accuracy-compare.mjs')){
  const [b,a]=process.argv.slice(2),out=process.argv.includes('--json')?process.argv[process.argv.indexOf('--json')+1]:null;
  const res=compare(JSON.parse(await readFile(b,'utf8')),JSON.parse(await readFile(a,'utf8')));
  if(out)await writeFile(out,JSON.stringify(res,null,1));
  const line=o=>Object.entries(o).filter(([k])=>METRICS[k]).map(([k,v])=>`${k} ${v.before?.meanAbs?.toFixed(2)}/${v.before?.max?.toFixed(1)} → ${v.after?.meanAbs?.toFixed(2)}/${v.after?.max?.toFixed(1)}`).join(' | ');
  console.log('overall (meanAbs/max, before → after):',`fit used ${res.overall.fitUsed.before}→${res.overall.fitUsed.after}`);console.log(' ',line(res.overall));
  for(const g of ['byView','byFps','byResolution','byFitStatusBefore'])for(const [k,v] of Object.entries(res[g]))console.log(g,k,`n=${v.cases}`,line(v));
  console.log('worst:',JSON.stringify(res.worst,null,0).slice(0,3000));
}
