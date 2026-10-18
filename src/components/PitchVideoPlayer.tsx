import {sourceFps,formatSourceFps} from '../services/sourceTiming';
import React,{useRef,useState,useEffect,useMemo,ReactNode} from 'react';
import {Play,Pause,Video,ChevronLeft,ChevronRight,X,MoreHorizontal} from 'lucide-react';
import {CameraViewMode,VideoTiming,SpatialCalibrationInfo} from '../types';
import {TimePosition,SelectedEvent,SelectedEvents,createAnalysisTimeline,createFineGridTimeline,selectEvent,sourceIndexAt} from '../services/analysisTimeline';
import {resolvePlayerTiming,eventDescription,flightTimeDescription} from './playerControls';
import {LocalFrameInterpolation,PreviewFrame} from '../services/localFrameInterpolation';

interface PitchVideoPlayerProps {
 videoUrl:string|null;releaseFrame:number;gloveFrame:number;totalFrames:number;fps?:number;timestamps?:number[];sourceTiming?:VideoTiming|null;events:SelectedEvents;selectionOnly?:boolean;timestampsArePreviewPositions?:boolean;
 isFpsEstimated?:boolean;viewMode:CameraViewMode;velocityKmh?:number;pitchName?:string;hasAnalyzed?:boolean;busy?:boolean;
 onCurrentFrameChange?:(frame:number)=>void;onPositionChange?:(point:TimePosition)=>void;targetFrameSeek?:number|null;onSetEvent:(name:'release'|'glove',event:SelectedEvent)=>void;
 spatialCalibration?:SpatialCalibrationInfo;onVideoElementReady?:(el:HTMLVideoElement|null)=>void;isSelectingPoint?:1|2|null;onSelectCoordinate?:(x:number,y:number)=>void;
 /** Points the user tapped / labelled on the CURRENT frame. */
 markers?:PointMarker[];
 variant?:'fullscreen'|'inline'|'compact';overlay?:{observed:OverlayPoint[];estimated:OverlayPoint[]}|null;
 twoD?:ReactNode;showTwoD?:boolean;viewToggle?:ReactNode;menuExtra?:ReactNode;onBack?:()=>void;onNext?:()=>void;onShowVideo?:()=>void;
 assist?:{text:string;count:number;min:number;max:number;onSkip:()=>void;onNoBall:()=>void;onDone:()=>void}|null;
 /** Ball-point confirmation: the program's point on this frame, the user's label on it, and the actions. */
 confirm?:{program:{xNorm:number;yNorm:number;source:'observation'|'estimated'|'user'}|null;label:{xNorm:number;yNorm:number;kind:'confirmed'|'corrected'|'no_ball'}|null;onConfirm:()=>void;onNoBall:()=>void;onMove:(xNorm:number,yNorm:number)=>void;onClear:()=>void}|null;
 /** Called once per video with (browser's presented time of frame 0) − (container time of frame 0), when they differ. */
 onTimeBaseOffset?:(offsetSec:number)=>void;
}
export interface PointMarker{xNorm:number;yNorm:number;kind:'tap'|'confirmed'|'corrected'|'no_ball';}
/** A ball position found by the program on one source frame (display only; never fed back into the engine). */
export interface OverlayPoint{frame:number;timestamp:number;x_norm:number;y_norm:number;}
export function PitchVideoPlayer({onShowVideo,videoUrl,releaseFrame,gloveFrame,totalFrames,fps:providedFps=NaN,timestamps:providedTimes=[],sourceTiming,events,selectionOnly=false,timestampsArePreviewPositions=false,viewMode,busy=false,onCurrentFrameChange,onPositionChange,targetFrameSeek,onSetEvent,onVideoElementReady,isSelectingPoint=null,onSelectCoordinate,markers=[],variant='inline',overlay=null,twoD,showTwoD=false,viewToggle,menuExtra,onBack,onNext,assist=null,confirm=null,onTimeBaseOffset}:PitchVideoPlayerProps){
 const videoRef=useRef<HTMLVideoElement|null>(null),previewCanvas=useRef<HTMLCanvasElement|null>(null),session=useRef<LocalFrameInterpolation|null>(null),request=useRef(0);
 const [isPlaying,setIsPlaying]=useState(false),[isMetadataReady,setIsMetadataReady]=useState(false),[fine,setFine]=useState(false),[position,setPosition]=useState<TimePosition>({timeSec:0,kind:"original",left:0,right:0,alpha:0});
 const [preview,setPreview]=useState<PreviewFrame|null>(null),[previewState,setPreviewState]=useState<'idle'|'processing'|'ready'|'failed'>('idle'),[previewError,setPreviewError]=useState('');
 const [decodedTime,setDecodedTime]=useState<number|null>(null);
 const [selectionRevision,setSelectionRevision]=useState(0);
 const [sourceSeeking,setSourceSeeking]=useState(false);
 const [menuOpen,setMenuOpen]=useState(false),[controlsHidden,setControlsHidden]=useState(false);
 const [timeBaseReady,setTimeBaseReady]=useState(false),calibrated=useRef(false);
 const wasBusy=useRef(false),lastPresented=useRef<number|null>(null),suppressPauseSync=useRef(false),pauseSyncPending=useRef(false);
 const resolved=useMemo(()=>resolvePlayerTiming(sourceTiming,providedTimes,timestampsArePreviewPositions),[sourceTiming,providedTimes,timestampsArePreviewPositions]);
 const {times:timestamps,fps,mediaOnly,assumed}=resolved;
 const fineBlockReason=busy?'目前處理中，完成後可切換。':!isMetadataReady?'影片準備中。':resolved.fineReason;
 const originalPoints=useMemo(()=>createAnalysisTimeline(timestamps,fps,false,assumed),[timestamps,fps,assumed]);
 const points=useMemo(()=>{try{return fine?createFineGridTimeline(timestamps,fps,assumed):originalPoints;}catch{return originalPoints;}},[timestamps,fps,fine,assumed,originalPoints]);
 const index=points.nearest(position.timeSec),point=position;
 const currentFrame=point.left;
 const showPreview=!isPlaying&&point.kind==='interpolated'&&previewState==='ready'&&Boolean(preview);
 const previewShrunk=Boolean(preview)&&Boolean(videoRef.current?.videoWidth)&&preview!.width<videoRef.current!.videoWidth;
 const canMark=Boolean(videoUrl&&isMetadataReady&&!busy&&!sourceSeeking&&(point.kind!=='interpolated'||previewState==='ready'));
 const markerPosition=(x:number,y:number)=>{const v=videoRef.current,rect=v?.parentElement?.getBoundingClientRect();if(!v||!rect||!v.videoWidth)return{left:`${x*100}%`,top:`${y*100}%`};const scale=Math.min(rect.width/v.videoWidth,rect.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;return{left:`${((rect.width-w)/2+x*w)/rect.width*100}%`,top:`${((rect.height-h)/2+y*h)/rect.height*100}%`};};
 const seek=(p:TimePosition)=>{const v=videoRef.current;if(!v||busy||!p||!Number.isFinite(p.timeSec)||!timestamps.length)return;pauseSyncPending.current=false;suppressPauseSync.current=!v.paused;v.pause();setIsPlaying(false);setPosition(p);setSelectionRevision(n=>n+1);onCurrentFrameChange?.(p.left);onPositionChange?.(p);request.current++;session.current?.invalidate();setPreview(null);setPreviewState(p.kind==='interpolated'?'processing':'idle');
  const sourceTime=timestamps[p.left]??p.timeSec,target=Math.max(0,Math.min((v.duration||sourceTime+1)-1e-6,sourceTime+(mediaOnly?0:0.0005)));
  // The selected fine time owns the cursor. Native seeking supplies only its left
  // original image; never seek the same source repeatedly inside one interval.
  if(Math.abs(v.currentTime-target)>1e-6){setDecodedTime(null);setSourceSeeking(true);v.currentTime=target;}};
 const handleVideoLoadedMetadata=()=>{const v=videoRef.current;if(!v)return;setIsMetadataReady(true);onVideoElementReady?.(v);};
 const handleSeeked=()=>{setSourceSeeking(false);const v=videoRef.current;if(v&&!('requestVideoFrameCallback' in v))setDecodedTime(null);};
 const handlePause=()=>{const v=videoRef.current;setIsPlaying(false);if(suppressPauseSync.current){suppressPauseSync.current=false;return;}if(v&&(isPlaying||pauseSyncPending.current)&&timestamps.length){pauseSyncPending.current=true;const f=lastPresented.current!==null?originalPoints.nearest(lastPresented.current):sourceIndexAt(timestamps,v.currentTime),p=originalPoints.get(f);setPosition(p);onCurrentFrameChange?.(f);onPositionChange?.(p);}};
 const handleTimeUpdate=()=>{const v=videoRef.current;if(v&&!v.paused&&(!('requestVideoFrameCallback' in v)||lastPresented.current===null)){const f=sourceIndexAt(timestamps,v.currentTime);const p=originalPoints.get(f);if(p){setPosition(p);onCurrentFrameChange?.(f);onPositionChange?.(p);}}};
 useEffect(()=>{if(busy)pauseSyncPending.current=false;if(wasBusy.current&&!busy&&isMetadataReady)seek(point);wasBusy.current=busy;},[busy]);
 useEffect(()=>{const v=videoRef.current;if(!v||!videoUrl)return;calibrated.current=false;setTimeBaseReady(false);setFine(Number.isFinite(fps)&&fps>0&&fps<90-0.001&&!assumed);setPreview(null);setPreviewState('idle');setPosition(originalPoints.get(0));setIsPlaying(false);setIsMetadataReady(false);setDecodedTime(null);lastPresented.current=null;setSourceSeeking(false);v.load();return()=>{v.pause();onVideoElementReady?.(null);};},[videoUrl]);
 useEffect(()=>{const v=videoRef.current;if(!v||!videoUrl||!('requestVideoFrameCallback' in v))return;let cancelled=false,handle:number;
  const callback=(_n:number,m:VideoFrameCallbackMetadata)=>{if(cancelled)return;setDecodedTime(m.mediaTime);lastPresented.current=m.mediaTime;if((!v.paused||pauseSyncPending.current)&&timestamps.length){const f=originalPoints.nearest(m.mediaTime),p=originalPoints.get(f);setPosition(p);onCurrentFrameChange?.(f);onPositionChange?.(p);}handle=v.requestVideoFrameCallback(callback);};handle=v.requestVideoFrameCallback(callback);return()=>{cancelled=true;v.cancelVideoFrameCallback(handle);};
 },[videoUrl,timestamps,originalPoints]);
 useEffect(()=>{if(!isMetadataReady||!timeBaseReady||targetFrameSeek===null||targetFrameSeek===undefined)return;const f=Math.max(0,Math.min(timestamps.length-1,targetFrameSeek)),t=timestamps[f];if(t!==undefined)seek(originalPoints.get(f));},[videoUrl,targetFrameSeek,isMetadataReady,timestamps,timeBaseReady]);
 // Time-base check. Browsers disagree on where an edit-listed clip starts (Chrome rebases the first frame to 0, others may keep
 // the container time). Frame 0 is the only frame whose identity is unambiguous whatever the offset, so show it and ask the
 // browser when it says it was presented; the difference rebases the parsed timestamps once, before any event is marked.
 useEffect(()=>{
  const v=videoRef.current;if(!v||!videoUrl||!isMetadataReady||timeBaseReady)return;
  const needs=Boolean(onTimeBaseOffset)&&!mediaOnly&&!assumed&&sourceTiming?.timeBase==='timestamp'&&timestamps.length>1&&'requestVideoFrameCallback' in v;
  if(!needs||calibrated.current){setTimeBaseReady(true);return;}
  calibrated.current=true;let done=false,handle:number|undefined;
  const finish=(offset:number|null)=>{if(done)return;done=true;window.clearTimeout(timer);if(handle!==undefined)v.cancelVideoFrameCallback(handle);
   const dt=1/(Number.isFinite(fps)&&fps>0?fps:30);
   if(offset!==null&&Math.abs(offset)>=.0005&&Math.abs(offset)<Math.min(.1,dt))onTimeBaseOffset!(offset);
   setTimeBaseReady(true);};
  const timer=window.setTimeout(()=>finish(null),1500),first=timestamps[0];
  handle=v.requestVideoFrameCallback((_n,m)=>finish(m.mediaTime-first));
  v.currentTime=Math.max(0,Math.min((v.duration||first+1)-1e-6,first+0.0005));
  return()=>{done=true;window.clearTimeout(timer);if(handle!==undefined)v.cancelVideoFrameCallback(handle);};
 },[videoUrl,isMetadataReady,timeBaseReady]);
 useEffect(()=>{request.current++;session.current?.dispose();session.current=null;return()=>{request.current++;session.current?.dispose();session.current=null;};},[videoUrl,timestamps]);
 useEffect(()=>{
  const id=++request.current;setPreview(null);setPreviewState('idle');setPreviewError('');
  if(!videoUrl||!isMetadataReady||isPlaying||point.kind!=='interpolated')return;
  setPreviewState('processing');
  const timer=setTimeout(async()=>{try{
   if(!session.current)session.current=new LocalFrameInterpolation(videoUrl,timestamps);
   const result=await session.current.preview(point);if(id!==request.current)return;
   if(result.quality.identicalSources||result.changedA===0||result.changedB===0)throw Error('此區段無法產生可區分的中間影像；請退回原始模式，不以端點重複冒充補幀');
   const canvas=previewCanvas.current;if(!canvas)throw Error('插值畫面未就緒');canvas.width=result.width;canvas.height=result.height;
   const context=canvas.getContext('2d');if(!context)throw Error('無法繪製中間影像，請退回原始模式');context.putImageData(new ImageData(result.data,result.width,result.height),0,0);setPreview(result);setPreviewState('ready');
  }catch(error){if(id===request.current){setPreviewState('failed');setPreviewError(error instanceof Error?error.message:'補幀暫時不可用，請使用原始模式');}}},40);
  return()=>{clearTimeout(timer);session.current?.invalidate();};
 },[videoUrl,isMetadataReady,isPlaying,point.timeSec,point.kind,timestamps,selectionRevision]);
 useEffect(()=>{if(fine&&resolved.fineReason){setFine(false);seek(originalPoints.get(originalPoints.nearest(point.timeSec)));}},[resolved.fineReason,originalPoints]);
 const togglePlay=()=>{const v=videoRef.current;if(!v||busy)return;if(!v.paused){pauseSyncPending.current=true;v.pause();setIsPlaying(false);}else{pauseSyncPending.current=false;setPreview(null);v.play().then(()=>setIsPlaying(true)).catch(()=>setIsPlaying(false));}};
 const stepFrame=(delta:number)=>{const next=points.get(Math.max(0,Math.min(points.length-1,index+delta)));if(next)seek(next);};
 const dragging=useRef<number|null>(null);
 const pointerSeek=(event:React.PointerEvent<HTMLInputElement>)=>{const rect=event.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-12)/Math.max(1,rect.width-24)));seek(points.get(Math.round(fraction*(points.length-1))));};
 const startDrag=(event:React.PointerEvent<HTMLInputElement>)=>{if(busy||!points.length)return;event.preventDefault();dragging.current=event.pointerId;event.currentTarget.focus({preventScroll:true});try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Pointer movement within the range still works. */}pointerSeek(event);};
 const endDrag=(event:React.PointerEvent<HTMLInputElement>)=>{if(dragging.current!==event.pointerId)return;pointerSeek(event);dragging.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
 useEffect(()=>{dragging.current=null;},[videoUrl,fine,busy]);
 const mark=(name:'release'|'glove')=>{if(!canMark)return;const selected=mediaOnly?{...point,timeSec:videoRef.current?.currentTime??NaN}:point;if(!Number.isFinite(selected.timeSec))return;onSetEvent(name,{...selectEvent(selected,timestamps,point.kind==='interpolated'?preview?.quality.level:undefined),selectionType:mediaOnly?'media_time':point.kind==='interpolated'?'interpolated':assumed?'cfr_assumed':'original',timelineIndex:index,...(mediaOnly?{sourceSpanSec:NaN,previewQuality:'unavailable' as const}:{})});};
 const switchMode=(next:boolean)=>{if(next&&fineBlockReason)return;setFine(next);const timeline=next?createFineGridTimeline(timestamps,fps,assumed):originalPoints,p=timeline.get(timeline.nearest(point.timeSec));if(p)seek(p);};
 const jump=(event:SelectedEvent|null)=>{if(!event)return;const next=event.kind==='interpolated'&&!fineBlockReason;setFine(next);const p=next?createFineGridTimeline(timestamps,fps,assumed):originalPoints;seek(p.get(p.nearest(event.timeSec)));};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(busy||['INPUT','SELECT','TEXTAREA','BUTTON'].includes((e.target as HTMLElement)?.tagName))return;if(e.key==='ArrowLeft'){e.preventDefault();stepFrame(e.shiftKey?-5:-1);}else if(e.key==='ArrowRight'){e.preventDefault();stepFrame(e.shiftKey?5:1);}else if(e.code==='Space'){e.preventDefault();togglePlay();}else if(e.key==='[')mark('release');else if(e.key===']')mark('glove');};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[index,points,busy,canMark,isPlaying]);
 const isFull=variant==='fullscreen',isCompact=variant==='compact',showMarks=isFull&&!assist&&!showTwoD,controlsOn=!isCompact&&!controlsHidden;
 const flightText=flightTimeDescription(events);
 // Hold −1 / +1 to keep stepping; the ref always points at the latest render's stepFrame.
 const stepRef=useRef(stepFrame);stepRef.current=stepFrame;
 const hold=useRef<{timer?:number;interval?:number}>({});
 const stopHold=()=>{window.clearTimeout(hold.current.timer);window.clearInterval(hold.current.interval);hold.current={};};
 useEffect(()=>stopHold,[]);
 const startHold=(delta:number)=>(e:React.PointerEvent<HTMLButtonElement>)=>{if(busy)return;e.preventDefault();try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* release events still arrive */}stopHold();stepRef.current(delta);hold.current.timer=window.setTimeout(()=>{hold.current.interval=window.setInterval(()=>stepRef.current(delta),90);},380);};
 const evLabel=(e:SelectedEvent)=>e.kind==='interpolated'?`F${(e.left+e.alpha).toFixed(1)}`:`F${e.left}`;
 // Detected-ball overlay: only drawn for positions that have a detection on this source frame.
 const frameDt=1/(Number.isFinite(fps)&&fps>0?fps:30),near=(p:OverlayPoint)=>Math.abs(p.timestamp-point.timeSec)<=frameDt*.55;
 const overlayOn=Boolean(overlay)&&!showTwoD&&!isCompact;
 const nowObserved=overlayOn?overlay!.observed.find(near):undefined,nowEstimated=overlayOn?overlay!.estimated.find(near):undefined;
 const trail=overlayOn?overlay!.observed.filter(p=>p.timestamp<point.timeSec-1e-6):[];
 const markerAt=(p:{x_norm:number;y_norm:number})=>markerPosition(p.x_norm,p.y_norm);
 // Pixel position on screen → normalised video coordinates (accounts for the object-contain letterbox).
 const clientToNorm=(clientX:number,clientY:number)=>{
  const v=videoRef.current,rect=v?.parentElement?.getBoundingClientRect();if(!v||!rect||!v.videoWidth)return null;
  const scale=Math.min(rect.width/v.videoWidth,rect.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;
  const x=clientX-rect.left-(rect.width-w)/2,y=clientY-rect.top-(rect.height-h)/2;
  return {x:Math.max(0,Math.min(1,x/w)),y:Math.max(0,Math.min(1,y/h))};
 };
 const [drag,setDrag]=useState<{x:number;y:number}|null>(null);
 const handlePos=confirm?(drag?{xNorm:drag.x,yNorm:drag.y}:confirm.label&&confirm.label.kind!=='no_ball'?confirm.label:confirm.program??null):null;
 const closeMenu=()=>setMenuOpen(false);
 const scrubRow=<div id="scrub-row" className="flex items-center gap-2 pointer-events-auto">
  <button type="button" id="step-back" aria-label="後退一格（長按連續）" disabled={busy||!points.length} onPointerDown={startHold(-1)} onPointerUp={stopHold} onPointerCancel={stopHold} onLostPointerCapture={stopHold} onContextMenu={e=>e.preventDefault()} onClick={e=>{if(e.detail===0)stepFrame(-1);}} className="ov-step"><ChevronLeft size={20}/>−1</button>
  <input id="video-timeline" aria-label="影格拉桿" type="range" min={0} max={Math.max(0,points.length-1)} value={index} disabled={busy} readOnly onPointerDown={startDrag} onPointerMove={e=>{if(dragging.current===e.pointerId)pointerSeek(e);}} onPointerUp={endDrag} onPointerCancel={()=>{dragging.current=null;}} onLostPointerCapture={()=>{dragging.current=null;}} onKeyDown={e=>{const moves:Record<string,number>={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-5,PageUp:5};if(e.key in moves){e.preventDefault();stepFrame(moves[e.key]);}else if(e.key==='Home'||e.key==='End'){e.preventDefault();seek(points.get(e.key==='Home'?0:points.length-1));}}} className="flex-1 min-w-0 accent-cyan-400 timeline-range"/>
  <button type="button" id="step-forward" aria-label="前進一格（長按連續）" disabled={busy||!points.length} onPointerDown={startHold(1)} onPointerUp={stopHold} onPointerCancel={stopHold} onLostPointerCapture={stopHold} onContextMenu={e=>e.preventDefault()} onClick={e=>{if(e.detail===0)stepFrame(1);}} className="ov-step">+1<ChevronRight size={20}/></button>
 </div>;
 const statusLine=<div id="current-time-status" role="status" data-kind={point.kind} data-time={point.timeSec} data-source-index={point.left} data-position-index={index} data-position-count={points.length} data-decoded-time={decodedTime??''} className="ov-chip font-mono truncate">
  {fine?`90Hz ${index}/${points.length-1} · `:''}{point.kind==='interpolated'?`F${point.left}→${point.right} 推算`:`F${point.left}`} · {point.timeSec.toFixed(3)}s{mediaOnly?' · 影格未確認':''}
 </div>;
 return <div className={`player-root ${isFull?'player-full':isCompact?'player-compact':'player-inline'}`} data-variant={variant}>
  <div className={`player-stage ${isFull?'':'rounded-2xl'} relative w-full overflow-hidden bg-black flex items-center justify-center ${isCompact?'h-[26dvh] min-h-[160px] border border-slate-700':isFull?'h-full':'h-[58dvh] min-h-[320px] max-h-[640px] border border-slate-700'}`}>
   {videoUrl?(
    <div className={`w-full h-full relative flex items-center justify-center ${isSelectingPoint?'cursor-crosshair':''}`} style={showTwoD?{visibility:'hidden',position:'absolute'}:undefined}
     onClick={e=>{
      if(isSelectingPoint&&onSelectCoordinate){
       const rect=e.currentTarget.getBoundingClientRect(),video=videoRef.current;if(!video)return;
       const scale=Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight),contentW=video.videoWidth*scale,contentH=video.videoHeight*scale;
       const clickX=e.clientX-rect.left-(rect.width-contentW)/2,clickY=e.clientY-rect.top-(rect.height-contentH)/2;
       if(clickX<0||clickY<0||clickX>contentW||clickY>contentH)return;
       onSelectCoordinate(Number(Math.max(0,Math.min(1,clickX/contentW)).toFixed(4)),Number(Math.max(0,Math.min(1,clickY/contentH)).toFixed(4)));
       return;
      }
      if(confirm&&!showTwoD){const n=clientToNorm(e.clientX,e.clientY);if(n)confirm.onMove(Number(n.x.toFixed(4)),Number(n.y.toFixed(4)));return;}
      if(isFull&&!showTwoD){setControlsHidden(h=>!h);setMenuOpen(false);}
     }}>
     <video ref={videoRef} src={videoUrl} className="w-full h-full object-contain select-none" playsInline muted onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleVideoLoadedMetadata} onSeeked={handleSeeked} onSeeking={()=>setSourceSeeking(true)} onEnded={()=>setIsPlaying(false)} onPause={handlePause} onPlay={()=>{suppressPauseSync.current=false;setIsPlaying(true);}}/>
     <canvas id="interpolated-preview" ref={previewCanvas} aria-label="局部運動插值畫面" className="absolute inset-0 w-full h-full object-contain pointer-events-none" style={{display:showPreview?'block':'none'}} data-time={previewState==='ready'?point.timeSec:''} data-motion-size={JSON.stringify(preview?[preview.motionWidth,preview.motionHeight]:[])} data-estimate-ms={preview?.estimateMs??0} data-synthesis-ms={preview?.synthesisMs??0} data-preview-state={previewState} data-quality={preview?.quality.level??''} data-source-indices={JSON.stringify(preview?.sourceIndices??[])} data-source-media-times={JSON.stringify(preview?.sourceMediaTimes??[])} data-changed-a={preview?.changedA??0} data-changed-b={preview?.changedB??0}/>
     {markers.map((m,i)=><span key={'m'+i} data-marker={m.kind} className={`ov-dot ov-marker ov-marker-${m.kind}`} style={markerAt({x_norm:m.xNorm,y_norm:m.yNorm})}>{m.kind==='no_ball'?'×':''}</span>)}
     {confirm&&handlePos&&<span id="confirm-handle" data-label-kind={confirm.label?.kind??''} className={`ov-handle ${confirm.label?'ov-handle-'+confirm.label.kind:'ov-handle-candidate'}`} style={markerAt({x_norm:handlePos.xNorm,y_norm:handlePos.yNorm})}
       onClick={e=>e.stopPropagation()}
       onPointerDown={e=>{e.stopPropagation();e.preventDefault();try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* drag still works */}}}
       onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const n=clientToNorm(e.clientX,e.clientY);if(n)setDrag(n);}}
       onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);const moved=drag;setDrag(null);if(moved)confirm.onMove(Number(moved.x.toFixed(4)),Number(moved.y.toFixed(4)));}}/>}
     {overlayOn&&<div id="ball-overlay" className="absolute inset-0 pointer-events-none z-10" data-observed-count={overlay!.observed.length} data-estimated-count={overlay!.estimated.length} data-current-observed={nowObserved?'1':'0'} data-current-estimated={nowEstimated?'1':'0'}>
      {trail.map(p=><span key={'t'+p.frame} data-overlay="trail" className="ov-dot ov-trail" style={markerAt(p)}/>)}
      {nowEstimated&&!nowObserved&&<span data-overlay="estimated" className="ov-dot ov-estimated" style={markerAt(nowEstimated)}/>}
      {nowObserved&&<span data-overlay="observed" className="ov-dot ov-observed" style={markerAt(nowObserved)}/>}
     </div>}
    </div>
   ):(
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-3 select-none"><Video className="w-8 h-8 text-slate-500"/><p className="text-sm font-bold text-slate-200">尚未載入投球影片</p></div>
   )}
   {showTwoD&&<div id="twod-view" className="absolute inset-0 overflow-y-auto bg-slate-950 p-3 pt-16">{twoD}</div>}

   {/* Overlay controls (fullscreen marking and inline result views) */}
   {!isCompact&&videoUrl&&<div className={`ov-layer ${controlsOn||showTwoD?'':'ov-hidden'}`}>
    <div className="ov-top">
     {showTwoD&&onShowVideo&&<button type="button" id="btn-twod-back" onClick={onShowVideo} className="ov-pill ov-pill-go">‹ 回到影片</button>}
     {showMarks&&<button type="button" id="set-release-time" aria-pressed={Boolean(events.release)} disabled={!canMark} onClick={()=>mark('release')} className={`ov-pill ${events.release?'ov-pill-release-on':'ov-pill-release'}`}>{events.release?`出手 ${evLabel(events.release)}`:'標記出手'}</button>}
     {assist&&<div id="assist-banner" role="status" className="ov-banner">
      <p className="font-bold text-sm">{assist.text}</p>
      <p id="assist-count" className="text-xs text-cyan-200">已點 {assist.count} 個（至少 {assist.min}、最多 {assist.max}）</p>
      <div className="grid grid-cols-2 gap-1.5 w-full">
       <button type="button" id="assist-noball" onClick={assist.onNoBall} className="ov-pill !max-w-none">這格看不到球</button>
       <button type="button" id="assist-done" disabled={assist.count<assist.min} onClick={assist.onDone} className="ov-pill !max-w-none ov-pill-go">完成並重新分析</button>
      </div>
      <button type="button" id="assist-skip" onClick={assist.onSkip} className="ov-pill !max-w-none w-full">略過，直接看結果</button>
     </div>}
     {!showMarks&&!assist&&!(showTwoD&&onShowVideo)&&<span/>}
     <div className="ov-cluster">
      {!showTwoD&&<button type="button" id="btn-play" aria-label={isPlaying?'暫停影片':'播放影片'} aria-pressed={isPlaying} disabled={busy||!isMetadataReady} onClick={togglePlay} className="ov-icon">{isPlaying?<Pause size={20}/>:<Play size={20}/>}</button>}
      <button type="button" id="player-menu-btn" aria-label="更多功能" aria-expanded={menuOpen} onClick={()=>setMenuOpen(o=>!o)} className="ov-icon"><MoreHorizontal size={20}/></button>
     </div>
     {showMarks&&<button type="button" id="set-glove-time" aria-pressed={Boolean(events.glove)} disabled={!canMark} onClick={()=>mark('glove')} className={`ov-pill ${events.glove?'ov-pill-glove-on':'ov-pill-glove'}`}>{events.glove?`進手套 ${evLabel(events.glove)}`:'標記進手套'}</button>}
    </div>
    {!showTwoD&&<div className="ov-bottom">
     <div className="flex items-center justify-between gap-2 pointer-events-none">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
       {statusLine}
       <span id="flight-time-status" role="status" className="ov-chip text-cyan-200">{flightText}</span>
       {showPreview&&previewShrunk&&<span id="preview-shrunk-chip" className="ov-chip text-amber-200">預覽已縮小（推算畫面，非實拍）</span>}
       {overlayOn&&<span className="ov-chip text-[10px]"><span className="ov-legend ov-observed"/>程式找到的球 <span className="ov-legend ov-estimated"/>推估</span>}
       {overlayOn&&overlay!.observed.length===0&&<span id="no-ball-chip" className="ov-chip text-amber-200">程式沒有找到球</span>}
      </div>
      {isFull&&showMarks&&events.release&&events.glove&&onNext&&<button type="button" id="btn-next-analyze" onClick={onNext} disabled={busy} className="ov-next pointer-events-auto">下一步<ChevronRight size={18}/></button>}
     </div>
     {confirm&&<div id="confirm-bar" className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
      <span id="confirm-status" role="status" className="ov-chip">{confirm.label?(confirm.label.kind==='confirmed'?'已確認':confirm.label.kind==='corrected'?'已修正':'已標：這格沒有球'):confirm.program?(confirm.program.source==='estimated'?'程式只有推估':'程式找到的球點'):'程式沒有球點：點畫面標出球'}</span>
      <button type="button" id="confirm-ok" disabled={!(confirm.program||confirm.label)||confirm.label?.kind==='no_ball'} onClick={confirm.onConfirm} className="ov-pill ov-pill-go !max-w-none">正確</button>
      <button type="button" id="confirm-noball" onClick={confirm.onNoBall} className="ov-pill !max-w-none">這格沒有球</button>
      <button type="button" id="confirm-clear" disabled={!confirm.label} onClick={confirm.onClear} className="ov-pill !max-w-none">清除</button>
     </div>}
     {scrubRow}
    </div>}
   </div>}
   {!isCompact&&videoUrl&&isFull&&controlsHidden&&!showTwoD&&<button type="button" id="show-controls" onClick={()=>setControlsHidden(false)} className="ov-reveal" aria-label="顯示控制項">輕點畫面顯示控制項</button>}

   {/* Menu sheet: secondary functions */}
   {menuOpen&&!isCompact&&<div className="ov-sheet-wrap" onClick={closeMenu}>
    <div id="player-menu" role="dialog" aria-label="更多功能" className="ov-sheet" onClick={e=>e.stopPropagation()}>
     <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-white">更多功能</h3><button type="button" id="player-menu-close" onClick={closeMenu} className="ov-icon" aria-label="關閉選單"><X size={18}/></button></div>
     {onBack&&<button type="button" id="btn-back-video" onClick={()=>{closeMenu();onBack();}} className="btn-secondary">‹ 回到選影片</button>}
     {viewToggle&&<div onClick={closeMenu}>{viewToggle}</div>}
     {!showTwoD&&<>
      <div className="space-y-1.5">
       <p className="text-xs font-bold text-slate-300">時間格線</p>
       <div className="grid grid-cols-2 gap-2"><button id="mode-source" className={`mode-toggle ${!fine?'mode-active':''}`} aria-pressed={!fine} disabled={busy} onClick={()=>switchMode(false)}>原始影格</button><button id="mode-fine" className={`mode-toggle ${fine?'mode-active':''}`} aria-pressed={fine} disabled={Boolean(fineBlockReason)} aria-describedby="fine-mode-reason" onClick={()=>switchMode(true)}>90 FPS 補幀</button></div>
       <p id="fine-mode-reason" role="status" className="text-xs text-amber-200">{fineBlockReason}</p>
       {fine&&<p className="text-[11px] text-amber-200" title={preview?.quality.note}>推算，非90FPS實拍；原始影格完整保留。{previewState==='processing'?'處理中，目前顯示來源画面…':previewState==='failed'?previewError:preview?`${preview.width}×${preview.height} 像素合成${previewShrunk?`（預覽已縮小，來源 ${videoRef.current?.videoWidth}×${videoRef.current?.videoHeight}）`:'（原始像素）'}；${preview.quality.level==='low'?'低品質，可退回原始影格':'品質有限'}，棒球位置未驗證。`:''}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
       <label className="text-xs text-slate-300">時間 (s)<input id="timeline-time-input" aria-label="定位影片時間" inputMode="decimal" type="number" step="any" min={timestamps[0]??0} max={timestamps.at(-1)??0} value={point.timeSec} disabled={busy} onChange={e=>{const p=points.get(points.nearest(Number(e.target.value)));if(p)seek(p);}} className="field mt-1 font-mono"/></label>
       {!fine&&<label className="text-xs text-slate-300">{mediaOnly?'時間位置':'原始索引'}<input id="source-frame-input" aria-label="定位原始影格" inputMode="numeric" type="number" min={0} max={timestamps.length-1} value={point.left} disabled={busy} onChange={e=>{const f=Math.max(0,Math.min(timestamps.length-1,Math.round(Number(e.target.value))));seek(points.get(f));}} className="field mt-1 font-mono"/></label>}
      </div>
      <div className="grid grid-cols-1 gap-2" aria-live="polite"><button id="jump-release-time" className="btn-secondary jump-btn" disabled={!events.release||busy} onClick={()=>{closeMenu();jump(events.release);}}>出手：{eventDescription(events.release)}</button><button id="jump-glove-time" className="btn-secondary jump-btn" disabled={!events.glove||busy} onClick={()=>{closeMenu();jump(events.glove);}}>進手套：{eventDescription(events.glove)}</button></div>
      <p className="text-[11px] text-slate-400 break-words">{mediaOnly?'時間位置（影格未確認）':point.kind==='interpolated'?'推算':assumed?'原始定位（CFR假設）':'原始'} · 來源 {formatSourceFps(fps)} FPS／{assumed?'時間位置數（原始數未確認）':'原始影格'} {mediaOnly?'未知':timestamps.length}。{!mediaOnly&&!fine&&decodedTime===null?'瀏覽器未回報呈現時刻時，不保證逐樣本精確解碼。':''}</p>
     </>}
     {menuExtra}
    </div>
   </div>}
  </div>
 </div>;
}
