import {VideoTiming} from '../types';
import {SelectedEvent,SelectedEvents} from '../services/analysisTimeline';
import {sourceFps} from '../services/sourceTiming';

// Preview-only time positions are never an interpolation source. Real PTS or
// explicitly confirmed CFR data take priority over a stale selectionOnly flag.
export function resolvePlayerTiming(source:VideoTiming|null|undefined,provided:number[],previewOnly:boolean) {
 const sourceValid=Number.isFinite(sourceFps(source?.timestamps??[]));
 const suppliedValid=!previewOnly&&Number.isFinite(sourceFps(provided));
 const times=sourceValid?source!.timestamps:provided;
 const mediaOnly=!sourceValid&&!suppliedValid;
 const fps=mediaOnly?NaN:sourceFps(times);
 return {times,fps,mediaOnly,assumed:mediaOnly||source?.timeBase==='fps_derived',fineReason:mediaOnly?'補幀需要來源影格時間；請在上方輸入並確認 FPS。':fps>=90-0.001?'來源已達 90 FPS，保留原始影格率。':null};
}

export function eventDescription(event:SelectedEvent|null):string {
 if(!event)return '未設定';
 const type=event.selectionType??(event.kind==='original'?'original':event.kind==='interpolated'?'interpolated':'cfr_assumed');
 const location=type==='original'?`原始影格 F${event.left}`:type==='interpolated'?`90 FPS 位置 ${event.timelineIndex??'—'} · 推算影格`:type==='media_time'?'媒體時間（來源索引未驗證）':`CFR 位置 ${event.left}（來源索引未驗證）`;
 return `${location} · ${event.timeSec.toFixed(6)} 秒`;
}
export function flightTimeDescription(events:SelectedEvents):string {
 if(!events.release||!events.glove)return '尚未完成設定';
 const dt=events.glove.timeSec-events.release.timeSec;
 if(!Number.isFinite(dt))return '事件時間無效';
 if(dt<=0)return '進手套時間需晚於出手';
 return `飛行時間：${dt.toFixed(4)} 秒`;
}
