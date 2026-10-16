import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Play,Pause,RotateCcw} from 'lucide-react';
import {MatchResult,TrajectoryPoint} from '../types';
import {CameraGeometry,projectWorld} from '../services/cameraGeometry';
import {standardCameras} from '../services/standardCamera';
import {independentObservations} from '../services/trackEvidence';

// Keep the original 2D sampler for comparison callers; it is not the scene's ball position.
export function sampleModelAtTime(track:TrajectoryPoint[],time:number){
 if(!track.length||time<track[0].timestamp_sec||time>track.at(-1)!.timestamp_sec)return null;
 const i=track.findIndex(p=>p.timestamp_sec>=time);if(i<=0)return track[0];
 const a=track[i-1],b=track[i],u=(time-a.timestamp_sec)/(b.timestamp_sec-a.timestamp_sec);
 return {x_norm:a.x_norm+(b.x_norm-a.x_norm)*u,y_norm:a.y_norm+(b.y_norm-a.y_norm)*u};
}
type World={x:number;y:number;z:number};
const W=640,H=480,WINDUP=1.1;
// Metres; +Y up, +Z release -> plate. Fixed standard field, NOT video pixels.
export const PITCH_FIELD={rubber:{x:0,y:.254,z:-.94},release:{x:0,y:1.78,z:0},plate:{x:0,y:0,z:17.5},glove:{x:0,y:.65,z:17.5},zone:{left:-.2159,right:.2159,bottom:.45,top:1.05}} as const;
export function sampleWorldAtTime(track:TrajectoryPoint[],time:number):World|null{
 if(!track.length||time<track[0].timestamp_sec||time>track.at(-1)!.timestamp_sec)return null;
 const i=track.findIndex(p=>p.timestamp_sec>=time),a=track[Math.max(0,i-1)],b=track[Math.max(0,i)],u=i>0?(time-a.timestamp_sec)/(b.timestamp_sec-a.timestamp_sec):0;
 const point={x:(a.world_x_cm+(b.world_x_cm-a.world_x_cm)*u)/100,y:(a.world_y_cm+(b.world_y_cm-a.world_y_cm)*u)/100,z:a.depth_z+(b.depth_z-a.depth_z)*u};
 return Object.values(point).every(Number.isFinite)?point:null;
}
function cameraProjection(g:CameraGeometry,p:World){
 const depth=g.rotation![2].reduce((sum,v,i)=>sum+v*[p.x,p.y,p.z][i],g.translation![2]);
 if(depth<=.05)return null;const q=projectWorld(g,p.x,p.y,p.z);return Number.isFinite(q.x)&&Number.isFinite(q.y)?q:null;
}
function sceneProjection(g:CameraGeometry){
 // Viewport framing uses ONLY fixed field landmarks, never the candidate/observations.
 const anchors=[{x:-1.2,y:.254,z:-1.7},{x:1.2,y:2.3,z:-.94},{x:-1,y:0,z:18.2},{x:1,y:1.3,z:18.2},{x:0,y:0,z:17.5}].map(p=>cameraProjection(g,p)).filter((p):p is {x:number;y:number}=>p!==null);
 if(anchors.length<2)return (_p:World)=>null;
 const minX=Math.min(...anchors.map(p=>p.x)),maxX=Math.max(...anchors.map(p=>p.x)),minY=Math.min(...anchors.map(p=>p.y)),maxY=Math.max(...anchors.map(p=>p.y));
 const scale=Math.min((W-64)/Math.max(1,maxX-minX),(H-96)/Math.max(1,maxY-minY));
 return (p:World)=>{const q=cameraProjection(g,p);return q?{x:W/2+(q.x-(minX+maxX)/2)*scale,y:H/2+14+(q.y-(minY+maxY)/2)*scale}:null;};
}
type Project=ReturnType<typeof sceneProjection>;
function line(ctx:CanvasRenderingContext2D,project:Project,points:World[],color:string,width=2,closed=false){
 ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();let started=false;
 for(const p of points){const q=project(p);if(!q){started=false;continue;}started?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);started=true;}
 if(closed)ctx.closePath();ctx.stroke();
}
function polygon(ctx:CanvasRenderingContext2D,project:Project,points:World[],color:string){
 const pixels=points.map(project);if(pixels.some(p=>!p))return;
 ctx.fillStyle=color;ctx.beginPath();pixels.forEach((p,i)=>i?ctx.lineTo(p!.x,p!.y):ctx.moveTo(p!.x,p!.y));ctx.closePath();ctx.fill();
}
function disc(ctx:CanvasRenderingContext2D,project:Project,center:World,rx:number,rz:number,color:string){
 polygon(ctx,project,Array.from({length:49},(_,i)=>({x:center.x+rx*Math.cos(i*Math.PI/24),y:center.y,z:center.z+rz*Math.sin(i*Math.PI/24)})),color);
}
function radiusAt(project:Project,p:World,r:number){const a=project(p),b=project({...p,x:p.x+r});return a&&b?Math.max(2,Math.min(20,Math.hypot(a.x-b.x,a.y-b.y))):2;}
function ball(ctx:CanvasRenderingContext2D,project:Project,p:World){
 const q=project(p);if(!q)return;const r=radiusAt(project,p,.0366);
 ctx.fillStyle='#fff';ctx.strokeStyle='#22c55e';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(q.x,q.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
 // Original V3 perspective ball and red seam treatment.
 if(r>5){ctx.strokeStyle='#dc2626';ctx.beginPath();ctx.arc(q.x-r*.35,q.y,r*.65,-.6,.6);ctx.stroke();ctx.beginPath();ctx.arc(q.x+r*.35,q.y,r*.65,Math.PI-.6,Math.PI+.6);ctx.stroke();}
}
function drawField(ctx:CanvasRenderingContext2D,project:Project,mode:'catcher'|'pitcher_rear'){
 // V3 field palette, wall/backstop, turf, dirt, plate and batter-box styling.
 // Ground objects and the nine-cell zone now share the candidate world transform.
 const horizon=Math.max(35,Math.min(H*.6,project({x:0,y:0,z:mode==='catcher'?-1000:1000})?.y??H*.35));
 ctx.fillStyle=mode==='catcher'?'#0f1e17':'#111827';ctx.fillRect(0,0,W,H);
 ctx.fillStyle='#173322';ctx.fillRect(0,horizon-45,W,45);ctx.fillStyle='#0d1b13';ctx.fillRect(W*.35,horizon-60,W*.3,60);
 if(mode==='pitcher_rear'){ctx.strokeStyle='#1f2937';ctx.lineWidth=1;for(let x=0;x<W;x+=18){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,horizon);ctx.stroke();}}
 ctx.fillStyle='#4e3321';ctx.fillRect(0,horizon-8,W,8);
 const turf=ctx.createLinearGradient(0,horizon,0,H);turf.addColorStop(0,'#1e3d2b');turf.addColorStop(1,'#13281c');ctx.fillStyle=turf;ctx.fillRect(0,horizon,W,H-horizon);
 disc(ctx,project,{x:0,y:0,z:-.94},2.7,1.8,'#5a3825');disc(ctx,project,PITCH_FIELD.rubber,1.5,1.1,'#6e4933');disc(ctx,project,PITCH_FIELD.plate,2.2,1.6,'#5a3825');
 polygon(ctx,project,[{x:-.305,y:.26,z:-1.02},{x:.305,y:.26,z:-1.02},{x:.305,y:.26,z:-.86},{x:-.305,y:.26,z:-.86}],'#f8fafc');
 const z=PITCH_FIELD.plate.z;
 polygon(ctx,project,[{x:0,y:.005,z:z+.216},{x:-.216,y:.005,z},{x:-.216,y:.005,z:z-.216},{x:.216,y:.005,z:z-.216},{x:.216,y:.005,z}],'#f8fafc');
 for(const side of [-1,1]){line(ctx,project,[{x:side*.48,y:.01,z:z-.6},{x:side*1.08,y:.01,z:z-.6},{x:side*1.08,y:.01,z:z+.6},{x:side*.48,y:.01,z:z+.6}],'rgba(255,255,255,.45)',1.5,true);line(ctx,project,[{x:0,y:.01,z},{x:side*7,y:.01,z:z-7}],'rgba(255,255,255,.35)',1);}
 const zone=PITCH_FIELD.zone;
 // Original yellow nine-cell strike zone; width .4318m, independently fixed in world.
 line(ctx,project,[{x:zone.left,y:zone.bottom,z},{x:zone.right,y:zone.bottom,z},{x:zone.right,y:zone.top,z},{x:zone.left,y:zone.top,z}],'#facc15',2.5,true);
 for(let i=1;i<3;i++){const x=zone.left+(zone.right-zone.left)*i/3,y=zone.bottom+(zone.top-zone.bottom)*i/3;line(ctx,project,[{x,y:zone.bottom,z},{x,y:zone.top,z}],'rgba(250,204,21,.45)',1);line(ctx,project,[{x:zone.left,y,z},{x:zone.right,y,z}],'rgba(250,204,21,.45)',1);}
 const label=project({x:zone.left,y:zone.top+.12,z});if(label){ctx.fillStyle='#facc15';ctx.font='bold 10px system-ui';ctx.fillText('STRIKE ZONE 九宮格',label.x-25,label.y);}
 const catcher=project({x:0,y:.65,z:z+.45}),head=project({x:0,y:1.0,z:z+.45});
 if(catcher&&head){ctx.fillStyle='#475569';ctx.beginPath();ctx.arc(head.x,head.y,radiusAt(project,{x:0,y:1,z:z+.45},.12),0,Math.PI*2);ctx.fill();ctx.fillStyle='#334155';ctx.beginPath();ctx.ellipse(catcher.x,catcher.y,Math.max(4,Math.abs(catcher.y-head.y)*.5),Math.max(5,Math.abs(catcher.y-head.y)),0,0,Math.PI*2);ctx.fill();}
}
function drawPitcher(ctx:CanvasRenderingContext2D,project:Project,elapsed:number,mode:'catcher'|'pitcher_rear'){
 // V3 head/body/throwing-arm flow and rear jersey. Phases are schematic joints,
 // fixed to the rubber/stride, not reconstructed pose or the ball's first pixel.
 const r=PITCH_FIELD.rubber,phase=Math.max(0,Math.min(1,(elapsed+WINDUP)/WINDUP));
 const frames=[
  {t:0,head:[0,2.13,r.z],hip:[0,1.18,r.z],shoulder:[-.18,1.75,r.z],elbow:[-.25,1.5,r.z+.15],hand:[0,1.5,r.z+.25],knee:[.12,.7,r.z+.05],foot:[.12,.254,r.z+.15]},
  {t:.35,head:[0,2.13,r.z],hip:[0,1.18,r.z],shoulder:[-.18,1.75,r.z],elbow:[-.38,1.5,r.z-.1],hand:[-.05,1.55,r.z+.2],knee:[.12,1.15,r.z+.25],foot:[.12,.85,r.z+.15]},
  {t:.7,head:[-.05,2.0,-.5],hip:[-.05,1.12,-.65],shoulder:[-.2,1.68,-.5],elbow:[-.4,1.65,-.65],hand:[-.2,1.98,-.7],knee:[.1,.65,-.05],foot:[.12,.08,.1]},
  {t:1,head:[-.06,1.98,-.2],hip:[-.08,1.03,-.45],shoulder:[-.18,1.62,-.22],elbow:[-.3,1.85,-.13],hand:[0,1.78,0],knee:[.1,.55,-.03],foot:[.12,.08,.1]}
 ];
 const i=Math.max(1,frames.findIndex(p=>p.t>=phase)),a=frames[i-1],b=frames[i],v=(phase-a.t)/(b.t-a.t),u=v*v*(3-2*v),follow=Math.min(1,Math.max(0,elapsed)/.25);
 const joint=(key:'head'|'hip'|'shoulder'|'elbow'|'hand'|'knee'|'foot'):World=>{const p=a[key].map((x,j)=>x+(b[key][j]-x)*u);if(key==='hand'){p[0]+=.3*follow;p[1]-=.85*follow;p[2]+=.45*follow;}if(key==='head'){p[1]-=.25*follow;p[2]+=.2*follow;}return{x:p[0],y:p[1],z:p[2]};};
 const head=joint('head'),hip=joint('hip'),shoulder=joint('shoulder'),elbow=joint('elbow'),hand=joint('hand'),neck={x:head.x,y:head.y-.17,z:head.z};
 line(ctx,project,[neck,hip],'#3b82f6',mode==='pitcher_rear'?8:5);
 line(ctx,project,[hip,joint('knee'),joint('foot')],'#cbd5e1',3);
 line(ctx,project,[hip,{x:-.12,y:.65+follow*.2,z:r.z},{x:-.15,y:r.y+follow*.4,z:r.z+follow*.2}],'#cbd5e1',3);
 line(ctx,project,[shoulder,elbow,hand],'#cbd5e1',3);
 line(ctx,project,[{x:shoulder.x+.35,y:shoulder.y,z:shoulder.z},{x:.35,y:1.35,z:-.1},{x:.2,y:1.3,z:.1}],'#cbd5e1',3);
 const h=project(head);if(h){ctx.fillStyle=mode==='catcher'?'#cbd5e1':'#0f172a';ctx.beginPath();ctx.arc(h.x,h.y,radiusAt(project,head,.12),0,Math.PI*2);ctx.fill();}
 if(mode==='pitcher_rear'){const torso=project({x:hip.x,y:(neck.y+hip.y)/2,z:hip.z}),top=project(neck),bottom=project(hip);if(torso&&top&&bottom){const h=Math.max(5,Math.hypot(top.x-bottom.x,top.y-bottom.y)/2),w=Math.max(3,h*26/38);ctx.fillStyle='#1e3a8a';ctx.beginPath();ctx.ellipse(torso.x,torso.y,w,h,-.15,0,Math.PI*2);ctx.fill();ctx.fillStyle='#facc15';ctx.font=`bold ${Math.max(8,h*.55)}px monospace`;ctx.fillText('18',torso.x-w*.6,torso.y+h*.2);}}
 const glove=project({x:.2,y:1.3,z:.1});if(glove){ctx.fillStyle='#8b5e3c';ctx.beginPath();ctx.ellipse(glove.x,glove.y,4,6,0,0,Math.PI*2);ctx.fill();}
 if(elapsed<0)ball(ctx,project,hand);
}

export function PitchVisualizer({result,active=true}:{result:MatchResult|null;active?:boolean}){
 const canvasRef=useRef<HTMLCanvasElement>(null),compareRef=useRef<HTMLCanvasElement>(null),[elapsed,setElapsed]=useState(-WINDUP),[playing,setPlaying]=useState(false);
 const [showObserved,setShowObserved]=useState(true),[showEstimated,setShowEstimated]=useState(true),[showModel,setShowModel]=useState(true);
 const model=useMemo(()=>(result?.model_track??[]).filter(p=>[p.timestamp_sec,p.world_x_cm,p.world_y_cm,p.depth_z,p.x_norm,p.y_norm].every(Number.isFinite)).sort((a,b)=>a.timestamp_sec-b.timestamp_sec),[result]);
 const mode=result?.camera_view??'catcher',matchedCamera=result?.spatial_calibration?.camera_geometry;
 const release=result?.event_times?.releaseTimeSec??model[0]?.timestamp_sec??0,duration=result?.event_times?result.event_times.catchTimeSec-release:result?.flight_time_sec??0,mediaTime=release+elapsed;
 const reliable=Boolean(result?.projection_match?.used&&result?.video_track_status==='VALID_TRACK');
 const observations=useMemo(()=>independentObservations(result?.visual_observations??result?.video_track??[],{releaseTimeSec:release,catchTimeSec:release+duration}),[result,release,duration]);
 const estimated=(result?.video_track??[]).filter(p=>p.source!=='vision');
 const camera=useMemo(()=>matchedCamera?.rotation&&matchedCamera.translation?matchedCamera:standardCameras(mode,W,H,17.5)[0],[matchedCamera,mode]);
 const project=useMemo(()=>sceneProjection(camera),[camera]);
 const at=sampleWorldAtTime(model,mediaTime),first=sampleWorldAtTime(model,model[0]?.timestamp_sec??0),end=sampleWorldAtTime(model,release+duration);
 const releaseGap=first?Math.hypot(first.x-PITCH_FIELD.release.x,first.y-PITCH_FIELD.release.y,first.z-PITCH_FIELD.release.z):0;
 const latest=observations.filter(p=>p.timestamp<=mediaTime).at(-1),comparisonWorld=latest?sampleWorldAtTime(model,latest.timestamp):null;
 const comparison=matchedCamera&&comparisonWorld?cameraProjection(matchedCamera,comparisonWorld):null;
 const deviation=latest&&comparison&&matchedCamera?Math.hypot(comparison.x-latest.x_norm*matchedCamera.width,comparison.y-latest.y_norm*matchedCamera.height):null;
 useEffect(()=>{setElapsed(-WINDUP);setPlaying(false);},[result]);
 useEffect(()=>{if(!active)setPlaying(false);},[active]);
 useEffect(()=>{if(!playing||!active||duration<=0)return;let id:number;const start=performance.now()-elapsed*1000;const loop=(now:number)=>{const t=(now-start)/1000;setElapsed(Math.min(duration,t));if(t>=duration)setPlaying(false);else id=requestAnimationFrame(loop);};id=requestAnimationFrame(loop);return()=>cancelAnimationFrame(id);},[playing,active,duration]);
 useEffect(()=>{
  if(!active)return;const ctx=canvasRef.current?.getContext('2d');if(!ctx)return;
  drawField(ctx,project,mode);drawPitcher(ctx,project,elapsed,mode);
  if(showModel&&model.length){line(ctx,project,model.map(p=>({x:p.world_x_cm/100,y:p.world_y_cm/100,z:p.depth_z})),'#10b981',3);if(elapsed>=0&&at)ball(ctx,project,at);}
  // Original V3 release marker/HUD, now tied to a fixed world release point.
  const rel=project(PITCH_FIELD.release);if(rel){ctx.strokeStyle='#ef4444';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(rel.x,rel.y,7,0,Math.PI*2);ctx.stroke();}
  ctx.fillStyle='rgba(15,23,42,.88)';ctx.beginPath();ctx.roundRect(14,14,260,66,8);ctx.fill();ctx.strokeStyle='#38bdf8';ctx.stroke();ctx.fillStyle='#38bdf8';ctx.font='bold 12px system-ui';ctx.fillText(`VELOCITY: ${result?.velocity_kmh??'--'} km/h`,24,35);ctx.fillStyle='#facc15';ctx.font='11px system-ui';ctx.fillText(mode==='catcher'?'CAM: 捕手後方近中線':'CAM: 投手後方偏側',24,53);ctx.fillStyle='#cbd5e1';ctx.fillText('固定標準球場／示意投球動作',24,69);
 },[active,elapsed,model,project,mode,showModel,result]);
 useEffect(()=>{
  if(!active)return;const ctx=compareRef.current?.getContext('2d');if(!ctx)return;
  const width=240,height=180,sw=matchedCamera?.width??720,sh=matchedCamera?.height??1280,scale=Math.min(width/sw,height/sh),ox=(width-sw*scale)/2,oy=(height-sh*scale)/2;
  const pixel=(x:number,y:number)=>({x:ox+x*sw*scale,y:oy+y*sh*scale});ctx.fillStyle='#020617';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#475569';ctx.strokeRect(ox,oy,sw*scale,sh*scale);
  if(showModel){ctx.strokeStyle='#10b981';ctx.lineWidth=1.5;ctx.beginPath();model.forEach((p,i)=>{const q=pixel(p.x_norm,p.y_norm);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();}
  for(const p of [...(showObserved&&reliable?observations:[]),...(showEstimated?estimated:[])]){if(p.timestamp>mediaTime)continue;const q=pixel(p.x_norm,p.y_norm);const real=p.source==='observation'||p.source==='vision';ctx.fillStyle=real?'#22d3ee':'#f59e0b';ctx.strokeStyle=ctx.fillStyle;ctx.beginPath();ctx.arc(q.x,q.y,real?2.5:3,0,Math.PI*2);real?ctx.fill():ctx.stroke();}
  if(reliable&&showObserved&&latest&&comparison&&matchedCamera){const a=pixel(latest.x_norm,latest.y_norm),b=pixel(comparison.x/matchedCamera.width,comparison.y/matchedCamera.height);ctx.strokeStyle='#f472b6';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
 },[active,model,observations,estimated,matchedCamera,mediaTime,reliable,showObserved,showEstimated,showModel]);
 return <div id="pitch-visualizer-container" className="space-y-3">
  <div className="video-stage relative w-full rounded-2xl overflow-hidden bg-slate-950 border-2 border-slate-700/80 min-h-[500px] h-[80dvh] max-h-[960px] flex items-center justify-center">
   <canvas id="pitch-canvas" ref={canvasRef} width={W} height={H} className="w-full h-full object-contain" aria-label="固定世界座標球場、原版投手與勝出候選3D動畫"/>
   {result&&<div className="absolute bottom-3 right-3 w-[42%] max-w-[240px] bg-slate-950/90 rounded border border-slate-600 text-[10px] text-cyan-200"><p className="px-2 py-1">影片2D對照／匹配用攝影機</p><canvas id="projection-comparison" ref={compareRef} width={240} height={180} className="w-full" aria-label="可靠AI觀測與同時間候選投影的2D比較"/></div>}
  </div>
  <p className={`text-xs ${reliable?'text-cyan-300':'text-amber-300'}`}>{reliable?'可靠AI觀測已參與匹配；動畫播放勝出候選的條件式3D模型，並非唯一真實3D重建。':'僅資料庫模擬，未取得可靠 AI 觀測；不可當成已重現本次實際球路。'}</p>
  <div className="flex flex-wrap gap-2 items-center text-xs">
   <button id="btn-toggle-play" disabled={!model.length} onClick={()=>{if(elapsed>=duration)setElapsed(-WINDUP);setPlaying(!playing);}} className="min-h-11 px-3 bg-blue-600 rounded flex items-center gap-2 disabled:opacity-40">{playing?<Pause size={16}/>:<Play size={16}/>} {playing?'暫停':'播放投球動畫'}</button>
   <button id="btn-reset-frame" disabled={!model.length} onClick={()=>{setElapsed(-WINDUP);setPlaying(true);}} className="min-h-11 px-3 bg-slate-800 rounded flex items-center gap-2"><RotateCcw size={16}/>重新播放</button>
   <span className="font-mono">{elapsed<0?'準備／抬腿／跨步／出手':`飛行 ${Math.max(0,elapsed).toFixed(4)} / ${duration.toFixed(4)} 秒`}</span>
  </div>
  <div className="flex flex-wrap gap-2 text-xs">
   <button id="toggle-video-track" aria-pressed={showObserved} onClick={()=>setShowObserved(!showObserved)} className="min-h-11 px-3 border rounded text-cyan-300">{showObserved?'✓ ':''}可靠 AI 2D觀測</button>
   <button id="toggle-estimated-track" aria-pressed={showEstimated} onClick={()=>setShowEstimated(!showEstimated)} className="min-h-11 px-3 border rounded text-amber-300">{showEstimated?'✓ ':''}插值／預測（非觀測）</button>
   <button id="toggle-model-track" aria-pressed={showModel} onClick={()=>setShowModel(!showModel)} className="min-h-11 px-3 border rounded text-emerald-300">{showModel?'✓ ':''}勝出候選模擬（估計）</button>
  </div>
  <p className="text-xs text-slate-400">原版球場與投手風格；頭身／擺臂流程沿用V3，抬腿、跨步與收尾為示意。場景與手部均固定世界座標，不依球體像素搬動。攝影機仍屬幾何估計。青點只在右下2D對照顯示，不偽造3D觀測。</p>
  {result&&<div id="tracking-evidence-status" className="text-xs space-y-1 bg-slate-950/60 rounded p-3" aria-live="polite">
   <p>出手 {release.toFixed(6)}s → 進手套 {(release+duration).toFixed(6)}s；飛行 {duration.toFixed(4)} 秒。{result.original_flight_frames==null?'原始影格數未確認':`區間內原始影格 ${result.original_flight_frames} 張`}。</p>
   <p>獨立觀測 {result.projection_match?.observation_count??0} 點；未找到／排除 {result.tracking_evidence?.excludedFrames??0} 張；{result.projection_match?.used?'已使用軌跡匹配':'未使用軌跡匹配'}：{result.projection_match?.reason||result.tracking_evidence?.reason||'觀測不足'}。</p>
   <p>原相機同時間比較：{reliable&&latest?`${latest.timestamp.toFixed(6)}s，偏差 ${deviation===null?'無候選時間支持':deviation.toFixed(2)+' px'}`:'尚無當前可靠觀測'}。匹配總殘差 {result.projection_match?.used&&Number.isFinite(result.projection_match.rmse_px)?result.projection_match.rmse_px!.toFixed(2)+' px':'未計算'}，非準確率。</p>
   <p>候選時間覆蓋 {(model.at(-1)?.timestamp_sec-(model[0]?.timestamp_sec??0)||0).toFixed(4)} 秒；依手動事件秒數停止，不拉伸曲線或補造端點。{!end?'進手套事件不在候選時間覆蓋內，該段無模型樣本。':`進手套時模型距本壘平面 ΔZ ${(end.z-PITCH_FIELD.plate.z).toFixed(3)}m，X ${end.x.toFixed(3)}m／高度 ${end.y.toFixed(3)}m（非量測終點）。`}</p>
   {releaseGap>.25&&<p className="text-amber-300">候選出手點距固定出手位置 {releaseGap.toFixed(2)}m；保留差異，未移動投手或扭曲球路。</p>}
   <p>IVB {result.ivb_inch.toFixed(1)} / HB {result.hb_inch.toFixed(1)} 吋：{result.movement_definition}</p>
  </div>}
 </div>;
}
