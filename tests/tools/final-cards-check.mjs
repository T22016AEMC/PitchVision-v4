// Shared Playwright check of the six final-number cards (5.0.3.2 #24): the big text is ONE number (the axis: ONE clock time), the
// small line below is the 90% range, the big number lies inside its range (the axis range may cross 12:00), nothing needs a tap.
export const FINAL_KEYS=['releaseSpeed','spinRate','spinAxis','ivb','hb','efficiency'];
export async function readFinalCards(page){
  return page.evaluate(keys=>keys.map(k=>{const card=document.querySelector('#final-'+k),v=card?.querySelector('[data-role=value]'),r=card?.querySelector('[data-role=range]');
    return {key:k,visible:Boolean(card?.checkVisibility?.()),value:v?.textContent?.trim()??null,range:r?.textContent?.trim()??null,text:card?.innerText??'',estimated:card?.dataset.estimated};}),FINAL_KEYS);
}
const num=s=>Number(String(s).replace(/[＋+]/g,'').replace('−','-'));
const clockHours=s=>{const m=/^(\d{1,2}):(\d\d)$/.exec(s);return m?((Number(m[1])%12)+Number(m[2])/60):null;};
export function checkFinalCards(cards,ok,label=''){
  const L=t=>`${label}${label?': ':''}${t}`;
  ok(L('six final cards visible without tapping anything'),cards.length===6&&cards.every(c=>c.visible));
  ok(L('the big text of each card is a single number'),cards.every(c=>c.key==='spinAxis'?/^\d{1,2}:\d\d$/.test(c.value??''):/^[+-]?\d+(\.\d+)?$/.test(c.value??'')));
  ok(L('the range is on the small line below, not in the big text'),cards.every(c=>c.range&&/^範圍 /.test(c.range)&&!/[–]/.test(c.value??'')));
  ok(L('every card carries the 推估 mark'),cards.every(c=>/推估/.test(c.text)&&c.estimated==='1'));
  const inside=[];
  for(const c of cards){
    const body=c.range.replace(/^範圍\s*/,'').replace(/\s*(km\/h|rpm|吋|%)\s*$/,'');
    const parts=body.split(/\s*[–]\s*/);if(parts.length!==2){inside.push(false);continue;}
    if(c.key==='spinAxis'){const v=clockHours(c.value),lo=clockHours(parts[0]),hi=clockHours(parts[1]);inside.push(v!==null&&lo!==null&&hi!==null&&(((v-lo)%12)+12)%12<=(((hi-lo)%12)+12)%12+1e-9);}
    else{const v=num(c.value),lo=num(parts[0]),hi=num(parts[1]);inside.push(Number.isFinite(v+lo+hi)&&lo<=v&&v<=hi);}
  }
  ok(L('the big number lies inside its range ('+inside.map(Number).join('')+')'),inside.every(Boolean));
}
