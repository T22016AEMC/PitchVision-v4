import assert from 'node:assert/strict';
import {makeScene} from './tools/synth.mjs';
import {trackScene,scoreScene,loadTracker} from './tools/ball-eval.mjs';
// Pure-computation checks of src/services/pitchBallTracker.ts on generated scenes with known ball positions
// (nothing from real footage). Real clips and the old-vs-new comparison: tests/tools/eval-ball-tracker.mjs.
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;};
const base={width:360,height:640,fps:24,view:'pitcher_rear',frames:40,release:14,glove:26};
const scene=o=>{const fps=o.fps??24,release=14,glove=release+Math.round(fps*.5);return makeScene({width:360,height:640,view:'pitcher_rear',frames:glove+Math.round(fps*.5)+14,release,glove,...o,fps});};
const rows=[];

// 1. Accuracy matrix: both views, three frame rates, shake, a rolling ball, an object that appears with the throw,
//    and a short occlusion. No false positives, most visible frames found, sub-3-pixel error.
for(const [name,o] of [
  ['pitcher view 24 fps clean',{view:'pitcher_rear',fps:24}],
  ['pitcher view 24 fps shake+distractors',{view:'pitcher_rear',fps:24,distractors:true,shake:3}],
  ['catcher view 24 fps shake+distractors',{view:'catcher',fps:24,distractors:true,shake:3}],
  ['pitcher view 60 fps distractors',{view:'pitcher_rear',fps:60,distractors:true,shake:2}],
  ['catcher view 30 fps occlusion',{view:'catcher',fps:30,distractors:true,occlusion:[[19,20]]}],
  ['pitcher view 30 fps occlusion+shake',{view:'pitcher_rear',fps:30,distractors:true,shake:2,occlusion:[[19,20]]}],
]){
  const sc=scene(o),res=await trackScene(sc),s=scoreScene(sc,res);
  rows.push({name,hits:s.hits,visible:s.visible,fp:s.falsePositives,err:+s.meanErrPx.toFixed(2),ms:s.ms});
  check(res.status==='tracked',`${name}: tracked`);
  check(s.falsePositives===0,`${name}: no false positives (got ${s.falsePositives})`);
  check(s.recall>=.6,`${name}: recall ${s.recall.toFixed(2)} ≥ 0.6`);
  check(s.meanErrPx<=2.5,`${name}: mean error ${s.meanErrPx.toFixed(2)} px`);
  // hidden frames must never be observations (only estimates)
  for(const t of sc.truth)if(!t.visible&&t.frame>=sc.release){const p=res.points.find(q=>q.frame===t.frame);check(!p||p.source==='estimated',`${name}: hidden frame ${t.frame} is not an observation`);}
}

// 2. A ball that is hidden for the whole flight must not be "found" from clutter (pitcher, rolling ball, lights).
{
  const res=await trackScene(scene({distractors:true,occlusion:[[12,31]]}));
  check(res.status==='no_ball_found'&&res.observedCount===0,'ball hidden all flight: no ball found, no observations');
}

// 3. Camera shake that is too large is reported, not guessed through.
{
  const res=await trackScene(scene({distractors:true,shake:100}));
  check(res.status==='camera_motion_too_large','huge shake: camera_motion_too_large');
  check(res.points.length===0,'huge shake: no points');
}
// moderate shake: still tracked, and the stabilisation is accurate (estimated shift = true shift)
{
  const sc=scene({distractors:true,shake:3}),res=await trackScene(sc),ref=sc.shifts[res.camera.shifts[0].frame];
  const worst=Math.max(...res.camera.shifts.map(s=>{const t=sc.shifts[s.frame];return Math.hypot(s.dx-(t[0]-ref[0]),s.dy-(t[1]-ref[1]));}));
  check(worst<=1,`shake estimate within 1 px (worst ${worst.toFixed(1)})`);
}

// 4. User taps are forced anchors and never make the result worse.
{
  const sc=scene({distractors:true,shake:2}),t=sc.truth,anchors=[16,22].map(f=>({frame:f,xNorm:t[f].x/360,yNorm:t[f].y/640}));
  const res=await trackScene(sc,{anchors}),s=scoreScene(sc,res);
  check(anchors.every(a=>res.points.some(p=>p.frame===a.frame&&p.source==='user')),'anchors appear as user points');
  check(s.falsePositives===0&&s.recall>=.6,`anchors: fp ${s.falsePositives}, recall ${s.recall.toFixed(2)}`);
}

// 5. Not enough frames.
{
  const sc=scene({}),tr=await loadTracker(),f=i=>({index:i,time:i/24,width:360,height:640,data:sc.render(i)});
  check(tr.analyzeBallFrames([12,13,14,15,16,17].map(f),[0,1].map(f),{fps:24,view:'pitcher_rear'}).status==='insufficient_frames','too few background frames');
  check(tr.analyzeBallFrames([12,13].map(f),[0,1,2,3].map(f),{fps:24,view:'pitcher_rear'}).status==='insufficient_frames','too few window frames');
  const bg=tr.pickBackgroundFrames(100,30,50);
  check(bg.length<=8&&bg.every(i=>i<=26||i>=54),'background frames come from outside the window with a guard');
}
console.log(JSON.stringify({pitchBallTrackerChecks:checks,scenes:rows}));
