// Ball-point labels the user confirms or corrects on the video. They live only in this browser (localStorage) and
// are never uploaded. "Export" produces a JSON file with coordinates and metadata only (no images): the format is the
// training/evaluation data for a future learned ball finder. Format: docs/BALL_LABELS.md.
import type {BallAnchor} from './pitchBallTracker';

export type LabelStatus='confirmed'|'corrected'|'no_ball';
export interface BallLabel{
  frame:number;
  /** Normalised position (0–1) of the ball in the video frame; absent for status "no_ball". */
  xNorm?:number;yNorm?:number;
  status:LabelStatus;
  /** What the program had on this frame when the label was made (null when it had nothing). */
  program?:{xNorm:number;yNorm:number;source:'observation'|'estimated'|'user'}|null;
  savedAt:string;
}
export interface LabelVideo{fileName:string;width:number;height:number;fps:number;frames:number;durationSec:number;timeBase:string}
export const LABEL_SCHEMA='pitchvision.ball-labels';
export const LABEL_SCHEMA_VERSION=1;

/** Same video → same key (file name, size, fps, frame count, duration). Different clips never share labels. */
export const labelsKey=(v:Pick<LabelVideo,'fileName'|'width'|'height'|'fps'|'frames'|'durationSec'>)=>
  `pitchvision.ballLabels.v1:${v.fileName}|${v.width}x${v.height}|${Number.isFinite(v.fps)?v.fps.toFixed(3):'?'}|${v.frames}|${Number.isFinite(v.durationSec)?v.durationSec.toFixed(3):'?'}`;

// Browser storage can be missing or blocked (private windows): every access is guarded and the app works without it.
export function loadLabels(key:string):BallLabel[]{
  try{
    const raw=window.localStorage.getItem(key);if(!raw)return [];
    const data=JSON.parse(raw);if(!Array.isArray(data))return [];
    return data.filter((l:any)=>l&&Number.isInteger(l.frame)&&['confirmed','corrected','no_ball'].includes(l.status)&&(l.status==='no_ball'||(Number.isFinite(l.xNorm)&&Number.isFinite(l.yNorm))));
  }catch{return [];}
}
export function saveLabels(key:string,labels:BallLabel[]){
  try{if(labels.length)window.localStorage.setItem(key,JSON.stringify(labels));else window.localStorage.removeItem(key);}catch{/* storage unavailable: labels stay in memory */}
}
/** Replace (or add) the label of one frame; keeps the list ordered by frame. */
export const upsertLabel=(labels:BallLabel[],next:BallLabel)=>[...labels.filter(l=>l.frame!==next.frame),next].sort((a,b)=>a.frame-b.frame);
export const removeLabel=(labels:BallLabel[],frame:number)=>labels.filter(l=>l.frame!==frame);

/** Confirmed and corrected labels become forced anchors when the video is analysed again. */
export const labelsToAnchors=(labels:BallLabel[]):BallAnchor[]=>labels.filter(l=>l.status!=='no_ball').map(l=>({frame:l.frame,xNorm:l.xNorm!,yNorm:l.yNorm!}));
export const labelsToNoBall=(labels:BallLabel[]):number[]=>labels.filter(l=>l.status==='no_ball').map(l=>l.frame);

export interface LabelExport{
  schema:typeof LABEL_SCHEMA;version:number;app:string;createdAt:string;
  video:LabelVideo;events:{releaseFrame:number|null;gloveFrame:number|null;releaseTimeSec:number|null;gloveTimeSec:number|null};
  coordinates:'normalised: x to the right, y downwards, both 0–1 over the whole (display-rotated) video frame';
  labels:{frame:number;timeSec:number|null;status:LabelStatus;xNorm:number|null;yNorm:number|null;xPx:number|null;yPx:number|null;program:BallLabel['program']}[];
}
export function buildLabelExport(video:LabelVideo,events:LabelExport['events'],labels:BallLabel[],times:readonly number[],appVersion:string):LabelExport{
  return {
    schema:LABEL_SCHEMA,version:LABEL_SCHEMA_VERSION,app:appVersion,createdAt:new Date().toISOString(),video,events,
    coordinates:'normalised: x to the right, y downwards, both 0–1 over the whole (display-rotated) video frame',
    labels:labels.map(l=>({
      frame:l.frame,timeSec:Number.isFinite(times[l.frame])?times[l.frame]:null,status:l.status,
      xNorm:l.status==='no_ball'?null:l.xNorm??null,yNorm:l.status==='no_ball'?null:l.yNorm??null,
      xPx:l.status==='no_ball'||l.xNorm===undefined?null:Math.round(l.xNorm*video.width*10)/10,
      yPx:l.status==='no_ball'||l.yNorm===undefined?null:Math.round(l.yNorm*video.height*10)/10,
      program:l.program??null
    }))
  };
}
/** Hands the JSON to the browser as a file download (nothing leaves the device unless the user shares the file). */
export function downloadLabelExport(data:LabelExport,fileName:string){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=fileName;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
