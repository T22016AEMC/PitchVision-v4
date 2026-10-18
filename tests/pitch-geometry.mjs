import assert from 'node:assert/strict';
import {loadEngine} from './tools/engine.mjs';
import {makeWorldCase} from './tools/world-synth.mjs';
import {legacyNumbers,runLegacy,summarizeCameraError} from './tools/legacy-run.mjs';
import {fitInputFor} from './tools/new-run.mjs';
// 5.0.3 geometry stage: flight/launch maths, distance prior, camera metadata, stop detection, the joint fit on known-truth
// synthetic pitches (self-consistency only, never real footage), pitch-type ranking and the end-to-end stage inside finishAnalysis.
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};
const E=await loadEngine();
const near=(a,b,tol,label)=>check(Math.abs(a-b)<=tol,`${label}: ${a} vs ${b} (±${tol})`);

// ── 1. flight maths: closed-form launch speed reproduces the distance; average ↔ release speed are consistent (A2)
{
  const {flightPositions,launchSpeedZ}=E;
  for(const [D,T] of [[16.6,.45],[17.5,.5],[15.5,.6]]){
    const vz=launchSpeedZ(D,T),[end]=flightPositions({y0:1.8,vx:0,vy:0,vz,mx:0,my:0},[T]);
    near(end[2],D,.02,`distance ${D} m covered in ${T} s`);
    const avg=D/T*3.6,rel=vz*3.6;check(rel>avg&&rel/avg<1.09,`release speed above average by a drag-sized margin (${(rel/avg*100-100).toFixed(1)} %)`);
  }
  near(launchSpeedZ(17.5,.5)*3.6/(17.5/.5*3.6),1.056,.006,'drag raises release speed ≈ 5.6 % over 17.5 m (HANDOFF figure)');
}

// ── 2. distance prior: no catcher recession; owner override replaces it
{
  const bio=E.computePitcherBiometrics(true,178),p=E.distancePrior(bio);
  near(p.priorM,16.6,.01,'178 cm pitcher: 18.44 − 1.84');near(p.legacyM-p.priorM,.9,.011,'old formula was 0.90 m longer');
  const flat=E.distancePrior(E.computePitcherBiometrics(false,178));check(flat.priorM>16.6&&flat.priorM<16.8,'flat ground prior');
}

// ── 3. camera metadata and the focal prior
{
  const enc=s=>[...new TextEncoder().encode(s)];
  const box=(type,...parts)=>{const body=parts.flat(),size=8+body.length;return [(size>>>24)&255,(size>>>16)&255,(size>>>8)&255,size&255,...enc(type),...body];};
  const be=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
  const keyEntry=name=>[...be(8+name.length),...enc("mdta"),...enc(name)];
  const keys=[...be(0),...be(2),...keyEntry('com.apple.quicktime.camera.lens_model'),...keyEntry('com.apple.quicktime.camera.focal_length.35mm_equivalent')];
  const item=(index,text)=>[...be(8+16+text.length),...be(index),...be(16+text.length),...enc('data'),...be(1),...be(0),...enc(text)];
  const ilst=[...item(1,'iPhone 16e back camera 4.2mm f/1.64'),...item(2,'27')];
  const meta=[...box('hdlr',be(0),be(0),enc('mdta'),be(0),be(0),be(0),[0]),...[...be(8+keys.length),...enc('keys'),...keys],...[...be(8+ilst.length),...enc('ilst'),...ilst]];
  const file=new Uint8Array(box('moov',box('meta',meta))).buffer;
  const m=E.parseCameraMetadata(file);
  check(m.source==='file'&&m.focal35mm===27&&/iPhone 16e/.test(m.lensModel),'QuickTime metadata read');
  near(E.focalPrior(2160,3840,m).px,2749.2,1,'27 mm equivalent → diagonal-based focal length in pixels');
  check(E.focalPrior(720,1280,{source:'none'}).relSigma>=.12,'generic prior is wider than the metadata prior');
  check(E.parseCameraMetadata(new ArrayBuffer(16)).source==='none','garbage metadata is ignored');
}

// ── 4. stop detection: perspective slow-down is not a stop; a ball that stops is found
{
  const mk=(speeds,start=[300,500])=>{let x=start[0],y=start[1];return speeds.map((s,i)=>{const p={frame:100+i,time:(100+i)/24,x,y,radius:3};x+=s*.2;y+=s;return p;});};
  check(E.detectStop(mk([14,13,12.5,12,11.5,11,10.5,10,9.5]),1).index===null,'smooth slow-down: no stop');
  const stop=E.detectStop(mk([8,7.8,7.6,7.4,7.2,5,.8,.2,.1,0]),1);
  check(stop.index===6,'ball stopping at the net is found at the first stopped observation (index 6 = frame 106)');
}

// ── 5. the joint fit on known-truth pitches
const cases=[];
for(const [view,fps,pitch,seed] of [['pitcher_rear',24,'fastball',201],['pitcher_rear',60,'slider',202],['catcher',24,'curve',203],['catcher',30,'cutter',204],['pitcher_rear',30,'sinker',205],['catcher',60,'changeup',206]])
  cases.push(await makeWorldCase({seed,view,fps,pitch,width:720,height:1280}));
let used=0,worldOld=0,worldNew=0,spanned=0,typeTop3=0,speedErr=0;
for(const c of cases){
  const fit=E.fitPitchGeometry({...fitInputFor(c),samples:250});
  check(['ok','low_confidence'].includes(fit.status)&&fit.camera,`${c.view} ${c.fps} fps ${c.pitch}: fit returned`);
  check(fit.samples.every(s=>Number.isFinite(s.ivb)&&Number.isFinite(s.hb)),'finite movement samples');
  const camNew=summarizeCameraError(E,{...fit.camera.geometry,yawDeg:fit.camera.yawDeg.value,pitchDeg:fit.camera.pitchDeg.value,rollDeg:fit.camera.rollDeg.value},c.truth,c.observations);
  const old=await legacyNumbers(c);
  if(fit.status==='ok'){used++;worldNew+=camNew.worldRmsCm;worldOld+=old.camera.worldRmsCm;
    const r=fit.speed.avgKmh,t=c.truth.avgSpeedKmh;if(t>=r.lo&&t<=r.hi)spanned++;speedErr+=Math.abs(r.value/t-1);
    const rank=E.rankPitchTypes(E.PITCH_DATABASE,fit.samples);check(rank&&Math.abs(rank.ranking.reduce((a,x)=>a+x.probability,0)-1)<1e-6,'type probabilities sum to 1');
    if(rank.top3.some(x=>x.pitchType===c.truth.pitchType))typeTop3++;
    check(fit.camera.focalPx.lo<=fit.camera.focalPx.value&&fit.camera.focalPx.value<=fit.camera.focalPx.hi,'focal range brackets its median');
    check(fit.events.releaseSec.value<fit.events.gloveSec.value&&fit.speed.releaseKmh.value>fit.speed.avgKmh.value*.99,'release before glove; release speed ≥ average');
  }
}
check(used>=4,`fit trusted on ${used} of 6 synthetic pitches`);
check(worldNew<worldOld,`camera maps pixels to the world better than the 5.0.2 standard camera (${(worldNew/used).toFixed(0)} cm vs ${(worldOld/used).toFixed(0)} cm)`);
check(spanned>=Math.ceil(used*.6),`average-speed range contains the truth in ${spanned} of ${used}`);
check(speedErr/used<.10,`average-speed error ${(speedErr/used*100).toFixed(1)} % < 10 %`);
check(typeTop3>=Math.ceil(used*.5),`true pitch type within the top three in ${typeTop3} of ${used}`);
check(E.fitPitchGeometry({...fitInputFor(cases[0]),observations:cases[0].observations.slice(0,4).map(o=>({frame:o.frame,time:o.timestamp,x:o.x,y:o.y,radius:o.radius}))}).status==='failed','too few ball points: the fit refuses instead of guessing');

// ── 6. the stage inside finishAnalysis: estimates carry ranges and origins; switching the stage off reproduces the 5.0.2 inputs
{
  const c=cases[0],on=(await runLegacy(c,{input:{disableGeometryStage:false,analysisDistance:E.distancePrior(E.computePitcherBiometrics(true,178)).priorM,fitSamples:250}})).out,off=(await runLegacy(c)).out;
  check(on.status==='done'&&off.status==='done','both runs complete');
  check(off.distanceM===17.5&&off.estimates===null,'stage off: 5.0.2 distance 17.5 m and no estimates');
  check(on.estimates&&on.estimates.items.length>=8&&on.estimates.items.every(i=>i.origin.length>0),'stage on: every item names its origin');
  check(on.estimates.items.filter(i=>['speedAvg','speedRelease','distance','ivb','hb'].includes(i.key)).every(i=>i.range&&i.estimated),'speeds, distance and movement carry a range and the 推估 flag');
  check(on.estimates.status==='ok'&&on.estimates.usedInEngine.camera,'estimated camera is handed to the engine');
  check(on.result.spatial_calibration?.camera_geometry?.positionM&&/球路自動估計/.test(on.result.spatial_calibration.calibration_status),'engine result carries the estimated camera');
  check(on.distanceM>14&&on.distanceM<19&&Math.abs(on.velocityKmh/on.estimates.numbers.avgKmh.value-1)<.02,'engine average speed matches the estimate (median of ratios vs ratio of medians, within 2 %)');
  check(on.eventTimes.gloveSec>on.eventTimes.releaseSec,'engine received fitted event times');
  // too little evidence → the 5.0.2 camera guess and the new distance prior, said plainly
  const few=await makeWorldCase({seed:301,view:'catcher',fps:24,pitch:'fastball',width:720,height:1280});few.observations=few.observations.slice(0,4);
  const fb=(await runLegacy(few,{input:{disableGeometryStage:false,analysisDistance:E.distancePrior(E.computePitcherBiometrics(true,178)).priorM}})).out;
  check(fb.status==='done'&&fb.estimates.status==='fallback'&&fb.estimates.items.some(i=>i.key==='camera'&&/推測/.test(i.value)),'few ball points: fallback says 相機為推測');
  check(Math.abs(fb.distanceM-16.6)<.05,'fallback uses the no-catcher distance prior');
  // an owner distance replaces the prior
  const ov=(await runLegacy(c,{input:{disableGeometryStage:false,analysisDistance:E.distancePrior(E.computePitcherBiometrics(true,178)).priorM,fitSamples:250,distanceOverrideM:16.2}})).out;
  near(ov.distanceM,16.2,.01,'owner distance is used as given');
  check(ov.estimates.items.find(i=>i.key==='distance').origin.includes('影像量測'),'owner distance is labelled as given by the owner');
}

console.log(JSON.stringify({pitchGeometryChecks:checks,fitUsed:`${used}/6`,worldRmsCm:{old:+(worldOld/used).toFixed(0),new:+(worldNew/used).toFixed(0)},avgSpeedErrPct:+(speedErr/used*100).toFixed(1),typeTop3:`${typeTop3}/${used}`}));
