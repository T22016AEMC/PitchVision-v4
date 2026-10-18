// Step 5 (5.0.3.1): why the database candidate gives IVB ≈ +25 in on the owner's straight clip. Every factor is varied one at a time
// on the SAME RK4 model the engine uses (integrateCandidateFlight, protected file unchanged). Numbers only; nothing is tuned.
import {loadEngine} from './engine.mjs';
import {writeFile,readFile} from 'node:fs/promises';
const E=await loadEngine();
const pool=E.uniquePhysicalCandidates(E.PITCH_DATABASE),rec=pool.find(r=>r.id===46);
const h0=(rec.trajectory_frames?.[0]?.y_cm??178)/100;
const ivb=(D,T,h,rpm,axis,eff)=>+E.integrateCandidateFlight(D,T,h,rpm,axis,eff).ivb.toFixed(2);
const tracks=JSON.parse(await readFile('test-results/real-tracks.json','utf8'))['straight-4k'],t=tracks.times,Tm=t[139]-t[127];
const base={D:rec.standard_distance_m,T:rec.flight_time_sec,h:h0,rpm:rec.spin_rate_rpm,axis:rec.spin_axis_decimal,eff:rec.spin_efficiency_pct};
const at=o=>{const p={...base,...o};return ivb(p.D,p.T,p.h,p.rpm,p.axis,p.eff);};
const user={D:16.6,T:Tm,h:1.93};
const rows={
  candidate:{id:rec.id,type:rec.pitch_type,rpm:rec.spin_rate_rpm,axis:rec.spin_axis,eff:rec.spin_efficiency_pct,dbFlightSec:rec.flight_time_sec,dbDistanceM:rec.standard_distance_m,dbReleaseHeightM:h0,rawDbIvb:rec.ivb_inch,
    dbAvgKmh:+(rec.standard_distance_m/rec.flight_time_sec*3.6).toFixed(1)},
  rk4AtDbConditions:at({}),
  rk4AtThisPitch_marks:at(user),
  flightTime:{note:'IVB ≈ ½·a·T²; at a fixed spin the Magnus acceleration also changes with speed',T_0_45:at({...user,T:.45}),T_0_50:at({...user,T:.5}),T_0_55:at({...user,T:.55})},
  distance:{D_15_9:at({...user,D:15.9}),D_16_6:at({...user,D:16.6}),D_17_3:at({...user,D:17.3})},
  releaseHeight:{h_1_6:at({...user,h:1.6}),h_1_93:at({...user,h:1.93}),h_2_2:at({...user,h:2.2}),note:'the 0.65 m catch-height prior only sets the launch angle; IVB is the difference to the spinless path from the same start, so it barely moves'},
  spin:{rpm_1500:at({...user,rpm:1500}),rpm_1800:at({...user,rpm:1800}),rpm_2070:at({...user,rpm:2070}),eff_70:at({...user,eff:70}),eff_85:at({...user,eff:85}),eff_98_7:at({...user,eff:98.7}),
    rpm1800_eff85:at({...user,rpm:1800,eff:85})},
  liftModel:(()=>{const v=Math.hypot(...E.integrateCandidateFlight(user.D,user.T,user.h,rec.spin_rate_rpm,rec.spin_axis_decimal,rec.spin_efficiency_pct).initialVelocity),w=rec.spin_rate_rpm*rec.spin_efficiency_pct/100*2*Math.PI/60,S=.0366*w/v;
    return {launchSpeedMs:+v.toFixed(2),spinFactorS:+S.toFixed(3),engineCL:+Math.min(.38,1.15*S).toFixed(3),sawicki2003CL:+(S<.1?1.5*S:.09+.6*S).toFixed(3),note:'engine lift = min(0.38, 1.15·S) (protected conditionedPhysics.ts, unchanged); a published fit (Sawicki et al. 2003, CL = 0.09 + 0.6·S for S > 0.1) is lower at this S'};})()
};
console.log(JSON.stringify(rows,null,1));
await writeFile('test-results/ivb-diagnosis-5031.json',JSON.stringify(rows,null,1));
