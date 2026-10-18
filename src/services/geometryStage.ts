// The 5.0.3 geometry stage of an analysis: camera → distance → events → launch → movement → speed → pitch types.
// It sits between the ball finder and the unchanged engine: when the fit is trustworthy its camera, distance and event times are
// what the engine receives; otherwise the engine gets the 5.0.2 inputs (with the new distance prior) and the page says so.
import type {PitchRecord,PitcherBiometrics,CameraViewMode} from '../types';
import type {BallObservation} from '../types';
import type {CameraGeometry} from './cameraGeometry';
import {SelectedEvents,describePosition,selectEvent,eventAnalysisView} from './analysisTimeline';
import {markEstimatedCamera} from './standardCamera';
import {fitPitchGeometry,launchSpeedZ,GeometryFit,Range} from './pitchGeometryFit';
import {rankPitchTypes} from './pitchTypeRanker';
import {distancePrior} from './distancePrior';
import {focalPrior,CameraMetadata} from './cameraMetadata';
import {PitchEstimates,buildEstimates,EstimateItem} from './pitchEstimates';

export type EventView=ReturnType<typeof eventAnalysisView>;
export interface GeometryStageArgs{
  observations:readonly BallObservation[];width:number;height:number;fps:number;view:CameraViewMode;times:readonly number[];durationSec:number;
  events:SelectedEvents;biometrics:PitcherBiometrics;cameraMeta?:CameraMetadata|null;
  /** The distance the caller currently uses (the prior, or the owner's value); it is the prior's centre and the fallback distance. */
  distanceM:number;distanceOverrideM?:number|null;
  db:PitchRecord[];seed?:number;samples?:number;
}
export interface GeometryStageResult{
  estimates:PitchEstimates;fit:GeometryFit|null;fitUsed:boolean;
  geometry?:CameraGeometry;biometrics:PitcherBiometrics;events:SelectedEvents;eventView:EventView|null;distanceM:number;
}

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const f1=(v:number,d=1)=>v.toFixed(d);

/** 5.0.2-style numbers with the new distance prior, shown when the fit cannot be trusted. Ranges: distance prior ±1.645σ, event marks ±1 frame. */
function fallbackEstimates(D:number,sigma:number,dt:number,markT:number,override:boolean,reasons:string[]):PitchEstimates{
  const T=Math.max(.1,markT),lo=D-1.645*sigma,hi=D+1.645*sigma,Tlo=Math.max(.1,T-dt),Thi=T+dt;
  const avg:Range={value:D/T*3.6,lo:lo/Thi*3.6,hi:hi/Tlo*3.6},rel:Range={value:launchSpeedZ(D,T)*3.6,lo:launchSpeedZ(lo,Thi)*3.6,hi:launchSpeedZ(hi,Tlo)*3.6};
  const items:EstimateItem[]=[
    {key:'speedAvg',label:'平均球速',value:f1(avg.value),unit:'km/h',range:`${f1(avg.lo)}–${f1(avg.hi)} km/h`,origin:['資料庫先驗','影像量測'],estimated:true,note:`距離先驗 ${f1(D,2)} m ÷ 你標的時間 ${f1(T,3)} s（±1 格）`},
    {key:'speedRelease',label:'出手球速',value:f1(rel.value),unit:'km/h',range:`${f1(rel.lo)}–${f1(rel.hi)} km/h`,origin:['物理模型推算'],estimated:true,note:'由平均球速以阻力模型回推'},
    {key:'distance',label:'出手到網距離',value:f1(D,2),unit:'m',range:override?undefined:`${f1(lo,2)}–${f1(hi,2)} m`,origin:override?['影像量測']:['資料庫先驗'],estimated:!override,note:override?'使用者輸入':'身高與場地推算的先驗'},
    {key:'camera',label:'相機',value:'相機為推測',origin:['資料庫先驗'],estimated:true,note:'自動校正信心不足，沿用舊的標準相機推測'}
  ];
  return {status:'fallback',reasons,notes:[],items,pitchTypes:null,usedInEngine:{camera:false,distance:true,events:false},numbers:{avgKmh:avg,releaseKmh:rel,distanceM:{value:D,lo,hi}},stopFrame:null};
}

export function runGeometryStage(a:GeometryStageArgs):GeometryStageResult{
  const prior=distancePrior(a.biometrics),override=finite(a.distanceOverrideM)&&a.distanceOverrideM>5&&a.distanceOverrideM<30?a.distanceOverrideM:undefined;
  const D0=override??(finite(a.distanceM)&&a.distanceM>5?a.distanceM:prior.priorM),dt=1/Math.max(1,a.fps);
  const bio=(D:number):PitcherBiometrics=>({...a.biometrics,effectiveTravelDistanceM:Math.round(D*100)/100});
  const keepUser=(reasons:string[]):GeometryStageResult=>{
    const eventView=(()=>{try{return eventAnalysisView(a.times,a.events,a.durationSec);}catch{return null;}})();
    const markT=a.events.glove!.timeSec-a.events.release!.timeSec;
    return {estimates:fallbackEstimates(D0,override!==undefined?0:prior.sigmaM,dt,markT,override!==undefined,reasons),fit:null,fitUsed:false,biometrics:bio(D0),events:a.events,eventView,distanceM:D0};
  };
  if(!a.events.release||!a.events.glove)return keepUser(['沒有事件標記']);
  if(a.observations.length<6)return keepUser(['影片中找到的球點少於 6 個，無法自動校正相機（相機為推測）']);
  const fp=focalPrior(a.width,a.height,a.cameraMeta);
  let fit:GeometryFit;
  try{
    fit=fitPitchGeometry({
      observations:a.observations.filter(o=>o.source!=='interpolated').map(o=>({frame:o.frame,time:o.timestamp,x:o.x,y:o.y,radius:o.radius})),
      width:a.width,height:a.height,fps:a.fps,view:a.view==='pitcher_rear'?'pitcher_rear':'catcher',
      markRelease:{frame:a.events.release.left,timeSec:a.events.release.timeSec},markGlove:{frame:a.events.glove.left,timeSec:a.events.glove.timeSec},times:a.times,
      focal:{px:fp.px,relSigma:fp.relSigma},biometrics:{heightCm:a.biometrics.pitcherHeightCm,hasMound:a.biometrics.hasMound},
      distance:{priorM:D0,sigmaM:prior.sigmaM,overrideM:override},seed:a.seed??20260503,samples:a.samples
    });
  }catch(error){return keepUser([`相機校正例外：${error instanceof Error?error.message:'未知錯誤'}（相機為推測）`]);}
  if(fit.status!=='ok'||!fit.camera||!fit.events||!fit.distance)return keepUser(fit.reasons.length?[...fit.reasons,'已退回舊路徑（相機為推測）']:['自動校正信心不足，已退回舊路徑（相機為推測）']);
  // fitted events → the engine's event bridge (fractional times are supported by describePosition / eventAnalysisView)
  let events=a.events,eventView:EventView|null=null,eventsUsed=false;
  const tr=fit.events.releaseSec.value,tg=fit.events.gloveSec.value;
  try{
    const first=a.times[0],last=a.times[a.times.length-1];
    if(tr>first&&tg<last&&tg>tr){
      const fitted:SelectedEvents={release:selectEvent(describePosition(a.times,tr),a.times),glove:selectEvent(describePosition(a.times,tg),a.times)};
      eventView=eventAnalysisView(a.times,fitted,a.durationSec);events=fitted;eventsUsed=true;
    }
  }catch{eventView=null;events=a.events;eventsUsed=false;}
  if(!eventView){try{eventView=eventAnalysisView(a.times,a.events,a.durationSec);}catch{eventView=null;}}
  const D=fit.distance.m.value;
  const ranking=rankPitchTypes(a.db,fit.samples??[]);
  const geometry=markEstimatedCamera(fit.camera.geometry);
  const estimates=buildEstimates(fit,ranking,{distanceOverride:Boolean(override),usedInEngine:{camera:true,distance:true,events:eventsUsed}});
  // what the owner's own marks would give, so the page can show both
  const markT=a.events.glove.timeSec-a.events.release.timeSec;
  const atMarks=D/markT*3.6;
  const speedItem=estimates.items.find(i=>i.key==='speedAvg');if(speedItem)speedItem.note=`${speedItem.note}；若採用你標的時間（${f1(markT,3)} s）則為 ${f1(atMarks)} km/h`;
  return {estimates,fit,fitUsed:true,geometry,biometrics:bio(D),events,eventView,distanceM:D};
}
