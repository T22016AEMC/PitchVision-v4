import React from 'react';
import {CameraGeometry,ImagePoint} from '../services/cameraGeometry';
import {ManualAnchorInput} from '../types';

export function CalibrationPanel(p:{
  disabled:boolean;interpolated:boolean;currentFrame:number;
  manualAnchor:ManualAnchorInput|null;onSelectAnchor:(point:1|2)=>void;onClearAnchors:()=>void;
  visibleEndFrame:number;releaseFrame:number;totalFrames:number;onVisibleEndFrame:(frame:number)=>void;
  referencePoints:(ImagePoint|null)[];onSelectReference:(index:number)=>void;
  referenceWidth:number;onReferenceWidth:(v:number)=>void;referenceLength:number;onReferenceLength:(v:number)=>void;
  referenceFocal:number|undefined;onReferenceFocal:(v:number|undefined)=>void;referenceConfirmed:boolean;onReferenceConfirmed:(v:boolean)=>void;
  cameraGeometry:CameraGeometry|null;onApply:()=>void;onClear:()=>void;
}){
  const lockPoint=p.interpolated||p.disabled;
  return <details id="calibration-panel" className="card">
    <summary className="card-title">選填校正：手動球位置與地面標定</summary>
    <div className="mt-3 space-y-4 text-sm">
      <fieldset className="space-y-2">
        <legend className="text-xs font-bold text-slate-300">手動錨點（追蹤走廊輔助）</legend>
        <div className="grid grid-cols-2 gap-2">
          <button id="mark-position-1" type="button" disabled={lockPoint} onClick={()=>p.onSelectAnchor(1)} className="btn-secondary">標記首個球位置 F{p.currentFrame}</button>
          <button id="mark-position-2" type="button" disabled={lockPoint} onClick={()=>p.onSelectAnchor(2)} className="btn-secondary">標記末個球位置 F{p.currentFrame}</button>
        </div>
        <button type="button" disabled={p.disabled} onClick={p.onClearAnchors} className="btn-secondary w-full">清除球位置</button>
        <p className="text-xs text-slate-400">{p.manualAnchor?.point1?`位置1 F${p.manualAnchor.point1.frame}`:'位置1未設定'} / {p.manualAnchor?.point2?`位置2 F${p.manualAnchor.point2.frame}`:'位置2未設定'}{p.interpolated?'；補幀畫面不可標記球位置':''}</p>
        <label className="block text-xs text-slate-300">球最後可見原始索引（追蹤提示，非接球事件）<input id="visible-end-frame" className="field mt-1" disabled={p.disabled} type="number" inputMode="numeric" min={p.releaseFrame} max={p.totalFrames-1} value={p.visibleEndFrame} onChange={e=>p.onVisibleEndFrame(Math.max(p.releaseFrame,Math.min(p.totalFrames-1,Number(e.target.value))))}/></label>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-xs font-bold text-slate-300">地面已知矩形（需有可量測的地面標記）</legend>
        <p className="text-xs text-slate-400">角點順序：出手端左→右→接球端右→左；請輸入實際量測尺度。</p>
        <div className="grid grid-cols-2 gap-2">{p.referencePoints.map((pt,i)=><button key={i} type="button" disabled={lockPoint} onClick={()=>p.onSelectReference(i)} className="btn-secondary">幾何角點{i+1}{pt?' ✓':''}</button>)}</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-300">已知寬 (m)<input className="field mt-1" type="number" inputMode="decimal" value={p.referenceWidth} onChange={e=>p.onReferenceWidth(Number(e.target.value))}/></label>
          <label className="text-xs text-slate-300">出手端至接球端已知長 (m)<input className="field mt-1" type="number" inputMode="decimal" value={p.referenceLength} onChange={e=>p.onReferenceLength(Number(e.target.value))}/></label>
        </div>
        <label className="block text-xs text-slate-300">已校準焦距（px，選填）<input className="field mt-1" type="number" inputMode="decimal" value={p.referenceFocal??''} onChange={e=>p.onReferenceFocal(Number(e.target.value)||undefined)}/></label>
        <label className="check"><input type="checkbox" checked={p.referenceConfirmed} onChange={e=>p.onReferenceConfirmed(e.target.checked)}/>已確認矩形與實際尺度</label>
        <div className="grid grid-cols-2 gap-2">
          <button id="apply-camera-calibration" type="button" disabled={p.disabled||!p.referenceConfirmed||p.referencePoints.some(pt=>!pt)} onClick={p.onApply} className="btn-secondary">套用幾何標定</button>
          <button type="button" disabled={p.disabled} onClick={p.onClear} className="btn-secondary">清除幾何標定</button>
        </div>
        {p.cameraGeometry&&<p id="camera-geometry-status" className="text-xs text-slate-300 break-words">{p.cameraGeometry.method} / {p.cameraGeometry.method==='planar_reference'?`yaw ${p.cameraGeometry.azimuthDeg.toFixed(1)}° / pitch ${p.cameraGeometry.elevationDeg.toFixed(1)}°`:'yaw / pitch 未估定'} / roll {p.cameraGeometry.rollDeg.toFixed(1)}°<br/>{p.cameraGeometry.limitations.join('；')}</p>}
      </fieldset>
    </div>
  </details>;
}
