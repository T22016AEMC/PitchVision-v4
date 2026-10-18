// Shared scoring for ball tracking (synthetic scenes and the hand-confirmed real clips).
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';

let mod=null;
export async function loadTracker(){
  if(mod)return mod;
  await mkdir('test-results',{recursive:true});
  await build({entryPoints:['src/services/pitchBallTracker.ts'],outfile:'test-results/ball-tracker.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  mod=await import(pathToFileURL(resolve('test-results/ball-tracker.mjs')).href+'?'+Date.now());
  return mod;
}

/** Run the tracker on a synthetic scene exactly as the app would: window = release−2 … glove+5, background outside it. */
export async function trackScene(scene,extra={}){
  const tr=await loadTracker(),first=Math.max(0,scene.release-2),last=Math.min(scene.frames-1,scene.glove+5);
  const frame=i=>({index:i,time:i/scene.fps,width:scene.width,height:scene.height,data:scene.render(i)});
  const win=[],bg=[];for(let i=first;i<=last;i++)win.push(frame(i));
  for(const i of tr.pickBackgroundFrames(scene.frames,first,last))bg.push(frame(i));
  return tr.analyzeBallFrames(win,bg,{fps:scene.fps,view:scene.view,releaseFrame:scene.release,...extra});
}

/** hit: within max(3·scale px, 1.2·ball radius). false positive: observation where the ball is hidden / not yet thrown, or farther than 2× that. */
export function scoreScene(scene,res){
  const S=Math.max(scene.width,scene.height)/1280,tol=r=>Math.max(3*S,1.2*r);
  const byFrame=new Map(res.points.map(p=>[p.frame,p]));
  let visible=0,hits=0,near=0,fp=0,estimatedVisible=0,errSum=0,errMax=0,hiddenObserved=0;
  for(const t of scene.truth){
    const p=byFrame.get(t.frame),inScope=t.frame>=scene.release&&t.frame<=scene.glove+2;
    if(!inScope)continue;
    if(t.visible){
      visible++;
      if(!p)continue;
      if(p.source==='estimated'){estimatedVisible++;continue;}
      const d=Math.hypot(p.x-t.x,p.y-t.y);
      if(d<=tol(t.r)){hits++;errSum+=d;errMax=Math.max(errMax,d);}
      else if(d<=2*tol(t.r))near++;
      else fp++;
    }else if(p&&p.source!=='estimated'){fp++;hiddenObserved++;}
  }
  return {visible,hits,near,falsePositives:fp,hiddenObserved,estimatedVisible,recall:visible?hits/visible:0,meanErrPx:hits?errSum/hits:0,maxErrPx:errMax,status:res.status,observed:res.observedCount,estimated:res.estimatedCount,ms:Math.round(res.stats.ms)};
}
