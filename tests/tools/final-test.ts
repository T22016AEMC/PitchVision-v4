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
