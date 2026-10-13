import React,{useRef,useState,useEffect,useMemo} from 'react';
import {Play,Pause,Pin,Target,Video} from 'lucide-react';
import {CameraViewMode,VideoTiming,SpatialCalibrationInfo} from '../types';
import {TimePosition,SelectedEvent,SelectedEvents,createAnalysisTimeline,selectEvent,sourceIndexAt} from '../services/analysisTimeline';
import {LocalFrameInterpolation,PreviewFrame} from '../services/localFrameInterpolation';

interface PitchVideoPlayerProps {
 videoUrl:string|null;releaseFrame:number;gloveFrame:number;totalFrames:number;fps?:number;timestamps?:number[];sourceTiming?:VideoTiming|null;events:SelectedEvents;
 isFpsEstimated?:boolean;viewMode:CameraViewMode;velocityKmh?:number;pitchName?:string;hasAnalyzed?:boolean;busy?:boolean;
 onCurrentFrameChange?:(frame:number)=>void;onPositionChange?:(point:TimePosition)=>void;targetFrameSeek?:number|null;onSetEvent:(name:'release'|'glove',event:SelectedEvent)=>void;
 spatialCalibration?:SpatialCalibrationInfo;onVideoElementReady?:(el:HTMLVideoElement|null)=>void;isSelectingPoint?:1|2|null;onSelectCoordinate?:(x:number,y:number)=>void;
 manualPoint1?:{frame:number;x_norm:number;y_norm:number}|null;manualPoint2?:{frame:number;x_norm:number;y_norm:number}|null;
}
export function PitchVideoPlayer({videoUrl,releaseFrame,gloveFrame,totalFrames,fps=30,timestamps=[],sourceTiming,events,viewMode,busy=false,onCurrentFrameChange,onPositionChange,targetFrameSeek,onSetEvent,onVideoElementReady,isSelectingPoint=null,onSelectCoordinate,manualPoint1,manualPoint2}:PitchVideoPlayerProps){
 const videoRef=useRef<HTMLVideoElement|null>(null),previewCanvas=useRef<HTMLCanvasElement|null>(null),session=useRef<LocalFrameInterpolation|null>(null),request=useRef(0);
 const [isPlaying,setIsPlaying]=useState(false),[isMetadataReady,setIsMetadataReady]=useState(false),[fine,setFine]=useState(false),[currentTime,setCurrentTime]=useState(0);
 const [preview,setPreview]=useState<PreviewFrame|null>(null),[previewState,setPreviewState]=useState<'idle'|'processing'|'ready'|'failed'>('idle'),[previewError,setPreviewError]=useState('');
 const [decodedTime,setDecodedTime]=useState<number|null>(null);
 const [sourceSeeking,setSourceSeeking]=useState(false);
 const wasBusy=useRef(false),lastPresented=useRef<number|null>(null),suppressPauseSync=useRef(false),pauseSyncPending=useRef(false);
 const assumed=sourceTiming?.timeBase!=='timestamp';
 const originalPoints=useMemo(()=>createAnalysisTimeline(timestamps,fps,false,assumed),[timestamps,fps,assumed]);
 const points=useMemo(()=>{try{return createAnalysisTimeline(timestamps,fps,fine,assumed);}catch{return originalPoints;}},[timestamps,fps,fine,assumed,originalPoints]);
 const index=points.nearest(currentTime),point=points.get(index)??{timeSec:0,kind:'original' as const,left:0,right:0,alpha:0};
 const currentFrame=point.left;
 const showPreview=!isPlaying&&point.kind==='interpolated'&&previewState==='ready'&&Boolean(preview);
 const canMark=Boolean(videoUrl&&isMetadataReady&&!busy&&!sourceSeeking&&(point.kind!=='interpolated'||previewState==='ready'));
 const markerPosition=(x:number,y:number)=>{const v=videoRef.current,rect=v?.parentElement?.getBoundingClientRect();if(!v||!rect||!v.videoWidth)return{left:`${x*100}%`,top:`${y*100}%`};const scale=Math.min(rect.width/v.videoWidth,rect.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;return{left:`${((rect.width-w)/2+x*w)/rect.width*100}%`,top:`${((rect.height-h)/2+y*h)/rect.height*100}%`};};
 const seek=(p:TimePosition)=>{const v=videoRef.current;if(!v||busy)return;pauseSyncPending.current=false;suppressPauseSync.current=!v.paused;v.pause();setIsPlaying(false);setCurrentTime(p.timeSec);onCurrentFrameChange?.(p.left);onPositionChange?.(p);setDecodedTime(null);v.currentTime=Math.max(0,Math.min((v.duration||p.timeSec+1)-1e-6,p.timeSec+0.0005));};
 const handleVideoLoadedMetadata=()=>{const v=videoRef.current;if(!v)return;setIsMetadataReady(true);onVideoElementReady?.(v);};
 const handleSeeked=()=>{setSourceSeeking(false);const v=videoRef.current;if(v&&!('requestVideoFrameCallback' in v))setDecodedTime(null);};
 const handlePause=()=>{const v=videoRef.current;setIsPlaying(false);if(suppressPauseSync.current){suppressPauseSync.current=false;return;}if(v&&(isPlaying||pauseSyncPending.current)&&timestamps.length){pauseSyncPending.current=true;const f=lastPresented.current!==null?originalPoints.nearest(lastPresented.current):sourceIndexAt(timestamps,v.currentTime),p=originalPoints.get(f);setCurrentTime(p.timeSec);onCurrentFrameChange?.(f);onPositionChange?.(p);}};
 const handleTimeUpdate=()=>{const v=videoRef.current;if(v&&!v.paused&&(!('requestVideoFrameCallback' in v)||lastPresented.current===null)){const f=sourceIndexAt(timestamps,v.currentTime);const p=originalPoints.get(f);if(p){setCurrentTime(p.timeSec);onCurrentFrameChange?.(f);onPositionChange?.(p);}}};
 useEffect(()=>{if(busy)pauseSyncPending.current=false;if(wasBusy.current&&!busy&&isMetadataReady)seek(point);wasBusy.current=busy;},[busy]);
 useEffect(()=>{const v=videoRef.current;if(!v||!videoUrl)return;setFine(false);setPreview(null);setPreviewState('idle');setCurrentTime(timestamps[0]??0);setIsPlaying(false);setIsMetadataReady(false);setDecodedTime(null);lastPresented.current=null;setSourceSeeking(false);v.load();return()=>{v.pause();onVideoElementReady?.(null);};},[videoUrl]);
 useEffect(()=>{const v=videoRef.current;if(!v||!videoUrl||!('requestVideoFrameCallback' in v))return;let cancelled=false,handle:number;
  const callback=(_n:number,m:VideoFrameCallbackMetadata)=>{if(cancelled)return;setDecodedTime(m.mediaTime);lastPresented.current=m.mediaTime;if((!v.paused||pauseSyncPending.current)&&timestamps.length){const f=originalPoints.nearest(m.mediaTime),p=originalPoints.get(f);setCurrentTime(p.timeSec);onCurrentFrameChange?.(f);onPositionChange?.(p);}handle=v.requestVideoFrameCallback(callback);};handle=v.requestVideoFrameCallback(callback);return()=>{cancelled=true;v.cancelVideoFrameCallback(handle);};
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
   if(result.quality.identicalSources)throw Error('相鄰來源畫面相同，無法確認新增的中間影像；請退回原始模式');
   const canvas=previewCanvas.current;if(!canvas)throw Error('插值畫面未就緒');canvas.width=result.width;canvas.height=result.height;
   const context=canvas.getContext('2d');if(!context)throw Error('無法繪製中間影像，請退回原始模式');context.putImageData(new ImageData(result.data,result.width,result.height),0,0);setPreview(result);setPreviewState('ready');
  }catch(error){if(id===request.current){setPreviewState('failed');setPreviewError(error instanceof Error?error.message:'補幀暫時不可用，請使用原始模式');}}},100);
  return()=>{clearTimeout(timer);};
 },[videoUrl,isMetadataReady,isPlaying,point.timeSec,point.kind,timestamps]);
 const togglePlay=()=>{const v=videoRef.current;if(!v||busy)return;if(!v.paused){pauseSyncPending.current=true;v.pause();setIsPlaying(false);}else{pauseSyncPending.current=false;setPreview(null);v.play().then(()=>setIsPlaying(true)).catch(()=>setIsPlaying(false));}};
 const stepFrame=(delta:number)=>{const next=points.get(Math.max(0,Math.min(points.length-1,index+delta)));if(next)seek(next);};
 const mark=(name:'release'|'glove')=>{if(canMark)onSetEvent(name,selectEvent(point,timestamps,point.kind==='interpolated'?preview?.quality.level:undefined));};
 const switchMode=(next:boolean)=>{setFine(next);const timeline=createAnalysisTimeline(timestamps,fps,next,assumed),p=timeline.get(timeline.nearest(point.timeSec));if(p)seek(p);};
 const jump=(event:SelectedEvent|null)=>{if(!event)return;const next=event.kind==='interpolated'&&fps<90;setFine(next);const p=createAnalysisTimeline(timestamps,fps,next,assumed);seek(p.get(p.nearest(event.timeSec)));};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(busy||['INPUT','SELECT','TEXTAREA','BUTTON'].includes((e.target as HTMLElement)?.tagName))return;if(e.key==='ArrowLeft'){e.preventDefault();stepFrame(e.shiftKey?-5:-1);}else if(e.key==='ArrowRight'){e.preventDefault();stepFrame(e.shiftKey?5:1);}else if(e.code==='Space'){e.preventDefault();togglePlay();}else if(e.key==='[')mark('release');else if(e.key===']')mark('glove');};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[index,points,busy,canMark,isPlaying]);
 return <div className="space-y-0">

      <div 
        className={`video-stage relative w-full rounded-2xl overflow-hidden bg-black border-2 border-slate-700/80 shadow-2xl flex items-center justify-center group transition-all duration-300 min-h-[500px] h-[560px] lg:h-[620px]`}
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

            <canvas id="interpolated-preview" ref={previewCanvas} aria-label="局部運動插值畫面" className="absolute inset-0 w-full h-full object-contain pointer-events-none" style={{display:showPreview?'block':'none'}} data-preview-state={previewState} data-quality={preview?.quality.level??''} data-source-indices={JSON.stringify(preview?.sourceIndices??[])} data-source-media-times={JSON.stringify(preview?.sourceMediaTimes??[])} data-changed-a={preview?.changedA??0} data-changed-b={preview?.changedB??0}/>
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
       <input id="video-timeline" aria-label="影片時間軸" type="range" min={0} max={points.length-1} value={index} disabled={busy} onChange={e=>seek(points.get(Number(e.target.value)))} className="w-full accent-cyan-400"/>
       <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={togglePlay} className="px-3 rounded bg-blue-600 flex items-center gap-1">{isPlaying?<Pause size={16}/>:<Play size={16}/>} {isPlaying?'暫停':'播放'}</button>
        <button title="後退 5 幀" disabled={busy} onClick={()=>stepFrame(-5)}>-5</button><button title="後退 1 幀" disabled={busy} onClick={()=>stepFrame(-1)}>-1</button><button title="前進 1 幀" disabled={busy} onClick={()=>stepFrame(1)}>+1</button><button title="前進 5 幀" disabled={busy} onClick={()=>stepFrame(5)}>+5</button>
       </div>
       <div className="flex flex-wrap gap-2">
        <button id="set-release-time" disabled={!canMark} onClick={()=>mark('release')} className="px-3 bg-red-950 border border-red-500/50 rounded flex gap-1 items-center"><Pin size={14}/>設為出手</button>
        <button id="set-glove-time" disabled={!canMark} onClick={()=>mark('glove')} className="px-3 bg-amber-950 border border-amber-500/50 rounded flex gap-1 items-center"><Target size={14}/>設為進手套</button>
       </div>
       <div id="current-time-status" role="status" data-kind={point.kind} data-time={point.timeSec} data-source-index={point.left} data-position-index={index} data-position-count={points.length} data-decoded-time={decodedTime??''} className="text-cyan-200">
        {point.kind==='interpolated'?'推算':assumed?'原始定位（CFR假設）':'原始'} · {point.kind==='interpolated'?`F${point.left}→${point.right}`:`F${point.left}`} · {point.timeSec.toFixed(6)}s · 來源 {fps.toFixed(4)} FPS／{assumed?'時間位置數（原始數未確認）':'原始影格'} {totalFrames}
       </div>
       <div className="flex flex-wrap gap-2 items-center">
        <button id="mode-source" aria-pressed={!fine} disabled={busy} onClick={()=>switchMode(false)}>原始模式</button><button id="mode-fine" aria-pressed={fine} disabled={busy||fps>=90-1e-6} onClick={()=>switchMode(true)}>90 FPS 推算</button>
        <label>時間(s)<input id="timeline-time-input" aria-label="定位影片時間" type="number" step="any" min={timestamps[0]??0} max={timestamps.at(-1)??0} value={point.timeSec} disabled={busy} onChange={e=>{const p=points.get(points.nearest(Number(e.target.value)));if(p)seek(p);}} className="w-28"/></label>
        {!fine&&<label>原始索引<input id="source-frame-input" aria-label="定位原始影格" type="number" min={0} max={timestamps.length-1} value={point.left} disabled={busy} onChange={e=>{const f=Math.max(0,Math.min(timestamps.length-1,Math.round(Number(e.target.value))));seek(points.get(f));}} className="w-20"/></label>}
       </div>
       <div className="flex flex-wrap gap-2"><button id="jump-release-time" disabled={!events.release||busy} onClick={()=>jump(events.release)}>出手 {events.release?`${events.release.timeSec.toFixed(6)}s · ${events.release.kind==='interpolated'?'推算':events.release.kind==='cfr_assumed'?'CFR假設':'原始'}`:'未設定'}</button><button id="jump-glove-time" disabled={!events.glove||busy} onClick={()=>jump(events.glove)}>進手套 {events.glove?`${events.glove.timeSec.toFixed(6)}s · ${events.glove.kind==='interpolated'?'推算':events.glove.kind==='cfr_assumed'?'CFR假設':'原始'}`:'未設定'}</button></div>
       {fine&&<p className="text-[11px] text-amber-200">90Hz 網格＋全部原始PTS；相鄰位置間距可變，並非90FPS實拍。{previewState==='processing'?'局部補幀處理中…':previewState==='failed'?previewError:preview?.quality.note??''} {preview&&`${preview.quality.level==='low'?'低品質，可退回原始模式':'品質有限'}；運動區一致性 ${(preview.quality.reliableFraction*100).toFixed(0)}%（非棒球精度）`}</p>}
       {!fine&&decodedTime===null&&<p className="text-[11px] text-slate-400">原始PTS定位；瀏覽器未回報呈現時刻時，不保證逐樣本精確解碼。</p>}
      </div>}
    </div>;
}
