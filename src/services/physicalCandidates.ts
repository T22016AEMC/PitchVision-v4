import {PitchRecord} from '../types';
import {integrateCandidateFlight,PHYSICS_VERSION,CATCH_HEIGHT_M} from './conditionedPhysics';
export const MOVEMENT_DEFINITION=`勝出候選RK4（${PHYSICS_VERSION}）：同初始位置／速度、相同飛行秒數，相對含重力及阻力的無旋轉軌跡之差；IVB=ΔY，HB=ΔX（捕手看向投手之右方為正），單位吋；不是總下墜。接球高度 ${CATCH_HEIGHT_M}m 為模型假設，原庫位移僅供診斷。`;
export type WorldSample=Readonly<{t:number;x:number;y:number;z:number}>;
export function physicalKey(r:PitchRecord):string {
 return JSON.stringify([r.code,r.velocity_kmh,r.spin_rate_rpm,((r.spin_axis_decimal%12)+12)%12,r.spin_efficiency_pct,r.ivb_inch,r.hb_inch,r.flight_time_sec,r.standard_distance_m,r.pitcher_hand??'unspecified',r.trajectory_frames?.[0]?.y_cm??null]);
}
export function physicalId(r:PitchRecord):string {let h=2166136261;for(const c of physicalKey(r))h=Math.imul(h^c.charCodeAt(0),16777619);return `pv3-${r.id}-${(h>>>0).toString(16)}`;}
export function uniquePhysicalCandidates(records:PitchRecord[]):PitchRecord[] {
 const groups=new Map<string,PitchRecord>();
 for(const r of records){const height=r.trajectory_frames?.[0]?.y_cm??178;if(![r.velocity_kmh,r.spin_rate_rpm,r.spin_axis_decimal,r.spin_efficiency_pct,r.ivb_inch,r.hb_inch,r.flight_time_sec,r.standard_distance_m,height].every(Number.isFinite)||r.velocity_kmh<=0||r.spin_rate_rpm<0||r.spin_efficiency_pct<0||r.spin_efficiency_pct>100||r.flight_time_sec<=0||r.standard_distance_m<=0||height<=0)continue;const key=physicalKey(r);if(!groups.has(key))groups.set(key,r);}
 return [...groups.values()];
}
const cache=new WeakMap<PitchRecord,{key:string;world:readonly WorldSample[];movement:Readonly<{ivb:number;hb:number}>}>();
export function candidateWorld(r:PitchRecord):readonly WorldSample[] {
 const height=(r.trajectory_frames?.[0]?.y_cm??178)/100;
 const key=[PHYSICS_VERSION,r.standard_distance_m,r.flight_time_sec,height,r.spin_rate_rpm,r.spin_axis_decimal,r.spin_efficiency_pct].join('|');
 const saved=cache.get(r);if(saved?.key===key)return saved.world;
 // Versioned runtime reconstruction; raw V3 JSON and its camera-specific fields
 // remain intact. Depth now follows the same integrated state as X/Y.
 const model=integrateCandidateFlight(r.standard_distance_m,r.flight_time_sec,height,r.spin_rate_rpm,r.spin_axis_decimal,r.spin_efficiency_pct);
 const world=Object.freeze(model.world.map(p=>Object.freeze(p)));
 cache.set(r,{key,world,movement:Object.freeze({ivb:model.ivb,hb:model.hb})});return world;
}
export function candidateModelMovement(r:PitchRecord){candidateWorld(r);return cache.get(r)!.movement;}
export function worldAt(r:PitchRecord,time:number):WorldSample|null {
 if(!Number.isFinite(time)||time<0||time>r.flight_time_sec+1e-6)return null;
 time=Math.min(time,r.flight_time_sec); // Preserve existing endpoint tolerance without extrapolation.
 const world=candidateWorld(r);
 const p=Math.min(60,Math.max(0,time/r.flight_time_sec*60)),i=Math.min(59,Math.floor(p)),a=world[i],b=world[i+1],u=p-i;
 return {t:time,x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,z:a.z+(b.z-a.z)*u};
}
