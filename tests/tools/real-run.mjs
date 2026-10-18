// Runs the app's real analysis path (runPitchAnalysis) in desktop Chrome on a local clip and saves the outcome as JSON
// (test-results/real-run/<name>.json). Clips come from ../test videos and are never committed.
//   node tests/tools/real-run.mjs [--only <substring>] [--out <dir>]
import {writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {openVideo,bundlePage} from './harness.mjs';
import {REAL_CLIPS} from './real-clips.mjs';

const args=process.argv.slice(2),only=args.includes('--only')?args[args.indexOf('--only')+1]:null;
const outDir=resolve(args.includes('--out')?args[args.indexOf('--out')+1]:'test-results/real-run');
await mkdir(outDir,{recursive:true});
const folder=resolve('..','test videos');
const pageScript=await bundlePage('tests/tools/page-entry.ts');
const strip=o=>JSON.parse(JSON.stringify(o,(k,v)=>k==='trajectory_frames'?undefined:v));
for(const c of REAL_CLIPS){
  if(only&&!c.name.includes(only))continue;
  const file=resolve(folder,c.file);if(!existsSync(file)){console.log(c.name,'-> file not found');continue;}
  const v=await openVideo(file,{pageScript});
  try{
    const info=await v.page.evaluate(t=>window.__pv.open(t),v.timing.timestamps);
    const run=await v.page.evaluate(p=>window.__pv.runApp(p),{release:c.release,glove:c.glove,view:c.view,heightCm:Number(process.env.HEIGHT_CM||178),hasMound:process.env.MOUND!=='0'});
    await writeFile(resolve(outDir,c.name+'.json'),JSON.stringify(strip({clip:c,info:{offset:info.offset,count:info.count,work:info.info},...run}),null,1));
    const r=run.outcome.result;
    console.log(c.name,run.outcome.status,'ms',Math.round(run.ms),'v',run.outcome.velocityKmh,'type',r?.matched_pitch_type,'ivb',r?.ivb_inch,'hb',r?.hb_inch,'obs',run.outcome.detections?.length);
  }finally{await v.close();}
}
