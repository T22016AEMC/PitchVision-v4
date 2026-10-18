// 5.0.3.2 Step 3 (synthetic only): where are the largest net-time and speed errors, which fit-quality numbers go with them, and why were
// fits rejected.   node tests/tools/worst-case-analysis.mjs <rows-5.0.3.json> <rows-5.0.3.1.json> [--json out.json]
import {readFile,writeFile} from 'node:fs/promises';
const [b,a]=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const out=process.argv.includes('--json')?process.argv[process.argv.indexOf('--json')+1]:null;
const B=JSON.parse(await readFile(b,'utf8')),A=JSON.parse(await readFile(a,'utf8'));
const shown=r=>r.usedFit?r.new:r.old;
const m={gloveErr:r=>Math.abs(shown(r).events.gloveErrFrames),speedErr:r=>Math.abs(shown(r).speed.avgErrPct),relSpeedErr:r=>Math.abs(r.usedFit?r.new.speed.releaseErrPct:shown(r).speed.avgErrPct)};
const mean=xs=>xs.reduce((s,x)=>s+x,0)/(xs.length||1),max=xs=>xs.length?Math.max(...xs):NaN;
const groupBy=(rows,f)=>{const g={};for(const r of rows)(g[f(r.spec)]??=[]).push(r);return g;};
const table=(rows)=>Object.fromEntries(Object.entries({view:s=>s.view,fps:s=>s.fps,res:s=>s.width>1000?'4K':'720p',pitch:s=>s.pitch}).map(([k,f])=>[k,Object.fromEntries(Object.entries(groupBy(rows,f)).map(([v,rs])=>[v,{n:rs.length,glove:[+mean(rs.map(m.gloveErr)).toFixed(2),+max(rs.map(m.gloveErr)).toFixed(1)],speed:[+mean(rs.map(m.speedErr)).toFixed(2),+max(rs.map(m.speedErr)).toFixed(1)]}]))]));
const big=(rows)=>rows.filter(r=>m.gloveErr(r)>2||m.speedErr(r)>15).map(r=>({seed:r.spec.seed,view:r.spec.view,fps:r.spec.fps,res:r.spec.width>1000?'4K':'720p',pitch:r.spec.pitch,glove:+m.gloveErr(r).toFixed(2),speed:+m.speedErr(r).toFixed(1),used:r.usedFit,status:r.new?.status,ess:r.new?.fit?.ess&&+r.new.fit.ess.toFixed(0),costDof:r.new?.fit?.bestCostPerDof&&+r.new.fit.bestCostPerDof.toFixed(2),stopped:r.new?.fit?.stopFrames,reasons:r.new?.reasons}));
const corr=(xs,ys)=>{const n=xs.length,mx=mean(xs),my=mean(ys);let sxy=0,sxx=0,syy=0;for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sxx+=(xs[i]-mx)**2;syy+=(ys[i]-my)**2;}return +(sxy/Math.sqrt(sxx*syy||1)).toFixed(2);};
const withFit=rows=>rows.filter(r=>r.new?.fit);
const result={
  before:{engine:B.engine,fitUsed:B.rows.filter(r=>r.usedFit).length,conditions:table(B.rows),over2framesOr15pct:big(B.rows),
    rejected:B.rows.filter(r=>!r.usedFit).map(r=>({seed:r.spec.seed,view:r.spec.view,fps:r.spec.fps,res:r.spec.width>1000?'4K':'720p',pitch:r.spec.pitch,status:r.new?.status,reasons:r.new?.reasons,ess:r.new?.fit?.ess&&+r.new.fit.ess.toFixed(0),costDof:r.new?.fit?.bestCostPerDof&&+r.new.fit.bestCostPerDof.toFixed(2),stopDetected:r.new?.events?.stopDetected,speedErrIfShown5031:null})),
    fitQualityVsError:{n:withFit(B.rows).length,corrCostDof_speedErr:corr(withFit(B.rows).map(r=>r.new.fit.bestCostPerDof),withFit(B.rows).map(m.speedErr)),corrEss_speedErr:corr(withFit(B.rows).map(r=>r.new.fit.ess),withFit(B.rows).map(m.speedErr)),corrCostDof_gloveErr:corr(withFit(B.rows).map(r=>r.new.fit.bestCostPerDof),withFit(B.rows).map(m.gloveErr))}},
  after:{engine:A.engine,fitUsed:A.rows.filter(r=>r.usedFit).length,conditions:table(A.rows),over2framesOr15pct:big(A.rows),
    fitQualityVsError:{n:withFit(A.rows).length,corrCostDof_speedErr:corr(withFit(A.rows).map(r=>r.new.fit.bestCostPerDof),withFit(A.rows).map(m.speedErr)),corrEss_speedErr:corr(withFit(A.rows).map(r=>r.new.fit.ess),withFit(A.rows).map(m.speedErr)),corrCostDof_gloveErr:corr(withFit(A.rows).map(r=>r.new.fit.bestCostPerDof),withFit(A.rows).map(m.gloveErr))},
    costDofDistribution:(()=>{const v=withFit(A.rows).map(r=>r.new.fit.bestCostPerDof).sort((x,y)=>x-y);return {min:+v[0].toFixed(2),median:+v[v.length>>1].toFixed(2),p90:+v[Math.floor(v.length*.9)].toFixed(2),max:+v.at(-1).toFixed(2),above4:v.filter(x=>x>4).length,above6:v.filter(x=>x>6).length};})(),
    essDistribution:(()=>{const v=withFit(A.rows).map(r=>r.new.fit.ess).sort((x,y)=>x-y);return {min:+v[0].toFixed(0),median:+v[v.length>>1].toFixed(0),max:+v.at(-1).toFixed(0),below10:v.filter(x=>x<10).length,below30:v.filter(x=>x<30).length};})()},
};
// the cases 5.0.3 rejected: what does 5.0.3.1 give for them?
const byseed=new Map(A.rows.map(r=>[r.spec.seed,r]));
for(const r of result.before.rejected){const x=byseed.get(r.seed);r.in5031={used:x.usedFit,ess:x.new.fit?.ess&&+x.new.fit.ess.toFixed(0),costDof:x.new.fit?.bestCostPerDof&&+x.new.fit.bestCostPerDof.toFixed(2),speedErrPct:+shown(x).speed.avgErrPct.toFixed(1),gloveErrFrames:+shown(x).events.gloveErrFrames.toFixed(2),relSpeedErrPct:x.final?.given?.releaseSpeedErrPct&&+x.final.given.releaseSpeedErrPct.toFixed(1)};}
// worst 5 in 5.0.3.1 by release-speed error, with fit quality
result.after.worstReleaseSpeed=[...A.rows].filter(r=>r.final?.given).sort((x,y)=>Math.abs(y.final.given.releaseSpeedErrPct)-Math.abs(x.final.given.releaseSpeedErrPct)).slice(0,6).map(r=>({seed:r.spec.seed,view:r.spec.view,fps:r.spec.fps,res:r.spec.width>1000?'4K':'720p',pitch:r.spec.pitch,errPct:+r.final.given.releaseSpeedErrPct.toFixed(1),inRange:r.final.given.releaseSpeed.inRange,widthKmh:+r.final.given.releaseSpeed.width.toFixed(0),ess:r.new.fit?.ess&&+r.new.fit.ess.toFixed(0),costDof:r.new.fit?.bestCostPerDof&&+r.new.fit.bestCostPerDof.toFixed(2)}));
if(out)await writeFile(out,JSON.stringify(result,null,1));
const J=x=>JSON.stringify(x);
console.log('5.0.3 fit used',result.before.fitUsed,'/',B.rows.length,'| cases >2 frames or >15%:',J(result.before.over2framesOr15pct));
console.log('5.0.3 rejected:',J(result.before.rejected));
console.log('5.0.3 fit quality vs error:',J(result.before.fitQualityVsError));
console.log('5.0.3.1 fit used',result.after.fitUsed,'cases >2 frames or >15%:',J(result.after.over2framesOr15pct));
console.log('5.0.3.1 cost/dof',J(result.after.costDofDistribution),'ess',J(result.after.essDistribution),'corr',J(result.after.fitQualityVsError));
console.log('5.0.3.1 worst release speed:',J(result.after.worstReleaseSpeed));
console.log('conditions 5.0.3 (glove[mean,max], speed[mean,max]):');for(const [k,v] of Object.entries(result.before.conditions))for(const [g,x] of Object.entries(v))console.log(' ',k,g,J(x),'→',J(result.after.conditions[k][g]));
