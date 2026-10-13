import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const baseline = resolve('baseline/v3');
await mkdir('test-results', { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex');
const results = { comparisons: 0, databases: [], preserved: [], cases: [] };
async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, {withFileTypes:true})) {
    const p = resolve(dir,e.name);
    files.push(...(e.isDirectory() ? await walk(p) : [p]));
  }
  return files;
}
for (const file of await walk(baseline)) {
  const name = relative(baseline,file).replaceAll('\\','/');
  const current = await readFile(name); // Missing any original file fails.
  const original = await readFile(file);
  if (name.endsWith('.json') && name.includes('database') || name === 'src/pitchDatabase.json') {
    assert.equal(hash(current),hash(original),name);
    const data = JSON.parse(current);
    results.databases.push({name,sha256:hash(current),records:Array.isArray(data)?data.length:Object.keys(data).length});
  }
  // All computational code must remain byte-identical, except lifecycle-only timing cleanup.
  if ((name.endsWith('.ts') && !['src/services/videoLoadService.ts','src/services/videoTimingService.ts'].includes(name)) || name === 'app.py') {
    assert.equal(hash(current),hash(original),`Scientific source changed: ${name}`);
    results.preserved.push(name);
  }
}
async function engine(root,label) {
  const modules = { match:'matchingEngine', spatial:'spatialCalibration', confidence:'confidenceEngine', validation:'services/trajectoryValidationService', timing:'services/videoTimingService', quality:'services/videoMetadataService', fit:'services/trajectoryFitEngine', physics:'services/physicsMeasurementEngine', spin:'services/spinInferenceEngine', movement:'services/movementDatabaseMatcher', detector:'baseballDetector', motion:'motionDetector', generator:'services/syntheticPitchGenerator', ingestion:'services/publicVideoIngestionService' };
  const contents = Object.entries(modules).map(([key,p])=>`export * as ${key} from ${JSON.stringify(resolve(root,'src',p+'.ts'))};`).join('\n');
  const outfile=resolve('test-results',label+'.mjs');
  await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  return import(pathToFileURL(outfile).href);
}
const a=await engine(baseline,'v3-engine'), b=await engine(process.cwd(),'v4-engine');
function compare(name,fn) {
  assert.deepStrictEqual(fn(b),fn(a),name);
  results.comparisons++;
  results.cases.push(name);
}
for (const fps of [24,29.97,30,60,120,240]) {
  for (const view of ['catcher','pitcher_rear']) {
    for (const [i,type] of a.match.PITCH_TYPE_OPTIONS.entries()) {
      const release=12, glove=release+Math.round(fps*0.48);
      const timestamps=Array.from({length:glove+10},(_,j)=>Number((j/fps).toFixed(4)));
      const observations=Array.from({length:8},(_,j)=>({frame:release+j*2,timestamp:(release+j*2)/fps,x:300+j*6,y:220+j*3+j*j*0.2,x_norm:(300+j*6)/720,y_norm:(220+j*3+j*j*0.2)/1280,radius:4,confidence:0.88,source:'observation'}));
      for (const obs of [[],observations]) {
        compare(`${fps}/${view}/${type}/${obs.length}`,e=>{
          const bio=e.spatial.computePitcherBiometrics(i%2===0,160+i*4,i%2?'manual':'ai_auto',110+i*5);
          const val=e.validation.validateAndReconstructVideoTrack({observations:obs,releaseFrame:release,catchFrame:glove,actualFps:fps,videoWidth:720,videoHeight:1280});
          const conf=e.confidence.calculateUnifiedConfidence({fps,totalVideoFrames:300,releaseFrame:release,gloveFrame:glove,isUserConfirmedFrames:true,isManualAnchorUsed:i%2===1,videoMetrics:val.metrics});
          const vel=e.match.calculateVelocity(release,glove,fps,bio.effectiveTravelDistanceM,timestamps);
          const match=e.match.matchPitchData(vel.velocityKmh,vel.flightSeconds,type,view,e.match.PITCH_DATABASE,release,glove,bio,val.videoTrack,val.metrics,conf,fps,timestamps,i%2===0,i%2===1,i%2===1,75);
          return {bio,val,conf,vel,match};
        });
      }
    }
  }
  compare(`quality-${fps}`,e=>[480,720,1080,2160].map(w=>e.quality.assessVideoQuality(w,w*16/9,fps,8)));
}
for (const [r,g] of [[0,null],[0,0],[1,0],[0,0.1],[0,0.5],[0,3],[0,3.1]]) {
  compare(`timestamp-boundary-${r}-${g}`,e=>e.timing.VideoTimingService.calculateTimestampVelocity(r,g,17.5));
}
compare('empty-fit',e=>e.fit.TrajectoryFitEngine.evaluateTrajectoryFit({videoTrack:[],modelTrack:[]}));
compare('clock-wrap',e=>[-13,-1,0,6,11.99,12,25].map(e.match.formatClockTime));
compare('reference-frame-estimates',e=>e.match.PITCH_TYPE_OPTIONS.map(t=>e.match.analyzePitchFramesFrameByFrame(240,60,t,'catcher')));
await writeFile('test-results/science-regression.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({comparisons:results.comparisons,databases:results.databases,unchangedScientificFiles:results.preserved.length,exactEquality:true},null,2));
