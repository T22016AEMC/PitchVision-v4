// 5.0.3.1 accuracy report: every number 5.0.3 → 5.0.3.1, synthetic (known truth) and real (owner clips, no instrument truth) apart.
// Inputs (all local, never committed):
//   rows: ENGINE_BUNDLE=test-results/engine-5.0.3-frozen.mjs node tests/tools/accuracy-rows.mjs --out test-results/rows-503-<set>.json [...]
//         node tests/tools/accuracy-rows.mjs --out test-results/rows-5031-<set>.json [...]   for set = deform (db source), indep, mirror
//   real: test-results/baseline-5.0.3.json (Step 0) and test-results/real-run-5031/*.json (tests/tools/real-run.mjs [--given-type])
//   test-results/release-check-5031.json, auto-events-5031.json, ivb-diagnosis-5031.json (Step 2 / Step 5 tools)
//   node tests/tools/accuracy-5031.mjs [--out test-results/accuracy-5.0.3.1.json]
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {compare} from './accuracy-compare.mjs';
import {finalCompare} from './accuracy-final.mjs';
import {summarizeRun} from './real-summary.mjs';
import {stats} from './accuracy-stats.mjs';

const args=process.argv.slice(2),outFile=args.includes('--out')?args[args.indexOf('--out')+1]:'test-results/accuracy-5.0.3.1.json';
const J=async f=>existsSync(f)?JSON.parse(await readFile(f,'utf8')):null;
const sets={db:['test-results/rows-503-deform.json','test-results/rows-5031m-db.json'],independent:['test-results/rows-503-indep.json','test-results/rows-5031m-indep.json'],independentMirrorHand:['test-results/rows-503-mirror.json','test-results/rows-5031m-mirror.json']};
const synthetic={};
for(const [name,[b,a]] of Object.entries(sets)){
  const B=await J(b),A=await J(a);if(!B||!A){synthetic[name]={missing:[b,a].filter(f=>!existsSync(f))};continue;}
  const late=(rows)=>{const s=x=>{const v=stats(x.filter(Number.isFinite));return v&&{meanAbs:+v.meanAbs.toFixed(2),max:+v.max.toFixed(2)};};
    return {gloveErrFrames:s(rows.map(r=>(r.usedFit?r.new:r.old).events?.gloveErrFrames)),avgSpeedErrPct:s(rows.map(r=>(r.usedFit?r.new:r.old).speed?.avgErrPct))};};
  synthetic[name]={cases:A.rows.length,engineBefore:B.engine,engineAfter:A.engine,
    events_and_fit:compare(B,A),final_numbers:finalCompare(B,A),
    ownerGloveMark2FramesLate:{before:late(B.late),after:late(A.late),note:'5.0.3 re-derived the net time from the image; 5.0.3.1 takes the owner mark as the event time (by instruction), so a late mark now passes through'}};
}
// what got worse (overall and per condition), from the db-source set
const worse=[];
const scan=(label,o)=>{for(const [k,v] of Object.entries(o)){if(v&&v.before&&v.after&&Number.isFinite(v.before.meanAbs)&&Number.isFinite(v.after.meanAbs)&&v.after.meanAbs>v.before.meanAbs*1.02+1e-9)worse.push({where:label,metric:k,before:+v.before.meanAbs.toFixed(3),after:+v.after.meanAbs.toFixed(3)});}};
for(const [name,s] of Object.entries(synthetic)){if(!s.events_and_fit)continue;const c=s.events_and_fit;scan(`${name} overall`,c.overall);for(const g of ['byView','byFps','byResolution','byPitch'])for(const [k,v] of Object.entries(c[g]))scan(`${name} ${g} ${k}`,v);
  const f=s.final_numbers;for(const g of ['overall']){const o=f[g];
    if(o.releaseSpeedErrPct.v5031?.meanAbs>o.releaseSpeedErrPct.v503?.meanAbs)worse.push({where:`${name} final ${g}`,metric:'releaseSpeedErrPct',before:o.releaseSpeedErrPct.v503.meanAbs,after:o.releaseSpeedErrPct.v5031.meanAbs});
    for(const m of ['ivbErrInch','hbErrInch'])if(o[m].given?.meanAbs>o[m].v503?.meanAbs)worse.push({where:`${name} final ${g}`,metric:m,before:o[m].v503.meanAbs,after:o[m].given.meanAbs});
    if(o.pitchTypeAI.top1_5031<o.pitchTypeAI.top1_503)worse.push({where:`${name} final ${g}`,metric:'pitchType top1 %',before:o.pitchTypeAI.top1_503,after:o.pitchTypeAI.top1_5031});
    if(o.pitchTypeAI.top3_5031<o.pitchTypeAI.top3_503)worse.push({where:`${name} final ${g}`,metric:'pitchType top3 %',before:o.pitchTypeAI.top3_503,after:o.pitchTypeAI.top3_5031});}
  for(const g of ['byView','byFps','byResolution','byPitch'])for(const [k,o] of Object.entries(f[g])){
    if(o.releaseSpeedErrPct.v5031?.meanAbs>o.releaseSpeedErrPct.v503?.meanAbs*1.02)worse.push({where:`${name} final ${g} ${k}`,metric:'releaseSpeedErrPct',before:o.releaseSpeedErrPct.v503.meanAbs,after:o.releaseSpeedErrPct.v5031.meanAbs});
    for(const m of ['ivbErrInch','hbErrInch'])if(o[m].given?.meanAbs>o[m].v503?.meanAbs*1.02)worse.push({where:`${name} final ${g} ${k}`,metric:m,before:o[m].v503.meanAbs,after:o[m].given.meanAbs});
    if(o.pitchTypeAI.top1_5031<o.pitchTypeAI.top1_503)worse.push({where:`${name} final ${g} ${k}`,metric:'pitchType top1 %',before:o.pitchTypeAI.top1_503,after:o.pitchTypeAI.top1_5031});}
}
// real clips
const base=await J('test-results/baseline-5.0.3.json');
const real=[];
for(const name of ['straight-720p','straight-4k','knuckle-720p','knuckle-4k'])for(const mode of ['given','ai']){
  const f=`test-results/real-run-5031/${name}${mode==='given'?'-given':''}.json`;const now=existsSync(f)?summarizeRun(JSON.parse(await readFile(f,'utf8'))):null;
  const was=base?.real?.find(r=>r.name===name&&(mode==='given'?/owner/.test(r.mode):/AI/.test(r.mode)))??null;
  real.push({name,mode:mode==='given'?'owner pitch type selected':'AI 自動辨識',v503:was&&{geometryCards:was.geometryCards,databaseBlock:was.databaseBlock,engineAvgKmh:was.engine?.avgKmh},v5031:now&&{final:now.final,engineAvgKmh:now.engine?.avgKmh,debugGeometry:now.geometryCards}});
}
const result={version:'5.0.3.1',created:new Date().toISOString(),
  note:'Synthetic = known-truth pitches through a known camera with tracker-like noise and (new in 5.0.3.1) a deforming net, blur and bag overlap; 5.0.3 (frozen engine) and 5.0.3.1 run on IDENTICAL cases. db = pitches drawn from the same database the prior uses (optimistic, self-consistent); independent = spins drawn from per-type ranges written apart from the database; independentMirrorHand = the same with the other throwing hand (the database has one hand only). Real = the owner clips in desktop Chrome through the app path; there is no instrument truth and owner marks / speed statements are not truth.',
  synthetic,worseItems:worse,
  real,realStep2:{releaseCheck:await J('test-results/release-check-5031.json'),autoEventsVsMarks:await J('test-results/auto-events-5031.json')},ivbDiagnosis:await J('test-results/ivb-diagnosis-5031.json')};
await writeFile(outFile,JSON.stringify(result,null,1));
console.log('wrote',outFile,'worse items',worse.length);
for(const w of worse)console.log(' worse:',w.where,w.metric,w.before,'→',w.after);
