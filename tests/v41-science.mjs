import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
await mkdir('test-results',{recursive:true});
await build({stdin:{contents:`export * from './src/services/mp4Timing';export * from './src/services/cameraGeometry';export * from './src/services/conditionedPhysics';export * from './src/services/pitchTypeIdentity';export * from './src/services/trackEvidence';export * from './src/services/compactBallAppearance';export * from './src/services/candidateChains';export * as movement from './src/services/movementDatabaseMatcher';export * as match from './src/matchingEngine';export * as spin from './src/services/spinInferenceEngine';export * as oldSpin from './baseline/v4/src/services/spinInferenceEngine';export * as oldMatch from './baseline/v4/src/matchingEngine';`,resolveDir:process.cwd(),loader:'ts'},outfile:'test-results/v41.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
await build({stdin:{contents:"export { TrajectoryFitEngine } from './src/services/trajectoryFitEngine';",resolveDir:process.cwd(),loader:'ts'},outfile:'test-results/v41-fit.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {TrajectoryFitEngine}=await import(pathToFileURL(resolve('test-results/v41-fit.mjs')).href);
const e=await import(pathToFileURL(resolve('test-results/v41.mjs')).href);let assertions=0;
const check=(condition,label)=>{assert.ok(condition,label);assertions++;};
for(const dt of [0.08,0.4166666666667,3]){const speed=e.match.calculateVelocity(0,1,30,17.5,[0,dt]);check(speed.flightSeconds===dt&&speed.velocityKmh===Number((17.5/dt*3.6).toFixed(1)),'valid timestamps never revert to FPS, time clamp or early rounding');}
const preciseFlight=0.4166666666667,preciseMatch=e.match.matchPitchData(151.2,preciseFlight,'四縫線直球 (Fastball)','catcher',e.match.PITCH_DATABASE,0,1,undefined,[],undefined,undefined,30,[0,preciseFlight]);check(preciseMatch.flight_time_sec===preciseFlight,'same precise time reaches matching and measurement engines');
const noFit=TrajectoryFitEngine.evaluateTrajectoryFit({videoTrack:[],modelTrack:[]});check(noFit.fit_score===0&&noFit.fit_quality==='NOT_VALIDATED','no observations must not earn a fit score');
const fakeFit=TrajectoryFitEngine.evaluateTrajectoryFit({videoTrack:[0,1,2].map(frame=>({frame,source:'interpolated',x_norm:0.5,y_norm:0.5})),modelTrack:[0,1,2].map(frame=>({frame,x_norm:0.5,y_norm:0.5}))});check(fakeFit.compared_points_count===0,'interpolated samples never validate a forward model');
const u32=(...ns)=>{const b=Buffer.alloc(ns.length*4);ns.forEach((n,i)=>b.writeUInt32BE(n,i*4));return b;};
const box=(type,...payload)=>{const body=Buffer.concat(payload);return Buffer.concat([u32(body.length+8),Buffer.from(type),body]);};
const mp4=(rows)=>box('moov',box('trak',box('mdia',box('mdhd',u32(0,0,0,24000,rows.reduce((a,[n,d])=>a+n*d,0))),box('hdlr',u32(0,0),Buffer.from('vide'),u32(0,0,0)),box('minf',box('stbl',box('stts',u32(0,rows.length),...rows.map(r=>u32(...r))))))));
const buf=mp4([[24,1001]]);const pts=e.parseMoovTiming(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));check(Math.abs(pts.actualFps-24000/1001)<1e-9,'non-integer CFR');check(!pts.isVFR,'constant sample delta');
const varying=mp4([[10,800],[10,1200]]);check(e.parseMoovTiming(varying.buffer.slice(varying.byteOffset,varying.byteOffset+varying.byteLength)).isVFR,'variable sample timing');
let malformed=false;try{e.parseMoovTiming(Uint8Array.from([0,0,0,64,109,111,111,118]).buffer)}catch{malformed=true}check(malformed,'truncated box rejected');
for(const [name,id]of [['彈指曲球 (Knuckle Curve)','KC'],['卡特球 (Cutter)','FC'],['曲球 (Curveball)','CU'],['SI','SI']])check(e.pitchTypeIdentity(name)===id,'exact pitch identity');
const candidates=e.match.PITCH_DATABASE.slice(0,3).map(r=>({...r,record_id:r.id,similarity_score:80}));
for(const angle of [25,46.5,54,68,80.5]) {const input={candidates,observedReleaseAngleDeg:angle,isReleaseAngleEstimated:false};assert.deepStrictEqual(e.spin.SpinInferenceEngine.inferSpinParameters(input),e.oldSpin.SpinInferenceEngine.inferSpinParameters(input));assertions++;}
for(const fps of [24,60,120]){
 const release=10,glove=release+Math.round(fps*0.5);
 const old=e.oldMatch.matchPitchData(126,0.5,'四縫線直球 (Fastball)','catcher',e.oldMatch.PITCH_DATABASE,release,glove,undefined,[],undefined,undefined,fps);
 // Historical V4.1 numeric comparison retains its original single-view candidate pool.
 const current=e.match.legacyMatchPitchData(126,0.5,'四縫線直球 (Fastball)','catcher',e.match.PITCH_DATABASE.filter(r=>r.camera_view==='catcher'),release,glove,undefined,[],undefined,undefined,fps);
 check(current.confidence_scores.trajectory_fit_confidence===0,'unobserved model has no fit confidence');
 for(const key of ['spin_rate_rpm','spin_axis','spin_efficiency_pct'])check(old[key]===current[key],`legacy manual fastball ${key}`);
}
const clean=Array.from({length:10},(_,i)=>({frame:i,timestamp:i/24,x_norm:0.2+i*0.02,y_norm:0.5+i*0.001,source:'observation'}));check(e.assessTrackEvidence(clean,24).valid,'continuous track');
check(e.linkBallCandidateChains(clean.map(p=>({...p,confidence:0.85})),24).length>=4,'multi-candidate chain');
const kc=e.movement.MovementDatabaseMatcher.matchCandidates({observedVelocityKmh:110,observedIvbInch:-7,observedHbInch:3,selectedPitchType:'彈指曲球 (Knuckle Curve)',cameraView:'catcher',db:e.match.PITCH_DATABASE,strictPitchTypeMode:true,allowCrossTypeFallback:false});check(kc.matchedRecordCount===120&&kc.candidates.every(c=>e.pitchTypeIdentity(c.pitch_type)==='KC'),'Knuckle Curve never Cutter');
const image={width:40,height:40,data:new Uint8ClampedArray(40*40*4)};for(let y=18;y<=22;y++)for(let x=18;x<=22;x++){const i=(y*40+x)*4;image.data.set([220,220,220,255],i);}check(e.isCompactBrightRegion(image,20,20,9),'compact white ball');image.data.fill(230);check(!e.isCompactBrightRegion(image,20,20,9),'large white garment rejected');
check(!e.assessTrackEvidence(clean.map(p=>({...p,timestamp:0})),24).valid,'duplicate timestamps rejected');
check(!e.assessTrackEvidence(clean.map((p,i)=>({...p,x_norm:i%2?0.9:0.1})),24).valid,'zigzag rejected');
const fit=e.fitQuadratic(Array.from({length:15},(_,i)=>({t:i/30,value:2+3*i/30+0.5*4*(i/30)**2})));check(Math.abs(fit.acceleration-4)<1e-8,'known acceleration recovery');
check(e.inferActiveSpin(0,500,120,85)===null,'out-of-domain Magnus rejected');
const physical=e.inferActiveSpin(2,3,120,80);check(physical&&physical.activeRpm>0&&physical.rpm>physical.activeRpm,'RPM/efficiency coupling');
// Pinhole camera synthetic geometry: validate actual reconstruction, not labels.
const C=[3,2,-7],target=[1,0,8];const normalize=v=>v.map(x=>x/Math.hypot(...v));const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const forward=normalize(target.map((x,i)=>x-C[i])),right=normalize(cross([0,1,0],forward)),down=cross(forward,right).map(x=>-x),R=[right,down,forward],t=R.map(r=>-dot(r,C));
const known={width:720,height:1280,focalPx:800,rotation:R,translation:t};
const ref={widthM:2,lengthM:17.5,points:[[0,0],[2,0],[2,17.5],[0,17.5]].map(([x,z])=>{const p=e.projectWorld(known,x,0,z);return{x:p.x/720,y:p.y/1280};})};
const estimated=e.calibrateGroundReference(720,1280,ref);check(estimated.reprojectionRmsePx<0.001,'calibration reprojection');check(Math.abs(estimated.focalPx-800)<0.01,'image-derived focal length');
const point=e.projectWorld(known,0.7,1.2,8),rebuilt=e.reconstructAtDepth(estimated,point.x/720,point.y/1280,8);check(Math.hypot(rebuilt.x-0.7,rebuilt.y-1.2)<0.001,'conditional 3D reconstruction');
const observed=Array.from({length:20},(_,i)=>{const time=i/40,p=e.projectWorld(known,0.2+0.5*2*time*time,1.8+time+0.5*(-6)*time*time,35*time);return{frame:i,timestamp:time,x_norm:p.x/720,y_norm:p.y/1280,source:'vision'};});
const conditioned=e.measureConditionedMovement(observed,estimated,0,0.5,17.5);check(conditioned.valid&&conditioned.ax>2&&conditioned.ay<3.80665&&conditioned.ivb>0&&conditioned.hb>0,'Magnus acceleration excludes directional drag and gravity');check(conditioned.uncertainty>0,'pixel sensitivity floor');
// Historical inference formulas remain callable; V4.4 production instead preserves database parameters.
const fullConditioned=e.match.legacyMatchPitchData(126,0.5,'🤖 AI 全數據庫自動辨識','catcher',e.match.PITCH_DATABASE,0,20,undefined,observed,{tracking_quality_status:'reliable',vision_detected_frames_count:20,tracking_ratio_pct:95},undefined,40,Array.from({length:21},(_,i)=>i/40),true,false,false,undefined,estimated);
check(fullConditioned.observed_metrics.movement_valid&&fullConditioned.source_rpm==='MODEL ESTIMATED','calibration reaches full physical inversion pipeline');
check(Math.abs(fullConditioned.model_track[0].x_norm-observed[0].x_norm)<1e-7&&Math.abs(fullConditioned.model_track[0].y_norm-observed[0].y_norm)<1e-7,'full model starts from reconstructed world state, not an arbitrary pixel anchor');
const noSpin=e.forwardProjectedModel(estimated,conditioned,17.5,0.5,0,12,80,0,19,40);check(Math.abs(noSpin.reconstructedIvbInch)+Math.abs(noSpin.reconstructedHbInch)<1e-10,'zero-spin counterfactual');
const rightSpin=e.forwardProjectedModel(estimated,conditioned,17.5,0.5,1500,3,80,0,19,40),leftSpin=e.forwardProjectedModel(estimated,conditioned,17.5,0.5,1500,9,80,0,19,40),backSpin=e.forwardProjectedModel(estimated,conditioned,17.5,0.5,1500,12,80,0,19,40);check(rightSpin.reconstructedHbInch>1&&leftSpin.reconstructedHbInch< -1,'horizontal spin axis signs');check(backSpin.reconstructedIvbInch>1,'backspin separates from gravity plus drag reference');
let rejected=false;try{e.calibrateGroundReference(720,1280,{...ref,points:Array(4).fill({x:0.5,y:0.5})})}catch{rejected=true}check(rejected,'degenerate calibration rejected');
// Real files validate timing independently of filename. Kept outside Git and optional on CI.
const real=[];
for(const file of ['直球.mp4','彈指曲球.mp4']) {try{const bytes=await readFile(resolve('../test videos',file));const timing=await e.readMp4Timing(new Blob([bytes]));check(timing?.timingReliable,'real MP4 sample timestamps');check(timing.totalFrames===timing.timestamps.length,'sample count');real.push({file,fps:timing.actualFps,averageFps:timing.averageFps,totalFrames:timing.totalFrames,durationSec:timing.durationSec,isVFR:timing.isVFR});}catch(err){if(err.code==='ENOENT')continue;throw err;}}
await writeFile('test-results/v41-science.json',JSON.stringify({assertions,real},null,2));console.log(JSON.stringify({assertions,real},null,2));
