import React, {useEffect,useMemo,useRef,useState} from 'react';
import {Play,Pause,RotateCcw} from 'lucide-react';
import {MatchResult,TrajectoryPoint} from '../types';

export function sampleModelAtTime(track:TrajectoryPoint[],time:number){
 if(!track.length||time<track[0].timestamp_sec||time>track.at(-1)!.timestamp_sec)return null;
 let i=track.findIndex(p=>p.timestamp_sec>=time);if(i<=0)return track[0];
 const a=track[i-1],b=track[i],u=(time-a.timestamp_sec)/(b.timestamp_sec-a.timestamp_sec);
 return {x_norm:a.x_norm+(b.x_norm-a.x_norm)*u,y_norm:a.y_norm+(b.y_norm-a.y_norm)*u};
}

/** Restored V3/V4 pitcher gesture; all ball-flight coordinates now come only
 * from the winning matcher's projected model, never an IVB/HB illustration. */
export function PitchVisualizer({result,active=true}:{result:MatchResult|null;active?:boolean}){
 const canvasRef=useRef<HTMLCanvasElement>(null),[elapsed,setElapsed]=useState(-.45),[playing,setPlaying]=useState(false);
 const [showObserved,setShowObserved]=useState(true),[showEstimated,setShowEstimated]=useState(true),[showModel,setShowModel]=useState(true);
 const model=useMemo(()=>(result?.model_track??[]).filter(p=>[p.timestamp_sec,p.x_norm,p.y_norm].every(Number.isFinite)).sort((a,b)=>a.timestamp_sec-b.timestamp_sec),[result]);
 const points=result?.visual_observations??result?.video_track??[],estimated=(result?.video_track??[]).filter(p=>p.source!=='vision');
 const geometry=result?.spatial_calibration?.camera_geometry,mode=result?.camera_view??'catcher';
 const width=720,height=Math.round(width*(geometry?.height??1280)/(geometry?.width??720));
 const duration=result?.flight_time_sec??0,release=model[0]?.timestamp_sec??0;
 useEffect(()=>{setElapsed(-.45);setPlaying(false);},[result]);
 useEffect(()=>{if(!active)setPlaying(false);},[active]);
 useEffect(()=>{
  if(!playing||!active||duration<=0)return;
  let id:number;const start=performance.now()-elapsed*1000;
  const loop=(now:number)=>{const t=(now-start)/1000;setElapsed(Math.min(duration,t));if(t>=duration)setPlaying(false);else id=requestAnimationFrame(loop);};
  id=requestAnimationFrame(loop);return()=>cancelAnimationFrame(id);
 },[playing,active,duration]);
 useEffect(()=>{
  if(!active)return;const ctx=canvasRef.current?.getContext('2d');if(!ctx)return;
  drawField(ctx,width,height,mode);
  if(!model.length){ctx.fillStyle='#cbd5e1';ctx.font='20px system-ui';ctx.fillText('分析完成後顯示候選球路',24,50);return;}
  // Normalized video coordinates share the camera's source aspect ratio. No 3D
  // reconstruction is attributed to the observed image points.
  if(showModel){ctx.strokeStyle='#10b981';ctx.lineWidth=3;ctx.beginPath();model.forEach((p,i)=>{i?ctx.lineTo(p.x_norm*width,p.y_norm*height):ctx.moveTo(p.x_norm*width,p.y_norm*height);});ctx.stroke();}
  for(const p of [...(showObserved?points:[]),...(showEstimated?estimated:[])]){
   if(![p.x_norm,p.y_norm,p.timestamp].every(Number.isFinite))continue;
   const real=p.source==='vision'&&!p.is_outlier;ctx.strokeStyle=real?'#22d3ee':'#f59e0b';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2;
   ctx.beginPath();ctx.arc(p.x_norm*width,p.y_norm*height,real?4:5,0,Math.PI*2);real?ctx.fill():ctx.stroke();
  }
  const origin={x:model[0].x_norm*width,y:model[0].y_norm*height};
  drawPitcher(ctx,origin.x,origin.y,Math.min(1,Math.max(0,(elapsed+.45)/.45)));
  const ball=elapsed>=0?sampleModelAtTime(model,release+elapsed):null;
  if(showModel&&ball){ctx.fillStyle='#fff';ctx.strokeStyle='#ef4444';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(ball.x_norm*width,ball.y_norm*height,6,0,Math.PI*2);ctx.fill();ctx.stroke();}
 },[active,elapsed,model,points,estimated,showObserved,showEstimated,showModel,width,height,mode]);
  const drawField = (ctx: CanvasRenderingContext2D, width: number, height: number, mode: 'catcher'|'pitcher_rear') => {
    const horizonY = height * 0.48;

    if (mode === 'catcher') {
      // 捕手平視低角度球場
      // 1. 遠方球場外野看台與綠色全壘打牆 (上半部)
      ctx.fillStyle = '#0F1E17';
      ctx.fillRect(0, 0, width, horizonY);

      // 外野綠色牆面與深色打擊之眼 (Batter's Eye)
      ctx.fillStyle = '#173322';
      ctx.fillRect(0, horizonY - 45, width, 45);
      ctx.fillStyle = '#0D1B13';
      ctx.fillRect(width * 0.35, horizonY - 60, width * 0.30, 60);

      // 外野警示帶 (Warning Track)
      ctx.fillStyle = '#4E3321';
      ctx.fillRect(0, horizonY - 8, width, 8);

      // 2. 內野草皮 (下半部平視延伸)
      const turfGrad = ctx.createLinearGradient(0, horizonY, 0, height);
      turfGrad.addColorStop(0, '#1E3D2B');
      turfGrad.addColorStop(1, '#13281C');
      ctx.fillStyle = turfGrad;
      ctx.fillRect(0, horizonY, width, height - horizonY);

      // 遠方投手丘 (平視透視微凸形)
      ctx.fillStyle = '#6E4933';
      ctx.beginPath();
      ctx.ellipse(width * 0.48, horizonY + 6, width * 0.14, height * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();

      // 投手板白色細條
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(width * 0.46, horizonY + 1, width * 0.04, 3);

      // 前景本壘板紅土扇形區 (底部近景)
      ctx.fillStyle = '#5A3825';
      ctx.beginPath();
      ctx.ellipse(width * 0.50, height * 0.82, width * 0.36, height * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();

      // 本壘板 (平視透視五邊形，位於好球帶下方)
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.moveTo(width * 0.50, height * 0.74);
      ctx.lineTo(width * 0.45, height * 0.71);
      ctx.lineTo(width * 0.45, height * 0.69);
      ctx.lineTo(width * 0.55, height * 0.69);
      ctx.lineTo(width * 0.55, height * 0.71);
      ctx.closePath();
      ctx.fill();

      // 左右打擊區白線
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(width * 0.28, height * 0.64, width * 0.09, height * 0.14);
      ctx.strokeRect(width * 0.63, height * 0.64, width * 0.09, height * 0.14);

    } else {
      // 投手後方低角度平視球場 (Over-the-shoulder POV)
      // 1. 遠方本壘後方看台與擋網 (上半部)
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, width, horizonY);

      // 擋網細格紋理
      ctx.strokeStyle = '#1F2937';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, horizonY);
        ctx.stroke();
      }

      // 2. 內野草地
      const turfGrad = ctx.createLinearGradient(0, horizonY, 0, height);
      turfGrad.addColorStop(0, '#193324');
      turfGrad.addColorStop(1, '#234430');
      ctx.fillStyle = turfGrad;
      ctx.fillRect(0, horizonY, width, height - horizonY);

      // 遠方本壘板紅土小圓
      ctx.fillStyle = '#6E4933';
      ctx.beginPath();
      ctx.ellipse(width * 0.50, horizonY + 12, width * 0.12, height * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();

      // 遠方蹲捕之捕手剪影
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(width * 0.50, horizonY + 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.roundRect(width * 0.48, horizonY + 7, width * 0.04, 14, 3);
      ctx.fill();

      // 近處投手丘前緣與投球板
      ctx.fillStyle = '#5A3825';
      ctx.beginPath();
      ctx.ellipse(width * 0.45, height * 0.88, width * 0.35, height * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(width * 0.41, height * 0.84, width * 0.08, 4);

    }
  };

 return <div id="pitch-visualizer-container" className="space-y-3">
  <div className="video-stage relative w-full rounded-2xl overflow-hidden bg-slate-950 border-2 border-slate-700/80 min-h-[500px] h-[80dvh] max-h-[960px] flex items-center justify-center">
   <canvas id="pitch-canvas" ref={canvasRef} width={width} height={height} className="w-full h-full object-contain" aria-label="相同攝影機投影座標下的觀測與候選模擬"/>
  </div>
  <div className="flex flex-wrap gap-2 items-center text-xs">
   <button id="btn-toggle-play" disabled={!model.length} onClick={()=>{if(elapsed>=duration)setElapsed(-.45);setPlaying(!playing);}} className="min-h-11 px-3 bg-blue-600 rounded flex items-center gap-2 disabled:opacity-40">{playing?<Pause size={16}/>:<Play size={16}/>} {playing?'暫停':'播放投球動畫'}</button>
   <button id="btn-reset-frame" disabled={!model.length} onClick={()=>{setElapsed(-.45);setPlaying(true);}} className="min-h-11 px-3 bg-slate-800 rounded flex items-center gap-2"><RotateCcw size={16}/>重新播放</button>
   <span className="font-mono">飛行 {Math.max(0,elapsed).toFixed(4)} / {duration.toFixed(4)} 秒</span>
  </div>
  <div className="flex flex-wrap gap-2 text-xs">
   <button id="toggle-video-track" aria-pressed={showObserved} onClick={()=>setShowObserved(!showObserved)} className="min-h-11 px-3 border rounded text-cyan-300">{showObserved?'✓ ':''}AI 觀測點</button>
   <button id="toggle-estimated-track" aria-pressed={showEstimated} onClick={()=>setShowEstimated(!showEstimated)} className="min-h-11 px-3 border rounded text-amber-300">{showEstimated?'✓ ':''}插值／預測（非觀測）</button>
   <button id="toggle-model-track" aria-pressed={showModel} onClick={()=>setShowModel(!showModel)} className="min-h-11 px-3 border rounded text-emerald-300">{showModel?'✓ ':''}勝出候選模型</button>
  </div>
  <p className="text-xs text-slate-400">火柴人為投球動作示意；青色為2D影像觀測候選，琥珀空心點為非觀測，綠線為排名使用的相同攝影機投影。未重建已確認的真實3D。</p>
  {result&&<div id="tracking-evidence-status" className="text-xs space-y-1 bg-slate-950/60 rounded p-3" aria-live="polite">
   <p>追蹤：{result.tracking_evidence?.trackReliable?'時空品質通過（球體身份待驗收）':result.tracking_evidence?.trackFound?'找到候選，可靠度不足':'未取得可靠球體候選'}。</p>
   <p>獨立觀測 {result.projection_match?.observation_count??points.length} 點；未找到／排除 {result.tracking_evidence?.excludedFrames??0} 張；呈現未確認 {result.tracking_evidence?.unverifiedFrames??0} 張。</p>
   <p>{result.projection_match?.used?'已使用真實觀測候選進行軌跡排名':'未使用軌跡排名'}：{result.projection_match?.reason||result.tracking_evidence?.reason||'沒有足夠獨立觀測'}</p>
   <p>匹配誤差 {result.projection_match?.used&&Number.isFinite(result.projection_match.rmse_px)?`${result.projection_match.rmse_px!.toFixed(2)} px（排名殘差，非準確率）`:'未計算'}；{result.projection_match?.rpm_distinguishable?'候選庫內RPM可區分，非旋轉直接量測':'RPM／轉軸／效率仍有候選歧義'}。</p>
   <p>模型時間覆蓋 {(model.at(-1)?.timestamp_sec-release||0).toFixed(4)} 秒；動畫依事件時差播放，超出候選時間不外推。</p>
   <p>IVB {result.ivb_inch.toFixed(1)} / HB {result.hb_inch.toFixed(1)} 吋：{result.movement_definition}</p>
  </div>}
 </div>;
}

function drawPitcher(ctx:CanvasRenderingContext2D,releaseX:number,releaseY:number,phase:number){
 // Original V3 head/body/arm gesture, translated so the release hand meets the
 // candidate's projected release; the gesture itself is not pose measurement.
 const headX=releaseX+18*Math.cos(Math.PI*.8),headY=releaseY-5-14*Math.sin(Math.PI*.8);
 ctx.fillStyle='#cbd5e1';ctx.beginPath();ctx.arc(headX,headY,7,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle='#3b82f6';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(headX,headY+7);ctx.lineTo(headX,headY+34);ctx.stroke();
 const angle=phase*Math.PI*.8;ctx.strokeStyle='#cbd5e1';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(headX,headY+5);ctx.lineTo(headX-18*Math.cos(angle),headY+5+14*Math.sin(angle));
 ctx.moveTo(headX,headY+34);ctx.lineTo(headX-10-phase*7,headY+51);ctx.moveTo(headX,headY+34);ctx.lineTo(headX+10,headY+51);ctx.moveTo(headX,headY+13);ctx.lineTo(headX+15,headY+24);ctx.stroke();
}
