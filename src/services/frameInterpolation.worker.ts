import {estimateMotionPair,renderMotionIntermediate,MotionPair} from './motionInterpolation';
const scope=self as unknown as {onmessage:(e:MessageEvent)=>void;postMessage:(data:unknown,transfer:Transferable[])=>void};
let pair:MotionPair|null=null,key='';
scope.onmessage=({data})=>{
  try{
    const start=performance.now();
    if(data.a&&data.b){pair=estimateMotionPair(data.a,data.b);key=data.key;}
    if(!pair||data.key!==key)throw Error('來源影格已更換');
    const estimated=performance.now();
    const pixels=renderMotionIntermediate(pair,data.alpha);
    const rendered=performance.now();
    let changedA=0,changedB=0;
    for(let i=0;i<pixels.length;i+=4){if(pixels[i]!==pair.a.data[i]||pixels[i+1]!==pair.a.data[i+1]||pixels[i+2]!==pair.a.data[i+2])changedA++;if(pixels[i]!==pair.b.data[i]||pixels[i+1]!==pair.b.data[i+1]||pixels[i+2]!==pair.b.data[i+2])changedB++;}
    scope.postMessage({id:data.id,width:pair.a.width,height:pair.a.height,pixels,quality:pair.quality,changedA,changedB,motionWidth:pair.motionWidth,motionHeight:pair.motionHeight,estimateMs:estimated-start,synthesisMs:rendered-estimated},[pixels.buffer]);
  }catch(error){scope.postMessage({id:data.id,error:error instanceof Error?error.message:'插值失敗'},[]);}
};
