// Test-only: the 5.0.3.1 final numbers for one synthetic case in both modes (owner type given / AI), with errors against the truth.
import {fitPitchGeometry,FitInput} from '../../src/services/pitchGeometryFit';
import {computeFinalNumbers} from '../../src/services/finalNumbers';
import {rankPitchTypes} from '../../src/services/pitchTypeRanker';
import {PITCH_DATABASE,PITCH_TYPE_OPTIONS} from '../../src/matchingEngine';

export function finalNumbersForTest(c:any,fitInput:FitInput,o:{ranker503?:boolean}={}){
  const fit=fitPitchGeometry(fitInput),t=c.truth,ai=PITCH_TYPE_OPTIONS[0];
  const fitOk=fit.status==='ok'&&Boolean(fit.samples?.length);
  const fallback={distanceM:fitInput.distance.overrideM??fitInput.distance.priorM,sigmaM:fitInput.distance.sigmaM,markFlightSec:fitInput.markGlove.timeSec-fitInput.markRelease.timeSec,frameSec:1/fitInput.fps,releaseHeightM:1.8};
  const run=(type:string,mirror?:boolean)=>{
    const f=computeFinalNumbers({db:PITCH_DATABASE,selectedPitchType:type,aiOption:ai,fit:fitOk?fit:null,fallback,mirror});
    const it=(k:string)=>f.items.find(i=>i.key===k);
    const err=(k:string,truth:number)=>{const i=it(k);return i?{value:i.value,lo:i.lo,hi:i.hi,err:i.value-truth,inRange:truth>=i.lo&&truth<=i.hi,width:i.hi-i.lo}:null;};
    let axisTruth=c.record.axis;const ax=it('spinAxis');if(ax){while(axisTruth-ax.value>6)axisTruth-=12;while(axisTruth-ax.value<-6)axisTruth+=12;}
    const names=f.pitchTypes?.top3.map(x=>x.pitchType)??[];
    return {status:f.status,conflicts:f.debug.conflicts.map(x=>x.item),candidates:f.debug.prior.candidates,
      releaseSpeed:err('releaseSpeed',t.releaseSpeedKmh),releaseSpeedErrPct:it('releaseSpeed')?(it('releaseSpeed')!.value/t.releaseSpeedKmh-1)*100:null,
      ivb:err('ivb',t.ivbInch),hb:err('hb',t.hbInch),rpm:err('spinRate',c.record.rpm),efficiency:err('efficiency',c.record.eff),axis:err('spinAxis',axisTruth),
      pitchType:f.pitchTypes?{top1:names[0]??null,top3:names,truth:t.pitchType,top1Ok:names[0]===t.pitchType,top3Ok:names.includes(t.pitchType),hard:f.pitchTypes.hard,probTruth:f.pitchTypes.top3.find(x=>x.pitchType===t.pitchType)?.probability??0}:null};
  };
  const r503=o.ranker503&&fitOk?rankPitchTypes(PITCH_DATABASE,fit.samples!):null;
  return {fitStatus:fit.status,given:run(t.pitchType),ai:run(ai),givenNoMirror:run(t.pitchType,false),aiMirror:run(ai,true),
    ranker503:r503?{top1Ok:r503.top3[0]?.pitchType===t.pitchType,top3Ok:r503.top3.some(x=>x.pitchType===t.pitchType)}:null};
}

/** 5.0.3.2 Step 2: per movement item, the measured range, the database range, whether they overlap (the 5.0.3.1 rule) and whether
 *  the page flagged a contradiction (the 5.0.3.2 rule) — for the true pitch type and for a deliberately wrong one. */
const WRONG:Record<string,string>={fastball:'曲球 (Curveball)',sinker:'橫掃球 (Sweeper)',cutter:'曲球 (Curveball)',slider:'變速球 (Changeup)',sweeper:'二縫線/伸卡球 (Sinker)',curve:'四縫線直球 (Fastball)',knuckleCurve:'四縫線直球 (Fastball)',changeup:'滑球 (Slider)',splitter:'卡特球 (Cutter)'};
export function conflictProbe(c:any,fitInput:FitInput){
  const fit=fitPitchGeometry(fitInput),t=c.truth,ai=PITCH_TYPE_OPTIONS[0];
  if(!(fit.status==='ok'&&fit.samples?.length))return {skipped:fit.status};
  const fallback={distanceM:fitInput.distance.priorM,sigmaM:fitInput.distance.sigmaM,markFlightSec:fitInput.markGlove.timeSec-fitInput.markRelease.timeSec,frameSec:1/fitInput.fps,releaseHeightM:1.8};
  const one=(type:string)=>{
    const f=computeFinalNumbers({db:PITCH_DATABASE,selectedPitchType:type,aiOption:ai,fit,fallback}),d=f.debug;
    const item=(k:'ivb'|'hb')=>{const m=k==='ivb'?d.measured.ivbInch:d.measured.hbInch,p=k==='ivb'?d.prior.ivbInch:d.prior.hbInch,fin=f.items.find(i=>i.key===k)!,truth=k==='ivb'?t.ivbInch:t.hbInch;
      const old=!(m&&p&&m.lo<=p.hi&&p.lo<=m.hi)||(d.essRatio!==null&&d.essRatio<.02),cf=d.conflicts.find(x=>x.item===k);
      return {measured:m&&[m.value,m.lo,m.hi],database:p&&[p.value,p.lo,p.hi],overlap:Boolean(m&&p&&m.lo<=p.hi&&p.lo<=m.hi),flaggedBefore:old,flaggedNow:Boolean(cf),kind:cf?.kind??null,gapInch:cf?.gapInch??null,
        merged:[fin.value,fin.lo,fin.hi],truth,mergedErr:fin.value-truth,truthInMerged:truth>=fin.lo&&truth<=fin.hi,truthInMeasured:m?truth>=m.lo&&truth<=m.hi:null};};
    const rel=f.items.find(i=>i.key==='releaseSpeed')!;
    return {status:f.status,type,ivb:item('ivb'),hb:item('hb'),speed:{measured:[d.measured.releaseKmh!.value,d.measured.releaseKmh!.lo,d.measured.releaseKmh!.hi],candidateWindow:d.prior.speedWindowKmh,truth:t.releaseSpeedKmh,shown:[rel.value,rel.lo,rel.hi]}};
  };
  return {fitStatus:fit.status,trueType:one(t.pitchType),wrongType:one(WRONG[c.pitch]??'曲球 (Curveball)')};
}
