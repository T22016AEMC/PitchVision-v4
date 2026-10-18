// 5.0.3.1 Step 0: the 5.0.3 numbers on synthetic truth and on the two real clips, saved as test-results/baseline-5.0.3.json.
// Needs: test-results/baseline-503-acc.json (node tests/tools/accuracy-503.mjs --out test-results/baseline-503-acc.json, run on 5.0.3)
// and test-results/real-run-503/*.json (node tests/tools/real-run.mjs --out test-results/real-run-503 [--given-type], run on 5.0.3).
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {summarizeRun} from './real-summary.mjs';

const acc=JSON.parse(await readFile('test-results/baseline-503-acc.json','utf8'));
const real=[];
for(const name of ['straight-720p','straight-4k','knuckle-720p','knuckle-4k'])for(const mode of ['given','ai']){
  const file=`test-results/real-run-503/${name}${mode==='given'?'-given':''}.json`;if(!existsSync(file)){real.push({name,mode,error:'missing run'});continue;}
  const j=JSON.parse(await readFile(file,'utf8'));
  real.push({mode:mode==='given'?'owner pitch type selected (as on the phone)':'AI 自動辨識',...summarizeRun(j)});
}
await writeFile('test-results/baseline-5.0.3.json',JSON.stringify({version:'5.0.3',created:new Date().toISOString(),
  note:'Synthetic = known-truth pitches (self-consistency only); real = owner clips through the real app path in desktop Chrome with the app distance prior (16.6 m for 178 cm) and the file focal prior. No instrument truth for the real clips.',
  synthetic:{caseCount:acc.synthetic.caseCount,overall:acc.synthetic.overall,byView:acc.synthetic.byView,byFps:acc.synthetic.byFps,lateGloveMark:acc.synthetic.lateGloveMark,rows:acc.synthetic.rows},
  real},null,1));
console.log('wrote test-results/baseline-5.0.3.json',real.length,'real runs');
for(const r of real)console.log(r.name,r.mode.slice(0,6),r.engine?.avgKmh?.toFixed(1),'stop',r.geometryCards?.stopFrame,'glove vs mark',r.geometryCards?.gloveVsMarkFrames?.value,'ivb cards',r.geometryCards?.ivbInch?.value,'db',r.databaseBlock?.type?.slice(0,6),r.databaseBlock?.ivbInch,r.databaseBlock?.rpm);
