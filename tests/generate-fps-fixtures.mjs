import {chromium} from '@playwright/test';import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
// Test-only ISO BMFF muxer. Every sample is an actual WebCodecs H.264 encoded
// image, not a renamed movie or patched FPS label. Manifest PTS are encoder inputs.
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;},u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;},zeros=n=>Buffer.alloc(n),box=(type,...data)=>{const body=Buffer.concat(data);return Buffer.concat([u32(body.length+8),Buffer.from(type),body]);},full=(type,version,flags,...data)=>box(type,Buffer.from([version,(flags>>16)&255,(flags>>8)&255,flags&255]),...data);
const matrix=Buffer.concat([u32(65536),u32(0),u32(0),u32(0),u32(65536),u32(0),u32(0),u32(0),u32(1073741824)]);
function mux(f){const width=f.width,height=f.height,times=f.pts,scale=1000000,deltas=times.map((t,i)=>i+1<times.length?times[i+1]-t:f.lastDuration),duration=times.at(-1)+deltas.at(-1),ftyp=box('ftyp',Buffer.from('isom'),u32(512),Buffer.from('isomiso2avc1mp41')),mdat=box('mdat',...f.chunks.map(c=>Buffer.from(c.bytes)));
 const mvhd=full('mvhd',0,0,u32(0),u32(0),u32(scale),u32(duration),u32(65536),u16(256),zeros(10),matrix,zeros(24),u32(2));
 const tkhd=full('tkhd',0,7,u32(0),u32(0),u32(1),u32(0),u32(duration),zeros(8),u16(0),u16(0),u16(0),u16(0),matrix,u32(width*65536),u32(height*65536));
 const mdhd=full('mdhd',0,0,u32(0),u32(0),u32(scale),u32(duration),u16(21956),u16(0)),hdlr=full('hdlr',0,0,u32(0),Buffer.from('vide'),zeros(12),Buffer.from('Synthetic test video\0'));
 const avc1=box('avc1',zeros(6),u16(1),zeros(16),u16(width),u16(height),u32(72*65536),u32(72*65536),u32(0),u16(1),zeros(32),u16(24),u16(65535),box('avcC',Buffer.from(f.config)));
 const stsd=full('stsd',0,0,u32(1),avc1),stts=full('stts',0,0,u32(deltas.length),...deltas.flatMap(d=>[u32(1),u32(d)])),stsc=full('stsc',0,0,u32(1),u32(1),u32(times.length),u32(1)),stsz=full('stsz',0,0,u32(0),u32(times.length),...f.chunks.map(c=>u32(c.bytes.length))),stco=full('stco',0,0,u32(1),u32(ftyp.length+8)),keys=f.chunks.flatMap((c,i)=>c.type==='key'?[u32(i+1)]:[]),stss=full('stss',0,0,u32(keys.length),...keys);
 const dinf=box('dinf',full('dref',0,0,u32(1),full('url ',0,1))),minf=box('minf',full('vmhd',0,1,zeros(8)),dinf,box('stbl',stsd,stts,stsc,stsz,stco,stss));return Buffer.concat([ftyp,mdat,box('moov',mvhd,box('trak',tkhd,box('mdia',mdhd,hdlr,minf)))]);
}
const folder=resolve('test-results/fps-fixtures');await mkdir(folder,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();const manifest=[];
try{await page.goto('http://127.0.0.1:4175');for(const [name,fps]of [['30',30],['60',60],['90',90],['120',120],['29.97',30000/1001],['vfr',null]]){
 const pts=fps?Array.from({length:Math.ceil(fps*1.4)},(_,i)=>Math.round(i*1e6/fps)):Array.from({length:48},(_,i)=>{let t=0;for(let j=0;j<i;j++)t+=[16667,33333,41667,25000][j%4];return t;});
 const durations=pts.map((t,i)=>i+1<pts.length?pts[i+1]-t:fps?Math.round(1e6/fps):25000);
 const encoded=await page.evaluate(async({pts,durations})=>{
  const width=320,height=240,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),chunks=[];let config,error;
  const encoder=new VideoEncoder({output:(chunk,meta)=>{const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);chunks.push({timestamp:chunk.timestamp,type:chunk.type,bytes:Array.from(bytes)});if(meta.decoderConfig?.description)config=Array.from(new Uint8Array(meta.decoderConfig.description));},error:e=>{error=e.message;}});
  const options={codec:'avc1.42001f',width,height,bitrate:2000000,latencyMode:'realtime',avc:{format:'avc'}};if(!(await VideoEncoder.isConfigSupported(options)).supported)throw Error('Browser H.264 test encoder unavailable');encoder.configure(options);
  for(let i=0;i<pts.length;i++){ctx.fillStyle='#142033';ctx.fillRect(0,0,width,height);for(let y=60;y<200;y+=8)for(let x=10;x<300;x+=8){ctx.fillStyle=((x*17+y*31)%3)?'#243346':'#334455';ctx.fillRect(x,y,8,8);}ctx.fillStyle='#dddd44';ctx.fillRect(20+(i*2)%260,100,24,24);
   // Nine binary cells robust to lossy AVC. This uniquely identifies each frame.
   for(let bit=0;bit<9;bit++){ctx.fillStyle=(i>>bit)&1?'white':'black';ctx.fillRect(8+bit*30,8,24,24);}ctx.fillStyle='white';ctx.font='18px monospace';ctx.fillText(String(i),10,55);
   const frame=new VideoFrame(canvas,{timestamp:pts[i],duration:durations[i]});encoder.encode(frame,{keyFrame:i%15===0});frame.close();if(encoder.encodeQueueSize>12)await new Promise(r=>encoder.addEventListener('dequeue',r,{once:true}));}
  await encoder.flush();encoder.close();if(error)throw Error(error);return{width,height,chunks,config};
 },{pts,durations});
 if(encoded.chunks.length!==pts.length||encoded.chunks.some((c,i)=>c.timestamp!==pts[i]))throw Error('Encoder dropped/reordered frames');const filename=`synthetic-${name}.mp4`;await writeFile(resolve(folder,filename),mux({...encoded,pts,lastDuration:durations.at(-1)}));manifest.push({name,filename,width:encoded.width,height:encoded.height,frameCount:pts.length,pts:pts.map(t=>t/1e6),duration:(pts.at(-1)+durations.at(-1))/1e6,fps:fps??(pts.length-1)*1e6/pts.at(-1),averageFps:pts.length*1e6/(pts.at(-1)+durations.at(-1)),events:{release:.3,glove:.9},encoding:'WebCodecs AVC baseline, realtime, no B frames; DTS=PTS'});console.log(filename,pts.length);}
 await writeFile(resolve(folder,'manifest.json'),JSON.stringify(manifest,null,2));
}finally{await browser.close();}
