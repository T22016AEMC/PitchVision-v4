// In-page helpers for the local test harness (bundled to an IIFE; never shipped in the app).
import {createVideoFrameSource,measureTimeBaseOffset,FrameSource,FrameImage} from '../../src/services/pitchBallFrameSource';
import {trackPitchBall} from '../../src/services/pitchBallTracker';
import {trackBaseballSparse} from '../../src/baseballTracker';
// @ts-ignore plain JS renderer shared with the Node tests
import {makeScene} from './synth.mjs';

declare global{interface Window{__pv:any;}}
let source:FrameSource|null=null,times:number[]=[],cache=new Map<number,FrameImage>();

async function open(containerTimes:number[],opts:{maxLongSide?:number}={}){
  // Put the parsed container times on the browser's own media timeline first.
  const probe=document.createElement('video');probe.muted=true;probe.playsInline=true;probe.src='/video';
  await new Promise<void>((ok,fail)=>{probe.onloadeddata=()=>ok();probe.onerror=()=>fail(Error('video error'));});
  const offset=await measureTimeBaseOffset(probe,containerTimes);probe.removeAttribute('src');probe.load();
  times=containerTimes.map(t=>Math.max(0,t+(offset??0)));cache=new Map();
  source=await createVideoFrameSource('/video',times,opts);
  return {offset,info:source.info,count:times.length};
}
async function frame(index:number){
  if(!source)throw Error('not open');
  let f=cache.get(index);if(!f){const g=await source.capture(index);if(!g)throw Error('frame '+index+' unavailable');f=g;cache.set(index,f);}
  return f;
}
/** Contact sheet of crops. Coordinates are in 720-wide space (x 0..720, y 0..1280). */
async function sheet(indices:number[],crop:{x:number;y:number;w:number;h:number},scale:number,grid:number,columns:number){
  const s=source!.info.width/720,tiles:HTMLCanvasElement[]=[];
  for(const index of indices){
    const f=await frame(index);
    const src=document.createElement('canvas');src.width=f.width;src.height=f.height;
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(f.data),f.width,f.height),0,0);
    const t=document.createElement('canvas');t.width=Math.round(crop.w*scale);t.height=Math.round(crop.h*scale);
    const c=t.getContext('2d')!;c.imageSmoothingEnabled=false;
    c.drawImage(src,crop.x*s,crop.y*s,crop.w*s,crop.h*s,0,0,t.width,t.height);
    c.strokeStyle='rgba(255,255,0,.55)';c.fillStyle='#ff0';c.font='11px monospace';c.lineWidth=1;
    for(let gx=Math.ceil(crop.x/grid)*grid;gx<crop.x+crop.w;gx+=grid){const px=(gx-crop.x)*scale;c.beginPath();c.moveTo(px,0);c.lineTo(px,t.height);c.stroke();c.fillText(String(gx),px+2,10);}
    for(let gy=Math.ceil(crop.y/grid)*grid;gy<crop.y+crop.h;gy+=grid){const py=(gy-crop.y)*scale;c.beginPath();c.moveTo(0,py);c.lineTo(t.width,py);c.stroke();c.fillText(String(gy),2,py-2);}
    c.fillStyle='#0f0';c.font='bold 16px monospace';c.fillText('F'+index,t.width-52,18);
    tiles.push(t);
  }
  const rows=Math.ceil(tiles.length/columns),W=tiles[0].width,H=tiles[0].height,out=document.createElement('canvas');
  out.width=W*columns+(columns-1)*4;out.height=H*rows+(rows-1)*4;const o=out.getContext('2d')!;o.fillStyle='#222';o.fillRect(0,0,out.width,out.height);
  tiles.forEach((t,i)=>o.drawImage(t,(i%columns)*(W+4),Math.floor(i/columns)*(H+4)));
  return out.toDataURL('image/png');
}
async function runNew(p:{release:number;glove:number;fps:number;view:'catcher'|'pitcher_rear';anchors?:any[]}){
  if(!source)throw Error('not open');
  const t0=performance.now(),r=await trackPitchBall(source as any,p.release,p.glove,{fps:p.fps,view:p.view,releaseFrame:p.release,anchors:p.anchors});
  return {...r,totalMs:performance.now()-t0};
}
async function runOld(p:{release:number;glove:number;fps:number;view:'catcher'|'pitcher_rear'}){
  const v=document.createElement('video');v.muted=true;v.playsInline=true;v.src='/video';
  await new Promise<void>((ok,fail)=>{v.onloadeddata=()=>ok();v.onerror=()=>fail(Error('video error'));});
  const t0=performance.now();
  try{
    const r=await trackBaseballSparse(v,{releaseFrame:p.release,visibleEndFrame:p.glove,catchFrame:p.glove,releaseTimeSec:times[p.release],catchTimeSec:times[p.glove],fps:p.fps,timestamps:times,cameraView:p.view});
    return {status:r.status,message:r.statusMessage,observations:r.observations.map(o=>({frame:o.frame,x_norm:o.x_norm,y_norm:o.y_norm,radius:o.radius,time:o.timestamp})),ms:performance.now()-t0,width:v.videoWidth,height:v.videoHeight};
  }finally{v.remove();}
}
/** Render a synthetic scene in the page and H.264-encode it; Node muxes the chunks into an .mp4. */
async function synthEncode(opts:any){
  const scene=makeScene(opts),{width,height,fps,frames}=scene;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;
  const chunks:any[]=[];let config:number[]|undefined,error:string|undefined;
  const encoder=new VideoEncoder({output:(chunk,meta)=>{const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);chunks.push({timestamp:chunk.timestamp,type:chunk.type,bytes:Array.from(bytes)});if(meta?.decoderConfig?.description)config=Array.from(new Uint8Array(meta.decoderConfig.description as ArrayBuffer));},error:e=>{error=e.message;}});
  const level=Math.max(width,height)>2500?'avc1.640033':Math.max(width,height)>1500?'avc1.64002A':'avc1.64001F';
  const cfg:any={codec:level,width,height,bitrate:Math.round(width*height*fps*0.18),framerate:fps,latencyMode:'quality',avc:{format:'avc'}};
  if(!(await VideoEncoder.isConfigSupported(cfg)).supported)throw Error('H.264 encoder unsupported for '+width+'x'+height);
  encoder.configure(cfg);
  const pts:number[]=[];
  for(let i=0;i<frames;i++){
    const data=scene.render(i);ctx.putImageData(new ImageData(data,width,height),0,0);
    const ts=Math.round(i*1e6/fps);pts.push(ts);const f=new VideoFrame(canvas,{timestamp:ts,duration:Math.round(1e6/fps)});encoder.encode(f,{keyFrame:i%12===0});f.close();
    if(encoder.encodeQueueSize>4)await new Promise(r=>encoder.addEventListener('dequeue',r,{once:true}));
  }
  await encoder.flush();encoder.close();if(error)throw Error(error);
  return {width,height,fps,chunks,config,pts,truth:scene.truth,release:scene.release,glove:scene.glove,view:scene.view,frames};
}
/** Frame-capture self-check: every frame of a range captured by sequential playback vs by seeking. */
async function compareCapture(first:number,last:number){
  if(!source)throw Error('not open');
  const seq=await (source as any).captureRange(first,last);
  const out:any[]=[];
  for(const f of seq){
    const g=await source.capture(f.index);if(!g){out.push({index:f.index,error:'seek failed'});continue;}
    let d=0;const n=f.data.length;for(let i=0;i<n;i+=16)d+=Math.abs(f.data[i]-g.data[i]);
    out.push({index:f.index,meanAbsDiff:+(d/(n/16)).toFixed(2)});
  }
  return {requested:last-first+1,sequentialGot:seq.length,frames:out};
}
window.__pv={compareCapture,runNew,runOld,synthEncode,open,frame:async(i:number)=>{const f=await frame(i);return {width:f.width,height:f.height,verified:f.verified,time:f.time};},sheet,getFrame:frame,get times(){return times;},get source(){return source;}};
