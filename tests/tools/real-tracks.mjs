// Saves the ball finder's observations for the owner's clips (position, radius, time) so the geometry fit can be run in Node
// without decoding video again.   node tests/tools/real-tracks.mjs   → test-results/real-tracks.json  (never committed)
import {writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {openVideo,bundlePage} from './harness.mjs';
import {REAL_CLIPS} from './real-clips.mjs';

const folder=resolve('..','test videos'),pageScript=await bundlePage('tests/tools/page-entry.ts'),out={};
await mkdir('test-results',{recursive:true});
for(const c of REAL_CLIPS){
  const file=resolve(folder,c.file);if(!existsSync(file))continue;
  const v=await openVideo(file,{pageScript});
  try{
    const info=await v.page.evaluate(t=>window.__pv.open(t),v.timing.timestamps);
    const run=await v.page.evaluate(p=>window.__pv.runNew(p),{release:c.release,glove:c.glove,fps:24,view:c.view});
    const W=info.info.sourceWidth,H=info.info.sourceHeight,k=W/run.work.width;
    out[c.name]={clip:c,width:W,height:H,fps:(v.timing.timestamps.length-1)/(v.timing.timestamps.at(-1)-v.timing.timestamps[0]),times:info.count&&(await v.page.evaluate(()=>window.__pv.times)),
      status:run.status,points:run.points.map(p=>({frame:p.frame,time:p.time,x:p.xNorm*W,y:p.yNorm*H,radius:p.radius*k,source:p.source,confidence:p.confidence}))};
    console.log(c.name,run.status,run.observedCount,'observed',W+'x'+H);
  }finally{await v.close();}
}
await writeFile('test-results/real-tracks.json',JSON.stringify(out));
