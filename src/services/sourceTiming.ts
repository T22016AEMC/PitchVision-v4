import {VideoTiming} from '../types';
export function sourceFps(times:readonly number[]):number {
 if(times.length<2||times.some((t,i)=>!Number.isFinite(t)||t<0||(i>0&&t<=times[i-1])))return NaN;
 const fps=(times.length-1)/(times.at(-1)!-times[0]);return Number.isFinite(fps)&&fps>0?fps:NaN;
}
export function formatSourceFps(fps:number):string {
 return Number.isFinite(fps)&&fps>0?(fps<.00005?fps.toPrecision(4):fps.toFixed(4)):'未知／待確認';
}
export function normalizeSourceTiming(timing:VideoTiming):VideoTiming {
 const fps=sourceFps(timing.timestamps);
 if(!Number.isFinite(fps)||timing.totalFrames!==timing.timestamps.length||!Number.isFinite(timing.durationSec)||timing.durationSec<=0||timing.timestamps.at(-1)!>=timing.durationSec)throw Error('來源時間表／影格數不一致；請確認FPS或重新匯出影片');
 return {...timing,actualFps:fps};
}
