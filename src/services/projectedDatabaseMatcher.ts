import {BaseballTrackPoint,CameraViewMode,DatabaseMatchCandidate,PitchRecord} from '../types';
import {CameraGeometry,projectWorld,reconstructAtDepth} from './cameraGeometry';
import {fitQuadratic,inferActiveSpin} from './conditionedPhysics';
import {assessTrackEvidence} from './trackEvidence';
import {sourceFps} from './sourceTiming';
import {standardCameras} from './standardCamera';
import {physicalId,uniquePhysicalCandidates,worldAt,candidateModelMovement} from './physicalCandidates';
import {pitchTypeIdentity} from './pitchTypeIdentity';
import type {MatcherResult} from './movementDatabaseMatcher';
export interface IndependentEvidence {flightTimeSec?:number;releaseTimeSec?:number;distanceM?:number;observations?:BaseballTrackPoint[];geometry?:CameraGeometry;sourceTimestamps?:readonly number[];}
export interface ProjectedMatch extends MatcherResult {projectionUsed:boolean;geometry?:CameraGeometry;physicalPoolCount:number;projectionRmsePx?:number;observationCount?:number;reason?:string;rpmDistinguishable?:boolean;ambiguity?:{rpm:[number,number];efficiency:[number,number];axes:string[];count:number};}
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
 const quality=assessTrackEvidence(evidence.observations??[],sourceFps(evidence.sourceTimestamps??[]),{releaseTimeSec:release,catchTimeSec:Number.isFinite(flight)?release+flight!:undefined,sourceTimestamps:evidence.sourceTimestamps});
 const unique=quality.observations.map(p=>({...p,source:'vision' as const})),usable=quality.matchingEligible;
 const observations=usable?unique.filter((_,i)=>i===0||i===unique.length-1||i%Math.max(1,Math.ceil(unique.length/22))===0):[];
 const cameras=standardCameras(mode,evidence.geometry?.width??720,evidence.geometry?.height??1280,evidence.distanceM??records[0].standard_distance_m,evidence.geometry);
 const projectionCost=(r:PitchRecord,g:CameraGeometry)=>{
  let sum=0,total=0;for(const p of observations){const world=worldAt(r,p.timestamp-release);if(!world)return Infinity;const q=g.rotation![2].reduce((s,v,i)=>s+v*[world.x,world.y,world.z][i],g.translation![2]);if(q<=.05)return Infinity;const pixel=projectWorld(g,world.x,world.y,world.z);sum+=p.confidence*((pixel.x-p.x_norm*g.width)**2+(pixel.y-p.y_norm*g.height)**2);total+=p.confidence;}return Math.sqrt(sum/total);
 };
 const scored=active.map(r=>{
  // Speed and flight time share measured duration: one kinematic evidence term.
  const base=Math.abs(candidateSpeed(r)-velocity)/8;
  let rmse=Infinity,geometry=cameras[0];if(usable)for(const g of cameras){const error=projectionCost(r,g);if(error<rmse){rmse=error;geometry=g;}}
  return {r,base,rmse,geometry,score:base+(usable?rmse/Math.max(2,Math.hypot(geometry.width,geometry.height)*.002):0)};
 }).filter(p=>Number.isFinite(p.score)).sort((a,b)=>a.score-b.score||a.r.id-b.r.id);
 // If no pose can explain actual observations, reject projection evidence rather
 // than blocking the manual time/velocity path or inventing an observed track.
 if(!scored.length){const fallback=matchProjectedDatabase(db,velocity,type,mode,{...evidence,observations:[]},strict,crossType,limit);fallback.reason='真實觀測與候選時間／相機幾何不相容';fallback.notes.push('已有影像觀測，但候選時間或相機幾何皆不相容；保留時間／平均球速路徑。');return fallback;}
 const best=scored[0],top=scored.slice(0,limit),weights=top.map(p=>1/(.08+p.score)),total=weights.reduce((a,b)=>a+b,0);
 // Pose hypotheses already share one residual score. Use the observed residual
 // scale to retain indistinguishable candidates, not a second inverse-physics vote.
 const pixelScale=Math.max(2,Math.hypot(best.geometry.width,best.geometry.height)*.002);
 const ambiguityTolerance=usable?Math.max(pixelScale,best.rmse,quality.projectedFitResidual*Math.hypot(best.geometry.width,best.geometry.height))/pixelScale:Infinity;
 const plausible=usable?scored.filter(p=>p.score<=best.score+ambiguityTolerance):scored;
 const rpmDistinguishable=usable&&best.geometry.method==='planar_reference'&&new Set(plausible.map(p=>p.r.spin_rate_rpm)).size===1;
 const ambiguity={rpm:[Math.min(...plausible.map(p=>p.r.spin_rate_rpm)),Math.max(...plausible.map(p=>p.r.spin_rate_rpm))] as [number,number],efficiency:[Math.min(...plausible.map(p=>p.r.spin_efficiency_pct)),Math.max(...plausible.map(p=>p.r.spin_efficiency_pct))] as [number,number],axes:[...new Set(plausible.map(p=>p.r.spin_axis))],count:plausible.length};
 const simulated=candidateModelMovement(best.r);
 const inverseNotes:string[]=[`候選物理一致性：積分 IVB ${simulated.ivb.toFixed(2)} / HB ${simulated.hb.toFixed(2)} 吋；原庫 ${best.r.ivb_inch} / ${best.r.hb_inch} 吋。原庫值保留診斷；正式IVB/HB使用候選積分，差異不是量測誤差。`];
 if(usable){
  // Same evidence, conditional on pose/model depth: diagnostic, NOT a second score.
  const inverses=cameras.flatMap(g=>{try{const v=inverseTrackSummary(best.r,g,observations,release,velocity);return Number.isFinite(v.angle)&&v.residual<.5?[v]:[];}catch{return [];}});
  const active=inverses.map(p=>p.activeRpm).filter((v):v is number=>v!==undefined),axes=inverses.map(p=>p.axis).filter((v):v is number=>v!==undefined);
  inverseNotes.push(inverses.length?`條件逆推（${inverses.length} 姿態，候選積分深度）：出手仰角 ${Math.min(...inverses.map(p=>p.angle)).toFixed(1)}–${Math.max(...inverses.map(p=>p.angle)).toFixed(1)}°；有效RPM ${active.length?Math.round(Math.min(...active))+'–'+Math.round(Math.max(...active)):'無可識別解'}；有效軸 ${axes.map(a=>a.toFixed(2)).join('/')} 時鐘小時；Magnus候選加速度 ${inverses.map(p=>Math.hypot(p.ax,p.ay).toFixed(1)).join('/')} m/s²。阻力沿用既有係數，非單鏡頭獨立量測。總RPM與效率不可分離；未額外計權。`:'條件逆推不適用：殘差／姿態退化，保留投影排名。');
 }
 const candidates:DatabaseMatchCandidate[]=top.map((p,i)=>({rank:i+1,pitch_type:p.r.pitch_type,code:p.r.code,record_id:p.r.id,physical_id:physicalId(p.r),velocity_kmh:p.r.velocity_kmh,spin_rate_rpm:p.r.spin_rate_rpm,spin_axis:p.r.spin_axis,spin_axis_decimal:p.r.spin_axis_decimal,spin_efficiency_pct:p.r.spin_efficiency_pct,ivb_inch:p.r.ivb_inch,hb_inch:p.r.hb_inch,similarity_score:Math.min(usable?95:65,100/(1+p.score)),velocity_similarity:Math.max(0,100-Math.abs(candidateSpeed(p.r)-velocity)*2),total_error:p.score,velocity_error:Math.abs(candidateSpeed(p.r)-velocity),movement_error:usable?p.rmse:undefined,interpolation_weight:weights[i]/total,physics_consistency_score:undefined,source_type:p.r.source_type??'synthetic',source_label:'統一數值積分候選；來源 V3原始參數，初始方向／接球高度為共同條件先驗'}));
 return {...empty,candidates,ambiguity,rpmDistinguishable,observationCount:unique.length,reason:usable?(rpmDistinguishable?'候選庫內RPM可區分；仍非直接旋轉量測':'已用軌跡排名，姿態／旋轉候選仍有歧義'):quality.matchingReasons.join('、'),velocityWindowCandidateCount:active.length,effectiveVelocityWindowKmh:window,projectionUsed:usable,geometry:best.geometry,projectionRmsePx:usable?best.rmse:undefined,notes:[...inverseNotes,`可辨識度：${usable?'實際影像候選約束（球體身份未保證）':'無／少量觀測，低辨識度資料庫估計'}；${ambiguity.count} 個評分容許候選；有效旋轉不等同總RPM`, `完整有效物理池 ${pool.length} 筆，攝影模式不篩除候選；相同物理參數僅計權一次`,usable?`獨立影像觀測 ${observations.length} 點；有限 ${cameras.length} 相機假設；RMSE ${best.rmse.toFixed(3)}px（排序尺度，非準確率）`:'無足夠獨立影像觀測：僅使用時間／球速，不以資料庫 IVB/HB 自我驗證',best.geometry.method==='planar_reference'?'沿用有效人工標定':'標準攝影位置工程先驗，非量測姿態；旋轉反解不唯一']};
}

/** Broad soft envelope across multiple physical candidates and camera poses.
 * Never excludes outside detections or manufactures observations. */
export function createDatabaseSearchPrior(db:PitchRecord[],velocity:number,type:string,mode:CameraViewMode,evidence:IndependentEvidence){
 const rank=matchProjectedDatabase(db,velocity,type,mode,{...evidence,observations:[]},true,false,1080);
 const byId=new Map(db.map(r=>[physicalId(r),r]));
 const records=rank.candidates.map(c=>byId.get(c.physical_id!)!).filter(Boolean);
 const sampled=records.filter((_,i)=>i%Math.max(1,Math.ceil(records.length/24))===0);
 const cameras=standardCameras(mode,evidence.geometry?.width??720,evidence.geometry?.height??1280,evidence.distanceM??17.5,evidence.geometry);
 const bins=Array.from({length:25},(_,i)=>{
  const t=(evidence.flightTimeSec??.5)*i/24,points:{x:number;y:number}[]=[];
  for(const r of sampled)for(const g of cameras){const w=worldAt(r,t);if(!w)continue;const depth=g.rotation![2].reduce((sum,v,j)=>sum+v*[w.x,w.y,w.z][j],g.translation![2]);if(depth<=.05)continue;const p=projectWorld(g,w.x,w.y,w.z);if(Number.isFinite(p.x)&&Number.isFinite(p.y))points.push({x:p.x/g.width,y:p.y/g.height});}
  return points.length?{left:Math.min(...points.map(p=>p.x))-.12,right:Math.max(...points.map(p=>p.x))+.12,top:Math.min(...points.map(p=>p.y))-.12,bottom:Math.max(...points.map(p=>p.y))+.12}:null;
 });
 return (time:number,x:number,y:number)=>{const i=Math.max(0,Math.min(24,Math.round((time-(evidence.releaseTimeSec??0))/(evidence.flightTimeSec??.5)*24))),b=bins[i];if(!b)return 0;const dx=Math.max(b.left-x,0,x-b.right),dy=Math.max(b.top-y,0,y-b.bottom);return Math.exp(-Math.hypot(dx,dy)/.15);};
}

function inverseTrackSummary(r:PitchRecord,g:CameraGeometry,points:BaseballTrackPoint[],release:number,velocity:number){
 const world=points.map(p=>{const t=p.timestamp-release,w=worldAt(r,t)!;return {t,...reconstructAtDepth(g,p.x_norm,p.y_norm,w.z)};});
 const x=fitQuadratic(world.map(p=>({t:p.t,value:p.x}))),y=fitQuadratic(world.map(p=>({t:p.t,value:p.y})));
 const mid=world[Math.floor(world.length/2)].t,vx=x.coeff[1]+x.acceleration*mid,vy=y.coeff[1]+y.acceleration*mid,speed=velocity/3.6;
 const ax=x.acceleration+.0062*speed*vx,ay=y.acceleration+9.80665+.0062*speed*vy;
 const spin=inferActiveSpin(ax,ay,velocity,100);
 return {angle:Math.atan2(y.coeff[1],speed)*180/Math.PI,activeRpm:spin?.activeRpm,axis:spin?.axisDecimal,ax,ay,error:Math.hypot(x.accelerationError,y.accelerationError),residual:Math.hypot(x.rmse,y.rmse)};
}
