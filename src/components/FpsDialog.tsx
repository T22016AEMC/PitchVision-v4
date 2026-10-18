import React,{useState} from 'react';

// Shown only when the container timing cannot be read. The app never guesses an FPS:
// playback and marking stay blocked until the user picks the real shooting FPS.
export function FpsDialog({error,onPick,onCancel}:{error:string|null;onPick:(fps:number)=>void;onCancel:()=>void}){
  const [other,setOther]=useState('');
  const otherFps=Number(other);
  return <div id="fps-dialog" role="dialog" aria-modal="true" aria-labelledby="fps-dialog-title" className="fixed inset-0 z-50 bg-slate-950/85 flex items-end sm:items-center justify-center p-4">
    <div className="w-full max-w-[420px] card space-y-3 bg-slate-900">
      <h2 id="fps-dialog-title" className="text-base font-bold text-white">拍攝時是幾 FPS？</h2>
      <p className="text-xs text-slate-300">讀不到這支影片的影格時間，請選拍攝時的 FPS（相機設定裡的幀率）。選錯會讓球速偏差。</p>
      <div className="grid grid-cols-4 gap-2">
        {[30,60,120,240].map(fps=><button key={fps} type="button" id={`fps-pick-${fps}`} onClick={()=>onPick(fps)} className="btn-secondary !text-base !font-bold">{fps}</button>)}
      </div>
      <div className="flex items-end gap-2">
        <label className="flex-1 text-xs text-slate-300">其他 FPS<input id="fps-other" className="field mt-1" type="number" inputMode="decimal" min="1" max="1000" step="any" placeholder="例如 25" value={other} onChange={e=>setOther(e.target.value)}/></label>
        <button type="button" id="fps-pick-other" disabled={!(otherFps>=1&&otherFps<=1000)} onClick={()=>onPick(otherFps)} className="btn-secondary !w-auto px-4">確定</button>
      </div>
      {error&&<p role="alert" className="text-xs text-rose-300 break-words">{error}</p>}
      <button type="button" id="fps-cancel" onClick={onCancel} className="link-btn !text-slate-400">取消，換一支影片</button>
    </div>
  </div>;
}
