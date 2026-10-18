// 5.0.3.2 Step 2 (synthetic): the measurement-vs-database contradiction check on known-truth pitches, true type and a deliberately
// wrong type.   node tests/tools/conflict-synth.mjs [--quick] [--out test-results/conflict-synth-5.0.3.2.json]
import {writeFile} from 'node:fs/promises';
import {caseSpecs,buildCase} from './accuracy-cases.mjs';
import {fitInputFor} from './new-run.mjs';
import {loadEngine} from './engine.mjs';
const args=process.argv.slice(2),quick=args.includes('--quick'),outFile=args.includes('--out')?args[args.indexOf('--out')+1]:'test-results/conflict-synth-5.0.3.2.json';
const E=await loadEngine(),rows=[];
for(const spec of caseSpecs({quick})){
  const c=await buildCase({...spec,net:'deform',source:'db'}),p=E.conflictProbe(c,fitInputFor(c));
  if(p.skipped){rows.push({spec,skipped:p.skipped});continue;}
  rows.push({spec:{seed:spec.seed,view:spec.view,fps:spec.fps,pitch:spec.pitch,res:spec.width>1000?'4K':'720p'},...p});
}
const sum=(sel)=>{
  const items=sel.flatMap(r=>['ivb','hb'].map(k=>r[k]));
  const n=items.length,c=f=>items.filter(f).length;
  const flagged=items.filter(i=>i.flaggedNow),unflagged=items.filter(i=>!i.flaggedNow);
  const cov=a=>a.length?Math.round(a.filter(i=>i.truthInMerged).length/a.length*100):null,err=a=>a.length?+(a.reduce((s,i)=>s+Math.abs(i.mergedErr),0)/a.length).toFixed(2):null;
  return {items:n,flaggedBefore:c(i=>i.flaggedBefore),flaggedNow:flagged.length,flaggedKinds:{disjoint:c(i=>i.kind==='disjoint'),centres_apart:c(i=>i.kind==='centres_apart'),weight_collapse:c(i=>i.kind==='weight_collapse')},
    flaggedNowButOverlapOldRule:c(i=>i.flaggedNow&&!i.flaggedBefore),
    mergedMeanAbsErrInch:{flagged:err(flagged),notFlagged:err(unflagged)},truthInMergedRangePct:{flagged:cov(flagged),notFlagged:cov(unflagged),all:cov(items)},
    truthInMeasuredRangePct:Math.round(items.filter(i=>i.truthInMeasured).length/n*100)};
};
const ok=rows.filter(r=>!r.skipped);
const result={engine:'current',cases:rows.length,skipped:rows.filter(r=>r.skipped).length,
  trueType:sum(ok.map(r=>r.trueType)),wrongType:sum(ok.map(r=>r.wrongType)),rows};
await writeFile(outFile,JSON.stringify(result,null,1));
console.log(JSON.stringify({cases:result.cases,skipped:result.skipped,trueType:result.trueType,wrongType:result.wrongType},null,1));
