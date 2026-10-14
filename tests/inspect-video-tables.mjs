import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {readMp4Timing}=await import(pathToFileURL(resolve('test-results/v41.mjs')).href);
function boxes(buffer,start=0,end=buffer.length){const items=[];for(let p=start;p+8<=end;){let size=buffer.readUInt32BE(p),header=8;if(size===1){size=Number(buffer.readBigUInt64BE(p+8));header=16;}if(!size)size=end-p;assert.ok(size>=header&&p+size<=end);items.push({type:buffer.toString('ascii',p+4,p+8),data:p+header,end:p+size});p+=size;}return items;}
const report=[];
for(const file of ['直球.mp4','彈指曲球.mp4']){
 const bytes=await readFile(resolve('../test videos',file)),root=boxes(bytes),child=(b,t)=>boxes(bytes,b.data,b.end).find(x=>x.type===t),moov=root.find(b=>b.type==='moov');
 const trak=boxes(bytes,moov.data,moov.end).filter(b=>b.type==='trak').find(b=>{const mdia=child(b,'mdia'),hdlr=child(mdia,'hdlr');return bytes.toString('ascii',hdlr.data+8,hdlr.data+12)==='vide';});
 const stbl=child(child(child(trak,'mdia'),'minf'),'stbl'),stsz=child(stbl,'stsz'),stts=child(stbl,'stts');let decodeSamples=0;
 for(let i=0;i<bytes.readUInt32BE(stts.data+4);i++)decodeSamples+=bytes.readUInt32BE(stts.data+8+i*8);
 const storedSamples=bytes.readUInt32BE(stsz.data+8),timing=await readMp4Timing(new Blob([bytes]));assert.equal(decodeSamples,storedSamples);
 const edits=child(trak,'edts'),elst=edits&&child(edits,'elst');
 report.push({file,storedSamples,sttsSampleCount:decodeSamples,presentationPTS:timing.timestamps.length,nonPresentedSamples:storedSamples-timing.timestamps.length,averageFPS:timing.averageFps,containerFPS:timing.containerFps,spacingFPS:timing.actualFps,isVFR:timing.isVFR,firstPTS:timing.timestamps[0],lastPTS:timing.timestamps.at(-1),duration:timing.durationSec,editList:elst?bytes.subarray(elst.data,elst.end).toString('hex'):null,pts:timing.timestamps});
}
await writeFile('test-results/video-tables-421.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.map(({pts,...r})=>r),null,2));
