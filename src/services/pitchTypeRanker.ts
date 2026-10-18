// Pitch-type ranking from the geometry fit (5.0.3 P1).
//
// The fit gives a weighted set of joint samples (release speed, constant lateral/vertical acceleration = movement, launch angle).
// Each sample is compared with every physically distinct database candidate in the SAME space (speed, acceleration, angle) with
// kernel widths that describe the database model's own scatter. A type's probability is the share of the total kernel mass that
// falls on its candidates. Because every sample is used, the speed window is exactly as wide as the speed uncertainty (frame
// rate, distance and event errors included) and the movement uncertainty is carried the same way; where the video cannot tell
// two types apart (for example when vertical movement is not measurable) the probabilities stay close and the result says so.
// The database is a reference prior only: nothing here pretends the matched candidate was observed.
import type {PitchRecord} from '../types';
import {uniquePhysicalCandidates,candidateModelMovement} from './physicalCandidates';
import {launchSpeedZ,INCH,G,FitSample} from './pitchGeometryFit';

export interface PitchTypeRank{pitchType:string;probability:number;candidates:number}
export interface PitchTypeRanking{
  ranking:PitchTypeRank[];top3:PitchTypeRank[];
  /** True when the first two are close or the leader is weak. */
  hard:boolean;hardReason:string|null;
  /** Source label for the UI. */
  basis:string;kernel:{speedKmh:number;accelMs2:number;angleDeg:number};candidatesUsed:number;
}

const SIGMA={speedKmh:3,accelMs2:.6,angleDeg:3.5};

/** mirror (off by default; the 5.0.3 evaluation did not support enabling it): also compare with the left-right mirror image of every candidate (the database does not say which hand it is, and the
 *  owner's hand is not known), which flips the sign of horizontal movement only. */
export function rankPitchTypes(db:PitchRecord[],samples:FitSample[],opts:{types?:string[];useAngle?:boolean;mirror?:boolean}={}):PitchTypeRanking|null{
  if(!samples.length)return null;
  const pool=uniquePhysicalCandidates(db);
  const relSpeeds=samples.map(s=>Math.hypot(s.flight.vx,s.flight.vy,s.flight.vz)*3.6);
  const sorted=[...relSpeeds].sort((a,b)=>a-b),lo=sorted[Math.floor(sorted.length*.02)],hi=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.98))];
  const slack=Math.max(4*SIGMA.speedKmh,0);
  const useAngle=opts.useAngle!==false,mirror=opts.mirror===true;
  // candidate features at the database's own distance and flight time
  const cands:{type:string;v:number;mx:number;my:number;ang:number}[]=[];
  for(const r of pool){
    if(opts.types?.length&&!opts.types.includes(r.pitch_type))continue;
    const T=r.flight_time_sec,D=r.standard_distance_m,v=launchSpeedZ(D,T)*3.6;
    if(v<lo-slack||v>hi+slack)continue;
    const m=candidateModelMovement(r);
    const h=(r.trajectory_frames?.[0]?.y_cm??178)/100,vyApprox=(.65-h)/T+G*T/2,vz=launchSpeedZ(D,T);
    cands.push({type:r.pitch_type,v:Math.hypot(vyApprox,vz)*3.6,mx:2*m.hb*INCH/(T*T),my:2*m.ivb*INCH/(T*T),ang:Math.atan2(vyApprox,vz)*180/Math.PI});
  }
  if(!cands.length)return null;
  const typeCount:Record<string,number>={};for(const r of pool)if(!opts.types?.length||opts.types.includes(r.pitch_type))typeCount[r.pitch_type]=(typeCount[r.pitch_type]||0)+1;
  const mass:Record<string,number>={};let total=0;
  const sv=1/(2*SIGMA.speedKmh**2),sm=1/(2*SIGMA.accelMs2**2),sa=1/(2*SIGMA.angleDeg**2);
  const prepared=samples.map((s,i)=>({w:s.w,v:relSpeeds[i],mx:s.flight.mx,my:s.flight.my,ang:Math.atan2(s.flight.vy,s.flight.vz)*180/Math.PI}));
  for(const c of cands){
    let k=0;
    for(const s of prepared){
      const base=sv*(s.v-c.v)**2+sm*(s.my-c.my)**2+(useAngle?sa*(s.ang-c.ang)**2:0);
      const e1=base+sm*(s.mx-c.mx)**2;
      if(!mirror){if(e1<30)k+=s.w*Math.exp(-e1);continue;}
      const e2=base+sm*(s.mx+c.mx)**2;
      // a candidate and its mirror image count as one hypothesis: the better of the two
      const e=Math.min(e1,e2);if(e<30)k+=s.w*Math.exp(-e);
    }
    k/=typeCount[c.type]||1;mass[c.type]=(mass[c.type]||0)+k;total+=k;
  }
  if(!(total>0))return null;
  const ranking=Object.entries(mass).map(([pitchType,m])=>({pitchType,probability:m/total,candidates:cands.filter(c=>c.type===pitchType).length})).sort((a,b)=>b.probability-a.probability);
  const margin=(ranking[0]?.probability??0)-(ranking[1]?.probability??0);
  const hard=ranking[0].probability<.4||margin<.12;
  return {ranking,top3:ranking.slice(0,3),hard,hardReason:hard?(ranking[0].probability<.4?'第一名可能性不到 40%':`前兩名只差 ${(margin*100).toFixed(0)} 個百分點`):null,
    basis:'影像量測的球速與位移範圍 vs 資料庫候選（資料庫先驗）',kernel:{speedKmh:SIGMA.speedKmh,accelMs2:SIGMA.accelMs2,angleDeg:SIGMA.angleDeg},candidatesUsed:cands.length};
}
