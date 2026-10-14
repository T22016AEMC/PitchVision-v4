import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const e=await import(pathToFileURL(resolve('test-results/v411.mjs')).href);
let assertions=0;const check=(v,n)=>{assert.ok(v,n);assertions++;};
for(const fps of [24000/1001,30000/1001,60000/1001,90,120]){
 const times=Array.from({length:80},(_,i)=>i/fps),copy=[...times],grid=e.createFineGridTimeline(times,fps);
 check(fps>=90?grid.length===times.length:grid.length===Math.floor(times.at(-1)*90+1e-8)+1,'fine operation count distinct from source count');
 for(let i=1;i<grid.length;i++)check(Math.abs(grid.get(i).timeSec-grid.get(i-1).timeSec-(fps>=90?1/fps:1/90))<1e-7,'one step uses selected timeline rate');
 assert.deepEqual(times,copy);assertions++;
}
const times=[.006, .048, .080, .139, .172, .224],grid=e.createFineGridTimeline(times,24),r=grid.get(2),g=grid.get(15),view=e.eventAnalysisView(times,{release:e.selectEvent(r,times,'low'),glove:e.selectEvent(g,times,'low')});
check(Math.abs(view.timestamps[view.gloveFrame]-view.timestamps[view.releaseFrame]-(g.timeSec-r.timeSec))<1e-12,'fine event times not quantized to original indices');
check(e.createAnalysisTimeline(times,24,false).length===times.length,'VFR originals remain available');
// Large detailed originals with a translating textured patch. Reduced vectors
// must be rescaled, but full-resolution fine texture must not be upsampled.
const image=dx=>{const width=768,height=384,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4,z=20+((x*11+y*7)%11);data.set([z,z,z,255],p);}for(let y=96;y<168;y++)for(let x=192;x<264;x++){const p=(y*width+x+dx)*4,texture=(Math.imul(x,1640531527)^Math.imul(y,2654435761))>>>24;data.set([100+texture%150,20+x%8,20+y%9,255],p);}return{width,height,data};};
const a=image(0),b=image(12),pair=e.estimateMotionPair(a,b),mid=e.renderMotionIntermediate(pair,.5);
check(pair.motionWidth===512&&pair.motionHeight===256,'only motion estimation is reduced');
check(mid.length===768*384*4&&pair.a===a&&pair.b===b,'native RGBA synthesis retains original buffers');
check(pair.scaleX===1.5&&pair.scaleY===1.5,'low-resolution vectors map back to native pixels');
check(pair.forward.vectors.some(v=>v.valid&&v.dx===8),'12px native displacement estimated as 8px reduced');
const p=(y,x)=>(y*768+x)*4;
check(Math.abs(mid[p(124,226)]-a.data[p(124,220)])<8,'texture moves halfway at native displacement');
check(mid[p(30,31)]===a.data[p(30,31)],'static native detail not reduced and upsampled');
check(mid.some((v,i)=>v!==a.data[i])&&mid.some((v,i)=>v!==b.data[i]),'native intermediate differs from both endpoints');
assert.deepEqual(e.renderMotionIntermediate(pair,0),a.data);assert.deepEqual(e.renderMotionIntermediate(pair,1),b.data);assertions+=2;
await writeFile('test-results/v421-unit.json',JSON.stringify({assertions,sourceSize:[a.width,a.height],motionSize:[pair.motionWidth,pair.motionHeight]},null,2));console.log(JSON.stringify({v421Assertions:assertions}));
