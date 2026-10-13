import { BallObservation } from '../types';
import { fitQuadratic } from './conditionedPhysics';
export function assessTrackEvidence(points:BallObservation[],fps:number){
  const real=points.filter(p=>p.source==='observation').sort((a,b)=>a.timestamp-b.timestamp);
  const speeds:number[]=[],turns:number[]=[];let gaps=0,duplicates=0;
  for(let i=1;i<real.length;i++){const a=real[i-1],b=real[i],dt=b.timestamp-a.timestamp;
    if(dt<=0){duplicates++;continue;}if(dt>Math.max(0.12,3/fps))gaps++;
    speeds.push(Math.hypot(b.x_norm-a.x_norm,b.y_norm-a.y_norm)/dt);
    if(i>1){const c=real[i-2],ux=a.x_norm-c.x_norm,uy=a.y_norm-c.y_norm,vx=b.x_norm-a.x_norm,vy=b.y_norm-a.y_norm;
      turns.push((ux*vx+uy*vy)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)||1));}
  }
  const sorted=[...speeds].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]||0;
  const jumps=speeds.filter(s=>s>Math.max(0.2,median*4)||s>12).length;
  const reversing=turns.filter(c=>c< -0.35).length;
  const duration=real.length?real.at(-1)!.timestamp-real[0].timestamp:0;
  const coverage=real.length/Math.max(1,(real.at(-1)?.frame||0)-(real[0]?.frame||0)+1);
  const score=Math.max(0,Math.min(1,coverage*(1-(gaps+jumps+duplicates+reversing)/Math.max(1,real.length-1))));
  const reasons=[];if(real.length<4)reasons.push('少於4個獨立觀測');if(duplicates)reasons.push('時間戳重複');if(gaps)reasons.push('時間缺口');if(jumps)reasons.push('異常投影速度');if(reversing>Math.max(1,turns.length*0.2))reasons.push('方向頻繁反轉');if(duration<0.08)reasons.push('觀測區間過短');
  let residual=Infinity;
  if(real.length>=4&&!duplicates){try{const first=real[0].timestamp,x=fitQuadratic(real.map(p=>({t:p.timestamp-first,value:p.x_norm}))),y=fitQuadratic(real.map(p=>({t:p.timestamp-first,value:p.y_norm})));residual=Math.hypot(x.rmse,y.rmse);if(residual>0.03)reasons.push('投影軌跡擬合殘差過大');}catch{reasons.push('軌跡擬合退化');}}
  return {valid:!reasons.length&&score>=0.45,score:score/(1+(Number.isFinite(residual)?residual:1)*10),duration,coverage,reasons,medianProjectedSpeed:median,projectedFitResidual:residual};
}
