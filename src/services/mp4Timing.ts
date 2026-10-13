import { VideoTiming } from '../types';
type Box={type:string;start:number;data:number;end:number};
function boxes(v:DataView,start:number,end:number):Box[] {
  const out:Box[]=[];
  while(start+8<=end){let size=v.getUint32(start);const type=String.fromCharCode(...new Uint8Array(v.buffer,start+4,4));let head=8;
    if(size===1){if(start+16>end)throw Error('截斷 MP4 box');size=Number(v.getBigUint64(start+8));head=16;}
    if(size===0)size=end-start;
    if(!Number.isSafeInteger(size)||size<head||start+size>end)throw Error('無效 MP4 box 範圍');
    out.push({type,start,data:start+head,end:start+size});start+=size;
  }return out;
}
function child(v:DataView,b:Box,type:string){return boxes(v,b.data,b.end).find(x=>x.type===type);}
function u32(v:DataView,p:number,b:Box){if(p+4>b.end)throw Error('截斷 sample table');return v.getUint32(p);}
export function parseMoovTiming(buffer:ArrayBuffer):VideoTiming|null {
  const v=new DataView(buffer);const moov=boxes(v,0,v.byteLength).find(b=>b.type==='moov');if(!moov)return null;
  const mvhd=child(v,moov,'mvhd');const movieScale=mvhd?u32(v,mvhd.data+(v.getUint8(mvhd.data)===1?20:12),mvhd):0;
  for(const trak of boxes(v,moov.data,moov.end).filter(x=>x.type==='trak')){
    const mdia=child(v,trak,'mdia');if(!mdia)continue;const hdlr=child(v,mdia,'hdlr');
    if(!hdlr||String.fromCharCode(...new Uint8Array(buffer,hdlr.data+8,4))!=='vide')continue;
    const mdhd=child(v,mdia,'mdhd'),minf=child(v,mdia,'minf');if(!mdhd||!minf)continue;
    const scale=u32(v,mdhd.data+(v.getUint8(mdhd.data)===1?20:12),mdhd);if(!scale)throw Error('無效影片 timescale');
    const stbl=child(v,minf,'stbl');if(!stbl)continue;const stts=child(v,stbl,'stts');if(!stts)continue;
    const deltas:number[]=[];let dts=0;const pts:number[]=[];
    for(let i=0,n=u32(v,stts.data+4,stts);i<n;i++){
      const count=u32(v,stts.data+8+i*8,stts),delta=u32(v,stts.data+12+i*8,stts);
      if(!delta||pts.length+count>300000)throw Error('影片影格表過大或時間不合法，請縮短影片');
      for(let j=0;j<count;j++){pts.push(dts);deltas.push(delta);dts+=delta;}
    }
    const ctts=child(v,stbl,'ctts');if(ctts){let index=0;for(let i=0,n=u32(v,ctts.data+4,ctts);i<n;i++){
      const count=u32(v,ctts.data+8+i*8,ctts),p=ctts.data+12+i*8;u32(v,p,ctts);
      const offset=v.getUint8(ctts.data)===1?v.getInt32(p):v.getUint32(p);
      if(index+count>pts.length)throw Error('CTTS 影格數不一致');for(let j=0;j<count;j++)pts[index++]+=offset;
    }if(index!==pts.length)throw Error('CTTS sample count 不一致');}
    let shift=0;const edts=child(v,trak,'edts'),elst=edts?child(v,edts,'elst'):null;
    if(elst){const ver=v.getUint8(elst.data),size=ver===1?20:12;let empty=0;
      const count=u32(v,elst.data+4,elst);let mediaEdits=0;
      for(let i=0;i<count;i++){const p=elst.data+8+i*size;if(p+size>elst.end)throw Error('截斷 edit list');
        const duration=ver===1?Number(v.getBigUint64(p)):v.getUint32(p),media=ver===1?Number(v.getBigInt64(p+8)):v.getInt32(p+4);
        const rate=v.getInt16(p+(ver===1?16:8));if(rate!==1)throw Error('非正常速率 edit list，需人工確認時間');
        if(media===-1)empty+=duration/(movieScale||scale);else{mediaEdits++;shift=empty-media/scale;}
      }if(mediaEdits>1)throw Error('多段 edit list 尚不支援，請匯出單段影片');
    }
    const presentation=pts.map((p,i)=>({t:p/scale+shift,dt:deltas[i]/scale})).filter(p=>p.t>=-1e-7).sort((a,b)=>a.t-b.t);
    const timestamps=presentation.map(p=>Math.max(0,p.t));
    if(timestamps.length<2||timestamps.some((t,i)=>i>0&&t<=timestamps[i-1]))throw Error('影片時間戳重複或不連續');
    const durationSec=presentation.at(-1)!.t+presentation.at(-1)!.dt;
    const spans=timestamps.slice(1).map((t,i)=>t-timestamps[i]);const average=spans.reduce((a,b)=>a+b,0)/spans.length;
    return {actualFps:1/average,averageFps:presentation.length/durationSec,containerFps:scale/(dts/pts.length),fpsSource:'container_timestamps',totalFrames:timestamps.length,durationSec,isVFR:spans.some(dt=>Math.abs(dt-average)>average*0.02),timeBase:'timestamp',timestamps,timingReliable:true,seekPrecision:'presentation_timestamps',timingWarning:'容器 PTS 已解析；HTMLVideoElement seek 仍受瀏覽器解碼與關鍵影格限制，不保證逐樣本精確解碼。'};
  }return null;
}
export async function readMp4Timing(file:Blob):Promise<VideoTiming|null>{
  let p=0;
  while(p+8<=file.size){const head=new DataView(await file.slice(p,p+16).arrayBuffer());let size=head.getUint32(0),header=8;
    const type=String.fromCharCode(...new Uint8Array(head.buffer,4,4));if(size===1){size=Number(head.getBigUint64(8));header=16;}if(size===0)size=file.size-p;
    if(!Number.isSafeInteger(size)||size<header||p+size>file.size)throw Error('容器資料截斷或格式不合法');
    if(type==='moov'){if(size>32*1024*1024)throw Error('影片時間表過大，請縮短影片');return parseMoovTiming(await file.slice(p,p+size).arrayBuffer());}
    if(type==='moof')throw Error('Fragmented MP4 時間表尚未支援，請指定 FPS 或匯出普通 MP4');p+=size;
  }return null;
}
