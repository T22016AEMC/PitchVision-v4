// One engine's numbers on the fixed synthetic case matrix, saved as rows (for version-to-version comparison on identical cases).
//   [ENGINE_BUNDLE=test-results/engine-5.0.3-frozen.mjs] node tests/tools/accuracy-rows.mjs --out <file> [--net deform|legacy] [--quick] [--source db|independent] [--hand db|mirror]
// Each row: the 5.0.2 path (geometry stage off), the geometry fit, and (when the engine has it) the 5.0.3.1 final numbers.
import {writeFile} from 'node:fs/promises';
import {caseSpecs,buildCase} from './accuracy-cases.mjs';
import {legacyNumbers} from './legacy-run.mjs';
import {newNumbers,finalNumbersFor} from './new-run.mjs';

const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const out=arg('--out','test-results/rows.json'),net=arg('--net','deform'),source=arg('--source','db'),hand=arg('--hand','db'),quick=args.includes('--quick');
const rows=[],late=[];
const t0=Date.now();
for(const spec of caseSpecs({quick})){
  const s={...spec,net,source,hand};
  const c=await buildCase(s),old=await legacyNumbers(c);let nw,fin=null;
  try{nw=await newNumbers(c);}catch(e){nw={error:String(e.message||e)};}
  try{fin=await finalNumbersFor(c);}catch(e){fin={error:String(e.message||e)};}
  rows.push({spec:s,old,new:nw,final:fin,usedFit:!nw.error&&nw.status==='ok'});
  if(spec.seed%3===0){
    const l=await buildCase({...s,gloveMarkLate:2}),oldL=await legacyNumbers(l);let nl;try{nl=await newNumbers(l);}catch(e){nl={error:String(e.message||e)};}
    late.push({spec:s,old:oldL,new:nl,usedFit:!nl.error&&nl.status==='ok'});
  }
}
await writeFile(out,JSON.stringify({engine:process.env.ENGINE_BUNDLE??'current',net,source,created:new Date().toISOString(),ms:Date.now()-t0,rows,late}));
console.log('wrote',out,rows.length,'rows, fit used',rows.filter(r=>r.usedFit).length,'in',Math.round((Date.now()-t0)/1000),'s');
