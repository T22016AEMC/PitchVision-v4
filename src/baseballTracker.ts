import {VideoTimingService} from './services/videoTimingService';
import {detectBallCandidatesCooperatively, BallVisualCandidate} from './services/ballCandidateDetector';
import {RobustTemporalTracker} from './services/robustTemporalTracker';
import {assessTrackEvidence} from './services/trackEvidence';
import {BallObservation,ManualAnchorInput} from './types';

export interface SparseTrackingOptions {
 releaseFrame:number;visibleEndFrame?:number;catchFrame?:number|null;fps:number;timestamps?:number[];
 releaseTimeSec?:number;catchTimeSec?:number;cameraView:'catcher'|'pitcher_rear';manualAnchor?:ManualAnchorInput;
 searchPrior?:(time:number,x:number,y:number)=>number;
 isCancelled?:()=>boolean;
 onProgress?:(pct:number,frame:number,text:string)=>void;
}
export interface SparseTrackingResult {
 observations:BallObservation[];visibleEndFrame:number;firstSeenFrame:number;lastSeenFrame:number;
 status:'reliable'|'sparse'|'insufficient_evidence';statusMessage:string;
}

/** Stream three decoded originals, retain only small candidate lists. Never decode
 * event-bridge/90Hz slots as source images or emit motion predictions as observations. */
export async function trackBaseballSparse(source:HTMLVideoElement,o:SparseTrackingOptions):Promise<SparseTrackingResult>{
 const times=o.timestamps??[],start=o.releaseTimeSec??times[o.releaseFrame],end=o.catchTimeSec??times[o.catchFrame??o.visibleEndFrame??o.releaseFrame];
 const empty=(message:string):SparseTrackingResult=>({observations:[],visibleEndFrame:o.catchFrame??o.releaseFrame,firstSeenFrame:o.releaseFrame,lastSeenFrame:o.releaseFrame,status:'insufficient_evidence',statusMessage:message});
 if(times.length<2||times.some((t,i)=>!Number.isFinite(t)||i>0&&t<=times[i-1])||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return empty('無可枚舉的原始PTS；保留手動時間／球速分析。');
 const indices=times.map((t,frame)=>({t,frame})).filter(p=>p.t>=start&&p.t<=end);
 if(!indices.length)return empty('選定區間沒有來源影格；保留手動分析。');
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
 video.style.cssText='position:fixed;width:1px;height:1px;bottom:0;left:0;opacity:.01;pointer-events:none';video.setAttribute('aria-hidden','true');document.body.append(video);
 const cancel=()=>{if(o.isCancelled?.())throw new DOMException('分析設定已變更','AbortError');};
 const canvas=document.createElement('canvas');
 const scale=Math.min(1,1280/Math.max(source.videoWidth,source.videoHeight));
 canvas.width=Math.max(1,Math.round(source.videoWidth*scale));canvas.height=Math.max(1,Math.round(source.videoHeight*scale));
 const lists:{frame:number;timestamp:number;candidates:BallVisualCandidate[]}[]=[];
 type Image={frame:number;timestamp:number;data:Uint8ClampedArray};
 let lastPresented=-Infinity,unverified=0,failed=0,scanned=0;
 try{
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>finish(Error('追蹤解碼初始化逾時')),5000);const finish=(e?:Error)=>{clearTimeout(timer);video.onloadeddata=null;video.onerror=null;e?reject(e):resolve();};video.onloadeddata=()=>finish();video.onerror=()=>finish(Error('追蹤解碼不可用'));video.src=source.currentSrc||source.src;video.load();});
  const capture=async(index:number):Promise<Image|null>=>{
   cancel();const {frame,t}=indices[index];scanned++;
   if(!('requestVideoFrameCallback' in video)){unverified++;return null;}
   let callback:number|undefined,timer:ReturnType<typeof setTimeout>|undefined;
   let finish!:(value:number|undefined)=>void;
   const presented=new Promise<number|undefined>(resolve=>{finish=resolve;callback=video.requestVideoFrameCallback((_now,meta)=>resolve(meta.mediaTime));timer=setTimeout(()=>resolve(undefined),450);});
   try{
    await VideoTimingService.seekAndCaptureFrame(video,frame,o.fps,undefined,t);
    const media=await presented;cancel();const span=(times[frame+1]??video.duration)-t;
    if(media===undefined||Math.abs(media-t)>Math.max(.002,span*.2)||media<=lastPresented){unverified++;return null;}
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('追蹤Canvas不可用');
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    lastPresented=media;failed=0;return{frame,timestamp:t,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
   }catch(error){if(o.isCancelled?.())throw error;failed++;unverified++;return null;}
   finally{finish(undefined);clearTimeout(timer);if(callback!==undefined)video.cancelVideoFrameCallback(callback);}
  };
  let prev:Image|null=null,current=await capture(0),next=indices.length>1?await capture(1):null;
  for(let i=0;i<indices.length;i++){
   cancel();if(failed>=3)break;
   if(current){
    const candidates=await detectBallCandidatesCooperatively(current.data,prev?.data??null,next?.data??null,{width:canvas.width,height:canvas.height,actualFps:o.fps,currentFrame:current.frame},o.isCancelled);
    lists.push({frame:current.frame,timestamp:current.timestamp,candidates});
   }else lists.push({frame:indices[i].frame,timestamp:indices[i].t,candidates:[]});
   o.onProgress?.(Math.round((i+1)/indices.length*85),indices[i].frame,`逐格視覺搜尋 ${i+1}/${indices.length}（${canvas.width}×${canvas.height}，三張緩衝）`);
   prev=current;current=next;next=i+2<indices.length?await capture(i+2):null;
   await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  const hint=(time:number,x:number,y:number)=>{
   const db=o.searchPrior?.(time,x,y)??0,a=o.manualAnchor?.point1,b=o.manualAnchor?.point2;
   if(!a||!b||![a.x_norm,a.y_norm,b.x_norm,b.y_norm,times[a.frame],times[b.frame]].every(Number.isFinite)||times[b.frame]<=times[a.frame])return db;
   const t=Math.max(0,Math.min(1,(time-times[a.frame])/(times[b.frame]-times[a.frame])));
   // Existing manual coordinates guide image association only, never become points.
   return .5*db+.5*Math.exp(-Math.hypot(x-a.x_norm-(b.x_norm-a.x_norm)*t,y-a.y_norm-(b.y_norm-a.y_norm)*t)/.12);
  };
  const observations=RobustTemporalTracker.associateCandidates(lists,hint);
  for(const p of observations){p.x=p.x_norm*source.videoWidth;p.y=p.y_norm*source.videoHeight;p.radius/=scale;}
  const evidence=assessTrackEvidence(observations,o.fps),coverage=observations.length/indices.length;
  const reliable=evidence.valid&&coverage>=.4&&evidence.duration>=(end-start)*.35;
  const message=`視覺候選 ${observations.length}/${indices.length}；已嘗試 ${scanned} 張；未確認呈現／解碼 ${unverified} 張。${reliable?'時序閘門通過，球體身份仍待確認':`證據不足或不完整：${evidence.reasons.join('、')||'區間覆蓋不足'}；保留手動匹配`}。非神經網路辨識，不產生假觀測。`;
  o.onProgress?.(100,indices.at(-1)!.frame,message);
  return{observations,visibleEndFrame:observations.at(-1)?.frame??indices.at(-1)!.frame,firstSeenFrame:observations[0]?.frame??indices[0].frame,lastSeenFrame:observations.at(-1)?.frame??indices[0].frame,status:reliable?'reliable':observations.length?'sparse':'insufficient_evidence',statusMessage:message};
 }finally{video.pause();video.removeAttribute('src');video.load();video.remove();canvas.width=canvas.height=0;}
}
