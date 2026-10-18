// The six final numbers of the result page (5.0.3.1): release speed, spin rate, spin axis, vertical and horizontal movement, spin
// efficiency. ONE value and ONE range per number for one video.
//
//   prior      = database candidates: the owner's pitch type (or every type in AI mode), inside a release-speed window that is never
//                narrower than the measured speed range; each candidate's spin is flown (the engine's own RK4, unchanged) at THIS
//                pitch's distance, flight time and release height, so its movement has the same definition as the measurement
//                (difference to the spinless gravity + drag path from the same start, at the net time).
//   likelihood = the image measurement: the weighted samples of the geometry fit (release speed, IVB, HB with their full spread).
//   posterior  = measurement samples re-weighted by the prior (and divided by the fit's own weak movement prior, so it is not
//                counted twice). Spin rate / axis / efficiency are never measured: they are the posterior spread of the candidates
//                (資料庫先驗, 推估) and are shown as ranges.
//   conflict   = the measured and the prior 90% ranges do not overlap: nothing is silently picked. The value is the precision-weighted
//                compromise, the range covers both, the confidence is lowered and the debug data says which side is suspect.
// Release speed is the measurement alone (distance prior ÷ the owner's marked time, drag model kD 0.0062); it is not pulled toward
// database speeds.
import type {PitchRecord} from '../types';
import {uniquePhysicalCandidates} from './physicalCandidates';
import {integrateCandidateFlight} from './conditionedPhysics';
import {launchSpeedZ,weightedQuantiles,rng,GeometryFit,FitSample,Range} from './pitchGeometryFit';

export type FinalOrigin='影像量測'|'物理模型推算'|'資料庫先驗';
export type FinalKey='releaseSpeed'|'spinRate'|'spinAxis'|'ivb'|'hb'|'efficiency';
export interface FinalItem{
  key:FinalKey;label:string;value:number;lo:number;hi:number;unit:string;
  /** Main text and range text as shown (spin items show the range as the main text: they are not measured). */
  display:string;range:string;origin:FinalOrigin[];estimated:true;note:string;
}
export interface FinalNumbers{
  status:'ok'|'low_confidence'|'fallback';
  items:FinalItem[];
  pitchTypeMode:'given'|'ai';pitchType:string|null;
  /** AI mode only: top three with relative likelihood. */
  pitchTypes:{top3:{pitchType:string;probability:number}[];hard:boolean;hardReason:string|null}|null;
  debug:FinalDebug;
}
export interface FinalDebug{
  measured:{releaseKmh?:Range;avgKmh?:Range;ivbInch?:Range;hbInch?:Range};
  prior:{candidates:number;speedWindowKmh:[number,number];windowWidened:boolean;ivbInch?:Range;hbInch?:Range;rpm?:Range;efficiencyPct?:Range;flownAt:{distanceM:number;flightSec:number;releaseHeightM:number}};
  merged:{ivbInch?:Range;hbInch?:Range};
  /** One entry per movement item whose measurement and database prior disagree (see assessAgreement). */
  conflicts:{item:'ivb'|'hb';kind:Exclude<AgreementKind,'agree'|'one_sided'>|'weight_collapse';measured:Range;prior:Range;gapInch:number;overlapInch:number;medianDifferenceInch:number;suspects:string[]}[];
  essRatio:number|null;
  distanceM:Range;flightSec:Range;
  topCandidates:{id:number;type:string;rpm:number;axis:string;efficiencyPct:number;ivbInch:number;hbInch:number;weight:number;mirrored:boolean}[];
  mirror:boolean;
  notes:string[];
}
export interface FinalInput{
  db:PitchRecord[];selectedPitchType:string;aiOption:string;
  /** Geometry fit with samples (null = fit not used; speed from the priors and the marks, movement from the database only). */
  fit:GeometryFit|null;
  fallback:{distanceM:number;sigmaM:number;markFlightSec:number;frameSec:number;releaseHeightM:number};
  seed?:number;
  /** Throwing hand unknown: also use every candidate's left-right mirror image (HB and axis mirrored), each hand with half the
   *  prior. The database holds one hand only. Default: on when the owner gave the pitch type, off in AI mode (see the 5.0.3.1
   *  evaluation in test-results/accuracy-5.0.3.1.json). */
  mirror?:boolean;
}

const SIGMA_V=3,SIGMA_M=3;            // km/h, inch: database model scatter (the same widths as the 5.0.3 ranker: 0.6 m/s² ≈ 3 in at 0.5 s)
const MISMATCH={eps:.15,sigma:10};     // model-mismatch share and width (inch), set from the synthetic error spread (mean |IVB err| ≈ 6, p90 ≈ 13 in)
const MAX_AI_CANDIDATES=240;

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const rangeOf=(vals:number[],w:number[]):Range=>{const [lo,value,hi]=weightedQuantiles(vals,w,[.05,.5,.95]);return {value,lo,hi};};
export const clock=(h:number)=>{let x=((h%12)+12)%12;let hh=Math.floor(x),mm=Math.round((x-hh)*60);if(mm===60){hh+=1;mm=0;}hh=hh%12;return `${hh===0?12:hh}:${String(mm).padStart(2,'0')}`;};
const sgn=(v:number,d=1)=>`${v>=0?'+':''}${v.toFixed(d)}`;
const gauss=(d:number,s:number)=>Math.exp(-.5*(d/s)**2);
const mixK=(d:number)=>(1-MISMATCH.eps)*gauss(d,SIGMA_M)+MISMATCH.eps*gauss(d,MISMATCH.sigma)*SIGMA_M/MISMATCH.sigma;

/** How the image measurement and the database prior of one movement item relate (both are 5–95% ranges with a median).
 *  agree        the ranges overlap AND at least one median lies inside the other range
 *  disjoint     the ranges do not overlap at all
 *  centres_apart  they overlap, but neither median lies inside the other range (the overlap is only the tails — the two sources
 *               say different things; a plain overlap test would call this "no contradiction")
 *  one_sided    one of them is missing (nothing measured, or no database candidate): nothing to compare
 *  A very wide range that contains the other median is "agree": it cannot contradict anything. */
export type AgreementKind='agree'|'disjoint'|'centres_apart'|'one_sided';
export function assessAgreement(meas?:Range,prior?:Range):{kind:AgreementKind;overlapInch:number;gapInch:number;medianDifferenceInch:number}{
  const ok=(r?:Range):r is Range=>Boolean(r)&&[r!.value,r!.lo,r!.hi].every(Number.isFinite);
  if(!ok(meas)||!ok(prior))return {kind:'one_sided',overlapInch:NaN,gapInch:NaN,medianDifferenceInch:NaN};
  const span=Math.min(meas.hi,prior.hi)-Math.max(meas.lo,prior.lo),md=Math.abs(meas.value-prior.value);
  if(span<0)return {kind:'disjoint',overlapInch:0,gapInch:-span,medianDifferenceInch:md};
  const measMedianInPrior=prior.lo<=meas.value&&meas.value<=prior.hi,priorMedianInMeas=meas.lo<=prior.value&&prior.value<=meas.hi;
  return {kind:measMedianInPrior||priorMedianInMeas?'agree':'centres_apart',overlapInch:span,gapInch:0,medianDifferenceInch:md};
}

interface Meas{w:number;v:number;avg:number;ivb:number|null;hb:number|null;D:number;T:number;y0:number;mx:number;my:number}

function measurementSamples(inp:FinalInput):Meas[]{
  const s:FitSample[]=inp.fit?.samples??[];
  if(s.length)return s.map(x=>({w:x.w,v:Math.hypot(x.flight.vx,x.flight.vy,x.flight.vz)*3.6,avg:x.D/(x.tg-x.tr)*3.6,ivb:x.ivb,hb:x.hb,D:x.D,T:x.tg-x.tr,y0:x.flight.y0,mx:x.flight.mx,my:x.flight.my}));
  // no usable fit: the distance prior and the owner's marks (each ±1 frame), Monte Carlo
  const R=rng(inp.seed??5031),f=inp.fallback,out:Meas[]=[];
  for(let i=0;i<600;i++){
    const D=R.truncNormal(f.distanceM,f.sigmaM,f.distanceM-2.5*f.sigmaM,f.distanceM+2.5*f.sigmaM);
    const T=Math.max(.1,f.markFlightSec+R.uniform(-f.frameSec,f.frameSec)-R.uniform(-f.frameSec,f.frameSec));
    const vz=launchSpeedZ(D,T);out.push({w:1/600,v:vz*3.6,avg:D/T*3.6,ivb:null,hb:null,D,T,y0:f.releaseHeightM,mx:0,my:0});
  }
  return out;
}

export function computeFinalNumbers(inp:FinalInput):FinalNumbers{
  const ai=inp.selectedPitchType===inp.aiOption;
  const M=measurementSamples(inp),W=M.map(m=>m.w),hasMove=M.every(m=>m.ivb!==null&&m.hb!==null);
  const vR=rangeOf(M.map(m=>m.v),W),avgR=rangeOf(M.map(m=>m.avg),W),DR=rangeOf(M.map(m=>m.D),W),TR=rangeOf(M.map(m=>m.T),W),hR=rangeOf(M.map(m=>m.y0),W);
  const notes:string[]=[];
  // ── prior: candidates of the type inside the speed window (never narrower than the measured speed range)
  const pool=uniquePhysicalCandidates(inp.db).filter(r=>ai||r.pitch_type===inp.selectedPitchType);
  const candSpeed=(r:PitchRecord)=>launchSpeedZ(r.standard_distance_m,r.flight_time_sec)*3.6;
  let lo=vR.lo-2*SIGMA_V,hi=vR.hi+2*SIGMA_V,widened=false;
  let inWin=pool.filter(r=>{const v=candSpeed(r);return v>=lo&&v<=hi;});
  for(let k=0;k<12&&inWin.length<8&&inWin.length<pool.length;k++){lo-=5;hi+=5;widened=true;inWin=pool.filter(r=>{const v=candSpeed(r);return v>=lo&&v<=hi;});}
  if(widened)notes.push(`量到的出手速度附近候選太少，速度窗口放寬為 ${lo.toFixed(0)}–${hi.toFixed(0)} km/h`);
  if(ai&&inWin.length>MAX_AI_CANDIDATES){const mid=vR.value;inWin=[...inWin].sort((a,b)=>Math.abs(candSpeed(a)-mid)-Math.abs(candSpeed(b)-mid)).slice(0,MAX_AI_CANDIDATES);}
  // fly each candidate's spin at this pitch's distance, flight time and release height (same movement definition as the measurement)
  const flown=new Map<string,{ivb:number;hb:number}>();
  const mirror=inp.mirror??!ai;
  const flownCands=inWin.map(r=>{
    const key=`${r.spin_rate_rpm}|${r.spin_axis_decimal}|${r.spin_efficiency_pct}`;let m=flown.get(key);
    if(!m){try{const f=integrateCandidateFlight(DR.value,TR.value,hR.value,r.spin_rate_rpm,r.spin_axis_decimal,r.spin_efficiency_pct);m={ivb:f.ivb,hb:f.hb};}catch{m={ivb:NaN,hb:NaN};}flown.set(key,m);}
    return {r,v:candSpeed(r),ivb:m.ivb,hb:m.hb,axis:r.spin_axis_decimal,mirrored:false};
  }).filter(c=>finite(c.ivb)&&finite(c.hb));
  // the mirror image of a spin (axis a → 12 − a) flips the horizontal Magnus term only (engine model: X ∝ sin θ, Y ∝ cos θ)
  const cands=mirror?[...flownCands,...flownCands.map(c=>({...c,hb:-c.hb,axis:((12-c.axis)%12+12)%12,mirrored:true}))]:flownCands;
  const typeCount:Record<string,number>={};for(const c of cands)typeCount[c.r.pitch_type]=(typeCount[c.r.pitch_type]||0)+1;
  const nTypes=Object.keys(typeCount).length||1;
  const prior=cands.map(c=>1/(typeCount[c.r.pitch_type]*nTypes)); // equal prior per type, then per candidate (and per hand)
  // ── likelihood of each candidate, and the prior density at each measurement sample
  const fitPriorDensity=(m:Meas)=>Math.max(Math.exp(-4.5),Math.exp(-.5*((m.mx/2)**2+(m.my/3)**2))); // the fit's own weak movement prior (pitchGeometryFit), capped
  const like=cands.map(()=>0),sampleW=M.map(()=>0);
  M.forEach((m,si)=>{
    let dens=0;
    cands.forEach((c,ci)=>{
      let k=gauss(m.v-c.v,SIGMA_V);
      if(hasMove)k*=mixK(m.ivb!-c.ivb)*mixK(m.hb!-c.hb);
      like[ci]+=m.w*k/(hasMove?fitPriorDensity(m):1);dens+=prior[ci]*k;
    });
    sampleW[si]=m.w*dens/(hasMove?fitPriorDensity(m):1);
  });
  const post=cands.map((_,i)=>prior[i]*like[i]),postSum=post.reduce((a,b)=>a+b,0);
  const essOf=(w:number[])=>{const s=w.reduce((a,b)=>a+b,0),s2=w.reduce((a,b)=>a+b*b,0);return s2>0?s*s/s2:0;};
  const essRatio=hasMove&&sampleW.some(x=>x>0)?essOf(sampleW)/Math.max(1e-9,essOf(W)):null;
  // ── prior movement ranges (candidate mixture with the model scatter), for the overlap check
  const R=rng((inp.seed??5031)+7),priorDraws:{ivb:number;hb:number}[]=[];
  if(cands.length){const cum:number[]=[];prior.reduce((a,p,i)=>(cum[i]=a+p),0);const tot=cum[cum.length-1];
    for(let i=0;i<2000;i++){const u=R.next()*tot;let k=cum.findIndex(c=>c>=u);if(k<0)k=cands.length-1;priorDraws.push({ivb:cands[k].ivb+R.normal()*SIGMA_M,hb:cands[k].hb+R.normal()*SIGMA_M});}}
  const ones=priorDraws.map(()=>1);
  const priorIvb=priorDraws.length?rangeOf(priorDraws.map(d=>d.ivb),ones):undefined,priorHb=priorDraws.length?rangeOf(priorDraws.map(d=>d.hb),ones):undefined;
  const measIvb=hasMove?rangeOf(M.map(m=>m.ivb!),W):undefined,measHb=hasMove?rangeOf(M.map(m=>m.hb!),W):undefined;
  const conflicts:FinalDebug['conflicts']=[];
  const suspects=(axis:'ivb'|'hb')=>{
    const s:string[]=[];const top=cands.map((c,i)=>({c,p:post[i]})).sort((a,b)=>b.p-a.p)[0]?.c;
    if(top&&axis==='ivb'&&top.r.spin_efficiency_pct>=95&&top.r.spin_rate_rpm>=2000)s.push(`候選轉速與效率偏高（${top.r.spin_rate_rpm} rpm、${top.r.spin_efficiency_pct}%）`);
    s.push(`距離為推估 ${DR.value.toFixed(2)} m（${DR.lo.toFixed(2)}–${DR.hi.toFixed(2)}）`);
    s.push(`飛行時間來自你的標記 ${TR.value.toFixed(3)} s（±1 格）`);
    if(axis==='ivb')s.push('候選的接球高度 0.65 m 是模型假設（只影響出手角，位移是同起點的差值）');
    s.push(`出手高度為推估 ${hR.value.toFixed(2)} m；出手點由球路外插`);
    if(axis==='hb')s.push(mirror?'資料庫沒有慣用手欄位（已同時考慮左右鏡像）':'資料庫沒有慣用手欄位：水平位移的方向可能與投手慣用手相反');
    return s;
  };
  // ── merged movement
  const merged:FinalDebug['merged']={};
  let lowConf=false;
  const mergeAxis=(axis:'ivb'|'hb',meas?:Range,pr?:Range):Range|undefined=>{
    if(!pr&&!meas)return undefined;
    if(!meas)return pr;                                   // nothing measured: database prior only
    if(!pr)return meas;
    const a=assessAgreement(meas,pr);
    const reweighted=sampleW.some(x=>x>0)?rangeOf(M.map(m=>axis==='ivb'?m.ivb!:m.hb!),sampleW):null;
    if(a.kind==='agree'&&reweighted&&(essRatio??0)>=.02)return reweighted;
    // conflict: no silent choice — precision-weighted compromise, range covering both, lower confidence, recorded in the debug data
    lowConf=true;conflicts.push({item:axis,kind:a.kind==='agree'||a.kind==='one_sided'?'weight_collapse':a.kind,measured:meas,prior:pr,gapInch:a.gapInch,overlapInch:a.overlapInch,medianDifferenceInch:a.medianDifferenceInch,suspects:suspects(axis)});
    const sm=Math.max(.5,(meas.hi-meas.lo)/3.29),sp=Math.max(.5,(pr.hi-pr.lo)/3.29),wm=1/sm**2,wp=1/sp**2;
    return {value:(meas.value*wm+pr.value*wp)/(wm+wp),lo:Math.min(meas.lo,pr.lo),hi:Math.max(meas.hi,pr.hi)};
  };
  merged.ivbInch=mergeAxis('ivb',measIvb,priorIvb);merged.hbInch=mergeAxis('hb',measHb,priorHb);
  // ── spin: posterior spread of the candidates (prior × speed only when the movement conflicts)
  const spinW=cands.map((c,i)=>conflicts.length||!(postSum>0)?prior[i]*M.reduce((a,m)=>a+m.w*gauss(m.v-c.v,SIGMA_V),0):post[i]);
  const rpm=cands.length?rangeOf(cands.map(c=>c.r.spin_rate_rpm),spinW):undefined,eff=cands.length?rangeOf(cands.map(c=>c.r.spin_efficiency_pct),spinW):undefined;
  let axisR:Range|undefined;
  if(cands.length){
    const ang=cands.map(c=>c.axis/12*2*Math.PI);let sx=0,sy=0;ang.forEach((a,i)=>{sx+=spinW[i]*Math.cos(a);sy+=spinW[i]*Math.sin(a);});
    const mean=Math.atan2(sy,sx)/(2*Math.PI)*12;
    const un=cands.map(c=>{let d=c.axis-mean;while(d>6)d-=12;while(d<-6)d+=12;return mean+d;});axisR=rangeOf(un,spinW);
  }
  // ── pitch types (AI mode only)
  let pitchTypes:FinalNumbers['pitchTypes']=null;
  if(ai&&cands.length&&postSum>0){
    const mass:Record<string,number>={};cands.forEach((c,i)=>{mass[c.r.pitch_type]=(mass[c.r.pitch_type]||0)+post[i]/postSum;});
    const rank=Object.entries(mass).map(([pitchType,probability])=>({pitchType,probability})).sort((a,b)=>b.probability-a.probability);
    const margin=(rank[0]?.probability??0)-(rank[1]?.probability??0),hard=!hasMove||rank[0].probability<.4||margin<.12;
    pitchTypes={top3:rank.slice(0,3),hard,hardReason:hard?(!hasMove?'影片沒有可用的位移量測，只能依球速':rank[0].probability<.4?'第一名可能性不到 40%':`${rank[0].pitchType} 與 ${rank[1].pitchType} 只差 ${(margin*100).toFixed(0)} 個百分點`):null};
  }
  // ── items
  const items:FinalItem[]=[];
  const distTxt=`距離 ${DR.value.toFixed(1)} m（推估，${DR.lo.toFixed(1)}–${DR.hi.toFixed(1)}）`;
  items.push({key:'releaseSpeed',label:'出手速度',value:vR.value,lo:vR.lo,hi:vR.hi,unit:'km/h',display:vR.value.toFixed(0),range:`${vR.lo.toFixed(0)}–${vR.hi.toFixed(0)} km/h`,
    origin:['影像量測','資料庫先驗','物理模型推算'],estimated:true,note:`${distTxt} ÷ 你標的飛行時間 ${TR.value.toFixed(3)} s（每個標記 ±1 格），以阻力模型回推出手速度`});
  if(rpm)items.push({key:'spinRate',label:'轉速',value:rpm.value,lo:rpm.lo,hi:rpm.hi,unit:'rpm',display:String(Math.round(rpm.value/10)*10),range:`${Math.round(rpm.lo/10)*10}–${Math.round(rpm.hi/10)*10} rpm`,
    origin:['資料庫先驗'],estimated:true,note:'單鏡頭量不到轉速：資料庫候選依球種、出手速度與位移加權的範圍'});
  if(axisR)items.push({key:'spinAxis',label:'轉軸',value:axisR.value,lo:axisR.lo,hi:axisR.hi,unit:'',display:clock(axisR.value),range:`${clock(axisR.lo)}–${clock(axisR.hi)}`,
    origin:['資料庫先驗'],estimated:true,note:'時鐘方向（捕手看投手）；資料庫候選的範圍，不是量測'});
  if(merged.ivbInch)items.push({key:'ivb',label:'垂直位移',value:merged.ivbInch.value,lo:merged.ivbInch.lo,hi:merged.ivbInch.hi,unit:'吋',display:sgn(merged.ivbInch.value),range:`${sgn(merged.ivbInch.lo)} – ${sgn(merged.ivbInch.hi)} 吋`,
    origin:hasMove?['影像量測','資料庫先驗']:['資料庫先驗'],estimated:true,note:`相對同起點、只有重力與阻力的無旋轉球路（IVB）${conflicts.some(c=>c.item==='ivb')?'；影像與資料庫不一致，範圍已放寬':''}`});
  if(merged.hbInch)items.push({key:'hb',label:'水平位移',value:merged.hbInch.value,lo:merged.hbInch.lo,hi:merged.hbInch.hi,unit:'吋',display:sgn(merged.hbInch.value),range:`${sgn(merged.hbInch.lo)} – ${sgn(merged.hbInch.hi)} 吋`,
    origin:hasMove?['影像量測','資料庫先驗']:['資料庫先驗'],estimated:true,note:`捕手看向投手的右方為正（HB）${conflicts.some(c=>c.item==='hb')?'；影像與資料庫不一致，範圍已放寬':''}`});
  if(eff)items.push({key:'efficiency',label:'旋轉效率',value:eff.value,lo:eff.lo,hi:eff.hi,unit:'%',display:eff.value.toFixed(0),range:`${eff.lo.toFixed(0)}–${eff.hi.toFixed(0)} %`,
    origin:['資料庫先驗'],estimated:true,note:'陀螺旋轉看不到：資料庫候選的範圍'});
  // every item: the big number is the median / best estimate and it lies inside its own 90% range
  for(const i of items){if(!(i.lo<=i.hi))[i.lo,i.hi]=[i.hi,i.lo];i.value=Math.min(i.hi,Math.max(i.lo,i.value));}
  const top=cands.map((c,i)=>({c,w:spinW[i]})).sort((a,b)=>b.w-a.w).slice(0,5),tw=spinW.reduce((a,b)=>a+b,0)||1;
  return {
    status:!inp.fit?'fallback':lowConf||inp.fit.status!=='ok'?'low_confidence':'ok',items,pitchTypeMode:ai?'ai':'given',pitchType:ai?null:inp.selectedPitchType,pitchTypes,
    debug:{measured:{releaseKmh:vR,avgKmh:avgR,ivbInch:measIvb,hbInch:measHb},
      prior:{candidates:cands.length,speedWindowKmh:[lo,hi],windowWidened:widened,ivbInch:priorIvb,hbInch:priorHb,rpm,efficiencyPct:eff,flownAt:{distanceM:DR.value,flightSec:TR.value,releaseHeightM:hR.value}},
      merged,conflicts,essRatio,distanceM:DR,flightSec:TR,
      topCandidates:top.map(({c,w})=>({id:c.r.id,type:c.r.pitch_type,rpm:c.r.spin_rate_rpm,axis:clock(c.axis),efficiencyPct:c.r.spin_efficiency_pct,ivbInch:+c.ivb.toFixed(1),hbInch:+c.hb.toFixed(1),weight:+(w/tw).toFixed(3),mirrored:c.mirrored})),notes,mirror}
  };
}
