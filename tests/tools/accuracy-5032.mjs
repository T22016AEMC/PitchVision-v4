// 5.0.3.2 accuracy report, SYNTHETIC ONLY (owner decision: no real-clip accuracy analysis in the 5.0.x phase): 5.0.3.1 → 5.0.3.2 on
// identical known-truth pitches, three sets (db = drawn from the database, independent = own spin ranges, independent + other hand),
// each with the owner's pitch type given and with AI recognition; plus the contradiction check and the worst-case analysis.
// Inputs: rows-5031m-<set>.json (5.0.3.1) and rows-5032a-<set>.json (5.0.3.2) from tests/tools/accuracy-rows.mjs,
//         conflict-synth-5.0.3.2.json, worst-case-5032.json.     node tests/tools/accuracy-5032.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {finalCompare} from './accuracy-final.mjs';
const J=async f=>existsSync(f)?JSON.parse(await readFile(f,'utf8')):null;
const pick=o=>({releaseSpeedErrPct:o.releaseSpeedErrPct.v5031?.meanAbs,releaseSpeedMaxErrPct:o.releaseSpeedErrPct.v5031?.max,releaseSpeedCoveragePct:o.releaseSpeedErrPct.coverage5031,
  ivbGiven:{err:o.ivbErrInch.given.meanAbs,max:o.ivbErrInch.given.max,coveragePct:o.ivbErrInch.coverageGiven,widthInch:+o.ivbErrInch.widthGiven.meanAbs.toFixed(1)},
  hbGiven:{err:o.hbErrInch.given.meanAbs,max:o.hbErrInch.given.max,coveragePct:o.hbErrInch.coverageGiven,widthInch:+o.hbErrInch.widthGiven.meanAbs.toFixed(1)},
  ivbAI:o.ivbErrInch.ai.meanAbs,hbAI:o.hbErrInch.ai.meanAbs,conflictPct:o.conflictPct,pitchTypeAI:{top1:o.pitchTypeAI.top1_5031,top3:o.pitchTypeAI.top3_5031},
  spin:o.spin_vs_truth_record});
const synthetic={},worse=[];
for(const [set,f] of Object.entries({db:'db',independent:'indep',independentMirrorHand:'mirror'})){
  const B=await J(`test-results/rows-5031m-${f}.json`),A=await J(`test-results/rows-5032a-${f}.json`);if(!B||!A){synthetic[set]={missing:true};continue;}
  const before=pick(finalCompare(B,B).overall),after=pick(finalCompare(B,A).overall);
  // events and release speed are untouched in 5.0.3.2: identical rows prove it
  const same=B.rows.every((r,i)=>r.final?.given?.releaseSpeed?.value===A.rows[i].final?.given?.releaseSpeed?.value&&r.new?.events?.gloveErrFrames===A.rows[i].new?.events?.gloveErrFrames);
  synthetic[set]={cases:A.rows.length,before5031:before,after5032:after,eventsAndReleaseSpeedIdentical:same};
  const chk=(label,b,a,lowerIsBetter)=>{if(Number.isFinite(b)&&Number.isFinite(a)&&(lowerIsBetter?a>b:a<b))worse.push({set,metric:label,before:b,after:a});};
  chk('IVB error (type given) in',before.ivbGiven.err,after.ivbGiven.err,true);chk('HB error (type given) in',before.hbGiven.err,after.hbGiven.err,true);
  chk('IVB error (AI) in',before.ivbAI,after.ivbAI,true);chk('HB error (AI) in',before.hbAI,after.hbAI,true);
  chk('IVB range width in',before.ivbGiven.widthInch,after.ivbGiven.widthInch,true);chk('HB range width in',before.hbGiven.widthInch,after.hbGiven.widthInch,true);
  chk('IVB coverage %',before.ivbGiven.coveragePct,after.ivbGiven.coveragePct,false);chk('HB coverage %',before.hbGiven.coveragePct,after.hbGiven.coveragePct,false);
  chk('pitch type top1 %',before.pitchTypeAI.top1,after.pitchTypeAI.top1,false);chk('pitch type top3 %',before.pitchTypeAI.top3,after.pitchTypeAI.top3,false);
  chk('release speed error %',before.releaseSpeedErrPct,after.releaseSpeedErrPct,true);
}
const out={version:'5.0.3.2',created:new Date().toISOString(),note:'Synthetic only. Real clips are NOT analysed for accuracy in 5.0.x (owner decision); the one-clip smoke test only checks that the flow runs and the six numbers are shown. 5.0.3.2 changes the display format and the contradiction check only: events, camera, distance, speed, lift/drag and pitch-type ranking are unchanged.',
  synthetic,worseItems:worse,contradictionCheck:await J('test-results/conflict-synth-5.0.3.2.json').then(x=>x&&{cases:x.cases,trueType:x.trueType,wrongType:x.wrongType}),worstCaseAnalysis:await J('test-results/worst-case-5032.json').then(x=>x&&{before5030:{fitUsed:x.before.fitUsed,over2framesOr15pct:x.before.over2framesOr15pct,rejected:x.before.rejected.map(r=>({seed:r.seed,view:r.view,fps:r.fps,res:r.res,reasons:r.reasons,in5031:r.in5031})),fitQualityVsError:x.before.fitQualityVsError},after5031:{fitUsed:x.after.fitUsed,over2framesOr15pct:x.after.over2framesOr15pct,costDofDistribution:x.after.costDofDistribution,essDistribution:x.after.essDistribution,fitQualityVsError:x.after.fitQualityVsError,worstReleaseSpeed:x.after.worstReleaseSpeed}})};
await writeFile('test-results/accuracy-5.0.3.2.json',JSON.stringify(out,null,1));
console.log('wrote test-results/accuracy-5.0.3.2.json; worse items:',worse.length);for(const w of worse)console.log(' worse:',w.set,w.metric,w.before,'→',w.after);
for(const [s,v] of Object.entries(synthetic))console.log(s,'identical events/speed:',v.eventsAndReleaseSpeedIdentical);
