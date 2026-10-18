// Browser-side frame access for the pitch ball tracker (new module; the old tracker is untouched).
// Decodes exact source frames by index through seek + requestVideoFrameCallback verification and
// hands back RGBA at a working resolution (long side capped, never upscaled).

export interface FrameImage{index:number;time:number;width:number;height:number;data:Uint8ClampedArray;/** presentation time confirmed by the browser */verified:boolean;}
export interface FrameSource{
  /** Source (decoded, display-rotated) size and the working size used for pixels. */
  info:{sourceWidth:number;sourceHeight:number;width:number;height:number;scale:number};
  count:number;
  /** Accumulated time: waiting for the decoder to present the frame (seek+decode) and drawing/reading pixels (scale+copy). */
  timing:{seekDecodeMs:number;scaleCopyMs:number;frames:number};
  capture(index:number):Promise<FrameImage|null>;
  /** Frames first..last in order. Plays the clip once (much faster than one seek per frame) and falls back to seeking for any frame the browser skipped. */
  captureRange(first:number,last:number,onFrame?:(done:number,total:number)=>void):Promise<FrameImage[]>;
  dispose():void;
}
export interface FrameSourceOptions{
  /** Long side of the working image. Default 1280: 4K and 1080p sources are scaled down to it (measured: same accuracy as 1920, about 1.6x faster). */
  maxLongSide?:number;
  isCancelled?:()=>boolean;
  /** Seconds to wait for one frame to be presented. */
  frameTimeoutMs?:number;
}


/**
 * Measures how the browser's own media timeline relates to the parsed container times:
 * shows frame 0 and returns (presented time − times[0]). Chrome rebases clips with edit lists to 0,
 * other engines may keep the container time. Returns null when the browser cannot tell.
 */
export async function measureTimeBaseOffset(video:HTMLVideoElement,times:number[],timeoutMs=4000):Promise<number|null>{
  if(!('requestVideoFrameCallback' in video)||times.length<2)return null;
  return new Promise<number|null>(resolve=>{
    let handle:number|undefined;
    const timer=window.setTimeout(()=>{if(handle!==undefined)video.cancelVideoFrameCallback(handle);resolve(null);},timeoutMs);
    handle=video.requestVideoFrameCallback((_n,m)=>{window.clearTimeout(timer);resolve(m.mediaTime-times[0]);});
    video.currentTime=Math.max(0,Math.min((video.duration||times[0]+1)-1e-6,times[0]+0.0005));
  });
}

/** `times` must already be on the browser's media timeline (apply measureTimeBaseOffset first when it differs). */
export async function createVideoFrameSource(url:string,times:number[],options:FrameSourceOptions={}):Promise<FrameSource>{
  const maxLong=options.maxLongSide??1280,timeout=options.frameTimeoutMs??3000;
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.src=url;
  video.style.cssText='position:fixed;width:1px;height:1px;bottom:0;left:0;opacity:.01;pointer-events:none';video.setAttribute('aria-hidden','true');document.body.append(video);
  await new Promise<void>((ok,fail)=>{const t=setTimeout(()=>fail(Error('影片載入逾時')),15000);video.onloadeddata=()=>{clearTimeout(t);ok();};video.onerror=()=>{clearTimeout(t);fail(Error('影片無法解碼'));};});
  const sw=video.videoWidth,sh=video.videoHeight,scale=Math.min(1,maxLong/Math.max(sw,sh));
  const width=Math.max(1,Math.round(sw*scale)),height=Math.max(1,Math.round(sh*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas 不可用');
  const hasRvfc='requestVideoFrameCallback' in video;
  let lastMedia:number|undefined,onPresented:(()=>void)|undefined,presentations=0,handle:number|undefined;
  const watch=()=>{if(hasRvfc)handle=video.requestVideoFrameCallback((_n,m)=>{lastMedia=m.mediaTime;presentations++;onPresented?.();watch();});};
  watch();
  const timing={seekDecodeMs:0,scaleCopyMs:0,frames:0};
  const capture=async(index:number):Promise<FrameImage|null>=>{
    if(options.isCancelled?.())throw new DOMException('已取消','AbortError');
    const t=times[index];if(t===undefined)return null;const tA=performance.now();
    const span=(times[index+1]??video.duration)-t,tolerance=Math.min(.004,Math.max(.0001,span*.2));
    let verified=false;const presentationsBefore=presentations;
    try{
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>finish(Error('影格呈現確認逾時')),timeout);
        const finish=(error?:Error)=>{clearTimeout(timer);video.removeEventListener('seeked',check);video.removeEventListener('error',fail);onPresented=undefined;error?reject(error):resolve();};
        const check=()=>{if(!video.seeking&&video.readyState>=2&&(!hasRvfc||(lastMedia!==undefined&&Math.abs(lastMedia-t)<=tolerance&&presentations>presentationsBefore)))finish();};
        const fail=()=>finish(Error('影格解碼失敗'));
        video.addEventListener('seeked',check);video.addEventListener('error',fail);onPresented=check;
        if(hasRvfc&&lastMedia!==undefined&&Math.abs(lastMedia-t)<=tolerance&&video.currentTime>=t&&video.currentTime<t+span&&!video.seeking){presentations=presentationsBefore+1;check();}
        else video.currentTime=Math.min(video.duration-1e-6,t+Math.min(.0005,span/8));
      });
      verified=hasRvfc;
    }catch(error){if(options.isCancelled?.())throw error;return null;}
    const tB=performance.now();
    ctx.drawImage(video,0,0,width,height);
    const data=ctx.getImageData(0,0,width,height).data;
    timing.seekDecodeMs+=tB-tA;timing.scaleCopyMs+=performance.now()-tB;timing.frames++;
    return {index,time:t,width,height,data,verified};
  };
  const captureRange=async(first:number,last:number,onFrame?:(done:number,total:number)=>void):Promise<FrameImage[]>=>{
    const total=last-first+1,got=new Map<number,FrameImage>();
    if(hasRvfc&&total>=3){
      const tA=performance.now();
      const first0=await capture(first);if(first0){got.set(first,first0);onFrame?.(1,total);}
      // play once from the first frame; every presented frame is copied at presentation time
      await new Promise<void>(resolve=>{
        const span=(times[last]-times[first])+0.5,timer=window.setTimeout(()=>finish(),Math.max(2500,span*3000));
        let h:number|undefined,done=false;
        const finish=()=>{if(done)return;done=true;window.clearTimeout(timer);if(h!==undefined)video.cancelVideoFrameCallback(h);video.pause();resolve();};
        const cb=(_n:number,m:VideoFrameCallbackMetadata)=>{
          if(done)return;
          // nearest source index to the presented time
          let idx=-1,best=Infinity;for(let i=first;i<=last;i++){const d=Math.abs(times[i]-m.mediaTime);if(d<best){best=d;idx=i;}}
          const span1=(times[Math.min(times.length-1,idx+1)]-times[idx])||(1/30);
          if(idx>=0&&best<=Math.max(.0004,span1*.25)&&!got.has(idx)){
            const t1=performance.now();ctx.drawImage(video,0,0,width,height);
            const data=ctx.getImageData(0,0,width,height).data;
            timing.scaleCopyMs+=performance.now()-t1;timing.frames++;
            got.set(idx,{index:idx,time:times[idx],width,height,data,verified:true});onFrame?.(got.size,total);
          }
          if(got.size>=total||m.mediaTime>=times[last]+1e-4)finish();else h=video.requestVideoFrameCallback(cb);
        };
        h=video.requestVideoFrameCallback(cb);
        video.playbackRate=1;video.play().catch(()=>finish());
      });
      timing.seekDecodeMs+=performance.now()-tA;
    }
    for(let i=first;i<=last;i++){ // anything missed (or no rVFC): seek for it
      if(got.has(i))continue;const f=await capture(i);if(f)got.set(i,f);onFrame?.(got.size,total);
    }
    return Array.from({length:total},(_,k)=>got.get(first+k)).filter((f):f is FrameImage=>Boolean(f));
  };
  return {info:{sourceWidth:sw,sourceHeight:sh,width,height,scale},count:times.length,timing,capture,captureRange,dispose:()=>{if(handle!==undefined)video.cancelVideoFrameCallback?.(handle);video.pause();video.removeAttribute('src');video.load();video.remove();canvas.width=canvas.height=0;}};
}
