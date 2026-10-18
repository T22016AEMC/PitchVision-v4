// 5.0.3.2 Step 0: the 5.0.3.1 final numbers on the owner clips (720p and 4K, owner pitch type and AI mode) and on the synthetic sets,
// saved as test-results/baseline-5.0.3.1b.json. Needs test-results/real-run-5031/*.json (tests/tools/real-run.mjs [--given-type]) and
// test-results/rows-5031m-{db,indep,mirror}.json (tests/tools/accuracy-rows.mjs), all produced on 5.0.3.1.
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {summarizeRun} from './real-summary.mjs';
import {finalCompare} from './accuracy-final.mjs';

const real=[];
for(const name of ['straight-720p','straight-4k','knuckle-720p','knuckle-4k'])for(const mode of ['given','ai']){
  const f=`test-results/real-run-5031/${name}${mode==='given'?'-given':''}.json`;if(!existsSync(f)){real.push({name,mode,error:'missing'});continue;}
  const j=JSON.parse(await readFile(f,'utf8')),s=summarizeRun(j);
  real.push({mode:mode==='given'?'owner pitch type selected':'AI 自動辨識',analysisMs:Math.round(j.ms),...s,debugFinal:j.outcome.final?.debug??null});
}
const sets={db:'rows-5031m-db',independent:'rows-5031m-indep',independentMirrorHand:'rows-5031m-mirror'};
const synthetic={};
for(const [k,f] of Object.entries(sets)){
  const A=JSON.parse(await readFile(`test-results/${f}.json`,'utf8'));
  synthetic[k]={cases:A.rows.length,rows:A.rows.map(r=>({spec:r.spec,usedFit:r.usedFit,final:r.final,events:{releaseErrFrames:r.new.events?.releaseErrFrames,gloveErrFrames:r.new.events?.gloveErrFrames},fit:r.new.fit,status:r.new.status})),
    summary:finalCompare(A,A).overall};
}
await writeFile('test-results/baseline-5.0.3.1b.json',JSON.stringify({version:'5.0.3.1',created:new Date().toISOString(),commit:'c807f01',note:'baseline for 5.0.3.2; real = desktop Chrome through the app path; synthetic = known-truth pitches (db / independent / independent + other hand)',real,synthetic},null,1));
console.log('wrote test-results/baseline-5.0.3.1b.json',real.length,'real runs');
