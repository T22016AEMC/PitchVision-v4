import React,{useEffect,useRef,useState} from 'react';
import {CameraGeometry,ImagePoint,calibrateGroundReference} from '../services/cameraGeometry';

// Advanced: calibrate from a known rectangle on the ground (needs a real tape-measured size).
// Corners are picked on a snapshot of the current video frame; nothing here has default sizes.
export function GroundCalibration({video,hasVideo,disabled,geometry,onApply,onClear}:{
  video:HTMLVideoElement|null;hasVideo:boolean;disabled:boolean;geometry:CameraGeometry|null;
  onApply:(geometry:CameraGeometry)=>void;onClear:()=>void;
}){
  const canvas=useRef<HTMLCanvasElement|null>(null);
  const [points,setPoints]=useState<(ImagePoint|null)[]>([null,null,null,null]);
  const [width,setWidth]=useState(''),[length,setLength]=useState(''),[focal,setFocal]=useState('');
  const [confirmed,setConfirmed]=useState(false),[snapshot,setSnapshot]=useState(false),[snapTick,setSnapTick]=useState(0),[message,setMessage]=useState<string|null>(null);
  const next=points.findIndex(p=>!p);
  const draw=(pts:(ImagePoint|null)[])=>{
    const c=canvas.current;if(!c||!video||!video.videoWidth)return false;
    const w=Math.min(420,video.videoWidth),h=Math.round(w*video.videoHeight/video.videoWidth);
    if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
    const ctx=c.getContext('2d');if(!ctx)return false;
    ctx.drawImage(video,0,0,w,h);
    pts.forEach((p,i)=>{if(!p)return;const x=p.x*w,y=p.y*h;ctx.fillStyle='#22d3ee';ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#082f49';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x,y);});
    return true;
  };
  // The canvas only exists once a snapshot is requested, so drawing happens in the effect after it mounts.
  const capture=()=>{setMessage(null);setPoints([null,null,null,null]);setConfirmed(false);setSnapshot(true);setSnapTick(t=>t+1);};
  useEffect(()=>{
    if(!snapshot)return;
    if(!draw(points)){setSnapshot(false);setMessage('目前無法讀取影片畫面，請先在影片頁暫停在要使用的畫面。');}
  },[points,snapshot,snapTick]);
  const pick=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(next<0||disabled)return;const r=e.currentTarget.getBoundingClientRect();
    const x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
    setPoints(prev=>prev.map((p,i)=>i===next?{x,y}:p));setConfirmed(false);
  };
  const widthM=Number(width),lengthM=Number(length),focalPx=Number(focal)||undefined;
  const ready=confirmed&&points.every(Boolean)&&widthM>0&&lengthM>0;
  const apply=()=>{
    if(!video)return;
    try{onApply(calibrateGroundReference(video.videoWidth,video.videoHeight,{points:points as ImagePoint[],widthM,lengthM,focalPx}));setMessage(null);}
    catch(error){setMessage(error instanceof Error?error.message:'標定失敗');}
  };
  const clear=()=>{setPoints([null,null,null,null]);setConfirmed(false);setSnapshot(false);setMessage(null);onClear();};
  return <details id="ground-calibration" className="card">
    <summary className="card-title">進階：地面已知矩形標定</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-xs text-slate-400">只在地面有已量測過長寬的矩形（例如用膠帶貼出的投球線範圍）時使用。一般情況不需要，程式會自動校正。角點順序：出手端左 → 出手端右 → 接球端右 → 接球端左。</p>
      {!hasVideo?<p className="text-xs text-amber-200">請先選擇影片。</p>:<>
        <button type="button" id="ground-capture" disabled={disabled} onClick={capture} className="btn-secondary">擷取目前影片畫面</button>
        {snapshot&&<div className="space-y-2">
          <p id="ground-next" className="text-xs text-cyan-200">{next>=0?`請點第 ${next+1} 個角點`:'4 個角點已選好'}</p>
          <canvas ref={canvas} id="ground-canvas" onPointerDown={pick} className="w-full rounded-xl border border-slate-700 touch-none" aria-label="點選地面矩形角點"/>
          <button type="button" disabled={disabled||!points.some(Boolean)} onClick={()=>{setPoints(prev=>{const i=prev.map(Boolean).lastIndexOf(true);return prev.map((p,j)=>j===i?null:p);});setConfirmed(false);}} className="btn-secondary">取消上一個角點</button>
        </div>}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-300">矩形寬 (m)<input id="ground-width" className="field mt-1" type="number" inputMode="decimal" min="0" step="any" value={width} onChange={e=>{setWidth(e.target.value);setConfirmed(false);}}/></label>
          <label className="text-xs text-slate-300">出手端至接球端長 (m)<input id="ground-length" className="field mt-1" type="number" inputMode="decimal" min="0" step="any" value={length} onChange={e=>{setLength(e.target.value);setConfirmed(false);}}/></label>
        </div>
        <label className="block text-xs text-slate-300">已校準焦距（px，選填）<input className="field mt-1" type="number" inputMode="decimal" min="0" step="any" value={focal} onChange={e=>setFocal(e.target.value)}/></label>
        <label className="check"><input type="checkbox" checked={confirmed} disabled={!points.every(Boolean)||!(widthM>0&&lengthM>0)} onChange={e=>setConfirmed(e.target.checked)}/>已確認角點與實際尺度正確</label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" id="apply-camera-calibration" disabled={disabled||!ready} onClick={apply} className="btn-secondary">套用幾何標定</button>
          <button type="button" disabled={disabled} onClick={clear} className="btn-secondary">清除幾何標定</button>
        </div>
      </>}
      {message&&<p role="alert" className="text-xs text-rose-300 break-words">{message}</p>}
      {geometry&&<p id="camera-geometry-status" className="text-xs text-slate-300 break-words">{geometry.method} / {geometry.method==='planar_reference'?`yaw ${geometry.azimuthDeg.toFixed(1)}° / pitch ${geometry.elevationDeg.toFixed(1)}°`:'yaw / pitch 未估定'} / roll {geometry.rollDeg.toFixed(1)}°<br/>{geometry.limitations.join('；')}</p>}
    </div>
  </details>;
}
