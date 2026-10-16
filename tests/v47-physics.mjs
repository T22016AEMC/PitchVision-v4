// Scoped consistency check only; no video or real-world accuracy acceptance.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
await mkdir('test-results/v47',{recursive:true});
const load=async(contents,name,resolveDir=process.cwd())=>{
 await build({stdin:{contents,resolveDir,loader:'ts'},outfile:`test-results/v47/${name}.mjs`,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 return import(pathToFileURL(resolve(`test-results/v47/${name}.mjs`)).href);
};
const e=await load("export * from './src/services/conditionedPhysics';export * from './src/services/physicalCandidates';export {standardCameras} from './src/services/standardCamera';",'current');
const previous=await load(execFileSync('git',['show','1686842:src/services/conditionedPhysics.ts'],{encoding:'utf8'}),'previous',resolve('src/services'));
const raw=await readFile('src/pitchDatabase.json','utf8'),db=JSON.parse(raw);
assert.equal(raw,await readFile('baseline/v3/src/pitchDatabase.json','utf8'));
assert.equal(db.length,1080);assert.equal(e.uniquePhysicalCandidates(db).length,1080);
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};
const fields=['velocity_kmh','spin_rate_rpm','spin_axis_decimal','spin_efficiency_pct','flight_time_sec','standard_distance_m','ivb_inch','hb_inch'];
const ranges=Object.fromEntries(fields.map(k=>[k,[Math.min(...db.map(r=>r[k])),Math.max(...db.map(r=>r[k]))]]));
const counts=k=>Object.fromEntries([...new Set(db.map(r=>r[k]))].map(v=>[v,db.filter(r=>r[k]===v).length]));
const keys=db.map(r=>JSON.stringify([r.velocity_kmh,r.spin_rate_rpm,((r.spin_axis_decimal%12)+12)%12,r.spin_efficiency_pct,r.flight_time_sec,r.standard_distance_m,r.trajectory_frames?.[0]?.y_cm??178]));
const samples=new Set();
for(const code of new Set(db.map(r=>r.code))){const group=db.filter(r=>r.code===code);samples.add(group[0]);samples.add(group.at(-1));}
for(const k of ['flight_time_sec','spin_rate_rpm','spin_efficiency_pct']){samples.add(db.find(r=>r[k]===ranges[k][0]));samples.add(db.find(r=>r[k]===ranges[k][1]));}
const rows=[];
for(const r of samples){
 const args=[r.standard_distance_m,r.flight_time_sec,(r.trajectory_frames[0].y_cm??178)/100,r.spin_rate_rpm,r.spin_axis_decimal,r.spin_efficiency_pct];
 const model=e.integrateCandidateFlight(...args),old=previous.integrateCandidateFlight(...args),world=e.candidateWorld(r),movement=e.candidateModelMovement(r);
 check(world.length===61&&world.every((p,i)=>Object.values(p).every(Number.isFinite)&&(!i||p.z>world[i-1].z&&p.t>world[i-1].t)),'finite monotonic SI trajectory');
 check(Math.abs(world.at(-1).y-e.CATCH_HEIGHT_M)<1e-5&&Math.abs(world.at(-1).z-r.standard_distance_m)<1e-5,'endpoint solver converges');
 check(Math.abs(model.ivb-old.ivb)<1e-8&&Math.abs(model.hb-old.hb)<1e-8,'valid candidate physics retained');
 check(Math.abs(movement.ivb-model.ivb)<1e-12&&Math.abs(movement.hb-model.hb)<1e-12,'world and official movement share one integration');
 rows.push({id:r.id,initialSpeedKmh:Math.hypot(...model.initialVelocity)*3.6,angleDeg:model.initialAngleDeg,rawIvb:r.ivb_inch,rawHb:r.hb_inch,modelIvb:model.ivb,modelHb:model.hb});
}
const model=e.integrateCandidateFlight(17.5,.5,1.78,2000,12,90);
const measurement={xFit:{coeff:[0,0,0]},yFit:{coeff:[1.78,model.initialVelocity[1],0]}};
// Check the legacy forward entry point's spinless reference, without video input.
const zero=e.forwardProjectedModel(e.standardCameras('catcher',720,1280,17.5)[0],measurement,17.5,.5,0,12,90,0,60,120,Array.from({length:61},(_,i)=>i*.5/60));
check(zero.reconstructedIvbInch===0&&zero.reconstructedHbInch===0,'same initial conditions give exactly zero movement with no spin');
// A short finite difference catches the old fixed-XY Magnus force doing work.
const dt=1e-5,v=[3,4,Math.expm1(.0062*17.5)/(.0062*.5)],speed=Math.hypot(...v);
const probe=e.forwardProjectedModel(e.standardCameras('catcher',720,1280,17.5)[0],{xFit:{coeff:[0,v[0],0]},yFit:{coeff:[1.78,v[1],0]}},17.5,.5,2000,3,90,0,2,120,[0,dt,2*dt]).modelTrack;
const positions=probe.map(p=>[p.world_x_cm/100,p.world_y_cm/100,p.depth_z]);
const lift=v.map((_,j)=>(positions[2][j]-2*positions[1][j]+positions[0][j])/(dt*dt)+.0062*speed*v[j]+(j===1?9.80665:0));
check(Math.abs(lift.reduce((sum,a,i)=>sum+a*v[i],0))/(Math.hypot(...lift)*speed)<1e-4,'shared forward Magnus is perpendicular to velocity');
const noSpin=e.integrateCandidateFlight(17.5,.5,1.78,0,12,90);
check(noSpin.ivb===0&&noSpin.hb===0,'candidate spinless reference');
const right=e.integrateCandidateFlight(17.5,.5,1.78,1500,3,80),left=e.integrateCandidateFlight(17.5,.5,1.78,1500,9,80);
check(Math.abs(right.hb+left.hb)<1e-8&&right.hb>0,'horizontal mirror symmetry');
check(e.integrateCandidateFlight(17.5,.5,1.78,2000,12,0).ivb===0,'zero effective spin');
const record=structuredClone(db[0]),before=e.candidateWorld(record);record.spin_rate_rpm+=1;
check(e.candidateWorld(record)!==before,'parameter mutation invalidates both derived caches');
check(e.worldAt(record,NaN)===null&&e.worldAt(record,record.flight_time_sec+1e-5)===null&&e.worldAt(record,record.flight_time_sec+1e-7).t===record.flight_time_sec,'no nonfinite time or extrapolation; retain numerical endpoint tolerance');
for(const args of [[17.5,.5,NaN,2000,12,90],[17.5,.5,-1,2000,12,90],[17.5,0,1.78,2000,12,90],[17.5,.5,1.78,2000,12,101]])assert.throws(()=>e.integrateCandidateFlight(...args));
check(e.uniquePhysicalCandidates([{...db[0],trajectory_frames:[{...db[0].trajectory_frames[0],y_cm:NaN}]}]).length===0,'invalid height excluded before model');
const report={physicsVersion:e.PHYSICS_VERSION,checks,sourceCount:db.length,validCount:e.uniquePhysicalCandidates(db).length,cameraCounts:counts('camera_view'),pitchCounts:counts('code'),ranges,exactPhysicalParameterDuplicates:db.length-new Set(keys).size,rawJsonUnchanged:true,integratedSampleCount:rows.length,rows,legacySpeedMinusDistanceTimeKmh:[Math.min(...db.map(r=>r.velocity_kmh-r.standard_distance_m/r.flight_time_sec*3.6)),Math.max(...db.map(r=>r.velocity_kmh-r.standard_distance_m/r.flight_time_sec*3.6))],assumptions:['catch height 0.65m; unmeasured','initial vx=0; vy/vz solved from height/distance/time','existing coefficients/effective spin preserved; not empirical accuracy validation']};
await writeFile('test-results/v47/physics-consistency.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,rows:undefined},null,2));
