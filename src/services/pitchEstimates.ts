// UI-ready summary of the 5.0.3 geometry fit: every number carries its origin (影像量測／物理模型推算／資料庫先驗), a range and an
// "estimated" flag. Presentation only: nothing here changes a number.
import type {GeometryFit,Range} from './pitchGeometryFit';
import type {PitchTypeRanking} from './pitchTypeRanker';

export type Origin='影像量測'|'物理模型推算'|'資料庫先驗';
export interface EstimateItem{
  key:'speedAvg'|'speedRelease'|'distance'|'release'|'glove'|'ivb'|'hb'|'angle'|'height'|'camera';
  label:string;value:string;unit?:string;range?:string;origin:Origin[];estimated:boolean;note?:string;
}
export interface PitchEstimates{
  /** ok = fit used; low_confidence = shown with a warning; fallback = fit failed, the 5.0.2 numbers are shown instead. */
  status:'ok'|'low_confidence'|'fallback';reasons:string[];notes:string[];
  items:EstimateItem[];
  pitchTypes:{top3:{pitchType:string;probability:number}[];hard:boolean;hardReason:string|null}|null;
  /** What the engine run actually used (so the page can say it). */
  usedInEngine:{camera:boolean;distance:boolean;events:boolean};
  /** Plain numbers for tests and the accuracy report. */
  numbers:{
    avgKmh?:Range;releaseKmh?:Range;distanceM?:Range;releaseSec?:Range;gloveSec?:Range;releaseVsMarkFrames?:Range;gloveVsMarkFrames?:Range;
    ivbInch?:Range;hbInch?:Range;angleDeg?:Range;heightM?:Range;yawDeg?:Range;pitchDeg?:Range;rollDeg?:Range;focalPx?:Range;flightSec?:Range;
  };
  stopFrame:number|null;
  fit?:GeometryFit['fit'];
}
const f=(v:number,d=1)=>Number.isFinite(v)?v.toFixed(d):'—';
const rg=(r:Range,d=1)=>`${f(r.lo,d)}–${f(r.hi,d)}`;
const sign=(v:number,d=1)=>`${v>=0?'+':''}${f(v,d)}`;

export function buildEstimates(fit:GeometryFit,ranking:PitchTypeRanking|null,opts:{distanceOverride:boolean;usedInEngine:PitchEstimates['usedInEngine']}):PitchEstimates{
  if(!fit.camera||!fit.distance||!fit.events||!fit.speed||!fit.movement||!fit.launch)
    return {status:'fallback',reasons:fit.reasons,notes:fit.notes??[],items:[],pitchTypes:null,usedInEngine:{camera:false,distance:false,events:false},numbers:{},stopFrame:null};
  const items:EstimateItem[]=[];
  const dOrigin:Origin[]=opts.distanceOverride?['影像量測']:['資料庫先驗','物理模型推算'];
  items.push({key:'speedAvg',label:'平均球速',value:f(fit.speed.avgKmh.value),unit:'km/h',range:`${rg(fit.speed.avgKmh)} km/h`,origin:['影像量測','資料庫先驗'],estimated:true,
    note:`距離 ${f(fit.distance.m.value,2)} m ÷ 飛行 ${f(fit.speed.flightSec.value,3)} s；距離是先驗，時間來自事件擬合`});
  items.push({key:'speedRelease',label:'出手球速',value:f(fit.speed.releaseKmh.value),unit:'km/h',range:`${rg(fit.speed.releaseKmh)} km/h`,origin:['物理模型推算'],estimated:true,
    note:'由平均球速以阻力模型（kD 0.0062）回推；出手速度比平均快約 5%'});
  items.push({key:'distance',label:'出手到網距離',value:f(fit.distance.m.value,2),unit:'m',range:`${rg(fit.distance.m,2)} m`,origin:dOrigin,estimated:!opts.distanceOverride,
    note:opts.distanceOverride?'使用者輸入':'影片無法量到距離：以身高與場地推算的先驗為主，球路只提供很弱的修正'});
  items.push({key:'release',label:'出手時間',value:`${sign(fit.events.releaseVsMarkFrames.value,2)} 格`,range:`${sign(fit.events.releaseVsMarkFrames.lo,2)} … ${sign(fit.events.releaseVsMarkFrames.hi,2)} 格（相對你標的）`,origin:['影像量測'],estimated:true,
    note:fit.events.stopDetected?'由可見球路與物理模型推得；出手格沒有手部偵測，不假裝知道手的位置':'由可見球路與物理模型推得'});
  items.push({key:'glove',label:'進手套／撞網時間',value:`${sign(fit.events.gloveVsMarkFrames.value,2)} 格`,range:`${sign(fit.events.gloveVsMarkFrames.lo,2)} … ${sign(fit.events.gloveVsMarkFrames.hi,2)} 格（相對你標的）`,origin:['影像量測'],estimated:true,
    note:fit.events.stopDetected?`球在 F${fit.events.stopFrame} 停下（撞網）；時間落在前一格到這格之間`:'沒有偵測到球停下，沿用你標的進手套並放寬範圍'});
  items.push({key:'ivb',label:'垂直位移 IVB',value:sign(fit.movement.ivbInch.value),unit:'吋',range:`${rg(fit.movement.ivbInch)} 吋`,origin:['影像量測','資料庫先驗'],estimated:true,
    note:'垂直方向與相機高度、俯仰、距離互相牽連，影片只能弱約束；範圍很大是正常的'});
  items.push({key:'hb',label:'水平位移 HB',value:sign(fit.movement.hbInch.value),unit:'吋',range:`${rg(fit.movement.hbInch)} 吋`,origin:['影像量測','物理模型推算'],estimated:true,
    note:'相對同初速、同出手位置、只有重力與阻力的無旋轉球路（與舊版同一定義）'});
  items.push({key:'angle',label:'出手角（垂直）',value:sign(fit.launch.angleDeg.value),unit:'°',range:`${rg(fit.launch.angleDeg)} °`,origin:['影像量測','資料庫先驗'],estimated:true});
  items.push({key:'height',label:'出手高度',value:f(fit.launch.heightM.value,2),unit:'m',range:`${rg(fit.launch.heightM,2)} m`,origin:['資料庫先驗'],estimated:true,note:'由身高與出手角推算的先驗，影片只有弱約束'});
  items.push({key:'camera',label:'相機（自動估計）',value:`俯仰 ${sign(fit.camera.pitchDeg.value)}°／偏航 ${f(fit.camera.yawDeg.value)}°／滾轉 ${sign(fit.camera.rollDeg.value)}°`,
    range:`焦距 ${Math.round(fit.camera.focalPx.lo)}–${Math.round(fit.camera.focalPx.hi)} px`,origin:['影像量測','資料庫先驗'],estimated:true,note:'相機為推測：角度由球路估計；焦距由手機型號推算（±10%）；位置與高度只有先驗'});
  return {
    status:fit.status==='ok'?'ok':'low_confidence',reasons:fit.reasons,notes:fit.notes??[],items,
    pitchTypes:ranking?{top3:ranking.top3.map(r=>({pitchType:r.pitchType,probability:r.probability})),hard:ranking.hard,hardReason:ranking.hardReason}:null,
    usedInEngine:opts.usedInEngine,stopFrame:fit.events.stopFrame,fit:fit.fit,
    numbers:{avgKmh:fit.speed.avgKmh,releaseKmh:fit.speed.releaseKmh,distanceM:fit.distance.m,releaseSec:fit.events.releaseSec,gloveSec:fit.events.gloveSec,releaseVsMarkFrames:fit.events.releaseVsMarkFrames,gloveVsMarkFrames:fit.events.gloveVsMarkFrames,
      ivbInch:fit.movement.ivbInch,hbInch:fit.movement.hbInch,angleDeg:fit.launch.angleDeg,heightM:fit.launch.heightM,yawDeg:fit.camera.yawDeg,pitchDeg:fit.camera.pitchDeg,rollDeg:fit.camera.rollDeg,focalPx:fit.camera.focalPx,flightSec:fit.speed.flightSec}
  };
}
