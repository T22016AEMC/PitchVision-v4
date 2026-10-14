import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const e=await import(pathToFileURL(resolve('test-results/v411.mjs')).href);
const {readMp4Timing}=await import(pathToFileURL(resolve('test-results/v41.mjs')).href);
const base=process.env.BASE_URL||'http://127.0.0.1:4175',dir=resolve('test-results',base.includes('127.0.0.1')?'v421-local':'v421-public');await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
const annotations=JSON.parse(await readFile('test-results/v41-manual-selections.json','utf8'));
const report={base,time:new Date().toISOString(),environment:'Desktop Chrome viewport/touch simulation; not physical iPhone/Android',manualBasis:annotations.basis,cases:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.message));
async function loaded(file){await page.goto(base,{waitUntil:'networkidle'});assert.match(await page.title(),/V4\.2\.1/);await page.locator('#video-upload-input').setInputFiles(resolve('../test videos',file));await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);}
async function source(frame){await page.locator('#mode-source').click();await page.locator('#source-frame-input').fill(String(frame));await page.waitForFunction(()=>!document.querySelector('video')?.seeking);await page.waitForTimeout(100);}
async function mark(name){await page.locator(`#set-${name}-time`).click();}
async function analyze(){assert.equal(await page.locator('#btn-start-analysis').isEnabled(),true);await page.locator('#btn-start-analysis').click();await page.waitForFunction(()=>document.querySelector('#analysis-readiness')?.textContent.includes('分析已完成'),{},{timeout:30000});const text=await page.locator('#right-column').innerText();assert.ok(text.includes('Spin Rate'));return{text,events:JSON.parse(await page.locator('#event-time-provenance').getAttribute('data-events'))};}
async function fine(time){await page.locator('#mode-fine').click();await page.locator('#timeline-time-input').fill(String(time));await page.waitForFunction(()=>document.querySelector('#interpolated-preview')?.dataset.previewState==='ready'||document.querySelector('#interpolated-preview')?.dataset.previewState==='failed',{},{timeout:20000});const state=await page.locator('#interpolated-preview').getAttribute('data-preview-state');assert.equal(state,'ready',await page.locator('#manual-controls').innerText());assert.equal(await page.locator('#current-time-status').getAttribute('data-kind'),'interpolated');const canvas=page.locator('#interpolated-preview');assert.equal(await canvas.isVisible(),true);return await canvas.evaluate(c=>({width:c.width,height:c.height,changedA:Number(c.dataset.changedA),changedB:Number(c.dataset.changedB),estimateMs:Number(c.dataset.estimateMs),synthesisMs:Number(c.dataset.synthesisMs),motionSize:JSON.parse(c.dataset.motionSize),quality:c.dataset.quality,indices:JSON.parse(c.dataset.sourceIndices),mediaTimes:JSON.parse(c.dataset.sourceMediaTimes)}));}
async function sourceHash(){return await page.locator('video').first().evaluate(v=>{const c=document.createElement('canvas');c.width=180;c.height=320;const x=c.getContext('2d');x.drawImage(v,0,0,180,320);const a=x.getImageData(0,0,180,320).data;let h=2166136261;for(let i=0;i<a.length;i+=16)h=Math.imul(h^a[i],16777619);return h>>>0;});}
try{
 for(const file of ['直球.mp4','彈指曲球.mp4']){
  await loaded(file);const timing=await readMp4Timing(new Blob([await readFile(resolve('../test videos',file))]));
  const item={file,fps:timing.actualFps,averageFPS:timing.averageFps,containerFPS:timing.containerFps,isVFR:timing.isVFR,originalFrames:timing.totalFrames,finePositions:e.createFineGridTimeline(timing.timestamps,timing.actualFps).length,v3EstimatedPositions:Math.round(timing.durationSec*30),firstPTS:timing.timestamps[0],lastPTS:timing.timestamps.at(-1)};report.cases.push(item);
  item.sourceResolution=await page.locator('video').first().evaluate(v=>[v.videoWidth,v.videoHeight]);
  await page.locator('#pitch-type-select').selectOption('🤖 AI 全數據庫自動辨識');await page.getByRole('button',{name:/投手後方平視视角|投手後方平視視角/}).click();
  assert.equal(await page.locator('#manual-controls input[type=range]').count(),1);assert.equal(await page.getByText('兩者獨立自定義：',{exact:true}).count(),0);assert.equal(await page.locator('#slider-release-frame').count(),0);assert.equal(await page.locator('#slider-glove-frame').count(),0);
  item.videoBox=await page.locator('video').first().boundingBox();assert.ok(item.videoBox.height>580,'mobile video enlarged');
  const geometry=await page.evaluate(()=>{const video=document.querySelector('.video-stage');const timeline=document.querySelector('#video-timeline');return{bottom:video.getBoundingClientRect().bottom,top:timeline.getBoundingClientRect().top};});assert.ok(geometry.top-geometry.bottom<32,'timeline directly below video');
  await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForTimeout(200);assert.equal(await page.locator('video').first().evaluate(v=>v.paused),false);await page.getByRole('button',{name:'暫停',exact:true}).click();
  const nearest=t=>e.sourceIndexAt(timing.timestamps,timing.timestamps.reduce((best,x)=>Math.abs(x-t)<Math.abs(best-t)?x:best,timing.timestamps[0]));
  const release=nearest(annotations[file].releaseTime),glove=nearest(annotations[file].gloveTime);
  item.sourceHashes=[];
  for(const f of [0,release-1,release,release+1,timing.totalFrames-1]){await source(f);item.sourceHashes.push({frame:f,hash:await sourceHash(),time:Number(await page.locator('#current-time-status').getAttribute('data-time')),decoded:await page.locator('#current-time-status').getAttribute('data-decoded-time')});assert.equal(Number(await page.locator('#source-frame-input').inputValue()),f);assert.ok(Math.abs(item.sourceHashes.at(-1).time-timing.timestamps[f])<1e-9);}
  assert.notEqual(item.sourceHashes[1].hash,item.sourceHashes[2].hash,'different original images displayed');assert.notEqual(item.sourceHashes[2].hash,item.sourceHashes[3].hash,'next original image differs');
  item.originalIntervalPositions=glove-release+1;item.fineIntervalPositions=e.createFineGridTimeline(timing.timestamps,timing.actualFps).nearest(timing.timestamps[glove])-e.createFineGridTimeline(timing.timestamps,timing.actualFps).nearest(timing.timestamps[release])+1;
  if(process.env.FULL_FRAME_AUDIT==='1'||process.env.FULL_FRAME_AUDIT===file){
   item.decodedAudit=[];
   for(let f=0;f<timing.timestamps.length;f++){await source(f);await page.waitForFunction(t=>{const s=document.querySelector('#current-time-status');return s.dataset.decodedTime!==''&&Math.abs(Number(s.dataset.decodedTime)-t)<0.00001;},timing.timestamps[f]);item.decodedAudit.push({index:f,expected:timing.timestamps[f],presented:Number(await page.locator('#current-time-status').getAttribute('data-decoded-time')),hash:await sourceHash()});}
   assert.equal(item.decodedAudit.length,timing.totalFrames);item.duplicateImages=item.decodedAudit.filter((p,i,a)=>i&&p.hash===a[i-1].hash).map(p=>p.index);
  }
  await source(release);await mark('release');await source(glove);await mark('glove');item.original=await analyze();assert.equal(item.original.events.release.timeSec,timing.timestamps[release]);assert.equal(item.original.events.glove.timeSec,timing.timestamps[glove]);
  assert.ok(item.original.text.includes(e.engine.calculateVelocity(release,glove,timing.actualFps,17.5,timing.timestamps).velocityKmh.toFixed(1)),'unchanged distance/time formula');
  await source(glove+1);await mark('glove');item.reanalysis=await analyze();assert.notEqual(item.reanalysis.events.glove.timeSec,item.original.events.glove.timeSec);
  await page.evaluate(()=>{window.__heartbeats=0;window.__beat=setInterval(()=>window.__heartbeats++,10);});
  await source(release);item.releasePreview=await fine((timing.timestamps[release]+timing.timestamps[release+1])/2);await mark('release');
  assert.ok(item.releasePreview.changedA>0&&item.releasePreview.changedB>0,'actual intermediate differs from both sources');
  await page.locator('#interpolated-preview').screenshot({path:resolve(dir,file+'-interpolated.png')});
  const before=Number(await page.locator('#current-time-status').getAttribute('data-time'));await page.getByTitle('前進 1 幀',{exact:true}).click();await page.waitForTimeout(150);const after=Number(await page.locator('#current-time-status').getAttribute('data-time'));assert.ok(after>before);await page.getByTitle('後退 1 幀',{exact:true}).click();await page.waitForTimeout(100);assert.ok(Math.abs(Number(await page.locator('#current-time-status').getAttribute('data-time'))-before)<1e-7);
  item.glovePreview=await fine((timing.timestamps[glove]+timing.timestamps[glove+1])/2);await mark('glove');item.interpolated=await analyze();assert.equal(item.interpolated.events.release.kind,'interpolated');assert.equal(item.interpolated.events.glove.kind,'interpolated');
  const dt=item.interpolated.events.glove.timeSec-item.interpolated.events.release.timeSec;assert.equal(Number(item.interpolated.text.match(/先驗估算距離\n([\d.]+)/)?.[1]),Number((17.5/dt*3.6).toFixed(1)));assert.ok(item.interpolated.text.includes('INSUFFICIENT EVIDENCE'));item.fineFlight=dt;
  item.heartbeats=await page.evaluate(()=>{clearInterval(window.__beat);return window.__heartbeats;});assert.ok(item.heartbeats>10,'main event loop continues during local interpolation');
  item.autoStatus='Automatic algorithms retained, not changed or rerun in this repair';
  // Real pointer dragging/clicking, not only JS value assignment.
  await page.locator('#video-timeline').scrollIntoViewIfNeeded();const slider=await page.locator('#video-timeline').boundingBox();
  await page.mouse.move(slider.x+slider.width*.3,slider.y+slider.height/2);await page.mouse.down();await page.mouse.move(slider.x+slider.width*.76,slider.y+slider.height/2,{steps:45});await page.mouse.up();
  const dragged=Number(await page.locator('#current-time-status').getAttribute('data-time'));assert.ok(dragged>timing.durationSec*.70&&dragged<timing.durationSec*.82);item.draggedTime=dragged;
  const clickBox=await page.locator('#video-timeline').boundingBox();await page.mouse.click(clickBox.x+clickBox.width*.72,clickBox.y+clickBox.height/2);const clicked=Number(await page.locator('#current-time-status').getAttribute('data-time'));item.clickedTime=clicked;assert.ok(clicked<dragged&&clicked>timing.durationSec*.65,JSON.stringify({clicked,dragged,slider,clickBox}));
  // Finish in a known time neighborhood chosen manually, while earlier requests
  // are still pending; only the final cursor may receive a preview.
  item.finalPreview=await fine((timing.timestamps[release]+timing.timestamps[release+1])/2);const finalTime=Number(await page.locator('#current-time-status').getAttribute('data-time'));
  await page.waitForTimeout(300);assert.equal(Number(await page.locator('#interpolated-preview').getAttribute('data-time')),finalTime);
  assert.deepEqual([item.finalPreview.width,item.finalPreview.height],item.sourceResolution);assert.ok(item.finalPreview.changedA>0&&item.finalPreview.changedB>0);
  for(const delta of [-5,-1,1,5]){const initial=Number(await page.locator('#current-time-status').getAttribute('data-time'));await page.getByTitle(`${delta<0?'後退':'前進'} ${Math.abs(delta)} 幀`,{exact:true}).click();const moved=Number(await page.locator('#current-time-status').getAttribute('data-time'));assert.ok(Math.abs(moved-initial-delta/90)<1e-7,'fine button uses 90Hz grid, not original/union index');}
  await fine((timing.timestamps[release]+timing.timestamps[release+1])/2);
  item.sameRatio=await page.evaluate(()=>{const c=document.querySelector('#interpolated-preview').getBoundingClientRect(),v=document.querySelector('video').getBoundingClientRect();return Math.abs(c.width-v.width)<1&&Math.abs(c.height-v.height)<1;});assert.ok(item.sameRatio);
  await page.locator('#mode-source').click();assert.equal(await page.locator('#interpolated-preview').isVisible(),false);
  const layout=await page.locator('#frame-step-controls button').evaluateAll(bs=>bs.map(b=>({y:b.getBoundingClientRect().y,h:b.getBoundingClientRect().height,svg:!!b.querySelector('svg')})));assert.equal(new Set(layout.map(b=>b.y)).size,1);assert.ok(layout.every(b=>b.h>=50&&b.svg));
  assert.equal(await page.locator('.mobile-workflow').count(),0);assert.equal(await page.locator('#initial-pitcher-setup').isVisible(),true);
  const initialHeight=Number(await page.locator('#height-number').inputValue());for(const d of [-5,-1,1,5])await page.getByRole('button',{name:`身高 ${d>0?'+':''}${d} cm`,exact:true}).click();assert.equal(Number(await page.locator('#height-number').inputValue()),initialHeight);
  await page.locator('#btn-stride-manual').click();const stride=Number(await page.locator('#stride-number').inputValue());for(const d of [-5,-1,1,5])await page.getByRole('button',{name:`跨步 ${d>0?'+':''}${d} cm`,exact:true}).click();assert.equal(Number(await page.locator('#stride-number').inputValue()),stride);await page.locator('#btn-stride-ai').click();
  item.afterParameterUpdates=await analyze();
  await page.locator('#btn-science-info').click();await page.locator('#btn-view-database').click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'下載 JSON (1080 筆)'}).click();assert.equal(JSON.parse(await readFile(await (await download).path(),'utf8')).length,1080);await page.locator('.fixed.inset-0.z-50 button').last().click();await page.locator('#science-center').getByRole('button',{name:'返回分析操作'}).click();
  await page.locator('#tab-dual-track-visualizer').click();await page.locator('#pitch-canvas').waitFor();item.chart=true;
  for(const width of [320,390,430,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'responsive overflow');}
  item.desktopVideo=await page.locator('video').first().boundingBox();assert.ok(item.desktopVideo.width>1000,'video no longer constrained to desktop sidebar');
  await page.locator('#mode-fine').click();await page.locator('#video-timeline').scrollIntoViewIfNeeded();const wide=await page.locator('#video-timeline').boundingBox();await page.mouse.click(wide.x+wide.width*.65,wide.y+wide.height/2);assert.ok(Number(await page.locator('#current-time-status').getAttribute('data-time'))>timing.durationSec*.60);item.desktopSlider=true;
  await page.setViewportSize({width:390,height:844});await page.locator('#video-timeline').scrollIntoViewIfNeeded();const touchBox=await page.locator('#video-timeline').boundingBox(),cdp=await context.newCDPSession(page);
  for(const [type,fraction]of [['touchStart',.5],['touchMove',.6],['touchMove',.7],['touchEnd',.7]])await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:touchBox.x+touchBox.width*fraction,y:touchBox.y+touchBox.height/2}]});await cdp.detach();
  assert.ok(Number(await page.locator('#current-time-status').getAttribute('data-time'))>timing.durationSec*.65);item.touchDrag=true;
  await page.locator('#left-column').screenshot({path:resolve(dir,file+'-controls.png')});
  console.log(file,JSON.stringify({fps:item.fps,sourceFrames:item.originalFrames,preview:item.releasePreview,fineFlight:item.fineFlight,heartbeats:item.heartbeats}));
 }
 await page.locator('#video-upload-input').setInputFiles(resolve('../test videos','直球.mp4'));await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);assert.ok((await page.locator('#jump-release-time').innerText()).includes('未設定'));assert.ok((await page.locator('#jump-glove-time').innerText()).includes('未設定'));assert.equal(await page.locator('#mode-fine').getAttribute('aria-pressed'),'true');report.samePageUploadReset=true;
 // Fault injection models browsers where workers are unavailable. No production special-case logic.
 const fallbackContext=await browser.newContext({viewport:{width:390,height:844}});await fallbackContext.addInitScript(()=>{window.Worker=class {constructor(){throw new Error('Worker unavailable test');}};});const fallback=await fallbackContext.newPage();fallback.on('pageerror',err=>report.errors.push(err.message));
 await fallback.goto(base);await fallback.locator('#video-upload-input').setInputFiles(resolve('../test videos','直球.mp4'));await fallback.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await fallback.locator('#mode-fine').click();await fallback.locator('#timeline-time-input').fill('5.17');await fallback.waitForFunction(()=>document.querySelector('#interpolated-preview')?.dataset.previewState==='failed');await fallback.locator('#mode-source').click();
 for(const [frame,name]of [[123,'release'],[133,'glove']]){await fallback.locator('#source-frame-input').fill(String(frame));await fallback.waitForFunction(()=>!document.querySelector('video').seeking);await fallback.locator(`#set-${name}-time`).click();}
 await fallback.locator('#btn-start-analysis').click();await fallback.waitForFunction(()=>document.querySelector('#analysis-readiness')?.textContent.includes('分析已完成'));report.workerFailureFallback=true;await fallbackContext.close();
 // Actual browser-generated WebM exercises unavailable-container-PTS confirmation.
 await page.goto(base);const bytes=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=160;c.height=160;const x=c.getContext('2d'),stream=c.captureStream(24),chunks=[];
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});recorder.ondataavailable=e=>chunks.push(e.data);
  const done=new Promise(r=>recorder.onstop=r);let frame=0;const timer=setInterval(()=>{x.fillStyle='black';x.fillRect(0,0,160,160);x.fillStyle='white';x.fillRect((frame++*3)%140,50,15,15);},1000/24);
  recorder.start();await new Promise(r=>setTimeout(r,1600));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
 });await page.locator('#video-upload-input').setInputFiles({name:'manual-fps-confirmation.webm',mimeType:'video/webm',buffer:Buffer.from(bytes)});await page.locator('#manual-fps').waitFor();assert.equal(await page.locator('#btn-start-analysis').isEnabled(),false);await page.locator('#manual-fps').fill('24');await page.locator('#confirm-manual-fps').click();await source(3);await mark('release');await source(20);await mark('glove');await analyze();report.manualFpsConfirmation=true;
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;console.error(error);process.exitCode=1;await page.screenshot({path:resolve(dir,'failure.png'),fullPage:true}).catch(()=>{});}
finally{await writeFile(resolve(dir,'acceptance.json'),JSON.stringify(report,null,2));await browser.close();}
