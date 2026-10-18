// 5.0.3 → 5.0.3.1 on identical synthetic cases: what each version would put on the page.
//   5.0.3   = geometry-fit cards when the fit is 'ok', otherwise the 5.0.2 numbers (its product policy); pitch types = the 5.0.3 ranker.
//   5.0.3.1 = the six final numbers (owner pitch type given / AI mode) from the rows of tests/tools/accuracy-rows.mjs.
//   node tests/tools/accuracy-final.mjs <rows-503.json> <rows-5031.json> [--json out.json]
import {readFile,writeFile} from 'node:fs/promises';
import {stats,rate} from './accuracy-stats.mjs';

const S=xs=>{const s=stats(xs.filter(Number.isFinite));return s&&{n:s.n,meanAbs:+s.meanAbs.toFixed(2),p90:+s.p90.toFixed(2),max:+s.max.toFixed(2)};};
const shown503=r=>r.usedFit?r.new:r.old;
export function finalCompare(b,a){
  const A=new Map(a.rows.map(r=>[r.spec.seed,r])),pairs=b.rows.filter(r=>A.has(r.spec.seed)).map(r=>({spec:r.spec,b:r,a:A.get(r.spec.seed)}));
  const sum=sel=>{
    const F=m=>sel.map(p=>p.a.final?.[m]).filter(Boolean);
    const given=F('given'),ai=F('ai');
    return {cases:sel.length,
      releaseSpeedErrPct:{v503:S(sel.map(p=>p.b.usedFit?p.b.new.speed.releaseErrPct:NaN)),v5031:S(given.map(g=>g.releaseSpeedErrPct)),
        coverage503:rate(sel.filter(p=>p.b.usedFit).map(p=>p.b.new.speed.releaseInRange)),coverage5031:rate(given.map(g=>g.releaseSpeed?.inRange)),widthKmh5031:S(given.map(g=>g.releaseSpeed?.width))},
      avgSpeedErrPct503:S(sel.map(p=>shown503(p.b).speed.avgErrPct)),
      ivbErrInch:{v503:S(sel.map(p=>shown503(p.b).movement.ivbErr)),given:S(given.map(g=>g.ivb?.err)),ai:S(ai.map(g=>g.ivb?.err)),
        coverage503:rate(sel.filter(p=>p.b.usedFit).map(p=>p.b.new.movement.ivbInRange)),coverageGiven:rate(given.map(g=>g.ivb?.inRange)),widthGiven:S(given.map(g=>g.ivb?.width))},
      hbErrInch:{v503:S(sel.map(p=>shown503(p.b).movement.hbErr)),given:S(given.map(g=>g.hb?.err)),ai:S(ai.map(g=>g.hb?.err)),
        coverage503:rate(sel.filter(p=>p.b.usedFit).map(p=>p.b.new.movement.hbInRange)),coverageGiven:rate(given.map(g=>g.hb?.inRange)),widthGiven:S(given.map(g=>g.hb?.width))},
      spin_vs_truth_record:{note:'spin is a database prior in both versions; 5.0.3 showed one candidate value, 5.0.3.1 a range',
        rpmErrGiven:S(given.map(g=>g.rpm?.err)),rpmCoverageGiven:rate(given.map(g=>g.rpm?.inRange)),effErrGiven:S(given.map(g=>g.efficiency?.err)),effCoverageGiven:rate(given.map(g=>g.efficiency?.inRange)),
        axisErrHoursGiven:S(given.map(g=>g.axis?.err)),axisCoverageGiven:rate(given.map(g=>g.axis?.inRange))},
      conflictPct:{given:rate(given.map(g=>g.conflicts.length>0)),ai:rate(ai.map(g=>g.conflicts.length>0))},
      handVariants:(()=>{const v=m=>{const x=F(m);if(!x.length)return null;return {ivb:S(x.map(g=>g.ivb?.err)),hb:S(x.map(g=>g.hb?.err)),hbCoverage:rate(x.map(g=>g.hb?.inRange)),axisErrHours:S(x.map(g=>g.axis?.err)),axisCoverage:rate(x.map(g=>g.axis?.inRange)),
        conflictPct:rate(x.map(g=>g.conflicts.length>0)),top1:x[0].pitchType?rate(x.map(g=>g.pitchType?.top1Ok)):null,top3:x[0].pitchType?rate(x.map(g=>g.pitchType?.top3Ok)):null};};
        return {note:'mirror = candidates and their left-right mirror image (unknown throwing hand)',givenMirror:v('given'),givenNoMirror:v('givenNoMirror'),aiNoMirror:v('ai'),aiMirror:v('aiMirror')};})(),
      pitchTypeAI:{top1_503:rate(sel.map(p=>shown503(p.b).pitchType.top1Ok)),top3_503:rate(sel.map(p=>shown503(p.b).pitchType.top3Ok)),
        top1_5031:rate(ai.map(g=>g.pitchType?.top1Ok)),top3_5031:rate(ai.map(g=>g.pitchType?.top3Ok)),hardPct_5031:rate(ai.map(g=>g.pitchType?.hard))}
    };
  };
  const by=f=>{const m=new Map();for(const p of pairs){const k=f(p.spec);if(!m.has(k))m.set(k,[]);m.get(k).push(p);}return Object.fromEntries([...m].map(([k,v])=>[k,sum(v)]));};
  return {overall:sum(pairs),byView:by(s=>s.view),byFps:by(s=>s.fps),byResolution:by(s=>s.width>1000?'4K':'720p'),byPitch:by(s=>s.pitch)};
}
if(process.argv[1]?.endsWith('accuracy-final.mjs')){
  const [b,a]=process.argv.slice(2),out=process.argv.includes('--json')?process.argv[process.argv.indexOf('--json')+1]:null;
  const res=finalCompare(JSON.parse(await readFile(b,'utf8')),JSON.parse(await readFile(a,'utf8')));
  if(out)await writeFile(out,JSON.stringify(res,null,1));
  console.log(JSON.stringify(res.overall,null,1));
  for(const g of ['byView','byFps','byResolution'])for(const [k,v] of Object.entries(res[g]))console.log(g,k,'speed',v.releaseSpeedErrPct.v503?.meanAbs,'→',v.releaseSpeedErrPct.v5031?.meanAbs,'ivb',v.ivbErrInch.v503?.meanAbs,'→',v.ivbErrInch.given?.meanAbs,'hb',v.hbErrInch.v503?.meanAbs,'→',v.hbErrInch.given?.meanAbs,'type top1',v.pitchTypeAI.top1_503,'→',v.pitchTypeAI.top1_5031,'top3',v.pitchTypeAI.top3_503,'→',v.pitchTypeAI.top3_5031);
}
