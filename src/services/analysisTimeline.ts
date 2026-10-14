export type PositionKind = 'original' | 'interpolated' | 'cfr_assumed';
export interface TimePosition {
  timeSec: number;
  kind: PositionKind;
  left: number;
  right: number;
  alpha: number;
}
export interface SelectedEvent extends TimePosition {
  selectionType?: 'original' | 'interpolated' | 'media_time' | 'cfr_assumed';
  timelineIndex?: number;
  previewQuality?: 'limited' | 'low' | 'unavailable';
  sourceSpanSec: number;
}
export interface SelectedEvents { release: SelectedEvent | null; glove: SelectedEvent | null }

export interface AnalysisTimeline {length:number;get:(index:number)=>TimePosition;nearest:(time:number)=>number}
// Fine-operation positions are a regular 90 Hz grid. Original PTS remain separately
// available in source mode; never insert originals into this grid's step count.
export function createFineGridTimeline(times:readonly number[],fps:number,assumed=false):AnalysisTimeline {
  if(times.length<2||fps>=90-0.001)return createAnalysisTimeline(times,fps,false,assumed);
  const first=times[0],last=times.at(-1)!,length=Math.floor((last-first)*90+1e-8)+1;
  if(!Number.isSafeInteger(length)||length>2_000_000_000)throw Error('時間軸超出支援範圍；請使用原始影格');
  return {length,get:i=>describePosition(times,first+Math.max(0,Math.min(length-1,Math.round(i)))/90,assumed),nearest:t=>Math.max(0,Math.min(length-1,Math.round((t-first)*90)))};
}
export function createAnalysisTimeline(times:readonly number[],fps:number,fine:boolean,assumed=false):AnalysisTimeline {
  if(!times.length)return{length:0,get:()=>({timeSec:0,kind:'cfr_assumed',left:0,right:0,alpha:0}),nearest:()=>0};
  const source=(i:number)=>({timeSec:times[i],kind:assumed?'cfr_assumed' as const:'original' as const,left:i,right:i,alpha:0});
  const lower=(a:ArrayLike<number>,x:number)=>{let lo=0,hi=a.length;while(lo<hi){const mid=(lo+hi)>>1;if(a[mid]<x)lo=mid+1;else hi=mid;}return lo;};
  const nearestSource=(t:number)=>{const i=Math.min(times.length-1,lower(times,t));return i>0&&Math.abs(times[i-1]-t)<Math.abs(times[i]-t)?i-1:i;};
  if(!fine||fps>=90-0.001||times.length<2)return{length:times.length,get:source,nearest:nearestSource};
  const first=times[0],last=times.at(-1)!,gridCount=Math.floor((last-first)*90)+1;
  if(!Number.isSafeInteger(gridCount)||gridCount+times.length>2_000_000_000)throw Error('時間軸長度超出支援範圍，請使用原始模式');
  const sourceMerged=new Int32Array(times.length),coincident:number[]=[];
  for(let i=0;i<times.length;i++){
    const k=(times[i]-first)*90;
    sourceMerged[i]=i+Math.max(0,Math.min(gridCount,Math.ceil(k-9e-6)))-coincident.length;
    if(Math.abs(k-Math.round(k))<9e-6)coincident.push(times[i]);
  }
  const gridTime=(k:number)=>first+k/90;
  const gridMerged=(k:number)=>{const t=gridTime(k);return k+lower(times,t-1e-7)-lower(coincident,t-1e-7);};
  const get=(index:number)=>{
    const src=lower(sourceMerged,index);if(src<sourceMerged.length&&sourceMerged[src]===index)return source(src);
    let lo=0,hi=gridCount-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(gridMerged(mid)<=index)lo=mid;else hi=mid-1;}
    return describePosition(times,gridTime(lo),assumed);
  };
  return{length:times.length+gridCount-coincident.length,get,nearest:(t:number)=>{
    const src=nearestSource(t),k=Math.max(0,Math.min(gridCount-1,Math.round((t-first)*90)));
    return Math.abs(times[src]-t)<=Math.abs(gridTime(k)-t)?sourceMerged[src]:gridMerged(k);
  }};
}

export function sourceIndexAt(times: readonly number[], time: number): number {
  let lo=0,hi=times.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(times[mid]<=time+1e-8)lo=mid;else hi=mid-1;}
  return Math.max(0,lo);
}
export function describePosition(times: readonly number[], time: number, assumed=false): TimePosition {
  const left=sourceIndexAt(times,time);
  if(Math.abs(times[left]-time)<1e-7 || left===times.length-1) return {timeSec:times[left],kind:assumed?'cfr_assumed':'original',left,right:left,alpha:0};
  const right=left+1;
  if(Math.abs(times[right]-time)<1e-7)return {timeSec:times[right],kind:assumed?'cfr_assumed':'original',left:right,right,alpha:0};
  return {timeSec:time,kind:'interpolated',left,right,alpha:(time-times[left])/(times[right]-times[left])};
}
export function buildAnalysisTimeline(times: readonly number[], fps: number, fine: boolean, assumed=false): TimePosition[] {
  if(!times.length)return [];
  if(!fine||fps>=90-0.001)return times.map((t,i)=>({timeSec:t,kind:assumed?'cfr_assumed':'original',left:i,right:i,alpha:0}));
  // Union: a 90 Hz grid AND every original PTS, never replace/downsample the source.
  const grid:number[]=[];
  const first=times[0],last=times.at(-1)!;
  if((last-first)*90>600000)throw Error('精細時間軸過長，請選取較短片段；原始模式仍可使用');
  for(let k=0;k<=Math.floor((last-first)*90);k++)grid.push(first+k/90);
  const merged=[...times,...grid].sort((a,b)=>a-b).filter((t,i,a)=>!i||Math.abs(t-a[i-1])>1e-7);
  return merged.map(t=>describePosition(times,t,assumed));
}
export function nearestPositionIndex(points: readonly TimePosition[],time:number): number {
  if(!points.length)return 0;
  let lo=0,hi=points.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(points[mid].timeSec<time)lo=mid+1;else hi=mid;}
  return lo>0&&Math.abs(points[lo-1].timeSec-time)<Math.abs(points[lo].timeSec-time)?lo-1:lo;
}
export function selectEvent(point:TimePosition,times:readonly number[],quality?:SelectedEvent['previewQuality']):SelectedEvent {
  const left=point.left,right=point.right;
  const span=right>left?times[right]-times[left]:Math.max(times[left]-times[Math.max(0,left-1)],(times[Math.min(times.length-1,left+1)]??times[left])-times[left]);
  return {...point,previewQuality:quality,sourceSpanSec:span};
}
export function eventAnalysisView(times:readonly number[],events:SelectedEvents,durationSec?:number){
  if(!events.release||!events.glove||!Number.isFinite(events.release.timeSec)||!Number.isFinite(events.glove.timeSec)||events.glove.timeSec<=events.release.timeSec)throw Error('請設定進手套晚於出手的兩個有效事件時間');
  const mediaSlots=()=>{
    const bridge=[events.release!.timeSec,events.glove!.timeSec];
    return {releaseFrame:0,gloveFrame:1,timestamps:bridge,engineTimingBridge:bridge,sourceTimestamps:times,eventTimes:{releaseTimeSec:bridge[0],gloveTimeSec:bridge[1]},flightSeconds:bridge[1]-bridge[0],eventOnly:true};
  };
  if(durationSec!==undefined){
    if(!Number.isFinite(durationSec)||durationSec<=0||events.release.timeSec<0||events.glove.timeSec>durationSec)throw Error('事件時間超出影片可用範圍');
    const usable=times.length>=2&&times.every((t,i)=>Number.isFinite(t)&&t>=0&&(!i||t>times[i-1]));
    if(!usable||events.release.timeSec<times[0]||events.glove.timeSec>times.at(-1)!){
      // Legacy event slots, NOT decoded frames, source PTS, or observations.
      return mediaSlots();
    }
  }
  try {
  if(times.length<2||times.some((t,i)=>!Number.isFinite(t)||t<0||(i>0&&t<=times[i-1])))throw Error('來源PTS無效');
  for(const event of [events.release,events.glove]){
    if(!Number.isFinite(event.timeSec)||event.timeSec<times[0]||event.timeSec>times.at(-1)!)throw Error('事件時間超出來源範圍');
    const canonical=describePosition(times,event.timeSec,event.kind==='cfr_assumed');
    if(canonical.left!==event.left||canonical.right!==event.right)throw Error('事件時間與來源支持影格不一致');
  }
  const releaseFrame=events.release.left;
  // Keep original interval counts for uncertainty; do not count the right support image as a new sample.
  const gloveFrame=events.glove.left>releaseFrame?events.glove.left:events.glove.right;
  if(gloveFrame<=releaseFrame)throw Error('事件區間沒有足夠來源時間位置');
  const timestamps=[...times];
  // Only event interface slots change; this array is NEVER decoded or used as observation samples.
  timestamps[releaseFrame]=events.release.timeSec;
  timestamps[gloveFrame]=events.glove.timeSec;
  if(timestamps.some((t,i)=>i>0&&t<=timestamps[i-1]))throw Error('舊引擎事件時間橋不單調，停止傳遞錯誤時間');
  // This bridge supplies event slots to the unchanged legacy model only. It is
  // not an observed/source timeline and must never reach video decoding/tracking.
  return {releaseFrame,gloveFrame,timestamps,engineTimingBridge:timestamps,sourceTimestamps:times,eventTimes:{releaseTimeSec:events.release.timeSec,gloveTimeSec:events.glove.timeSec},flightSeconds:events.glove.timeSec-events.release.timeSec,eventOnly:false};
  } catch(error) {
    // Valid media events remain usable even if legacy source-index mapping fails.
    if(durationSec!==undefined)return mediaSlots();
    throw error;
  }
}
