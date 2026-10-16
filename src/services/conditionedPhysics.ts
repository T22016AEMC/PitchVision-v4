import { BaseballTrackPoint, TrajectoryPoint } from '../types';
import { CameraGeometry, reconstructAtDepth, solveLinear, projectWorld } from './cameraGeometry';
const kDrag=0.0062,gravity=9.80665;
function initialLongitudinalVelocity(distance:number,duration:number){return Math.expm1(kDrag*distance)/(kDrag*duration);}
function advanceFlightState(s:number[],dt:number,activeRpm:number,axis:number){
  const speed=Math.hypot(...s.slice(3)),lift=Math.min(0.38,1.15*0.0366*activeRpm*2*Math.PI/60/Math.max(0.001,speed)),mag=0.0177*lift*speed*speed,theta=axis/12*2*Math.PI;
  const acc=[mag*Math.sin(theta)-kDrag*speed*s[3],mag*Math.cos(theta)-gravity-kDrag*speed*s[4],-kDrag*speed*s[5]];
  for(let j=0;j<3;j++){s[j]+=s[j+3]*dt+0.5*acc[j]*dt*dt;s[j+3]+=acc[j]*dt;}
}
export function fitQuadratic(points:{t:number;value:number}[]){
  if(points.length<4)throw Error('需至少4個獨立觀測來估算加速度與殘差');
  const A=points.map(p=>[1,p.t,p.t*p.t]),normal=[0,1,2].map(i=>[0,1,2].map(j=>A.reduce((s,r)=>s+r[i]*r[j],0))),b=[0,1,2].map(i=>A.reduce((s,r,k)=>s+r[i]*points[k].value,0));
  const coeff=solveLinear(normal,b),residual=points.map((p,i)=>p.value-A[i].reduce((s,x,j)=>s+x*coeff[j],0));
  const sigma2=residual.reduce((s,x)=>s+x*x,0)/(points.length-3),invColumn=solveLinear(normal,[0,0,1]);
  return {coeff,rmse:Math.sqrt(residual.reduce((s,x)=>s+x*x,0)/points.length),acceleration:2*coeff[2],accelerationError:2*Math.sqrt(Math.max(0,invColumn[2]*sigma2))};
}
export function measureConditionedMovement(track:BaseballTrackPoint[],geometry:CameraGeometry,releaseTime:number,flightTime:number,distance:number){
  const real=track.filter(p=>p.source==='vision');
  const world=real.map(p=>({t:p.timestamp-releaseTime,...reconstructAtDepth(geometry,p.x_norm,p.y_norm,distance*(p.timestamp-releaseTime)/flightTime)}));
  const x=fitQuadratic(world.map(p=>({t:p.t,value:p.x}))),y=fitQuadratic(world.map(p=>({t:p.t,value:p.y})));
  // Undo the existing vector drag at mid-flight before attributing acceleration to Magnus.
  const vx=x.coeff[1]+x.acceleration*flightTime/2,vy=y.coeff[1]+y.acceleration*flightTime/2;
  const v0z=initialLongitudinalVelocity(distance,flightTime),vz=v0z*Math.exp(-kDrag*distance/2),speed=Math.hypot(vx,vy,vz);
  const ax=x.acceleration+kDrag*speed*vx,ay=y.acceleration+gravity+kDrag*speed*vy;
  const factor=0.5*flightTime*flightTime/0.0254;
  // Compare with a zero-spin trajectory using the same initial conditions, gravity and drag.
  const free=[x.coeff[0],y.coeff[0],0,x.coeff[1],y.coeff[1],v0z];
  for(let time=0;time<flightTime;){const dt=Math.min(1/240,flightTime-time);advanceFlightState(free,dt,0,12);time+=dt;}
  const endpoint=(c:number[])=>c[0]+c[1]*flightTime+c[2]*flightTime*flightTime;
  const hb=(endpoint(x.coeff)-free[0])/0.0254,ivb=(endpoint(y.coeff)-free[1])/0.0254;
  const pixelNoise=real.map((p,i)=>{const q=reconstructAtDepth(geometry,p.x_norm+1/geometry.width,p.y_norm+1/geometry.height,world[i].z);return Math.hypot(q.x-world[i].x,q.y-world[i].y);}).reduce((a,b)=>a+b,0)/Math.max(1,real.length);
  const tRows=world.map(p=>[1,p.t,p.t*p.t]),normal=[0,1,2].map(i=>[0,1,2].map(j=>tRows.reduce((s,r)=>s+r[i]*r[j],0)));
  const pixelAcceleration=2*pixelNoise*Math.sqrt(Math.max(0,solveLinear(normal,[0,0,1])[2]));
  const uncertainty=Math.hypot(x.accelerationError,y.accelerationError,pixelAcceleration)*factor;
  const valid=world.every(p=>p.t>=-0.002&&p.t<=flightTime+0.002)&&Math.hypot(x.rmse,y.rmse)<0.15&&Math.hypot(ax,ay)<25&&flightTime>0.1;
  return {ivb,hb,ax,ay,uncertainty,valid,world,xFit:x,yFit:y,rmseM:Math.hypot(x.rmse,y.rmse),basis:'平面標定+線性深度/時間約束，二次擬合與中段阻力修正；IVB/HB相對同初值重力+阻力無旋轉軌跡。殘差標準誤+1px敏感度，不含焦距/尺度/畸變/深度假設誤差'};
}
export function inferActiveSpin(ax:number,ay:number,velocityKmh:number,priorEfficiency:number){
  const speed=velocityKmh/3.6,accel=Math.hypot(ax,ay),cap=0.0177*0.38*speed*speed;
  if(speed<=0||accel<1e-6||accel>cap) return null;
  const activeRpm=accel/(0.0177*1.15*0.0366*(2*Math.PI/60)*speed);
  const axis=((Math.atan2(ax,ay)/(2*Math.PI)*12)%12+12)%12;
  const efficiency=priorEfficiency/100;if(efficiency<=0)return null;
  return {activeRpm,axisDecimal:axis||12,rpm:activeRpm/efficiency,efficiencyPct:priorEfficiency,basis:'Magnus合力約束有效RPM；總RPM與Efficiency耦合，Efficiency仍為資料庫先驗，不能唯一反解'};
}
export function forwardProjectedModel(g:CameraGeometry,measurement:ReturnType<typeof measureConditionedMovement>,distance:number,duration:number,rpm:number,axis:number,efficiency:number,release:number,glove:number,fps:number,timestamps?:number[]){
 const v0z=initialLongitudinalVelocity(distance,duration);
 const initial=[measurement.xFit.coeff[0],measurement.yFit.coeff[0],0,measurement.xFit.coeff[1],measurement.yFit.coeff[1],v0z];
 let state=[...initial],free=[...initial],last=0;
 const track:TrajectoryPoint[]=[];
 for(let f=release;f<=glove;f++){const time=(timestamps?.[f]??f/fps)-(timestamps?.[release]??release/fps);while(last<time-1e-9){const dt=Math.min(1/240,time-last);advanceFlightState(state,dt,rpm*efficiency/100,axis);advanceFlightState(free,dt,0,axis);last+=dt;}
   const pixel=projectWorld(g,state[0],state[1],state[2]);track.push({frame:f,timestamp_sec:timestamps?.[f]??f/fps,x_norm:pixel.x/g.width,y_norm:pixel.y/g.height,radius:4,depth_z:state[2],world_x_cm:state[0]*100,world_y_cm:state[1]*100,confidence:g.quality*100,source:'model'});
 }
 return {modelTrack:track,reconstructedIvbInch:(state[1]-free[1])/0.0254,reconstructedHbInch:(state[0]-free[0])/0.0254};
}

// V4.5 candidate-only integration. Existing measured-speed and inverse APIs stay unchanged.
export function integrateCandidateFlight(distance:number,duration:number,height:number,rpm:number,axis:number,efficiency:number){
 if(![distance,duration,height,rpm,axis,efficiency].every(Number.isFinite)||distance<=0||duration<=0||rpm<0||efficiency<0||efficiency>100)throw Error('無效候選飛行條件');
 const theta=axis/12*2*Math.PI,active=rpm*efficiency/100;
 const derivative=(s:number[],spin:number)=>{
  const [vx,vy,vz]=s.slice(3),speed=Math.hypot(vx,vy,vz),lift=Math.min(.38,1.15*.0366*spin*2*Math.PI/60/Math.max(.001,speed));
  // Effective transverse spin axis: omega x velocity; no gyro RPM is observable here.
  const cross=[Math.sin(theta)*vz,Math.cos(theta)*vz,-Math.cos(theta)*vy-Math.sin(theta)*vx],n=Math.hypot(...cross)||1,mag=.0177*lift*speed*speed;
  return [vx,vy,vz,...cross.map((v,i)=>mag*v/n-kDrag*speed*s[i+3]-(i===1?gravity:0))];
 };
 const step=(s:number[],dt:number,spin:number)=>{
  const a=derivative(s,spin),b=derivative(s.map((v,i)=>v+a[i]*dt/2),spin),c=derivative(s.map((v,i)=>v+b[i]*dt/2),spin),d=derivative(s.map((v,i)=>v+c[i]*dt),spin);
  return s.map((v,i)=>v+dt*(a[i]+2*b[i]+2*c[i]+d[i])/6);
 };
 const run=(vy:number,vz:number,spin:number,samples=false)=>{
  let s=[0,height,0,0,vy,vz],time=0;const world=[{t:0,x:0,y:height,z:0}];
  for(let i=1;i<=60;i++){const target=duration*i/60;while(time<target-1e-12){const dt=Math.min(1/240,target-time);s=step(s,dt,spin);time+=dt;}if(samples)world.push({t:target,x:s[0],y:s[1],z:s[2]});}
  return {s,world};
 };
 // Missing initial vectors: solve a common 0.65m glove-height prior plus recorded
 // distance/time, rather than pretending legacy camera-dependent XY is world data.
 let vy=(.65-height)/duration+gravity*duration/2,vz=initialLongitudinalVelocity(distance,duration);
 for(let i=0;i<8;i++){
  const a=run(vy,vz,active).s,ey=a[1]-.65,ez=a[2]-distance;if(Math.hypot(ey,ez)<1e-11)break;
  const b=run(vy+.01,vz,active).s,c=run(vy,vz+.01,active).s,A=(b[1]-a[1])/.01,B=(c[1]-a[1])/.01,C=(b[2]-a[2])/.01,D=(c[2]-a[2])/.01,det=A*D-B*C;
  if(Math.abs(det)<1e-10)throw Error('候選初值求解退化');vy-=(D*ey-B*ez)/det;vz-=(A*ez-C*ey)/det;
 }
 const flight=run(vy,vz,active,true),free=run(vy,vz,0).s;
 if(!flight.s.every(Number.isFinite)||Math.hypot(flight.s[1]-.65,flight.s[2]-distance)>1e-5||vz<=0)throw Error('候選數值積分未收斂');
 return {world:flight.world,ivb:(flight.s[1]-free[1])/.0254,hb:(flight.s[0]-free[0])/.0254,initialVelocity:[0,vy,vz],initialAngleDeg:Math.atan2(vy,vz)*180/Math.PI};
}
