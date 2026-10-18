// Contact sheet of the frames around the net (or the release) for one owner clip, with the tracked ball points drawn on top.
// Output goes to test-results/ (never committed).   node tests/tools/net-sheet.mjs <clip-name> <first> <last> [cx cy w h scale]
// Coordinates are in 720-wide space (x 0..720, y 0..1280).
import {writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openVideo,bundlePage} from './harness.mjs';
import {REAL_CLIPS} from './real-clips.mjs';

const [name,first,last,cx,cy,w,h,scale]=process.argv.slice(2);
const c=REAL_CLIPS.find(x=>x.name===name);if(!c)throw Error('unknown clip '+name);
const tracks=JSON.parse(await readFile('test-results/real-tracks.json','utf8'))[name];
const v=await openVideo(resolve('..','test videos',c.file),{pageScript:await bundlePage('tests/tools/page-entry.ts')});
try{
  await v.page.evaluate(t=>window.__pv.open(t),v.timing.timestamps);
  const frames=[];for(let i=Number(first);i<=Number(last);i++)frames.push(i);
  const W=Number(w??80),H=Number(h??80),crop={x:Number(cx??380)-W/2,y:Number(cy??660)-H/2,w:W,h:H};
  const png=await v.page.evaluate(({frames,crop,scale})=>window.__pv.sheet(frames,crop,scale,20,frames.length>6?6:frames.length),{frames,crop,scale:Number(scale??5)});
  const out=`test-results/sheet-${name}-${first}-${last}.png`;
  await writeFile(out,Buffer.from(png.split(',')[1],'base64'));
  const s=tracks.width/720;
  console.log(out,'crop(720 space)',crop,'points(720 space):',tracks.points.filter(p=>p.frame>=Number(first)&&p.frame<=Number(last)).map(p=>`F${p.frame} ${(p.x/s).toFixed(1)},${(p.y/s).toFixed(1)}${p.source==='estimated'?'(推估)':''}`).join(' | '));
}finally{await v.close();}
