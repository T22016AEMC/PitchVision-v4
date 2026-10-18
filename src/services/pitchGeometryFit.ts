// Joint geometry fit for one monocular pitch video: camera → distance → events → launch → movement → speed.
//
// Method (original implementation; the physics constants match conditionedPhysics.ts):
//   The tracked ball path (pixels, per frame time) is explained by a 3D flight (gravity + quadratic drag + a constant "Magnus"
//   acceleration) seen by a pinhole camera. Single-camera video does not fix the scale, so quantities that the picture cannot
//   determine (focal length ±10 %, camera height/distance, release height, the distance to the net, the exact release and net
//   times) are DRAWN from stated priors; the quantities the picture does determine (camera angles, launch direction, Magnus
//   acceleration) are solved per draw with Levenberg–Marquardt. Each draw is weighted by how well it explains the track
//   (importance sampling), and every reported number is a weighted percentile range over the draws. Nothing is hidden: when the
//   data cannot narrow a quantity the range simply stays as wide as its prior.
//
//   World frame (as the legacy engine): X to the catcher's right looking at the pitcher, Y up, Z from the release plane to the
//   net. Units m, s. Image: pixels, origin top-left, principal point at the centre, no lens distortion.
import {cameraFromPose} from './standardCamera';
import type {CameraGeometry} from './cameraGeometry';

export const G=9.80665,KD=0.0062,BALL_RADIUS_M=0.0366,INCH=0.0254;
type V3=[number,number,number];
const rad=(d:number)=>d*Math.PI/180,deg=(r:number)=>r*180/Math.PI;

// ── helpers ──────────────────────────────────────────────────────────────
export function rng(seed:number){
  let a=seed>>>0;
  const next=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  const normal=()=>{let u=0;while(!u)u=next();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*next());};
  return {next,uniform:(lo:number,hi:number)=>lo+(hi-lo)*next(),normal,truncNormal:(m:number,s:number,lo:number,hi:number)=>{for(let i=0;i<50;i++){const v=m+s*normal();if(v>=lo&&v<=hi)return v;}return Math.min(hi,Math.max(lo,m));}};
}
export function weightedQuantiles(values:number[],weights:number[],qs:number[]){
  const idx=values.map((_,i)=>i).filter(i=>Number.isFinite(values[i])&&weights[i]>0).sort((a,b)=>values[a]-values[b]);
  if(!idx.length)return qs.map(()=>NaN);
  const total=idx.reduce((s,i)=>s+weights[i],0);let acc=0,k=0;const out:number[]=[];
  for(const q of qs){const target=q*total;while(k<idx.length-1&&acc+weights[idx[k]]<target){acc+=weights[idx[k]];k++;}out.push(values[idx[k]]);}
  return out;
}
const wmean=(v:number[],w:number[])=>{let s=0,t=0;for(let i=0;i<v.length;i++){if(!Number.isFinite(v[i]))continue;s+=v[i]*w[i];t+=w[i];}return t?s/t:NaN;};
export interface Range{value:number;lo:number;hi:number}
function range(values:number[],weights:number[]):Range{const [lo,mid,hi]=weightedQuantiles(values,weights,[.05,.5,.95]);return {value:mid,lo,hi};}

function solveSym(A:number[][],b:number[]):number[]|null{
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(M[j][i])>Math.abs(M[p][i]))p=j;if(Math.abs(M[p][i])<1e-14)return null;[M[i],M[p]]=[M[p],M[i]];
    for(let j=i+1;j<n;j++){const f=M[j][i]/M[i][i];for(let k=i;k<=n;k++)M[j][k]-=f*M[i][k];}}
  const x=Array(n).fill(0);for(let i=n-1;i>=0;i--){let s=M[i][n];for(let k=i+1;k<n;k++)s-=M[i][k]*x[k];x[i]=s/M[i][i];}return x;
}
function logDeterminant(A:number[][]):number{
  const n=A.length,M=A.map(r=>[...r]);let ld=0;
  for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(M[j][i])>Math.abs(M[p][i]))p=j;if(Math.abs(M[p][i])<1e-14)return NaN;[M[i],M[p]]=[M[p],M[i]];ld+=Math.log(Math.abs(M[i][i]));
    for(let j=i+1;j<n;j++){const f=M[j][i]/M[i][i];for(let k=i;k<n;k++)M[j][k]-=f*M[i][k];}}
  return ld;
}
/** One draw from N(0, A⁻¹) given A = LLᵀ (solve Lᵀδ = z). Null when A is not positive definite. */
function sampleInverse(A:number[][],z:number[]):number[]|null{
  const n=A.length,L=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let sum=A[i][j];for(let k=0;k<j;k++)sum-=L[i][k]*L[j][k];if(i===j){if(sum<=1e-12)return null;L[i][i]=Math.sqrt(sum);}else L[i][j]=sum/L[j][j];}
  const d=Array(n).fill(0);for(let i=n-1;i>=0;i--){let sum=z[i];for(let k=i+1;k<n;k++)sum-=L[k][i]*d[k];d[i]=sum/L[i][i];}
  return d;
}
/** Levenberg–Marquardt with a numeric Jacobian. Returns the minimiser and its cost (sum of squared residuals). */
function levenbergMarquardt(x0:number[],steps:number[],residuals:(x:number[])=>number[],maxIter=10){
  let x=[...x0],r=residuals(x),cost=r.reduce((s,v)=>s+v*v,0),lambda=1e-2;
  const n=x.length;
  for(let iter=0;iter<maxIter;iter++){
    const J:number[][]=[];
    for(let j=0;j<n;j++){const xp=[...x];xp[j]+=steps[j];const rp=residuals(xp);J.push(rp.map((v,i)=>(v-r[i])/steps[j]));}
    const A=Array.from({length:n},(_,a)=>Array.from({length:n},(_,b)=>{let s=0;for(let i=0;i<r.length;i++)s+=J[a][i]*J[b][i];return s;}));
    const g=Array.from({length:n},(_,a)=>{let s=0;for(let i=0;i<r.length;i++)s+=J[a][i]*r[i];return s;});
    let improved=false;
    for(let tries=0;tries<6;tries++){
      const Ad=A.map((row,i)=>row.map((v,j)=>i===j?v*(1+lambda)+1e-9:v)),d=solveSym(Ad,g.map(v=>-v));
      if(!d){lambda*=10;continue;}
      const xn=x.map((v,i)=>v+d[i]),rn=residuals(xn),cn=rn.reduce((s,v)=>s+v*v,0);
      if(Number.isFinite(cn)&&cn<cost){const rel=(cost-cn)/Math.max(cost,1e-9);x=xn;r=rn;cost=cn;lambda=Math.max(1e-6,lambda/4);improved=true;if(rel<1e-4)return {x,cost};break;}
      lambda*=8;
    }
    if(!improved)break;
  }
  return {x,cost};
}

// ── flight model ─────────────────────────────────────────────────────────
export interface FlightParams{y0:number;vx:number;vy:number;vz:number;mx:number;my:number}
/** Position at each time since release (ascending). Gravity + quadratic drag (kD as the engine) + constant lateral acceleration (mx,my). */
export function flightPositions(f:FlightParams,times:readonly number[]):V3[]{
  const out:V3[]=[];let s=[0,f.y0,0,f.vx,f.vy,f.vz],t=0;
  const der=(q:number[])=>{const sp=Math.hypot(q[3],q[4],q[5]);return [q[3],q[4],q[5],f.mx-KD*sp*q[3],f.my-G-KD*sp*q[4],-KD*sp*q[5]];};
  for(const target of times){
    const n=Math.max(1,Math.ceil((target-t)/(1/60)-1e-9)),dt=(target-t)/n;
    if(target>t)for(let i=0;i<n;i++){
      const a=der(s),b=der(s.map((v,k)=>v+a[k]*dt/2)),c=der(s.map((v,k)=>v+b[k]*dt/2)),d=der(s.map((v,k)=>v+c[k]*dt));
      s=s.map((v,k)=>v+dt*(a[k]+2*b[k]+2*c[k]+d[k])/6);
    }
    t=Math.max(t,target);out.push([s[0],s[1],s[2]]);
  }
  return out;
}
/** Launch speed along Z so that drag-slowed flight covers `distance` in `duration` (same closed form as the engine). */
export const launchSpeedZ=(distance:number,duration:number)=>Math.expm1(KD*distance)/(KD*duration);

// ── camera ───────────────────────────────────────────────────────────────
interface Pose{pos:V3;yaw:number;pitch:number;roll:number;f:number;w:number;h:number}
function poseMatrix(p:Pose){
  const y=rad(p.yaw),pt=rad(p.pitch),r=rad(p.roll),fw:V3=[Math.sin(y)*Math.cos(pt),Math.sin(pt),Math.cos(y)*Math.cos(pt)];
  const rt:V3=[fw[1]*0-fw[2]*1,fw[2]*0-fw[0]*0,fw[0]*1-fw[1]*0]; // cross(forward,[0,1,0])
  const rn=Math.hypot(...rt),right:V3=[rt[0]/rn,rt[1]/rn,rt[2]/rn];
  const down:V3=[fw[1]*right[2]-fw[2]*right[1],fw[2]*right[0]-fw[0]*right[2],fw[0]*right[1]-fw[1]*right[0]];
  const c=Math.cos(r),s=Math.sin(r);
  const R:number[][]=[right.map((v,i)=>c*v+s*down[i]),down.map((v,i)=>c*v-s*right[i]),fw];
  return R;
}
function project(R:number[][],pos:V3,f:number,w:number,h:number,P:V3){
  const dx=P[0]-pos[0],dy=P[1]-pos[1],dz=P[2]-pos[2];
  const x=R[0][0]*dx+R[0][1]*dy+R[0][2]*dz,y=R[1][0]*dx+R[1][1]*dy+R[1][2]*dz,z=R[2][0]*dx+R[2][1]*dy+R[2][2]*dz;
  return {u:w/2+f*x/z,v:h/2+f*y/z,depth:z};
}

/** Pixel position of one fitted sample's ball at `tau` seconds after its release (diagnostics: where the extrapolated release point lands). */
export function projectSampleAt(s:{pos:V3;yaw:number;pitch:number;roll:number;f:number;flight:FlightParams},W:number,H:number,tau:number){
  const R=poseMatrix({pos:s.pos,yaw:s.yaw,pitch:s.pitch,roll:s.roll,f:s.f,w:W,h:H}),[P]=flightPositions(s.flight,[Math.max(0,tau)]);
  const q=project(R,s.pos,s.f,W,H,P);return {x:q.u,y:q.v,radiusPx:s.f*BALL_RADIUS_M/q.depth,world:P};
}

// ── public types ─────────────────────────────────────────────────────────
export interface FitObservation{frame:number;time:number;x:number;y:number;radius:number}
export interface FitInput{
  observations:FitObservation[];width:number;height:number;fps:number;view:'pitcher_rear'|'catcher';
  /** The owner's event marks: first frame the ball is off the hand, first frame it is at the net. Initial values only. */
  markRelease:{frame:number;timeSec:number};markGlove:{frame:number;timeSec:number};
  times:readonly number[];
  focal:{px:number;relSigma:number};
  biometrics:{heightCm:number;hasMound:boolean};
  /** Prior for release→net distance (m) and its sigma, or an owner override that replaces the prior. */
  distance:{priorM:number;sigmaM:number;overrideM?:number};
  seed?:number;samples?:number;
  /** Test switches: use the radius cue, use the stopped-ball (net) cue. */
  useRadius?:boolean;useStop?:boolean;
  /** Likelihood tempering (>=1) so the reported ranges account for model mismatch; calibrated on synthetic coverage. */
  temper?:number;
  /** 5.0.3.1: 'marks' (default) = the owner's release / net marks ARE the event times, each ±1 frame (the mark is the first frame
   *  after the event, so the window is mark − 1.5 … mark + 0.5 frames); the picture never moves them. 'auto' = the 5.0.3 behaviour
   *  (net time from the image), only for clips without marks, and always reported as low confidence. */
  eventSource?:'marks'|'auto';
}
export interface GeometryFit{
  status:'ok'|'low_confidence'|'failed';reasons:string[];notes?:string[];
  camera?:{positionM:Range[];yawDeg:Range;pitchDeg:Range;rollDeg:Range;focalPx:Range;geometry:CameraGeometry;source:'estimated'};
  distance?:{m:Range;source:string;priorM:number;sigmaM:number};
  events?:{releaseSec:Range;gloveSec:Range;stopFrame:number|null;stopDetected:boolean;releaseVsMarkFrames:Range;gloveVsMarkFrames:Range;releaseFrameFloat:Range;gloveFrameFloat:Range;
    source:'marks'|'auto';contact:NetContact};
  launch?:{heightM:Range;angleDeg:Range;azimuthDeg:Range;speedKmh:Range;source:'estimated'};
  movement?:{ivbInch:Range;hbInch:Range};
  speed?:{avgKmh:Range;releaseKmh:Range;flightSec:Range};
  fit?:{ess:number;samples:number;bestCostPerDof:number;bestRmsPx:number;freeFrames:number;stopFrames:number;rejected:number};
  samples?:FitSample[];
}
export interface FitSample{w:number;cost:number;pos:V3;yaw:number;pitch:number;roll:number;f:number;D:number;tr:number;tg:number;flight:FlightParams;ivb:number;hb:number;pxRms:number}

/** Where the ball meets the net, from the image alone (5.0.3.1).
 *  The net is the first ABRUPT drop of the per-frame image step below what the preceding steps predict (a straight-line trend of
 *  the last three steps, so the smooth perspective slow-down of a ball flying away from the camera is not a stop), followed by a
 *  step that stays small (the ball is held by the net, pushed back, or starts to slide down it). Contact lies between the last
 *  free observation and the next one; the fraction of the predicted step actually travelled gives the contact time. The start of
 *  the fall along the net (image y increasing with growing steps) is reported too, for comparison with a "net" mark set on the
 *  visible bulge or drop. Frame-rate independent; thresholds are in units of the position noise.
 *  index = first observation after contact (null = no contact found). */
export interface NetContact{index:number|null;stopX:number;stopY:number;contactTime:number;contactFrame:number;predictedStepPx:number;dropStepPx:number;fallStartFrame:number|null}
export function detectNetContact(obs:FitObservation[],sigmaPx:number):NetContact{
  const none:NetContact={index:null,stopX:NaN,stopY:NaN,contactTime:NaN,contactFrame:NaN,predictedStepPx:NaN,dropStepPx:NaN,fallStartFrame:null};
  const n=obs.length;if(n<6)return none;
  const gap=(i:number)=>Math.max(1,obs[i+1].frame-obs[i].frame);
  const step=(i:number)=>Math.hypot(obs[i+1].x-obs[i].x,obs[i+1].y-obs[i].y)/gap(i);
  const noise=Math.SQRT2*sigmaPx; // noise of one step
  for(let j=3;j<n-1;j++){
    const s=[step(j-3),step(j-2),step(j-1)],trend=s[2]+(s[2]-s[0])/2;
    const pred=Math.max(.6*s[2],Math.min(1.15*Math.max(...s),trend));
    if(pred<4*sigmaPx)continue;                                      // ball barely moving in the image: no evidence either way
    const drop=step(j),after=j+1<n-1?step(j+1):null;
    if(after===null){if(!(drop<.35*pred))continue;}                  // last observation: only a clear single drop counts
    else{
      if(!(after<Math.max(.5*pred,2*noise)&&after<.6*s[2]))continue; // must stay small afterwards (held / pushed back / starting to fall)
      if(!(drop+after<1.5*pred))continue;                           // over two frames at least half a frame of travel is missing
      if(j+2<n-1&&step(j+2)>.85*pred&&step(j+2)>step(j+1)*3&&obs[j+3].y<=obs[j+2].y)continue; // resumes at full speed upward/sideways: a tracking glitch
    }
    const frac=Math.min(1,Math.max(0,drop/pred));
    const contactTime=obs[j].time+frac*(obs[j+1].time-obs[j].time),contactFrame=obs[j].frame+frac*gap(j);
    // fall along the net: first post-contact frame from which image y keeps increasing with growing steps
    let fallStartFrame:number|null=null;
    for(let k=j+1;k+2<n;k++){const d1=obs[k+1].y-obs[k].y,d2=obs[k+2].y-obs[k+1].y;if(d1>.5*noise&&d2>d1+noise*.5){fallStartFrame=obs[k].frame;break;}}
    return {index:j+1,stopX:obs[j+1].x,stopY:obs[j+1].y,contactTime,contactFrame,predictedStepPx:pred,dropStepPx:drop,fallStartFrame};
  }
  return none;
}
/** 5.0.3 compatible wrapper: index of the first observation after the ball met the net (or null). */
export function detectStop(obs:FitObservation[],sigmaPx:number):{index:number|null;stopX:number;stopY:number}{
  const c=detectNetContact(obs,sigmaPx);return {index:c.index,stopX:c.stopX,stopY:c.stopY};
}

export function releaseHeightPriorM(heightCm:number,hasMound:boolean){
  const armAngle=54*Math.PI/180;
  return (heightCm*0.81+heightCm*0.38*Math.sin(armAngle)-38+(hasMound?25.4:0))/100;
}

// ── the fit ──────────────────────────────────────────────────────────────
export function fitPitchGeometry(input:FitInput):GeometryFit{
  const {width:W,height:H,view,fps}=input,long=Math.max(W,H),scale=long/1280,sigma=1.0*scale,dt=1/Math.max(1,fps);
  const reasons:string[]=[],notes:string[]=[];
  // frames before the owner's release mark are the ball in the hand (or unknown): they are never treated as free flight
  const obs=[...input.observations].filter(o=>[o.x,o.y,o.time].every(Number.isFinite)&&o.time>=input.markRelease.timeSec-1e-6).sort((a,b)=>a.frame-b.frame);
  if(obs.length<6)return {status:'failed',reasons:['影片中找到的球點少於 6 個，無法校正相機與幾何']};
  const useStop=input.useStop!==false,fromMarks=input.eventSource!=='auto';
  const markR=input.markRelease.timeSec,markG=input.markGlove.timeSec;
  const contact=useStop?detectNetContact(obs,sigma):detectNetContact([],sigma);
  let stop={index:contact.index,stopX:contact.stopX,stopY:contact.stopY};
  // a contact far from the owner's net mark is more likely a tracking glitch or a perspective slow-down than the net
  if(stop.index!==null&&Math.abs(contact.contactTime-markG)>.17){notes.push('影像判斷的撞網時間與你標的相差超過 0.17 秒，不採用');stop={index:null,stopX:NaN,stopY:NaN};}
  // free flight: from the release mark until the ball meets the net (image contact), and never the net-mark frame itself
  const freeEnd=fromMarks?markG-.5*dt:Infinity;
  const free=(stop.index===null?obs:obs.slice(0,stop.index)).filter(o=>o.time<freeEnd),stopped=stop.index===null?[]:obs.slice(stop.index);
  if(free.length<5)return {status:'failed',reasons:['自由飛行的球點少於 5 個（球停得太早或球點太少）']};
  const tFirst=free[0].time;
  // priors for the event times. marks: mark − 1.5 … mark + 0.5 frames (±1 frame around the middle of the frame interval that
  // ends at the mark); auto: release as 5.0.3, net from the image contact ±0.5 frame (or the initial value ±1 frame).
  const rLo=markR-1.5*dt,rHi=Math.min(markR+(fromMarks?.5:.25)*dt,tFirst-1e-4);
  const contactOk=stop.index!==null&&Number.isFinite(contact.contactTime);
  const gLo=fromMarks?markG-1.5*dt:contactOk?contact.contactTime-.5*dt:markG-1.5*dt,gHi=fromMarks?markG+.5*dt:contactOk?contact.contactTime+.5*dt:markG+.5*dt;
  if(!fromMarks)reasons.push('沒有使用者標記：出手與撞網時間為自動判斷（低信心）');
  if(fromMarks&&Number.isFinite(contact.contactTime)){
    const diff=(contact.contactTime-markG)/dt;
    if(Math.abs(diff)>1.5)notes.push(`影像判斷球在 F${contact.contactFrame.toFixed(1)} 撞網（球速突變），與你標的 F${input.markGlove.frame} 差 ${diff>0?'+':''}${diff.toFixed(1)} 格；最終數字仍以你的標記為準`);
  }
  const hRel=releaseHeightPriorM(input.biometrics.heightCm,input.biometrics.hasMound);
  const D0=input.distance.overrideM??input.distance.priorM,sD=input.distance.overrideM!==undefined?0.03:input.distance.sigmaM;
  const f0=input.focal.px,fRel=input.focal.relSigma;
  const R=rng(input.seed??12345),N=input.samples??400;
  const useRadius=input.useRadius!==false,temper=Math.max(1,input.temper??1);
  const sigR=(o:FitObservation)=>.25*o.radius+.4*scale;
  const sigStop=6*sigma;

  // Draws (what the picture cannot determine): focal scale, release→net distance, release time, net time.
  interface Draw{fs:number;D:number;tr:number;tg:number;stratum:number}
  // marks: the event times are stratified (4 × 4 cells of their ±1-frame windows) and the weights are normalised within each cell,
  // so the times keep exactly the owner's mark ±1 frame and the picture only re-weights what it can inform (camera, distance, focal).
  const SK=4;let drawCount=0;
  const priorDraw=():Draw=>{
    const k=drawCount++,a=k%SK,b=Math.floor(k/SK)%SK;
    const tr=fromMarks?rLo+(a+R.next())/SK*(rHi-rLo):R.uniform(rLo,rHi),tg=fromMarks?gLo+(b+R.next())/SK*(gHi-gLo):R.uniform(gLo,gHi);
    return {fs:R.uniform(1-fRel,1+fRel),D:R.truncNormal(D0,sD,D0-2.5*sD,D0+2.5*sD),tr,tg,stratum:fromMarks?a*SK+b:0};
  };
  const NP=11,PRIOR_ROWS=NP,STOP_ROWS=2;

  const times=free.map(o=>o.time);
  const evalDraw=(d:Draw)=>{
    const T=d.tg-d.tr;if(T<.2||T>1.6)return null;
    const tau=times.map(t=>t-d.tr);if(tau[0]<0)return null;
    const vz=launchSpeedZ(d.D,T),f=f0*d.fs;
    const lenOK=2*tau.length+(useRadius?tau.length:0)+STOP_ROWS+PRIOR_ROWS;
    const posOf=(b:number,yc:number,xc:number):V3=>view==='pitcher_rear'?[xc,yc,-b]:[xc,yc,d.D+b];
    const aimPoint:V3=[0,(hRel+.65)/2,d.D/2],pos0=posOf(5.5,1.5,0),v=[aimPoint[0]-pos0[0],aimPoint[1]-pos0[1],aimPoint[2]-pos0[2]];
    const yaw0=deg(Math.atan2(v[0],v[2])),pitch0=deg(Math.atan2(v[1],Math.hypot(v[0],v[2])));
    let lastPx=0;
    const rest=(x:number[])=>{
      const [yaw,pitch,roll,vx,vy,mx,my,b,yc,xc,y0]=x;
      if(b<.8||b>14||yc<.2||yc>3.5)return Array(lenOK).fill(1e3);
      const pos=posOf(b,yc,xc),Rm=poseMatrix({pos,yaw,pitch,roll,f,w:W,h:H}),flight={y0,vx,vy,vz,mx,my};
      const P=flightPositions(flight,[...tau,T]);
      const res:number[]=[];const preds:number[]=[];
      for(let i=0;i<tau.length;i++){const q=project(Rm,pos,f,W,H,P[i]);if(!(q.depth>.5))return Array(lenOK).fill(1e3);res.push((q.u-free[i].x)/sigma,(q.v-free[i].y)/sigma);preds.push(f*BALL_RADIUS_M/q.depth);}
      lastPx=Math.sqrt(res.reduce((s,v)=>s+v*v,0)/res.length)*sigma;
      if(useRadius){let num=0,den=0;for(let i=0;i<tau.length;i++){const w=1/sigR(free[i])**2;num+=w*free[i].radius*preds[i];den+=w*preds[i]*preds[i];}
        const k=Math.min(2.5,Math.max(.5,num/den));for(let i=0;i<tau.length;i++)res.push((free[i].radius-k*preds[i])/sigR(free[i]));}
      if(stopped.length&&Number.isFinite(stop.stopX)){const q=project(Rm,pos,f,W,H,P[tau.length]);if(q.depth>.5)res.push((q.u-stop.stopX)/sigStop,(q.v-stop.stopY)/sigStop);else res.push(50,50);}
      else res.push(0,0);
      const vy0=(.65-y0)/T+G*T/2;
      res.push((yaw-yaw0)/25,(pitch-pitch0)/25,roll/3,vx/1.5,(vy-vy0)/2.5,mx/2,my/3,(b-5.5)/2.5,(yc-1.5)/.35,xc/.9,(y0-hRel)/.2);
      return res;
    };
    const x0=[yaw0,pitch0,0,0,(.65-hRel)/T+G*T/2,0,0,5.5,1.5,0,hRel];
    const steps=[.05,.05,.05,.05,.05,.05,.05,.05,.02,.02,.02];
    const out=levenbergMarquardt(x0,steps,rest,10);
    const rFinal=rest(out.x),px=lastPx;
    if(rFinal[0]===1e3)return null;
    // Laplace approximation of the marginal likelihood over the solved parameters: exp(-cost/2) / sqrt(det(JᵀJ))
    const J:number[][]=[];for(let j=0;j<NP;j++){const xp=[...out.x];xp[j]+=steps[j];const rp=rest(xp);J.push(rp.map((v,i)=>(v-rFinal[i])/steps[j]));}
    const H_=Array.from({length:NP},(_,a)=>Array.from({length:NP},(_,b)=>{let s=0;for(let i=0;i<rFinal.length;i++)s+=J[a][i]*J[b][i];return s;}));
    const logDet=logDeterminant(H_);if(!Number.isFinite(logDet))return null;
    // The remaining uncertainty of the solved parameters (camera height/setback, angles, launch, Magnus) is carried by drawing one
    // posterior (Laplace) sample around the optimum for each draw, so the reported ranges are not narrower than the data allow.
    const z=Array.from({length:NP},()=>R.normal()),delta=sampleInverse(H_,z);
    const xs=delta?out.x.map((v,i)=>v+Math.sqrt(temper)*delta[i]):out.x;
    const [yaw,pitch,roll,vx,vy,mx,my,b,yc,xc,y0]=xs,pos=posOf(b,yc,xc);
    // movement as the engine defines it: difference to the spinless flight with the same start, at the net time
    const flight:FlightParams={y0,vx,vy,vz,mx,my},freeFlight:FlightParams={...flight,mx:0,my:0};
    const [end]=flightPositions(flight,[T]),[endFree]=flightPositions(freeFlight,[T]);
    return {cost:out.cost,logEvidence:-.5*out.cost/temper-.5*logDet,sample:{pos,yaw,pitch,roll,f,D:d.D,tr:d.tr,tg:d.tg,flight,ivb:(end[1]-endFree[1])/INCH,hb:(end[0]-endFree[0])/INCH,pxRms:px}};
  };

  const dof=Math.max(1,2*free.length+(useRadius?free.length:0)+(stopped.length?2:0)-7);
  const run=(n:number,draw:()=>{d:Draw;logq:number})=>{
    const out:{w:number;cost:number;stratum:number;s:ReturnType<typeof evalDraw>}[]=[];let rejected=0;
    for(let i=0;i<n;i++){const {d,logq}=draw();const e=evalDraw(d);if(!e){rejected++;continue;}out.push({w:e.logEvidence-logq,cost:e.cost,stratum:d.stratum,s:e});}
    return {out,rejected};
  };
  // stage 1: draws from the priors (importance weight = marginal likelihood)
  let {out:stage,rejected}=run(fromMarks?N:Math.round(N*.6),()=>({d:priorDraw(),logq:0}));
  const normalise=(rows:typeof stage)=>{
    if(!fromMarks){const m=Math.max(...rows.map(r=>r.w));return rows.map(r=>({...r,w:Math.exp(r.w-m)}));}
    // within-cell normalisation: every non-empty time cell carries the same total weight (its prior mass)
    const cells=new Map<number,typeof rows>();for(const r of rows){const c=cells.get(r.stratum)??[];c.push(r);cells.set(r.stratum,c);}
    const out:typeof rows=[];
    for(const c of cells.values()){const m=Math.max(...c.map(r=>r.w)),e=c.map(r=>Math.exp(r.w-m)),s=e.reduce((a,b)=>a+b,0);c.forEach((r,i)=>out.push({...r,w:e[i]/s}));}
    return out;
  };
  let rows=normalise(stage);
  const ess=(rs:typeof rows)=>{const s=rs.reduce((a,r)=>a+r.w,0),s2=rs.reduce((a,r)=>a+r.w*r.w,0);return s*s/Math.max(1e-30,s2);};
  // stage 2 (auto events only): refine around the heavy draws (per-dimension Gaussian proposal truncated to the prior support)
  if(!fromMarks&&rows.length&&ess(rows)<80){
    const keys:(keyof Draw)[]=['fs','D','tr','tg'];
    const get=(r:typeof rows[number],k:keyof Draw)=>{const s=r.s!.sample;switch(k){case 'fs':return s.f/f0;case 'D':return s.D;case 'tr':return s.tr;default:return s.tg;}};
    const w=rows.map(r=>r.w),sumW=w.reduce((a,b)=>a+b,0);
    const mu:Record<string,number>={},sd:Record<string,number>={};
    for(const k of keys){const vals=rows.map(r=>get(r,k));const m=vals.reduce((a,v,i)=>a+v*w[i],0)/sumW;mu[k]=m;sd[k]=Math.max(1e-4,Math.sqrt(vals.reduce((a,v,i)=>a+w[i]*(v-m)**2,0)/sumW)*1.4);}
    const lo:Record<string,number>={fs:1-fRel,D:D0-2.5*sD,tr:rLo,tg:gLo},hi:Record<string,number>={fs:1+fRel,D:D0+2.5*sD,tr:rHi,tg:gHi};
    const logPrior=(d:Draw)=>-.5*((d.D-D0)/sD)**2;
    const logProp=(d:Draw)=>keys.reduce((a,k)=>a-.5*((d[k]-mu[k])/sd[k])**2-Math.log(sd[k]),0);
    const second=run(Math.round(N*.4),()=>{
      const d:any={};for(const k of keys){let v=mu[k]+sd[k]*R.normal();let tries=0;while((v<lo[k]||v>hi[k])&&tries++<30)v=mu[k]+sd[k]*R.normal();d[k]=Math.min(hi[k],Math.max(lo[k],v));}
      return {d,logq:logProp(d)-logPrior(d)};
    });
    rejected+=second.rejected;rows=normalise(second.out.length?second.out:stage);
  }
  if(!rows.length)return {status:'failed',reasons:['相機與幾何擬合沒有可用解']};
  const total=rows.reduce((a,r)=>a+r.w,0),W_=rows.map(r=>r.w/total),S=rows.map(r=>({...r.s!.sample}));
  const best=rows.reduce((a,b)=>b.cost<a.cost?b:a);
  // a camera looking back toward the pitcher has a yaw near ±180°: unwrap around the best draw before averaging
  {const ref=best.s!.sample.yaw;for(const x of S){let d=x.yaw-ref;while(d>180)d-=360;while(d<-180)d+=360;x.yaw=ref+d;}}
  const rms=best.s!.sample.pxRms;
  const e=ess(rows);
  const bestCostPerDof=best.cost/dof;
  if(bestCostPerDof>6)reasons.push(`最佳擬合殘差偏大（χ²/自由度 ${bestCostPerDof.toFixed(1)}）：球路與物理模型不一致`);
  if(e<10)reasons.push(`有效樣本數只有 ${e.toFixed(0)}：資料與先驗相差很大`);
  const cam0=S.reduce((a,s,i)=>({pos:[a.pos[0]+s.pos[0]*W_[i],a.pos[1]+s.pos[1]*W_[i],a.pos[2]+s.pos[2]*W_[i]] as V3,yaw:a.yaw+s.yaw*W_[i],pitch:a.pitch+s.pitch*W_[i],roll:a.roll+s.roll*W_[i],f:a.f+s.f*W_[i]}),{pos:[0,0,0] as V3,yaw:0,pitch:0,roll:0,f:0});
  const g=cameraFromPose(cam0.pos,cam0.yaw,cam0.pitch,cam0.roll,cam0.f,W,H);
  g.limitations=[`由球路自動估計（${S.length} 組取樣加權）；焦距由手機型號推算 ±${Math.round(fRel*100)}%，相機位置與距離只有先驗＋弱約束`,...g.limitations];g.quality=Math.max(.2,Math.min(.6,1/(1+bestCostPerDof/4)));
  const q=(sel:(s:FitSample,i:number)=>number)=>range(S.map(sel),W_);
  const frameOf=(t:number)=>input.markRelease.frame+(t-input.markRelease.timeSec)/dt;
  const releaseFrame=(t:number)=>input.markRelease.frame+(t-input.markRelease.timeSec)/dt,gloveFrame=(t:number)=>input.markGlove.frame+(t-input.markGlove.timeSec)/dt;
  void frameOf;
  const result:GeometryFit={
    status:reasons.length?'low_confidence':'ok',reasons,notes,
    camera:{positionM:[0,1,2].map(k=>q(s=>s.pos[k])),yawDeg:q(s=>s.yaw),pitchDeg:q(s=>s.pitch),rollDeg:q(s=>s.roll),focalPx:q(s=>s.f),geometry:g,source:'estimated'},
    distance:{m:q(s=>s.D),source:input.distance.overrideM!==undefined?'owner':'prior+track',priorM:D0,sigmaM:sD},
    events:{releaseSec:q(s=>s.tr),gloveSec:q(s=>s.tg),stopFrame:stop.index!==null?obs[stop.index].frame:null,stopDetected:stop.index!==null,
      releaseVsMarkFrames:q(s=>releaseFrame(s.tr)-input.markRelease.frame),gloveVsMarkFrames:q(s=>gloveFrame(s.tg)-input.markGlove.frame),releaseFrameFloat:q(s=>releaseFrame(s.tr)),gloveFrameFloat:q(s=>gloveFrame(s.tg)),
      source:fromMarks?'marks':'auto',contact},
    launch:{heightM:q(s=>s.flight.y0),angleDeg:q(s=>deg(Math.atan2(s.flight.vy,s.flight.vz))),azimuthDeg:q(s=>deg(Math.atan2(s.flight.vx,s.flight.vz))),speedKmh:q(s=>Math.hypot(s.flight.vx,s.flight.vy,s.flight.vz)*3.6),source:'estimated'},
    movement:{ivbInch:q(s=>s.ivb),hbInch:q(s=>s.hb)},
    speed:{avgKmh:q(s=>s.D/(s.tg-s.tr)*3.6),releaseKmh:q(s=>Math.hypot(s.flight.vx,s.flight.vy,s.flight.vz)*3.6),flightSec:q(s=>s.tg-s.tr)},
    fit:{ess:e,samples:S.length,bestCostPerDof,bestRmsPx:rms,freeFrames:free.length,stopFrames:stopped.length,rejected},
    samples:S.map((s,i)=>({...s,w:W_[i],cost:rows[i].cost}))
  };
  return result;
}
