import {CameraViewMode} from '../types';
import {CameraGeometry,projectWorld} from './cameraGeometry';
import {candidateWorld} from './physicalCandidates';
import {PitchRecord} from '../types';
type Vec=[number,number,number];
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
const unit=(a:Vec):Vec=>{const n=Math.hypot(...a);return a.map(x=>x/n) as Vec;};
const cross=(a:Vec,b:Vec):Vec=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rad=(x:number)=>x*Math.PI/180;
export function cameraFromPose(position:Vec,yawDeg:number,pitchDeg:number,rollDeg:number,focalPx:number,width:number,height:number):CameraGeometry {
 if(![...position,yawDeg,pitchDeg,rollDeg,focalPx,width,height].every(Number.isFinite)||focalPx<=0||width<=0||height<=0)throw Error('無效相機先驗參數');
 const forward:Vec=[Math.sin(rad(yawDeg))*Math.cos(rad(pitchDeg)),Math.sin(rad(pitchDeg)),Math.cos(rad(yawDeg))*Math.cos(rad(pitchDeg))],right=unit(cross(forward,[0,1,0])),down=cross(forward,right),c=Math.cos(rad(rollDeg)),s=Math.sin(rad(rollDeg));
 const R=[right.map((v,i)=>c*v+s*down[i]),down.map((v,i)=>c*v-s*right[i]),forward];
 return {method:'standard_prior',width,height,positionM:position,yawDeg,pitchDeg,azimuthDeg:yawDeg,elevationDeg:pitchDeg,rollDeg,focalPx,rotation:R,translation:R.map(row=>-dot(row,position)),quality:0.2,limitations:['標準拍攝位置工程先驗，非實測外參；yaw/pitch/roll、焦距與尺度仍有不確定性','世界：X為捕手看向投手的右方，Y向上，Z由出手平面向捕手；單位公尺；無鏡頭畸變模型']};
}
export function standardCameras(mode:CameraViewMode,width:number,height:number,distance:number,preferred?:CameraGeometry):CameraGeometry[] {
 if(validManualCamera(preferred))return [preferred!];
 if(!Number.isFinite(distance)||distance<=0)throw Error('投球距離須為正值');
 const rear=mode==='pitcher_rear',back=4+(rear?Math.max(0,18.44-distance):0),h=rear?1.65:1.75,angle=rear?7.5:0;
 // Bounded hypotheses, not an unbounded pose optimizer. Position and aim
 // are separate: aim starts at the middle of the flight corridor, with offsets.
 const variants=[[0,0,0,0,0,1],[-1,0,-.15,0,0,.8],[1,0,.15,0,0,1.2],[0,-2.5,0,0,0,1],[0,2.5,0,0,0,1],[0,0,0,-3,-2,1],[0,0,0,3,2,1]];
 const cameras=variants.map(([db,da,dh,dy,dp,df])=>{
  const b=back+db,position:Vec=[b*Math.tan(rad(angle+da)),h+dh*(rear?1:5/3),rear?-b:distance+b],aim:Vec=[0,1.2,distance/2],v=aim.map((x,i)=>x-position[i]);
  return cameraFromPose(position,Math.atan2(v[0],v[2])*180/Math.PI+dy,Math.atan2(v[1],Math.hypot(v[0],v[2]))*180/Math.PI+dp,(preferred?.rollDeg??0)+dy/3,Math.max(width,height)*.9*df,width,height);
 });
 if(rear){const roll=preferred?.rollDeg??0;return [...cameras,...cameras.map(g=>cameraFromPose([-g.positionM![0],g.positionM![1],g.positionM![2]],-g.yawDeg!,g.pitchDeg!,2*roll-g.rollDeg,g.focalPx!,width,height))];}
 return cameras;
}
export function validManualCamera(g:CameraGeometry|undefined):boolean {
 return Boolean(g?.method==='planar_reference'&&g.width>0&&g.height>0&&Number.isFinite(g.focalPx)&&g.focalPx!>0&&g.rotation?.length===3&&g.rotation.every(r=>r.length===3&&r.every(Number.isFinite))&&g.translation?.length===3&&g.translation.every(Number.isFinite));
}
export function projectCandidate(r:PitchRecord,g:CameraGeometry){
 return candidateWorld(r).map(p=>{const R=g.rotation!,tr=g.translation!,depth=dot(R[2],[p.x,p.y,p.z])+tr[2];if(depth<=.05)throw Error('候選位於相機後方或近裁切面');const q=projectWorld(g,p.x,p.y,p.z);return {timeSec:p.t,x:q.x,y:q.y,x_norm:q.x/g.width,y_norm:q.y/g.height};});
}
