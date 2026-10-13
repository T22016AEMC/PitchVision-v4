import React from 'react';
import { MetricsPanel } from './MetricsPanel';
import { VideoQualityCard } from './VideoQualityCard';
import { MatchResult } from '../types';
import { VideoQualityAssessment } from '../services/videoMetadataService';
export function ScientificInfoPanel({open,onClose,result,quality,fileName,fps,onDatabase,onCode,timingNote}:{open:boolean;onClose:()=>void;result:MatchResult|null;quality:VideoQualityAssessment|null;fileName:string;fps:number;onDatabase:()=>void;onCode:()=>void;timingNote?:string}) {
 if(!open)return null;
 return <section id="science-center" aria-label="科學資訊中心" className="mx-auto max-w-7xl p-4 space-y-4 border-t border-slate-700 bg-slate-900">
  <div className="flex items-center justify-between"><h2 className="font-bold text-cyan-300">科學資訊中心</h2><button onClick={onClose} className="p-3">返回分析操作</button></div>
  <div className="flex gap-3 flex-wrap"><button id="btn-view-database" onClick={onDatabase} className="p-3 bg-slate-800 rounded">科學參考庫／下載 JSON</button><button id="btn-view-code" onClick={onCode} className="p-3 bg-slate-800 rounded">Python 原始碼／下載</button></div>
  <p className="text-xs text-slate-300">球速為距離與出手／接球時間差換算的平均速度。IVB/HB是相對同初始條件無旋轉重力軌跡的差異，需尺度與投影約束。RPM與Efficiency在单視角下耦合，資料庫只提供先驗。</p>
  <p className="text-xs text-amber-300">{timingNote} 單一平面標定只能約束相機與平面，離地球的深度仍為條件假設。未知畸變、距離與遮蔽可能主導誤差。解碼時間表平均FPS與平均呈現FPS不等於曝光快門；曝光/相機穩定性尚未獨立量測。</p>
  <p className="text-xs">原有獨立 Python 範例：streamlit run app.py（與網頁引擎不同）。資料庫為合成參考，未重新生成。</p>
  {result?.spatial_calibration?.camera_geometry&&<p className="text-xs">攝影幾何：{result.spatial_calibration.camera_geometry.method}；{result.spatial_calibration.camera_geometry.limitations.join('；')}</p>}
  {result?.uncertainty&&<p className="text-xs">不確定度依據：{result.uncertainty.uncertainty_basis}；保留的原模型範圍是候選先驗敏感度，不是實测精度信賴區間。</p>}
  {quality&&<VideoQualityCard assessment={quality} videoFileName={fileName} actualFps={fps}/>}
  <MetricsPanel matchedResult={result||undefined}/>
 </section>;
}
