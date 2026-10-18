import {TimePosition} from './analysisTimeline';
import {PixelFrame,InterpolationQuality} from './motionInterpolation';
/** Preview frames are at most this many pixels on the long side. */
export const PREVIEW_LONG_SIDE=1920;
interface Captured extends PixelFrame { mediaTime?:number; index:number }
export interface PreviewFrame extends PixelFrame {quality:InterpolationQuality; sourceMediaTimes:(number|undefined)[]; sourceIndices:number[];changedA:number;changedB:number;motionWidth:number;motionHeight:number;estimateMs:number;synthesisMs:number}

export class LocalFrameInterpolation {
  private video:HTMLVideoElement;
  private ready:Promise<void>;
  private worker:Worker;
  private frames=new Map<number,Captured>();
  private workerPair='';
  private sequence=0;
  private latestRequest=0;
  private disposed=false;
  private workerFailed=false;
  private queue:Promise<unknown>=Promise.resolve();
  private rejectPending:((e:Error)=>void)|null=null;
  constructor(url:string,private times:readonly number[]){
    this.worker=this.createWorker();
    this.video=document.createElement('video');
    this.video.muted=true;this.video.playsInline=true;this.video.preload='auto';this.video.setAttribute('aria-hidden','true');
    // A compositor-backed local decoder; it never changes the visible player's position.
    this.video.style.cssText='position:fixed;width:1px;height:1px;bottom:0;left:0;opacity:0.01;pointer-events:none';document.body.append(this.video);
    this.ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(new Error('局部解碼初始化逾時')),5000);
      const finish=(error?:Error)=>{clearTimeout(timer);this.video.removeEventListener('loadeddata',done);this.video.removeEventListener('error',fail);error?reject(error):resolve();};
      const done=()=>finish(),fail=()=>finish(new Error('瀏覽器無法解碼相鄰來源影格'));
      this.video.addEventListener('loadeddata',done);this.video.addEventListener('error',fail);this.video.src=url;this.video.load();
    });
    // Prevent an unused initialization rejection from becoming an unhandled page error.
    this.ready.catch(()=>{});
  }
  private createWorker(){
    const worker=new Worker(new URL('./frameInterpolation.worker.ts',import.meta.url),{type:'module'});
    worker.addEventListener('error',e=>{e.preventDefault();this.workerFailed=true;this.workerPair='';this.rejectPending?.(new Error('補幀Worker無法使用；請使用原始模式'));});
    return worker;
  }
  private async capture(index:number):Promise<Captured>{
    if(this.frames.has(index)){const f=this.frames.get(index)!;this.frames.delete(index);this.frames.set(index,f);return f;}
    await this.ready;if(this.disposed)throw Error('影片已更換');
    const v=this.video,t=this.times[index],span=(this.times[index+1]??v.duration)-t;
    let mediaTime:number|undefined;
    await new Promise<void>((resolve,reject)=>{
      let sought=false,presented=false,callback:number|undefined,fallback:ReturnType<typeof setTimeout>|undefined;
      const timer=setTimeout(()=>finish(new Error('相鄰原始影格定位逾時')),2500);
      const finish=(error?:Error)=>{clearTimeout(timer);clearTimeout(fallback);v.removeEventListener('seeked',seeked);v.removeEventListener('error',fail);if(callback!==undefined)v.cancelVideoFrameCallback?.(callback);error?reject(error):resolve();};
      const seeked=()=>{sought=true;if(presented)finish();else fallback=setTimeout(()=>finish(),350);};
      const fail=()=>finish(new Error('相鄰來源影格解碼失敗'));
      v.addEventListener('seeked',seeked);v.addEventListener('error',fail);
      if('requestVideoFrameCallback' in v)callback=v.requestVideoFrameCallback((_now,meta)=>{mediaTime=meta.mediaTime;presented=true;if(sought)finish();});
      v.currentTime=Math.min(v.duration-1e-6,Math.max(0,t+Math.min(0.0005,span/8)));
    });
    if(this.disposed)throw Error('影片已更換');
    // No compositor metadata means seek precision cannot be independently verified.
    if(mediaTime!==undefined && Math.abs(mediaTime-t)>Math.max(0.004,span*0.2))throw Error('瀏覽器呈現時刻與指定原始PTS不符，停止補幀；可退回原始模式');
    await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
    // Large sources (e.g. iPhone 4K, ~8.3 MP) are scaled to a long side of about 1920 first. The result is a visual
    // preview only; the original frames are untouched and the preview is never an observation.
    const k=Math.min(1,PREVIEW_LONG_SIDE/Math.max(v.videoWidth,v.videoHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(v.videoWidth*k));canvas.height=Math.max(1,Math.round(v.videoHeight*k));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('無法讀取局部影像');ctx.drawImage(v,0,0,canvas.width,canvas.height);
    const frame={width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data,index,mediaTime};
    this.frames.set(index,frame);while(this.frames.size>2&&([...this.frames.values()].reduce((n,f)=>n+f.data.byteLength,0)>32*1024*1024||this.frames.size>4))this.frames.delete(this.frames.keys().next().value!);return frame;
  }
  preview(point:TimePosition):Promise<PreviewFrame>{
    const request=++this.latestRequest;
    const run=async()=>{
      if(request!==this.latestRequest)throw Error('已略過較舊的時間位置');
      if(this.disposed)throw Error('影片已更換');
      if(this.workerFailed)throw Error('補幀Worker無法使用；請使用原始模式');
      const a=await this.capture(point.left),b=await this.capture(point.right),key=`${point.left}:${point.right}`;
      if(request!==this.latestRequest)throw Error('已略過較舊的時間位置');
      const result=await new Promise<PreviewFrame>((resolve,reject)=>{
        const id=++this.sequence;
        let settled=false;
        const timer=setTimeout(()=>{this.workerPair='';this.worker.terminate();if(!this.disposed){this.workerFailed=false;this.worker=this.createWorker();}finish(new Error('補幀運算逾時；原始模式仍可使用'));},8000);
        const finish=(error?:Error,data?:PreviewFrame)=>{if(settled)return;settled=true;clearTimeout(timer);this.rejectPending=null;this.worker.onmessage=null;this.worker.onerror=null;error?reject(error):resolve(data!);};
        this.rejectPending=error=>finish(error);
        this.worker.onmessage=({data})=>{if(data.id!==id)return;if(data.error){this.workerPair='';finish(new Error(data.error));return;}this.workerPair=key;finish(undefined,{width:data.width,height:data.height,data:data.pixels,quality:data.quality,sourceMediaTimes:[a.mediaTime,b.mediaTime],sourceIndices:[point.left,point.right],changedA:data.changedA,changedB:data.changedB,motionWidth:data.motionWidth,motionHeight:data.motionHeight,estimateMs:data.estimateMs,synthesisMs:data.synthesisMs});};
        this.worker.onerror=()=>{this.workerPair='';finish(new Error('補幀Worker無法使用；請使用原始模式'));};
        const message:any={id,key,alpha:point.alpha};const transfer:Transferable[]=[];
        if(this.workerPair!==key){message.a={width:a.width,height:a.height,data:a.data.slice()};message.b={width:b.width,height:b.height,data:b.data.slice()};transfer.push(message.a.data.buffer,message.b.data.buffer);}
        this.worker.postMessage(message,transfer);
      });
      if(a.mediaTime===undefined||b.mediaTime===undefined){result.quality={...result.quality,level:'low',note:result.quality.note+' 瀏覽器未回報兩個來源的呈現時刻，解碼定位未獨立確認。'};}
      return result;
    };
    const pending=this.queue.then(run,run);this.queue=pending.catch(()=>{});return pending;
  }
  invalidate(){this.latestRequest++;}
  dispose(){this.disposed=true;this.rejectPending?.(new Error('影片已更換'));this.worker.terminate();this.frames.clear();this.video.pause();this.video.removeAttribute('src');this.video.load();this.video.remove();}
}
