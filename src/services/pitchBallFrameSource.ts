// Browser-side frame access for the pitch ball tracker (new module; the old tracker is untouched).
// Decodes exact source frames by index through seek + requestVideoFrameCallback verification and
// hands back RGBA at a working resolution (long side capped, never upscaled).

export interface FrameImage{index:number;time:number;width:number;height:number;data:Uint8ClampedArray;/** presentation time confirmed by the browser */verified:boolean;}
export interface FrameSource{
  /** Source (decoded, display-rotated) size and the working size used for pixels. */
  info:{sourceWidth:number;sourceHeight:number;width:number;height:number;scale:number};
  count:number;
  capture(index:number):Promise<FrameImage|null>;
  dispose():void;
}
export interface FrameSourceOptions{
  /** Long side of the working image. Default 1920. */
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
  const maxLong=options.maxLongSide??1920,timeout=options.frameTimeoutMs??3000;
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.src=url;
  video.style.cssText='position:fixed;width:1px;height:1px;bottom:0;left:0;opacity:.01;pointer-events:none';video.setAttribute('aria-hidden','true');document.body.append(video);
  await new Promise<void>((ok,fail)=>{const t=setTimeout(()=>fail(Error('影片載入逾時')),15000);video.onloadeddata=()=>{clearTimeout(t);ok();};video.onerror=()=>{clearTimeout(t);fail(Error('影片無法解碼'));};});
  const sw=video.videoWidth,sh=video.videoHeight,scale=Math.min(1,maxLong/Math.max(sw,sh));
  const width=Math.max(1,Math.round(sw*scale)),height=Math.max(1,Math.round(sh*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas 不可用');
  const hasRvfc='requestVideoFrameCallback' in video;
  let lastMedia:number|undefined,onPresented:(()=>void)|undefined,lastShown=-Infinity,handle:number|undefined;
  const watch=()=>{if(hasRvfc)handle=video.requestVideoFrameCallback((_n,m)=>{lastMedia=m.mediaTime;onPresented?.();watch();});};
  watch();
  const capture=async(index:number):Promise<FrameImage|null>=>{
    if(options.isCancelled?.())throw new DOMException('已取消','AbortError');
    const t=times[index];if(t===undefined)return null;
    const span=(times[index+1]??video.duration)-t,tolerance=Math.min(.004,Math.max(.0001,span*.2));
    let verified=false;
    try{
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>finish(Error('影格呈現確認逾時')),timeout);
        const finish=(error?:Error)=>{clearTimeout(timer);video.removeEventListener('seeked',check);video.removeEventListener('error',fail);onPresented=undefined;error?reject(error):resolve();};
        const check=()=>{if(!video.seeking&&video.readyState>=2&&(!hasRvfc||(lastMedia!==undefined&&Math.abs(lastMedia-t)<=tolerance&&lastMedia>lastShown)))finish();};
        const fail=()=>finish(Error('影格解碼失敗'));
        video.addEventListener('seeked',check);video.addEventListener('error',fail);onPresented=check;
        if(hasRvfc&&lastMedia!==undefined&&Math.abs(lastMedia-t)<=tolerance&&video.currentTime>=t&&video.currentTime<t+span&&!video.seeking&&lastMedia>lastShown)check();
        else video.currentTime=Math.min(video.duration-1e-6,t+Math.min(.0005,span/8));
      });
      verified=hasRvfc;if(hasRvfc)lastShown=lastMedia!;
    }catch(error){if(options.isCancelled?.())throw error;return null;}
    ctx.drawImage(video,0,0,width,height);
    return {index,time:t,width,height,data:ctx.getImageData(0,0,width,height).data,verified};
  };
  return {info:{sourceWidth:sw,sourceHeight:sh,width,height,scale},count:times.length,capture,dispose:()=>{if(handle!==undefined)video.cancelVideoFrameCallback?.(handle);video.pause();video.removeAttribute('src');video.load();video.remove();canvas.width=canvas.height=0;}};
}
