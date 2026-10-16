import { BallObservation, BaseballTrackPoint } from '../types';
import { fitQuadratic } from './conditionedPhysics';
export interface EvidenceWindow {releaseTimeSec?:number;catchTimeSec?:number;sourceTimestamps?:readonly number[];expectedFrames?:number}
export function independentObservations(points:readonly (BallObservation|BaseballTrackPoint)[],window:EvidenceWindow={}){
 const sorted=points.filter(p=>(p.source==='observation'||p.source==='vision')&&!p.is_outlier&&p.confidence>=.45&&[p.timestamp,p.x_norm,p.y_norm,p.frame,p.confidence].every(Number.isFinite)&&Number.isInteger(p.frame)&&p.frame>=0&&p.x_norm>=0&&p.x_norm<=1&&p.y_norm>=0&&p.y_norm<=1&&(!window.sourceTimestamps?.length||p.frame<window.sourceTimestamps.length&&Math.abs(window.sourceTimestamps[p.frame]-p.timestamp)<1e-6)&&(window.releaseTimeSec===undefined||p.timestamp>=window.releaseTimeSec)&&(window.catchTimeSec===undefined||p.timestamp<=window.catchTimeSec)).sort((a,b)=>a.timestamp-b.timestamp);
 const frames=new Set<number>(),times=new Set<number>();
 return sorted.filter(p=>{if(frames.has(p.frame)||times.has(p.timestamp))return false;frames.add(p.frame);times.add(p.timestamp);return true;}).map(p=>({...p,source:'observation' as const}));
}
export function assessTrackEvidence(points:readonly (BallObservation|BaseballTrackPoint)[],fps:number,window:EvidenceWindow={}){
  const real=independentObservations(points,window);
  const speeds:number[]=[],turns:number[]=[];let gaps=0,duplicates=0;
  for(let i=1;i<real.length;i++){const a=real[i-1],b=real[i],dt=b.timestamp-a.timestamp;
    if(dt<=0){duplicates++;continue;}if(dt>Math.max(0.12,Number.isFinite(fps)&&fps>0?3/fps:0))gaps++;
    speeds.push(Math.hypot(b.x_norm-a.x_norm,b.y_norm-a.y_norm)/dt);
    if(i>1){const c=real[i-2],ux=a.x_norm-c.x_norm,uy=a.y_norm-c.y_norm,vx=b.x_norm-a.x_norm,vy=b.y_norm-a.y_norm;
      turns.push((ux*vx+uy*vy)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)||1));}
  }
  const sorted=[...speeds].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]||0;
  // Perspective can change projected speed smoothly across the flight. Compare
  // with neighboring velocities, not the whole-flight median; keep the same caps.
  const jumps=speeds.filter((s,i)=>{const start=Math.max(0,i-2),near=speeds.slice(start,i+3).filter((_,j)=>j+start!==i).sort((a,b)=>a-b),local=near[Math.floor(near.length/2)]??median;return s>Math.max(.2,local*4)||s>12;}).length;
  const reversing=turns.filter(c=>c< -0.35).length;
  const duration=real.length?real.at(-1)!.timestamp-real[0].timestamp:0;
  const coverage=real.length/Math.max(1,(real.at(-1)?.frame||0)-(real[0]?.frame||0)+1);
  const score=Math.max(0,Math.min(1,coverage*(1-(gaps+jumps+duplicates+reversing)/Math.max(1,real.length-1))));
  const reasons=[];if(real.length<4)reasons.push('少於4個獨立觀測');if(duplicates)reasons.push('時間戳重複');if(gaps)reasons.push('時間缺口');if(jumps)reasons.push('異常投影速度');if(reversing>Math.max(1,turns.length*0.2))reasons.push('方向頻繁反轉');if(duration<0.08)reasons.push('觀測區間過短');
  let residual=Infinity;
  if(real.length>=4&&!duplicates){try{const first=real[0].timestamp,x=fitQuadratic(real.map(p=>({t:p.timestamp-first,value:p.x_norm}))),y=fitQuadratic(real.map(p=>({t:p.timestamp-first,value:p.y_norm})));residual=Math.hypot(x.rmse,y.rmse);if(residual>0.03)reasons.push('投影軌跡擬合殘差過大');}catch{reasons.push('軌跡擬合退化');}}
  const meanConfidence=real.reduce((sum,p)=>sum+p.confidence,0)/Math.max(1,real.length);
  if(meanConfidence<.5)reasons.push('平均觀測信心不足0.50');
  const valid=!reasons.length&&score>=.45;
  if(score<.45)reasons.push('時空連續覆蓋不足');
  const expected=(window.expectedFrames??(window.sourceTimestamps?.filter(t=>(window.releaseTimeSec===undefined||t>=window.releaseTimeSec)&&(window.catchTimeSec===undefined||t<=window.catchTimeSec)).length))||Math.max(1,(real.at(-1)?.frame??0)-(real[0]?.frame??0)+1);
  const intervalCoverage=real.length/Math.max(1,expected),interval=(window.catchTimeSec??real.at(-1)?.timestamp??0)-(window.releaseTimeSec??real[0]?.timestamp??0),timeCoverage=interval>0?duration/interval:0;
  const matchingReasons=[...reasons];if(intervalCoverage<.4)matchingReasons.push('投球區間觀測覆蓋不足40%');if(timeCoverage<.35)matchingReasons.push('投球時間涵蓋不足35%');
  const matchingEligible=valid&&intervalCoverage>=.4&&timeCoverage>=.35;
  return {valid,trackingSuccess:real.length>0,matchingEligible,matchingReasons,observations:real,meanConfidence,expectedFrames:expected,intervalCoverage,timeCoverage,score:score/(1+(Number.isFinite(residual)?residual:1)*10),duration,coverage,reasons,medianProjectedSpeed:median,projectedFitResidual:residual};
}
