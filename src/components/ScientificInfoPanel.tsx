import React,{useEffect} from 'react';
import {X} from 'lucide-react';
import {MetricsPanel} from './MetricsPanel';
import {VideoQualityCard} from './VideoQualityCard';
import {MatchResult} from '../types';
import {VideoQualityAssessment} from '../services/videoMetadataService';

export function ScientificInfoPanel({open,onClose,result,quality,fileName,fps,onDatabase,onCode,timingNote}:{open:boolean;onClose:()=>void;result:MatchResult|null;quality:VideoQualityAssessment|null;fileName:string;fps:number;onDatabase:()=>void;onCode:()=>void;timingNote?:string}) {
  useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',key);document.body.style.overflow='hidden';return()=>{window.removeEventListener('keydown',key);document.body.style.overflow='';};},[open,onClose]);
  if(!open)return null;
  return <section id="science-center" role="dialog" aria-modal="true" aria-label="科學資訊中心" className="fixed inset-0 z-40 bg-slate-950 overflow-y-auto overscroll-contain">
    <div className="sticky top-0 bg-slate-950/95 border-b border-slate-800 backdrop-blur">
      <div className="mx-auto max-w-[480px] px-4 py-3 flex items-center justify-between gap-2">
        <h2 className="font-bold text-cyan-300">科學資訊中心</h2>
        <button type="button" id="btn-close-science" onClick={onClose} className="icon-btn" aria-label="返回分析操作"><X size={20}/><span className="text-xs">返回</span></button>
      </div>
    </div>
    <div className="mx-auto max-w-[480px] px-4 py-4 pb-12 space-y-4">
      <div className="grid grid-cols-1 gap-2">
        <button id="btn-view-database" type="button" onClick={onDatabase} className="btn-secondary">科學參考庫／下載 JSON</button>
        <button id="btn-view-code" type="button" onClick={onCode} className="btn-secondary">Python 原始碼／下載</button>
      </div>
      <p className="text-xs text-slate-300">球速為距離與出手／接球時間差換算的平均速度。正式IVB/HB使用勝出資料庫候選RK4相對同初值、同秒數無旋轉（含重力及阻力）之差，非影像直接量測。RPM與Efficiency在單視角下耦合，最終參數保留資料庫候選及其歧義。</p>
      <p className="text-xs text-amber-300">{timingNote} 單一平面標定只能約束相機與平面，離地球的深度仍為條件假設。未知畸變、距離與遮蔽可能主導誤差。解碼時間表平均FPS與平均呈現FPS不等於曝光快門；曝光/相機穩定性尚未獨立量測。</p>
      <p className="text-xs">原有獨立 Python 範例：streamlit run app.py（與網頁引擎不同）。資料庫為合成參考，未重新生成。</p>
      {result?.movement_definition&&<p className="text-xs text-indigo-200">正式IVB/HB定義：{result.movement_definition} 原庫欄位保留作診斷，不用總下墜或像素位移取代。</p>}
      {result?.spatial_calibration?.camera_geometry&&<p className="text-xs break-words">攝影幾何：{result.spatial_calibration.camera_geometry.method}；{result.spatial_calibration.camera_geometry.limitations.join('；')}</p>}
      {result?.uncertainty&&<p className="text-xs">不確定度依據：{result.uncertainty.uncertainty_basis}；保留的原模型範圍是候選先驗敏感度，不是實测精度信賴區間。</p>}
      {quality&&<VideoQualityCard assessment={quality} videoFileName={fileName} actualFps={fps}/>}
      <MetricsPanel matchedResult={result||undefined}/>
    </div>
  </section>;
}
