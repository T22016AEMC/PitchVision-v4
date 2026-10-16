import {PitchRecord} from '../types';
import {calibrate3DSpatialContext,DEFAULT_PITCHER_BIOMETRICS,reconstructPhysicsModelTrack} from '../spatialCalibration';
export type WorldSample=Readonly<{t:number;x:number;y:number;z:number}>;
export function physicalKey(r:PitchRecord):string {
 return JSON.stringify([r.code,r.velocity_kmh,r.spin_rate_rpm,((r.spin_axis_decimal%12)+12)%12,r.spin_efficiency_pct,r.ivb_inch,r.hb_inch,r.flight_time_sec,r.standard_distance_m,r.pitcher_hand??'unspecified',r.trajectory_frames?.[0]?.y_cm??null]);
}
export function physicalId(r:PitchRecord):string {let h=2166136261;for(const c of physicalKey(r))h=Math.imul(h^c.charCodeAt(0),16777619);return `pv3-${r.id}-${(h>>>0).toString(16)}`;}
export function uniquePhysicalCandidates(records:PitchRecord[]):PitchRecord[] {
 const groups=new Map<string,PitchRecord>();
 for(const r of records){if(![r.velocity_kmh,r.spin_rate_rpm,r.spin_axis_decimal,r.spin_efficiency_pct,r.ivb_inch,r.hb_inch,r.flight_time_sec,r.standard_distance_m].every(Number.isFinite)||r.velocity_kmh<=0||r.spin_rate_rpm<0||r.spin_efficiency_pct<0||r.spin_efficiency_pct>100||r.flight_time_sec<=0||r.standard_distance_m<=0)continue;const key=physicalKey(r);if(!groups.has(key))groups.set(key,r);}
 return [...groups.values()];
}
const cache=new WeakMap<PitchRecord,readonly WorldSample[]>();
const movementCache=new WeakMap<PitchRecord,{ivb:number;hb:number}>();
export function candidateWorld(r:PitchRecord):readonly WorldSample[] {
 const saved=cache.get(r);if(saved)return saved;
 // Legacy x_cm is camera-dependent. Regenerate via the existing unchanged
 // reconstructor with ONE physical reference context, discarding its 2D fields.
 const spatial=calibrate3DSpatialContext(0,60,'catcher',r.pitch_type,DEFAULT_PITCHER_BIOMETRICS);
 spatial.effective_travel_distance_m=r.standard_distance_m;
 spatial.release_height_cm=r.trajectory_frames?.[0]?.y_cm??spatial.release_height_cm;
 const times=Array.from({length:61},(_,i)=>r.flight_time_sec*i/60);
 const model=reconstructPhysicsModelTrack({releaseFrame:0,gloveFrame:60,cameraView:'catcher',spatialCalibration:spatial,velocityKmh:r.velocity_kmh,spinRateRpm:r.spin_rate_rpm,spinAxisDecimal:r.spin_axis_decimal,spinEfficiencyPct:r.spin_efficiency_pct,releaseAngleDeg:spatial.arm_slot_angle_deg,fps:60/r.flight_time_sec,timestamps:times});
 const world=Object.freeze(model.modelTrack.map((p,i)=>Object.freeze({t:times[i],x:p.world_x_cm/100,y:p.world_y_cm/100,z:r.standard_distance_m*i/60})));
 cache.set(r,world);movementCache.set(r,{ivb:model.reconstructedIvbInch,hb:model.reconstructedHbInch});return world;
}
export function candidateModelMovement(r:PitchRecord){candidateWorld(r);return movementCache.get(r)!;}
export function worldAt(r:PitchRecord,time:number):WorldSample|null {
 const world=candidateWorld(r);if(time<0||time>r.flight_time_sec+1e-6)return null;
 const p=Math.min(60,Math.max(0,time/r.flight_time_sec*60)),i=Math.min(59,Math.floor(p)),a=world[i],b=world[i+1],u=p-i;
 return {t:time,x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,z:a.z+(b.z-a.z)*u};
}
