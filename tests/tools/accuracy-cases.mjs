// The fixed synthetic case matrix for the 5.0.3 accuracy comparison: both views, 24/30/60 FPS, all nine pitch types, two
// image sizes. Seeds are fixed so 5.0.2 and 5.0.3 are compared on exactly the same pitches.
import {PITCH_GROUPS,makeWorldCase} from './world-synth.mjs';

export function caseSpecs({quick=false}={}){
  const specs=[];let seed=100;
  const pitches=Object.keys(PITCH_GROUPS),views=['pitcher_rear','catcher'],fpsList=[24,30,60];
  for(const view of views)for(const fps of fpsList)for(const pitch of pitches){
    for(let k=0;k<(quick?1:2);k++){
      const big=k===1;// the second pitch of each cell is a 4K-sized frame (same noise at 1280-px working scale)
      specs.push({seed:seed++,view,fps,pitch,width:big?2160:720,height:big?3840:1280});
    }
  }
  return specs;
}
export const buildCase=spec=>makeWorldCase(spec);
