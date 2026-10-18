// Step 2 (5.0.3.1, measurement only): for each owner clip, the image release / net times vs the owner's marks, and where the
// fitted path puts the ball at the release time compared with the ball in the hand (frame before the release mark) and the first
// free ball (release-mark frame). Pixel coordinates in the source frame. No parameter is tuned here.
import {fitReal} from './real-fit.mjs';
import {loadEngine} from './engine.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const E=await loadEngine(),tracks=JSON.parse(await readFile('test-results/real-tracks.json','utf8'));
const out=[];
for(const n of ['straight-720p','straight-4k','knuckle-720p','knuckle-4k']){
  const {fit,input,clip}=await fitReal(n),j=tracks[n],dt=1/input.fps;
  const pt=f=>j.points.find(p=>p.frame===f&&p.source!=='estimated')??null;
  const S=fit.samples,w=S.map(s=>s.w);
  const at=(tauOf)=>{const xs=S.map(s=>E.projectSampleAt(s,j.width,j.height,tauOf(s)));const q=k=>E.weightedQuantiles(xs.map(p=>p[k]),w,[.05,.5,.95]);return {x:q('x'),y:q('y'),r:q('radiusPx')};};
  const rel=at(()=>0),atMark=at(s=>input.markRelease.timeSec-s.tr);
  const hand=pt(clip.release-1),first=pt(clip.release);
  const d=(a,b)=>a&&b?Math.hypot(a.x-b.x,a.y-b.y):null;
  const c=fit.events.contact;
  const row={name:n,marks:{release:clip.release,glove:clip.glove},
    imageRelease:{note:'no hand detection: the release time is the mark ±1 frame; the image only checks where the fitted path starts',fittedReleaseFrame:fit.events.releaseFrameFloat},
    imageNet:{contactFrame:Number.isFinite(c.contactFrame)?+c.contactFrame.toFixed(2):null,vsMarkFrames:Number.isFinite(c.contactFrame)?+(c.contactFrame-clip.glove).toFixed(2):null,fallStartFrame:c.fallStartFrame,predictedStepPx:+c.predictedStepPx?.toFixed(1),dropStepPx:+c.dropStepPx?.toFixed(1)},
    extrapolatedReleasePx:{x:rel.x.map(v=>+v.toFixed(1)),y:rel.y.map(v=>+v.toFixed(1)),ballRadiusPx:+rel.r[1].toFixed(1)},
    pathAtReleaseMarkPx:{x:+atMark.x[1].toFixed(1),y:+atMark.y[1].toFixed(1)},
    ballInHandPx:hand&&{frame:hand.frame,x:+hand.x.toFixed(1),y:+hand.y.toFixed(1),radius:+hand.radius.toFixed(1)},firstFreeBallPx:first&&{frame:first.frame,x:+first.x.toFixed(1),y:+first.y.toFixed(1)},
    distancePx:{extrapolatedToHand:d({x:rel.x[1],y:rel.y[1]},hand)&&+d({x:rel.x[1],y:rel.y[1]},hand).toFixed(1),pathAtMarkToFirstFree:d({x:atMark.x[1],y:atMark.y[1]},first)&&+d({x:atMark.x[1],y:atMark.y[1]},first).toFixed(1),handToFirstFree:d(hand,first)&&+d(hand,first).toFixed(1)}};
  out.push(row);console.log(JSON.stringify(row));
}
await writeFile('test-results/release-check-5031.json',JSON.stringify(out,null,1));
