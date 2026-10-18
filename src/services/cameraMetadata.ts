// Camera facts the phone writes into a QuickTime/MP4 file (mdta "keys"/"ilst" metadata), used only to set the focal-length prior.
// iPhone .mov files carry the lens model (e.g. "iPhone 16e back camera 4.2mm f/1.64") and the 35 mm-equivalent focal length.
// Files re-encoded by chat apps or converters usually lose this; then the generic prior applies. Nothing here changes timing.
export interface CameraMetadata{lensModel?:string;focal35mm?:number;source:'file'|'none'}
export interface FocalPrior{px:number;relSigma:number;basis:string}

const u32=(v:DataView,p:number)=>v.getUint32(p);
function walk(v:DataView,start:number,end:number){
  const out:{type:string;data:number;end:number}[]=[];
  while(start+8<=end){const size=u32(v,start);if(size<8||start+size>end)break;out.push({type:String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+start+4,4)),data:start+8,end:start+size});start+=size;}
  return out;
}
export function parseCameraMetadata(buffer:ArrayBuffer):CameraMetadata{
  const v=new DataView(buffer);
  try{
    const moov=walk(v,0,v.byteLength).find(b=>b.type==='moov');if(!moov)return {source:'none'};
    // the mdta keys live in moov/meta (or inside a track's meta); look in both
    const metas:{data:number;end:number}[]=[];
    const visit=(b:{data:number;end:number},depth:number)=>{for(const c of walk(v,b.data,b.end)){if(c.type==='meta'){ // QuickTime writes meta without the 4-byte version/flags that ISO files have
        const tag=c.data+8<=c.end?String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+c.data+4,4)):'';
        metas.push({data:tag==='hdlr'?c.data:c.data+4,end:c.end});}else if(depth<3&&(c.type==='udta'||c.type==='trak'))visit(c,depth+1);}};
    visit(moov,0);
    for(const meta of metas){
      const kids=walk(v,meta.data,meta.end),keys=kids.find(k=>k.type==='keys'),ilst=kids.find(k=>k.type==='ilst');if(!keys||!ilst)continue;
      const names:string[]=[];let p=keys.data+4;const n=u32(v,p);p+=4;
      for(let i=0;i<n&&p+8<=keys.end;i++){const sz=u32(v,p);names.push(new TextDecoder().decode(new Uint8Array(v.buffer,v.byteOffset+p+8,sz-8)));p+=sz;}
      const out:CameraMetadata={source:'file'};
      for(const item of walk(v,ilst.data,ilst.end)){
        const name=names[u32(v,item.data-4)-1]; // the item box type is the 1-based key index
        const data=walk(v,item.data,item.end).find(d=>d.type==='data');if(!data||!name)continue;
        const type=u32(v,data.data),bytes=new Uint8Array(v.buffer,v.byteOffset+data.data+8,data.end-data.data-8);
        const text=type===1?new TextDecoder().decode(bytes):'';
        if(name==='com.apple.quicktime.camera.lens_model')out.lensModel=text;
        if(name==='com.apple.quicktime.camera.focal_length.35mm_equivalent'){const f=type===1?Number(text):type===23&&bytes.length>=4?new DataView(bytes.buffer,bytes.byteOffset,4).getFloat32(0):NaN;if(Number.isFinite(f)&&f>8&&f<200)out.focal35mm=f;}
      }
      if(out.lensModel||out.focal35mm)return out;
    }
  }catch{/* unreadable metadata just means no prior from the file */}
  return {source:'none'};
}
export async function readCameraMetadata(file:Blob):Promise<CameraMetadata>{
  try{
    let p=0;
    while(p+8<=file.size){
      const head=new DataView(await file.slice(p,p+16).arrayBuffer());let size=head.getUint32(0),header=8;
      const type=String.fromCharCode(...new Uint8Array(head.buffer,4,4));if(size===1){size=Number(head.getBigUint64(8));header=16;}if(size===0)size=file.size-p;
      if(!Number.isSafeInteger(size)||size<header||p+size>file.size)return {source:'none'};
      if(type==='moov'){if(size>32*1024*1024)return {source:'none'};return parseCameraMetadata(await file.slice(p,p+size).arrayBuffer());}
      p+=size;
    }
  }catch{/* ignore */}
  return {source:'none'};
}

/**
 * Focal length in pixels along the image diagonal convention: f = diagonal_px × f35 / 43.27 (35 mm-equivalent focal length,
 * 43.27 mm = diagonal of a 36×24 mm frame). Phone video is often cropped by stabilisation, so the stated uncertainty is ±10 %.
 * Without file metadata the generic phone prior (long side × 0.74, ±12 %) applies.
 */
export function focalPrior(width:number,height:number,meta?:CameraMetadata|null):FocalPrior{
  const long=Math.max(width,height),diag=Math.hypot(width,height);
  if(meta?.focal35mm)return {px:diag*meta.focal35mm/43.27,relSigma:.10,basis:`檔案資訊：${meta.lensModel??'鏡頭'}，35 mm 等效焦距 ${meta.focal35mm} mm`};
  return {px:long*.74,relSigma:.12,basis:'檔案沒有鏡頭資訊：一般手機主鏡頭先驗'};
}
