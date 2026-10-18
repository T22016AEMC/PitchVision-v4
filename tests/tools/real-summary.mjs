// Summary of one real-clip app run (tests/tools/real-run.mjs output) in a version-neutral shape: what the result page showed
// (geometry-stage cards, the collapsed database block, and from 5.0.3.1 the six final numbers). No instrument truth exists.
const rg=x=>x&&Number.isFinite(x.value)?{value:+x.value.toFixed(2),lo:+x.lo.toFixed(2),hi:+x.hi.toFixed(2)}:null;
export function summarizeRun(j){
  const o=j.outcome,e=o.estimates,r=o.result,u=r?.uncertainty,c=j.clip,t=j.times;
  const n=e?.numbers??{};
  return {
    name:c.name,selectedPitchType:j.selectedPitchType??null,marks:{release:c.release,glove:c.glove,flightSec:t?+(t[c.glove]-t[c.release]).toFixed(4):null},
    ownerStatement:{speedKmh:c.speedClaimKmh,pitchType:c.pitchType,note:'owner statement, not an instrument reading; never used to judge events or types'},
    engine:{distanceM:o.distanceM,eventTimes:o.eventTimes,avgKmh:o.velocityKmh},
    geometryCards:e?{status:e.status,stopFrame:e.stopFrame,avgKmh:rg(n.avgKmh),releaseKmh:rg(n.releaseKmh),distanceM:rg(n.distanceM),releaseVsMarkFrames:rg(n.releaseVsMarkFrames),gloveVsMarkFrames:rg(n.gloveVsMarkFrames),
      ivbInch:rg(n.ivbInch),hbInch:rg(n.hbInch),angleDeg:rg(n.angleDeg),heightM:rg(n.heightM),top3:e.pitchTypes?.top3?.map(x=>({type:x.pitchType,pct:+(x.probability*100).toFixed(1)}))??null,hard:e.pitchTypes?.hard??null}:null,
    databaseBlock:r?{type:r.matched_pitch_type,avgKmh:r.velocity_kmh,rpm:r.spin_rate_rpm,rpmRange:u&&Number.isFinite(u.spin_rate_min)?[u.spin_rate_min,u.spin_rate_max]:null,axis:r.spin_axis,efficiencyPct:r.spin_efficiency_pct,
      ivbInch:r.ivb_inch,ivbRange:u?.ivb_range??null,hbInch:r.hb_inch,hbRange:u?.hb_range??null}:null,
    final:o.final?{status:o.final.status,items:Object.fromEntries(o.final.items.map(i=>[i.key,{value:i.value,lo:i.lo,hi:i.hi,display:i.display,range:i.range,origin:i.origin,estimated:i.estimated}])),
      conflicts:o.final.debug?.conflicts??[],pitchTypes:o.final.pitchTypes??null}:null
  };
}
