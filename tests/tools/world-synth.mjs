// Physically consistent synthetic pitches with known truth for the 5.0.3 accuracy tests.
// A 3D flight (the engine's own gravity + drag + Magnus integrator) is seen by a known pinhole camera. The ball finder is
// replaced by a noise model measured on the real clips (≈1 px at 1280-px working size, radius only approximately known),
// so every number the estimators return can be compared with the truth. This is "synthetic self-consistency", not real footage.
import {loadEngine} from './engine.mjs';

export function rng(seed){let a=seed>>>0;const next=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  const normal=()=>{let u=0,v=0;while(!u)u=next();v=next();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
  return {next,uniform:(a,b)=>a+(b-a)*next(),normal,pick:arr=>arr[Math.floor(next()*arr.length)%arr.length]};
}
const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI;
export const PITCH_GROUPS={
  fastball:'四縫線直球 (Fastball)',sinker:'二縫線/伸卡球 (Sinker)',cutter:'卡特球 (Cutter)',slider:'滑球 (Slider)',sweeper:'橫掃球 (Sweeper)',
  curve:'曲球 (Curveball)',knuckleCurve:'彈指曲球 (Knuckle Curve)',changeup:'變速球 (Changeup)',splitter:'指叉球 (Splitter)'
};

/** Focal length the app can assume from the phone model (long side × 0.78) and its relative uncertainty. */
export const FOCAL_PRIOR={ratio:0.78,relSigma:0.10};

/**
 * One synthetic pitch.
 * options: seed, view ('pitcher_rear'|'catcher'), fps, width, height, pitch (key of PITCH_GROUPS), distanceM, hideFirst (frames after the
 * release frame where the ball is not found), noisePx (1280-scale pixels), outliers.
 */
export async function makeWorldCase(o){
  const E=await loadEngine(),R=rng(o.seed??1);
  const view=o.view??'pitcher_rear',fps=o.fps??24,W=o.width??720,H=o.height??1280,long=Math.max(W,H),scale=long/1280;
  const pool=E.uniquePhysicalCandidates(E.PITCH_DATABASE).filter(r=>r.pitch_type===PITCH_GROUPS[o.pitch??'fastball']);
  const rec=pool[Math.floor(R.next()*pool.length)%pool.length];
  const D=o.distanceM??R.uniform(15.5,18.0),T=rec.flight_time_sec*(D/17.5),height=R.uniform(1.6,2.0);
  const flight=E.integrateCandidateFlight(D,T,height,rec.spin_rate_rpm,rec.spin_axis_decimal,rec.spin_efficiency_pct);
  // aim: small rotation of the whole path about the vertical through the release point, plus a release offset
  const aim=rad(R.normal()*0.8),x0=R.normal()*0.25,ca=Math.cos(aim),sa=Math.sin(aim);
  const samples=flight.world.map(p=>({t:p.t,x:x0+p.x*ca+p.z*sa,y:p.y,z:-p.x*sa+p.z*ca}));
  // camera
  const focal=long*FOCAL_PRIOR.ratio*(1+R.uniform(-.10,.10)*(o.focalError??1));
  const roll=R.normal()*1.2;
  let camera;
  for(let tries=0;;tries++){
    const back=R.uniform(3,7),h=R.uniform(1.2,1.9),cx=R.normal()*.6;
    const position=view==='pitcher_rear'?[cx,h,-back]:[cx,h,D+back];
    const aimPoint=[0,1.2,D*R.uniform(.35,.65)],v=aimPoint.map((a,i)=>a-position[i]);
    const yaw=deg(Math.atan2(v[0],v[2]))+R.normal()*2.5,pitch=deg(Math.atan2(v[1],Math.hypot(v[0],v[2])))+R.normal()*2.5;
    camera={position,yawDeg:yaw,pitchDeg:pitch,rollDeg:roll,focalPx:focal,width:W,height:H};
    const g=E.cameraFromPose(position,yaw,pitch,roll,focal,W,H);camera.geometry=g;
    const ok=samples.every(p=>{const q=g.rotation[2].reduce((s,v,i)=>s+v*[p.x,p.y,p.z][i],g.translation[2]);if(q<=1)return false;const u=E.projectWorld(g,p.x,p.y,p.z);return u.x>.03*W&&u.x<.97*W&&u.y>.03*H&&u.y<.97*H;});
    if(ok)break;if(tries>200)throw Error('could not place camera');
  }
  const g=camera.geometry,world=t=>{ // truth position at time since release
    if(t<=0){const p=samples[0];return {x:p.x,y:p.y,z:p.z};}
    if(t>=T){const p=samples.at(-1),fall=.5*9.80665*(t-T)**2;return {x:p.x,y:Math.max(.05,p.y-Math.min(fall,.6)),z:p.z};}
    const u=t/T*(samples.length-1),i=Math.min(samples.length-2,Math.floor(u)),f=u-i,a=samples[i],b=samples[i+1];
    return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f};
  };
  // time base: release between two frames; user marks follow the convention "first frame the ball is off the hand / at the net"
  const releaseFrame=Math.round(R.uniform(60,110)),u=R.next(),tr=(releaseFrame-u)/fps,tg=tr+T,gloveFrame=Math.ceil(tg*fps-1e-9);
  const frames=gloveFrame+Math.round(fps*.8)+10,times=Array.from({length:frames},(_,k)=>k/fps);
  const kRad=R.uniform(1.0,1.6),sigma=(o.noisePx??1.0)*scale,observations=[];
  for(let k=releaseFrame+(o.hideFirst??0);k<=gloveFrame+(o.afterNet??3);k++){
    const p=world(times[k]-tr),cam=g.rotation[2].reduce((s,v,i)=>s+v*[p.x,p.y,p.z][i],g.translation[2]),q=E.projectWorld(g,p.x,p.y,p.z);
    const out=(o.outliers??.03)>R.next(),s=out?sigma*4:sigma,x=q.x+R.normal()*s,y=q.y+R.normal()*s;
    const rTrue=focal*0.0366/cam,r=Math.max(.8,rTrue*kRad+R.normal()*(.12*rTrue+.3*scale));
    observations.push({frame:k,timestamp:times[k],x,y,x_norm:x/W,y_norm:y/H,radius:r,confidence:out?.6:.9,source:'observation'});
  }
  const v0=flight.initialVelocity,speedAvg=D/T*3.6,speedRel=Math.hypot(...v0)*3.6;
  return {
    seed:o.seed,view,fps,width:W,height:H,pitch:o.pitch??'fastball',record:{id:rec.id,type:rec.pitch_type,rpm:rec.spin_rate_rpm,axis:rec.spin_axis_decimal,eff:rec.spin_efficiency_pct},
    truth:{camera:{position:camera.position,yawDeg:camera.yawDeg,pitchDeg:camera.pitchDeg,rollDeg:camera.rollDeg,focalPx:focal},geometry:g,distanceM:D,flightSec:T,releaseTimeSec:tr,gloveTimeSec:tg,
      ivbInch:flight.ivb,hbInch:flight.hb,avgSpeedKmh:speedAvg,releaseSpeedKmh:speedRel,releaseAngleDeg:flight.initialAngleDeg,pitchType:rec.pitch_type,releaseHeightM:height,world},
    marks:{releaseFrame,gloveFrame:gloveFrame+(o.gloveMarkLate??0)},times,observations,
    focalPriorPx:long*FOCAL_PRIOR.ratio,focalRelSigma:FOCAL_PRIOR.relSigma
  };
}
