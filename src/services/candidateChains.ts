import { BallObservation } from '../types';
import { assessTrackEvidence } from './trackEvidence';
export function linkBallCandidateChains(observations:BallObservation[],fps:number):BallObservation[]{
 const sorted=[...observations].sort((a,b)=>a.frame-b.frame),paths:BallObservation[][]=[],scores:number[]=[];
 for(let i=0;i<sorted.length;i++){const current=sorted[i];let best=[current],bestScore=current.confidence;
  for(let j=i-1;j>=0;j--){const previous=sorted[j],gap=current.frame-previous.frame;if(gap>3)break;if(gap<=0)continue;
   const dt=current.timestamp-previous.timestamp,d=Math.hypot(current.x_norm-previous.x_norm,current.y_norm-previous.y_norm);
   if(dt<=0||d<0.001||d/dt>8||current.timestamp-paths[j][0].timestamp>1.2)continue;
   let cost=d/dt*0.05;
   const path=paths[j];if(path.length>1){const old=path[path.length-2],oldDt=previous.timestamp-old.timestamp;
    if(oldDt<=0)continue;const vx=(previous.x_norm-old.x_norm)/oldDt,vy=(previous.y_norm-old.y_norm)/oldDt,ux=(current.x_norm-previous.x_norm)/dt,uy=(current.y_norm-previous.y_norm)/dt;
    const cosine=(vx*ux+vy*uy)/(Math.hypot(vx,vy)*Math.hypot(ux,uy)||1);if(cosine<0.2)continue;cost+=Math.hypot(ux-vx,uy-vy)*0.2;
   }
   const score=scores[j]+current.confidence-cost-(gap-1)*0.2;if(score>bestScore){best=[...path,current];bestScore=score;}
  }paths.push(best);scores.push(bestScore);
 }
 let best:BallObservation[]=[],score=-Infinity;
 paths.forEach((path,i)=>{const evidence=assessTrackEvidence(path,fps);if(!evidence.valid)return;
   const first=path[0],last=path.at(-1)!,net=Math.hypot(last.x_norm-first.x_norm,last.y_norm-first.y_norm);let length=0;for(let j=1;j<path.length;j++)length+=Math.hypot(path[j].x_norm-path[j-1].x_norm,path[j].y_norm-path[j-1].y_norm);
   if(net<0.025||net/Math.max(length,0.0001)<0.65)return;
   const candidate=scores[i]*evidence.score;if(candidate>score){best=path;score=candidate;}
 });return best;
}
