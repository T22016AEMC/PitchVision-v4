import {sourceFps,formatSourceFps} from '../services/sourceTiming';
import React,{useRef,useState,useEffect,useMemo} from 'react';
import {Play,Pause,Pin,Target,Video,ChevronLeft,ChevronsLeft,ChevronRight,ChevronsRight} from 'lucide-react';
import {CameraViewMode,VideoTiming,SpatialCalibrationInfo} from '../types';
import {TimePosition,SelectedEvent,SelectedEvents,createAnalysisTimeline,createFineGridTimeline,selectEvent,sourceIndexAt} from '../services/analysisTimeline';
import {LocalFrameInterpolation,PreviewFrame} from '../services/localFrameInterpolation';

interface PitchVideoPlayerProps {
 videoUrl:string|null;releaseFrame:number;gloveFrame:number;totalFrames:number;fps?:number;timestamps?:number[];sourceTiming?:VideoTiming|null;events:SelectedEvents;
 isFpsEstimated?:boolean;viewMode:CameraViewMode;velocityKmh?:number;pitchName?:string;hasAnalyzed?:boolean;busy?:boolean;
 onCurrentFrameChange?:(frame:number)=>void;onPositionChange?:(point:TimePosition)=>void;targetFrameSeek?:number|null;onSetEvent:(name:'release'|'glove',event:SelectedEvent)=>void;
 spatialCalibration?:SpatialCalibrationInfo;onVideoElementReady?:(el:HTMLVideoElement|null)=>void;isSelectingPoint?:1|2|null;onSelectCoordinate?:(x:number,y:number)=>void;
 manualPoint1?:{frame:number;x_norm:number;y_norm:number}|null;manualPoint2?:{frame:number;x_norm:number;y_norm:number}|null;
}
export function PitchVideoPlayer({videoUrl,releaseFrame,gloveFrame,totalFrames,fps:providedFps=NaN,timestamps=[],sourceTiming,events,viewMode,busy=false,onCurrentFrameChange,onPositionChange,targetFrameSeek,onSetEvent,onVideoElementReady,isSelectingPoint=null,onSelectCoordinate,manualPoint1,manualPoint2}:PitchVideoPlayerProps){
 const videoRef=useRef<HTMLVideoElement|null>(null),previewCanvas=useRef<HTMLCanvasElement|null>(null),session=useRef<LocalFrameInterpolation|null>(null),request=useRef(0);
 const [isPlaying,setIsPlaying]=useState(false),[isMetadataReady,setIsMetadataReady]=useState(false),[fine,setFine]=useState(false),[position,setPosition]=useState<TimePosition>({timeSec:0,kind:"original",left:0,right:0,alpha:0});
 const [preview,setPreview]=useState<PreviewFrame|null>(null),[previewState,setPreviewState]=useState<'idle'|'processing'|'ready'|'failed'>('idle'),[previewError,setPreviewError]=useState('');
 const [decodedTime,setDecodedTime]=useState<number|null>(null);
 const [selectionRevision,setSelectionRevision]=useState(0);
 const [sourceSeeking,setSourceSeeking]=useState(false);
 const wasBusy=useRef(false),lastPresented=useRef<number|null>(null),suppressPauseSync=useRef(false),pauseSyncPending=useRef(false);
 const parsedFps=useMemo(()=>sourceFps(timestamps),[timestamps]),fps=Number.isFinite(parsedFps)?parsedFps:providedFps;
 const assumed=sourceTiming?.timeBase!=='timestamp';
 const originalPoints=useMemo(()=>createAnalysisTimeline(timestamps,fps,false,assumed),[timestamps,fps,assumed]);
 const points=useMemo(()=>{try{return fine?createFineGridTimeline(timestamps,fps,assumed):originalPoints;}catch{return originalPoints;}},[timestamps,fps,fine,assumed,originalPoints]);
 const index=points.nearest(position.timeSec),point=position;
 const currentFrame=point.left;
 const showPreview=!isPlaying&&point.kind==='interpolated'&&previewState==='ready'&&Boolean(preview);
 const canMark=Boolean(videoUrl&&isMetadataReady&&!busy&&!sourceSeeking&&(point.kind!=='interpolated'||previewState==='ready'));
 const markerPosition=(x:number,y:number)=>{const v=videoRef.current,rect=v?.parentElement?.getBoundingClientRect();if(!v||!rect||!v.videoWidth)return{left:`${x*100}%`,top:`${y*100}%`};const scale=Math.min(rect.width/v.videoWidth,rect.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;return{left:`${((rect.width-w)/2+x*w)/rect.width*100}%`,top:`${((rect.height-h)/2+y*h)/rect.height*100}%`};};
 const seek=(p:TimePosition)=>{const v=videoRef.current;if(!v||busy||!p||!Number.isFinite(p.timeSec)||!timestamps.length)return;pauseSyncPending.current=false;suppressPauseSync.current=!v.paused;v.pause();setIsPlaying(false);setPosition(p);setSelectionRevision(n=>n+1);onCurrentFrameChange?.(p.left);onPositionChange?.(p);request.current++;session.current?.invalidate();setPreview(null);setPreviewState(p.kind==='interpolated'?'processing':'idle');
  const sourceTime=timestamps[p.left]??p.timeSec,target=Math.max(0,Math.min((v.duration||sourceTime+1)-1e-6,sourceTime+0.0005));
  // The selected fine time owns the cursor. Native seeking supplies only its left
  // original image; never seek the same source repeatedly inside one interval.
  if(Math.abs(v.currentTime-target)>1e-6){setDecodedTime(null);setSourceSeeking(true);v.currentTime=target;}};
 const handleVideoLoadedMetadata=()=>{const v=videoRef.current;if(!v)return;setIsMetadataReady(true);onVideoElementReady?.(v);};
 const handleSeeked=()=>{setSourceSeeking(false);const v=videoRef.current;if(v&&!('requestVideoFrameCallback' in v))setDecodedTime(null);};
 const handlePause=()=>{const v=videoRef.current;setIsPlaying(false);if(suppressPauseSync.current){suppressPauseSync.current=false;return;}if(v&&(isPlaying||pauseSyncPending.current)&&timestamps.length){pauseSyncPending.current=true;const f=lastPresented.current!==null?originalPoints.nearest(lastPresented.current):sourceIndexAt(timestamps,v.currentTime),p=originalPoints.get(f);setPosition(p);onCurrentFrameChange?.(f);onPositionChange?.(p);}};
 const handleTimeUpdate=()=>{const v=videoRef.current;if(v&&!v.paused&&(!('requestVideoFrameCallback' in v)||lastPresented.current===null)){const f=sourceIndexAt(timestamps,v.currentTime);const p=originalPoints.get(f);if(p){setPosition(p);onCurrentFrameChange?.(f);onPositionChange?.(p);}}};
 useEffect(()=>{if(busy)pauseSyncPending.current=false;if(wasBusy.current&&!busy&&isMetadataReady)seek(point);wasBusy.current=busy;},[busy]);
 useEffect(()=>{const v=videoRef.current;if(!v||!videoUrl)return;setFine(Number.isFinite(fps)&&fps>0&&fps<90-0.001&&!assumed);setPreview(null);setPreviewState('idle');setPosition(originalPoints.get(0));setIsPlaying(false);setIsMetadataReady(false);setDecodedTime(null);lastPresented.current=null;setSourceSeeking(false);v.load();return()=>{v.pause();onVideoElementReady?.(null);};},[videoUrl]);
 useEffect(()=>{const v=videoRef.current;if(!v||!videoUrl||!('requestVideoFrameCallback' in v))return;let cancelled=false,handle:number;
  const callback=(_n:number,m:VideoFrameCallbackMetadata)=>{if(cancelled)return;setDecodedTime(m.mediaTime);lastPresented.current=m.mediaTime;if((!v.paused||pauseSyncPending.current)&&timestamps.length){const f=originalPoints.nearest(m.mediaTime),p=originalPoints.get(f);setPosition(p);onCurrentFrameChange?.(f);onPositionChange?.(p);}handle=v.requestVideoFrameCallback(callback);};handle=v.requestVideoFrameCallback(callback);return()=>{cancelled=true;v.cancelVideoFrameCallback(handle);};
 },[videoUrl,timestamps,originalPoints]);
 useEffect(()=>{if(!isMetadataReady||targetFrameSeek===null||targetFrameSeek===undefined)return;const f=Math.max(0,Math.min(timestamps.length-1,targetFrameSeek)),t=timestamps[f];if(t!==undefined)seek(originalPoints.get(f));},[videoUrl,targetFrameSeek,isMetadataReady,timestamps]);
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
 const togglePlay=()=>{const v=videoRef.current;if(!v||busy)return;if(!v.paused){pauseSyncPending.current=true;v.pause();setIsPlaying(false);}else{pauseSyncPending.current=false;setPreview(null);v.play().then(()=>setIsPlaying(true)).catch(()=>setIsPlaying(false));}};
 const stepFrame=(delta:number)=>{const next=points.get(Math.max(0,Math.min(points.length-1,index+delta)));if(next)seek(next);};
 const dragging=useRef<number|null>(null);
 const pointerSeek=(event:React.PointerEvent<HTMLInputElement>)=>{const rect=event.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-12)/Math.max(1,rect.width-24)));seek(points.get(Math.round(fraction*(points.length-1))));};
 const startDrag=(event:React.PointerEvent<HTMLInputElement>)=>{if(busy||!points.length)return;event.preventDefault();dragging.current=event.pointerId;event.currentTarget.focus({preventScroll:true});try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Pointer movement within the range still works. */}pointerSeek(event);};
 const endDrag=(event:React.PointerEvent<HTMLInputElement>)=>{if(dragging.current!==event.pointerId)return;pointerSeek(event);dragging.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
 useEffect(()=>{dragging.current=null;},[videoUrl,fine,busy]);
 const mark=(name:'release'|'glove')=>{if(canMark)onSetEvent(name,selectEvent(point,timestamps,point.kind==='interpolated'?preview?.quality.level:undefined));};
 const switchMode=(next:boolean)=>{setFine(next);const timeline=next?createFineGridTimeline(timestamps,fps,assumed):originalPoints,p=timeline.get(timeline.nearest(point.timeSec));if(p)seek(p);};
 const jump=(event:SelectedEvent|null)=>{if(!event)return;const next=event.kind==='interpolated'&&fps<90;setFine(next);const p=next?createFineGridTimeline(timestamps,fps,assumed):originalPoints;seek(p.get(p.nearest(event.timeSec)));};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(busy||['INPUT','SELECT','TEXTAREA','BUTTON'].includes((e.target as HTMLElement)?.tagName))return;if(e.key==='ArrowLeft'){e.preventDefault();stepFrame(e.shiftKey?-5:-1);}else if(e.key==='ArrowRight'){e.preventDefault();stepFrame(e.shiftKey?5:1);}else if(e.code==='Space'){e.preventDefault();togglePlay();}else if(e.key==='[')mark('release');else if(e.key===']')mark('glove');};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[index,points,busy,canMark,isPlaying]);
 return <div className="space-y-0">

      <div 
        className={`video-stage relative w-full rounded-2xl overflow-hidden bg-black border-2 border-slate-700/80 shadow-2xl flex items-center justify-center group transition-all duration-300 min-h-[500px] h-[80dvh] max-h-[960px]`}
      >
        {/* Real HTML5 Video - 純淨原始畫面，已完全移除覆蓋軌跡，讓使用者清晰檢視每一影格 */}
        {videoUrl ? (
          <div
            className={`w-full h-full relative flex items-center justify-center ${
              isSelectingPoint ? 'cursor-crosshair' : ''
            }`}
            onClick={(e) => {
              if (!isSelectingPoint || !onSelectCoordinate) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const video=videoRef.current;if(!video)return;
              const scale=Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight);
              const contentW=video.videoWidth*scale,contentH=video.videoHeight*scale;
              const clickX=e.clientX-rect.left-(rect.width-contentW)/2;
              const clickY=e.clientY-rect.top-(rect.height-contentH)/2;
              if(clickX<0||clickY<0||clickX>contentW||clickY>contentH)return;
              const xNorm = Number((Math.max(0, Math.min(1, clickX / contentW))).toFixed(4));
              const yNorm = Number((Math.max(0, Math.min(1, clickY / contentH))).toFixed(4));
              onSelectCoordinate(xNorm, yNorm);
            }}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-contain select-none"
              playsInline
              muted
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onSeeked={handleSeeked}
              onSeeking={()=>setSourceSeeking(true)}
              onEnded={() => setIsPlaying(false)}
              onPause={handlePause}
              onPlay={()=>{suppressPauseSync.current=false;setIsPlaying(true);}}
            />

            <canvas id="interpolated-preview" ref={previewCanvas} aria-label="局部運動插值畫面" className="absolute inset-0 w-full h-full object-contain pointer-events-none" style={{display:showPreview?'block':'none'}} data-time={previewState==='ready'?point.timeSec:''} data-motion-size={JSON.stringify(preview?[preview.motionWidth,preview.motionHeight]:[])} data-estimate-ms={preview?.estimateMs??0} data-synthesis-ms={preview?.synthesisMs??0} data-preview-state={previewState} data-quality={preview?.quality.level??''} data-source-indices={JSON.stringify(preview?.sourceIndices??[])} data-source-media-times={JSON.stringify(preview?.sourceMediaTimes??[])} data-changed-a={preview?.changedA??0} data-changed-b={preview?.changedB??0}/>
            {/* Manual Anchor Point 1 Marker */}
            {manualPoint1 && (
              <div
                className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-1/2 z-10 transition-transform"
                style={{
                  ...markerPosition(manualPoint1.x_norm,manualPoint1.y_norm)
                }}
              >
                <div className="w-5 h-5 rounded-full border-2 border-cyan-400 bg-cyan-500/40 animate-ping absolute -inset-0.5" />
                <div className="w-4 h-4 rounded-full border-2 border-white bg-cyan-500 shadow flex items-center justify-center text-[8px] font-bold text-slate-950">
                  1
                </div>
                <div className="absolute top-4 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-950/90 border border-cyan-500/60 text-cyan-300 text-[9px] font-mono whitespace-nowrap shadow">
                  錨點1: F{manualPoint1.frame}
                </div>
              </div>
            )}

            {/* Manual Anchor Point 2 Marker */}
            {manualPoint2 && (
              <div
                className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-1/2 z-10 transition-transform"
                style={{
                  ...markerPosition(manualPoint2.x_norm,manualPoint2.y_norm)
                }}
              >
                <div className="w-5 h-5 rounded-full border-2 border-amber-400 bg-amber-500/40 animate-ping absolute -inset-0.5" />
                <div className="w-4 h-4 rounded-full border-2 border-white bg-amber-500 shadow flex items-center justify-center text-[8px] font-bold text-slate-950">
                  2
                </div>
                <div className="absolute top-4 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-950/90 border border-amber-500/60 text-amber-300 text-[9px] font-mono whitespace-nowrap shadow">
                  錨點2: F{manualPoint2.frame}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-3 select-none">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-400 shadow-inner">
              <Video className="w-7 h-7 text-slate-500" />
            </div>
            <div className="space-y-1.5">
              <p className="text-base font-bold text-slate-200">尚未載入投球影片</p>
              <p className="text-xs text-slate-400 max-w-md">
                請於上方上傳 60fps 投球短片（或載入範例影片）。影片視窗已移除任何覆蓋軌跡，確保畫面純淨、逐格檢視清晰無阻。
              </p>
            </div>
          </div>
        )}


      </div>
      {videoUrl&&points.length>0&&<div id="manual-controls" className="bg-[#0b1329]/90 border border-slate-800 rounded-b-xl p-3 space-y-2 text-xs">
       <input id="video-timeline" aria-label="影片時間軸" type="range" min={0} max={points.length-1} value={index} disabled={busy} readOnly onPointerDown={startDrag} onPointerMove={e=>{if(dragging.current===e.pointerId)pointerSeek(e);}} onPointerUp={endDrag} onPointerCancel={()=>{dragging.current=null;}} onLostPointerCapture={()=>{dragging.current=null;}} onKeyDown={e=>{const moves:Record<string,number>={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-5,PageUp:5};if(e.key in moves){e.preventDefault();stepFrame(moves[e.key]);}else if(e.key==='Home'||e.key==='End'){e.preventDefault();seek(points.get(e.key==='Home'?0:points.length-1));}}} className="w-full accent-cyan-400 timeline-range"/>
       <div className="flex gap-2 items-center"><button type="button" disabled={busy} onClick={togglePlay} className="px-4 rounded bg-blue-600 flex items-center gap-2">{isPlaying?<Pause size={18}/>:<Play size={18}/>} {isPlaying?'暫停':'播放'}</button></div>
       <div id="frame-step-controls" className="grid grid-cols-4 gap-2 pt-2">
        {([-5,-1,1,5] as const).map(delta=>{const Icon=delta===-5?ChevronsLeft:delta===-1?ChevronLeft:delta===1?ChevronRight:ChevronsRight;return <button key={delta} title={`${delta<0?'後退':'前進'} ${Math.abs(delta)} 幀`} disabled={busy} onClick={()=>stepFrame(delta)} className="frame-step bg-slate-800 border border-slate-600 rounded-lg flex items-center justify-center gap-1 text-base font-bold"><Icon size={20}/>{delta>0?'+':''}{delta}</button>;})}
       </div>
       <div className="flex flex-wrap gap-2">
        <button id="set-release-time" disabled={!canMark} onClick={()=>mark('release')} className="px-3 bg-red-950 border border-red-500/50 rounded flex gap-1 items-center"><Pin size={14}/>設為出手</button>
        <button id="set-glove-time" disabled={!canMark} onClick={()=>mark('glove')} className="px-3 bg-amber-950 border border-amber-500/50 rounded flex gap-1 items-center"><Target size={14}/>設為進手套</button>
       </div>
       <div id="current-time-status" role="status" data-kind={point.kind} data-time={point.timeSec} data-source-index={point.left} data-position-index={index} data-position-count={points.length} data-decoded-time={decodedTime??''} className="text-cyan-200">
        {fine?`90Hz 位置 ${index}/${points.length-1} · `:''}{point.kind==='interpolated'?'推算':assumed?'原始定位（CFR假設）':'原始'} · {point.kind==='interpolated'?`F${point.left}→${point.right}`:`F${point.left}`} · {point.timeSec.toFixed(6)}s · 來源 {formatSourceFps(fps)} FPS／{assumed?'時間位置數（原始數未確認）':'原始影格'} {totalFrames}
       </div>
       <div className="flex flex-wrap gap-2 items-center">
        <div className="grid grid-cols-2 gap-2 w-full"><button id="mode-source" className={`mode-toggle ${!fine?'mode-active':''}`} aria-pressed={!fine} disabled={busy} onClick={()=>switchMode(false)}>原始影格</button><button id="mode-fine" className={`mode-toggle ${fine?'mode-active':''}`} aria-pressed={fine} disabled={busy||!Number.isFinite(fps)||fps<=0||fps>=90-0.001} onClick={()=>switchMode(true)}>90 FPS 補幀</button></div>
        <label>時間(s)<input id="timeline-time-input" aria-label="定位影片時間" type="number" step="any" min={timestamps[0]??0} max={timestamps.at(-1)??0} value={point.timeSec} disabled={busy} onChange={e=>{const p=points.get(points.nearest(Number(e.target.value)));if(p)seek(p);}} className="w-28"/></label>
        {!fine&&<label>原始索引<input id="source-frame-input" aria-label="定位原始影格" type="number" min={0} max={timestamps.length-1} value={point.left} disabled={busy} onChange={e=>{const f=Math.max(0,Math.min(timestamps.length-1,Math.round(Number(e.target.value))));seek(points.get(f));}} className="w-20"/></label>}
       </div>
       <div className="flex flex-wrap gap-2"><button id="jump-release-time" disabled={!events.release||busy} onClick={()=>jump(events.release)}>出手 {events.release?`${events.release.timeSec.toFixed(6)}s · ${events.release.kind==='interpolated'?'推算':events.release.kind==='cfr_assumed'?'CFR假設':'原始'}`:'未設定'}</button><button id="jump-glove-time" disabled={!events.glove||busy} onClick={()=>jump(events.glove)}>進手套 {events.glove?`${events.glove.timeSec.toFixed(6)}s · ${events.glove.kind==='interpolated'?'推算':events.glove.kind==='cfr_assumed'?'CFR假設':'原始'}`:'未設定'}</button></div>
       {fine&&<p className="text-[11px] text-amber-200 min-h-[60px]" title={preview?.quality.note}>推算，非90FPS實拍；原始影格完整保留。{previewState==='processing'?'處理中，目前顯示來源画面…':previewState==='failed'?previewError:preview?`${preview.width}×${preview.height} 原始像素合成；${preview.quality.level==='low'?'低品質，可退回原始影格':'品質有限'}，棒球位置未驗證。`:''}</p>}
       {!fine&&decodedTime===null&&<p className="text-[11px] text-slate-400">原始PTS定位；瀏覽器未回報呈現時刻時，不保證逐樣本精確解碼。</p>}
      </div>}
    </div>;
}
