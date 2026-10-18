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

/** Independent per-type spin ranges (axis in clock hours as the engine: 12 = backspin, 3 = break to +X; efficiency %; release km/h). */
export const INDEPENDENT_TYPES={
  fastball:{axis:[12.0,13.5],eff:[80,98],rpm:[1600,2300],speed:[105,140]},sinker:{axis:[13.6,15.0],eff:[75,95],rpm:[1500,2200],speed:[100,135]},
  cutter:{axis:[10.8,11.9],eff:[25,55],rpm:[1700,2400],speed:[100,130]},slider:{axis:[9.3,10.6],eff:[20,50],rpm:[1700,2500],speed:[95,125]},
  sweeper:{axis:[8.7,9.6],eff:[50,85],rpm:[1800,2600],speed:[90,120]},curve:{axis:[6.5,7.8],eff:[65,95],rpm:[1600,2500],speed:[85,115]},
  knuckleCurve:{axis:[6.0,7.2],eff:[70,98],rpm:[1600,2500],speed:[85,115]},changeup:{axis:[13.8,15.2],eff:[70,92],rpm:[1100,1800],speed:[90,120]},
  splitter:{axis:[13.0,14.5],eff:[35,75],rpm:[800,1500],speed:[95,125]}
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
  let rec=pool[Math.floor(R.next()*pool.length)%pool.length];
  if(o.source==='independent'){
    // spin drawn from per-type ranges written independently of the database (typical pitch-design ranges, the database's hand
    // convention: +X = catcher's right), with speed and spin drawn independently of each other. 'mirror' flips the hand.
    const P=INDEPENDENT_TYPES[o.pitch??'fastball'],IR=rng((o.seed??1)*13+4242),u=([a,b])=>IR.uniform(a,b);
    let axis=u(P.axis);if(o.hand==='mirror')axis=((12-axis)%12+12)%12;
    const v=u(P.speed),Dref=17.5,Tref=Math.expm1(.0062*Dref)/(.0062*v/3.6);
    rec={...rec,id:-1,spin_rate_rpm:Math.round(u(P.rpm)),spin_axis_decimal:axis,spin_efficiency_pct:+u(P.eff).toFixed(1),flight_time_sec:Tref,standard_distance_m:Dref};
  }
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
  // What happens at the net (5.0.3.1, from the real straight clip: the ball pushes the net back, rebounds a little, is held for a few
  // frames and then slides down). 'legacy' = the 5.0.3 model (stops dead on the net plane, then drops). Its own random stream, so
  // camera, path and tracker noise are identical in both models.
  const NR=rng((o.seed??1)*7+99991),netModel=o.net??'deform';
  const net={depth:NR.uniform(.12,.35),rebound:NR.uniform(.02,.10),hold:NR.uniform(.04,.15),fallG:NR.uniform(.5,.95),overlapPx:NR.uniform(.3,1.0),blurFrac:NR.uniform(.02,.05)};
  const pe=samples.at(-1),pp=samples.at(-2),dtS=T/(samples.length-1),vEnd=[(pe.x-pp.x)/dtS,(pe.y-pp.y)/dtS,(pe.z-pp.z)/dtS],sEnd=Math.hypot(...vEnd),uEnd=vEnd.map(v=>v/sEnd);
  const afterNet=tau=>{
    if(netModel==='legacy'){const fall=.5*9.80665*tau**2;return {x:pe.x,y:Math.max(.05,pe.y-Math.min(fall,.6)),z:pe.z};}
    const ts=2*net.depth/sEnd;let s,drop=0;
    if(tau<=ts)s=sEnd*tau-sEnd*sEnd*tau*tau/(4*net.depth);
    else{s=net.depth-net.rebound*Math.min(1,(tau-ts)/.04);const tf=tau-ts-net.hold;if(tf>0)drop=Math.min(.5*net.fallG*9.80665*tf*tf,Math.max(0,pe.y-.1));}
    return {x:pe.x+uEnd[0]*s,y:pe.y+uEnd[1]*s-drop,z:pe.z+uEnd[2]*s};
  };
  const g=camera.geometry,world=t=>{ // truth position at time since release
    if(t<=0){const p=samples[0];return {x:p.x,y:p.y,z:p.z};}
    if(t>=T)return afterNet(t-T);
    const u=t/T*(samples.length-1),i=Math.min(samples.length-2,Math.floor(u)),f=u-i,a=samples[i],b=samples[i+1];
    return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f};
  };
  // time base: release between two frames; user marks follow the convention "first frame the ball is off the hand / at the net"
  const releaseFrame=Math.round(R.uniform(60,110)),u=R.next(),tr=(releaseFrame-u)/fps,tg=tr+T,gloveFrame=Math.ceil(tg*fps-1e-9);
  const frames=gloveFrame+Math.round(fps*.8)+10,times=Array.from({length:frames},(_,k)=>k/fps);
  const kRad=R.uniform(1.0,1.6),sigma=(o.noisePx??1.0)*scale,observations=[];
  for(let k=releaseFrame+(o.hideFirst??0);k<=gloveFrame+(o.afterNet??3);k++){
    const p=world(times[k]-tr),cam=g.rotation[2].reduce((s,v,i)=>s+v*[p.x,p.y,p.z][i],g.translation[2]),q=E.projectWorld(g,p.x,p.y,p.z);
    const out=(o.outliers??.03)>R.next(),s=out?sigma*4:sigma;let x=q.x+R.normal()*s,y=q.y+R.normal()*s;
    if(netModel!=='legacy'){
      // motion blur: the found centre slides along the streak; ball over the bag / net after contact: a small extra centroid error
      const prev=k>releaseFrame?E.projectWorld(g,...Object.values(world(times[k-1]-tr))):q,streak=Math.hypot(q.x-prev.x,q.y-prev.y);
      if(streak>0){const b=NR.normal()*net.blurFrac*streak;x+=b*(q.x-prev.x)/streak;y+=b*(q.y-prev.y)/streak;}
      if(times[k]-tr>T){x+=NR.normal()*net.overlapPx*sigma;y+=NR.normal()*net.overlapPx*sigma;}
    }
    const rTrue=focal*0.0366/cam,r=Math.max(.8,rTrue*kRad+R.normal()*(.12*rTrue+.3*scale));
    observations.push({frame:k,timestamp:times[k],x,y,x_norm:x/W,y_norm:y/H,radius:r,confidence:out?.6:.9,source:'observation'});
  }
  const v0=flight.initialVelocity,speedAvg=D/T*3.6,speedRel=Math.hypot(...v0)*3.6;
  return {
    seed:o.seed,view,fps,width:W,height:H,pitch:o.pitch??'fastball',record:{id:rec.id,type:rec.pitch_type,rpm:rec.spin_rate_rpm,axis:rec.spin_axis_decimal,eff:rec.spin_efficiency_pct},
    truth:{camera:{position:camera.position,yawDeg:camera.yawDeg,pitchDeg:camera.pitchDeg,rollDeg:camera.rollDeg,focalPx:focal},geometry:g,distanceM:D,flightSec:T,releaseTimeSec:tr,gloveTimeSec:tg,
      ivbInch:flight.ivb,hbInch:flight.hb,avgSpeedKmh:speedAvg,releaseSpeedKmh:speedRel,releaseAngleDeg:flight.initialAngleDeg,pitchType:rec.pitch_type,releaseHeightM:height,world,net:{model:netModel,...net}},
    marks:{releaseFrame,gloveFrame:gloveFrame+(o.gloveMarkLate??0)},times,observations,
    focalPriorPx:long*FOCAL_PRIOR.ratio,focalRelSigma:FOCAL_PRIOR.relSigma
  };
}
