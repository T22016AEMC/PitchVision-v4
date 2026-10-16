import {BaseballTrackPoint,CameraViewMode,DatabaseMatchCandidate,PitchRecord} from '../types';
import {CameraGeometry,projectWorld} from './cameraGeometry';
import {standardCameras} from './standardCamera';
import {physicalId,uniquePhysicalCandidates,worldAt} from './physicalCandidates';
import {pitchTypeIdentity} from './pitchTypeIdentity';
import type {MatcherResult} from './movementDatabaseMatcher';
export interface IndependentEvidence {flightTimeSec?:number;releaseTimeSec?:number;distanceM?:number;observations?:BaseballTrackPoint[];geometry?:CameraGeometry;}
export interface ProjectedMatch extends MatcherResult {projectionUsed:boolean;geometry?:CameraGeometry;physicalPoolCount:number;projectionRmsePx?:number;}
export function matchProjectedDatabase(db:PitchRecord[],velocity:number,type:string,mode:CameraViewMode,evidence:IndependentEvidence,strict=true,crossType=false,limit=5):ProjectedMatch {
 if(!Number.isFinite(velocity)||velocity<=0)throw Error('匹配需要有效球速條件');
 const pool=uniquePhysicalCandidates(db),all=!type||type==='ALL'||type.startsWith('🤖'),identity=pitchTypeIdentity(type),typed=all?pool:pool.filter(r=>identity?pitchTypeIdentity(r.pitch_type)===identity:r.pitch_type===type);
 const fallback=!typed.length&&(!strict||crossType),records=fallback?pool:typed;
 const empty={candidates:[],matchedRecordCount:records.length,velocityWindowCandidateCount:0,totalDbRecords:db.length,isCrossTypeFallback:fallback,isInsufficientPitchTypeData:!records.length,effectiveVelocityWindowKmh:14,activePitchType:type,notes:[],projectionUsed:false,physicalPoolCount:pool.length};
 if(!records.length)return empty;
 // The UI measures mean distance/time speed. The legacy velocity_kmh field has
 // no documented release/average convention, so compare like-for-like means.
 const candidateSpeed=(r:PitchRecord)=>r.standard_distance_m/r.flight_time_sec*3.6;
 let window=4,active=records.filter(r=>Math.abs(candidateSpeed(r)-velocity)<=window);
 while(active.length<4&&window<14){window+=2;active=records.filter(r=>Math.abs(candidateSpeed(r)-velocity)<=window);}if(!active.length)active=records;
 const release=evidence.releaseTimeSec??0,flight=evidence.flightTimeSec;
 const raw=(evidence.observations??[]).filter(p=>p.source==='vision'&&!p.is_outlier&&p.confidence>=.45&&[p.timestamp,p.x_norm,p.y_norm].every(Number.isFinite)&&p.x_norm>=0&&p.x_norm<=1&&p.y_norm>=0&&p.y_norm<=1&&p.timestamp>=release&&(!flight||p.timestamp<=release+flight)).sort((a,b)=>a.timestamp-b.timestamp);
 const unique=raw.filter((p,i)=>!i||p.timestamp>raw[i-1].timestamp&&p.frame!==raw[i-1].frame);
 const usable=unique.length>=4&&unique.at(-1)!.timestamp-unique[0].timestamp>=Math.max(.08,(flight??0)*.2);
 const observations=usable?unique.filter((_,i)=>i===0||i===unique.length-1||i%Math.max(1,Math.ceil(unique.length/22))===0):[];
 const cameras=standardCameras(mode,evidence.geometry?.width??720,evidence.geometry?.height??1280,evidence.distanceM??records[0].standard_distance_m,evidence.geometry);
 const projectionCost=(r:PitchRecord,g:CameraGeometry)=>{
  let sum=0;for(const p of observations){const world=worldAt(r,p.timestamp-release);if(!world)return Infinity;const q=g.rotation![2].reduce((s,v,i)=>s+v*[world.x,world.y,world.z][i],g.translation![2]);if(q<=.05)return Infinity;const pixel=projectWorld(g,world.x,world.y,world.z);sum+=(pixel.x-p.x_norm*g.width)**2+(pixel.y-p.y_norm*g.height)**2;}return Math.sqrt(sum/observations.length);
 };
 const scored=active.map(r=>{
  const temporal=Number.isFinite(flight)&&flight!>0?Math.abs(r.flight_time_sec-flight!)/.08:0;
  const speed=Math.abs(candidateSpeed(r)-velocity)/8,base=.75*speed+.25*temporal;
  let rmse=Infinity,geometry=cameras[0];if(usable)for(const g of cameras){const error=projectionCost(r,g);if(error<rmse){rmse=error;geometry=g;}}
  return {r,base,rmse,geometry,score:base+(usable?rmse/Math.max(2,Math.hypot(geometry.width,geometry.height)*.002):0)};
 }).filter(p=>Number.isFinite(p.score)).sort((a,b)=>a.score-b.score||a.r.id-b.r.id);
 // If no pose can explain actual observations, reject projection evidence rather
 // than blocking the manual time/velocity path or inventing an observed track.
 if(!scored.length){const fallback=matchProjectedDatabase(db,velocity,type,mode,{...evidence,observations:[]},strict,crossType,limit);fallback.notes.push('已有影像觀測，但候選時間或相機幾何皆不相容；保留時間／平均球速路徑。');return fallback;}
 const best=scored[0],top=scored.slice(0,limit),weights=top.map(p=>1/(.08+p.score)),total=weights.reduce((a,b)=>a+b,0);
 const candidates:DatabaseMatchCandidate[]=top.map((p,i)=>({rank:i+1,pitch_type:p.r.pitch_type,code:p.r.code,record_id:p.r.id,physical_id:physicalId(p.r),velocity_kmh:p.r.velocity_kmh,spin_rate_rpm:p.r.spin_rate_rpm,spin_axis:p.r.spin_axis,spin_axis_decimal:p.r.spin_axis_decimal,spin_efficiency_pct:p.r.spin_efficiency_pct,ivb_inch:p.r.ivb_inch,hb_inch:p.r.hb_inch,similarity_score:Math.min(usable?95:65,100/(1+p.score)),velocity_similarity:Math.max(0,100-Math.abs(candidateSpeed(p.r)-velocity)*2),total_error:p.score,velocity_error:Math.abs(candidateSpeed(p.r)-velocity),movement_error:usable?p.rmse:undefined,interpolation_weight:weights[i]/total,physics_consistency_score:undefined,source_type:p.r.source_type??'synthetic',source_label:'V4.4 統一物理候選；來源 V3，世界軌跡由既有重建器再生成'}));
 return {...empty,candidates,velocityWindowCandidateCount:active.length,effectiveVelocityWindowKmh:window,projectionUsed:usable,geometry:best.geometry,projectionRmsePx:usable?best.rmse:undefined,notes:[`完整有效物理池 ${pool.length} 筆，攝影模式不篩除候選；相同物理參數僅計權一次`,usable?`獨立影像觀測 ${observations.length} 點；有限 ${cameras.length} 相機假設；RMSE ${best.rmse.toFixed(3)}px（排序尺度，非準確率）`:'無足夠獨立影像觀測：僅使用時間／球速，不以資料庫 IVB/HB 自我驗證',best.geometry.method==='planar_reference'?'沿用有效人工標定':'標準攝影位置工程先驗，非量測姿態；旋轉反解不唯一']};
}
