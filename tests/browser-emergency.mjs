import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
await mkdir('test-results/emergency',{recursive:true});
await build({stdin:{contents:"export * from './src/services/manualAnalysisReadiness';export * from './src/services/analysisTimeline';export {calculateVelocity} from './src/matchingEngine';",resolveDir:process.cwd(),loader:'ts'},outfile:'test-results/emergency/time.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const e=await import(pathToFileURL(resolve('test-results/emergency/time.mjs')).href);
const raw={durationSec:7,timestamps:[],totalFrames:0,actualFps:NaN,fpsSource:'estimated',timeBase:'fps_derived'},before=JSON.stringify(raw);
const selected={release:{timeSec:5.274549,kind:'cfr_assumed',left:527,right:528,alpha:0,sourceSpanSec:NaN},glove:{timeSec:5.774032,kind:'cfr_assumed',left:577,right:578,alpha:0,sourceSpanSec:NaN}};
const confirmed=e.confirmCfrTiming(raw,30,selected),view=e.eventAnalysisView(confirmed.timing.timestamps,confirmed.events),result=e.calculateVelocity(view.releaseFrame,view.gloveFrame,30,17.5,view.engineTimingBridge);
assert.equal(JSON.stringify(raw),before);assert.equal(view.eventTimes.releaseTimeSec,selected.release.timeSec);assert.equal(view.eventTimes.gloveTimeSec,selected.glove.timeSec);assert.ok(Math.abs(result.flightSeconds-0.499483)<1e-12);
assert.equal(e.manualAnalysisReason(true,false,false,raw,0,0).includes('確認 FPS'),true);
assert.equal(e.manualAnalysisReason(true,false,false,confirmed.timing,view.releaseFrame,view.gloveFrame),null);
const base=process.env.BASE_URL||'http://127.0.0.1:4175',report={base,environment:'Desktop Chrome with mobile viewport and touch simulation; physical phone not tested',knownTime:{release:view.eventTimes.releaseTimeSec,glove:view.eventTimes.gloveTimeSec,engineFlightSeconds:result.flightSeconds},errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
page.on('pageerror',error=>report.errors.push(error.message));
const status=page.locator('#current-time-status'),canvas=page.locator('#interpolated-preview');
const time=async()=>Number(await status.getAttribute('data-time'));
async function seek(t){await page.locator('#timeline-time-input').fill(String(t));await page.waitForFunction(()=>!document.querySelector('video').seeking);}
async function mark(name){await page.locator(`#set-${name}-time`).click();}
async function analyze(){assert.equal(await page.locator('#btn-start-analysis').isEnabled(),true);await page.locator('#btn-start-analysis').click();await page.waitForFunction(()=>document.querySelector('#analysis-readiness').textContent.includes('分析已完成'),null,{timeout:20000});const el=page.locator('#event-time-provenance'),events=JSON.parse(await el.getAttribute('data-events')),flight=Number(await el.getAttribute('data-engine-flight-seconds'));assert.ok(Math.abs(flight-(events.glove.timeSec-events.release.timeSec))<1e-9);assert.ok((await page.locator('#right-column').innerText()).length>100);return{events,engineFlightSeconds:flight};}
async function slider(){const s=page.locator('#video-timeline');await s.scrollIntoViewIfNeeded();const b=await s.boundingBox(),max=Number(await s.getAttribute('max')),y=b.y+b.height/2;await page.mouse.click(b.x+12+(b.width-24)*.35,y);assert.ok(Math.abs(Number(await s.inputValue())/max-.35)<.04);await page.mouse.move(b.x+12+(b.width-24)*.35,y);await page.mouse.down();await page.mouse.move(b.x+12+(b.width-24)*.65,y,{steps:8});await page.mouse.up();assert.ok(Math.abs(Number(await s.inputValue())/max-.65)<.04);
 const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+12+(b.width-24)*.45,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();assert.ok(Math.abs(Number(await s.inputValue())/max-.45)<.05);
 for(const d of [-5,-1,1,5]){const n=Number(await s.inputValue());await page.getByTitle(`${d<0?'後退':'前進'} ${Math.abs(d)} 幀`,{exact:true}).click();assert.equal(Number(await s.inputValue()),n+d);}
}
async function preview(t){await seek(t);await page.waitForFunction(()=>['ready','failed'].includes(document.querySelector('#interpolated-preview').dataset.previewState),null,{timeout:20000});const state=await canvas.getAttribute('data-preview-state');if(state==='ready'){assert.equal(Number(await canvas.getAttribute('data-time')),await time());assert.ok(Number(await canvas.getAttribute('data-changed-a'))>0);assert.ok(Number(await canvas.getAttribute('data-changed-b'))>0);}return state;}
try{
 await page.goto(base);
 // Encode actual images with the existing browser WebCodecs capability. No
 // captureStream dependency (some headless environments record empty headers).
 const chunks=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=160;c.height=160;const x=c.getContext('2d'),chunks=[];
  const encoder=new VideoEncoder({output:chunk=>{const b=new Uint8Array(chunk.byteLength);chunk.copyTo(b);chunks.push(Array.from(b));},error:e=>{throw e;}});
  encoder.configure({codec:'vp8',width:160,height:160,bitrate:500000,latencyMode:'realtime'});
  for(let i=0;i<40;i++){x.fillStyle='#142033';x.fillRect(0,0,160,160);for(let y=0;y<160;y+=8)for(let z=0;z<160;z+=8){x.fillStyle=(z+y)%3?'#243346':'#334455';x.fillRect(z,y,5,5);}x.fillStyle='white';x.fillRect(10+i*2,50,15,15);const f=new VideoFrame(c,{timestamp:Math.round(i*1e6/24)});encoder.encode(f,{keyFrame:true});f.close();}
  await encoder.flush();encoder.close();return chunks;
 });
 const uint=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);let first=0;while(first<3&&b[first]===0)first++;return b.subarray(first);};
 const el=(hex,...parts)=>{const data=Buffer.concat(parts);let len=1;while(data.length>=2**(7*len)-1)len++;const size=Buffer.alloc(len);let n=data.length;for(let i=len-1;i>=0;i--){size[i]=n&255;n=Math.floor(n/256);}size[0]|=1<<(8-len);return Buffer.concat([Buffer.from(hex,'hex'),size,data]);};
 const str=x=>Buffer.from(x),duration=Buffer.alloc(8);duration.writeDoubleBE(40*1000/24);
 const header=el('1a45dfa3',el('4286',uint(1)),el('42f7',uint(1)),el('42f2',uint(4)),el('42f3',uint(8)),el('4282',str('webm')),el('4287',uint(4)),el('4285',uint(2)));
 const info=el('1549a966',el('2ad7b1',uint(1000000)),el('4489',duration),el('4d80',str('PitchVision test')),el('5741',str('PitchVision test')));
 const tracks=el('1654ae6b',el('ae',el('d7',uint(1)),el('73c5',uint(1)),el('83',uint(1)),el('86',str('V_VP8')),el('23e383',uint(Math.round(1e9/24))),el('e0',el('b0',uint(160)),el('ba',uint(160)))));
 const blocks=chunks.map((bytes,i)=>{const block=Buffer.alloc(4);block[0]=0x81;block.writeInt16BE(Math.round(i*1000/24),1);block[3]=0x80;return el('a3',block,Buffer.from(bytes));});
 const bytes=Buffer.concat([header,el('18538067',info,tracks,el('1f43b675',el('e7',uint(0)),...blocks))]);
 await writeFile('test-results/emergency/unknown-timing.webm',Buffer.from(bytes));assert.ok(bytes.length>1000,'recorded test movie contains encoded data');await page.locator('#video-upload-input').setInputFiles({name:'unknown-timing.webm',mimeType:'video/webm',buffer:Buffer.from(bytes)});await page.locator('#manual-fps').waitFor();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 assert.equal(await page.locator('#slider-release-frame').count(),0);assert.equal(await page.locator('#slider-glove-frame').count(),0);assert.match(await page.locator('#analysis-readiness').innerText(),/設定出手與進手套/);assert.doesNotMatch(await page.locator('#analysis-readiness').innerText(),/載入可播放|先上傳/);
 await page.getByRole('button',{name:'播放影片',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('video').paused);await page.getByRole('button',{name:'暫停影片',exact:true}).click();await slider();await seek(.31);await mark('release');const r=await time();await seek(.91);await mark('glove');const g=await time();assert.equal(await page.locator('#btn-start-analysis').isEnabled(),true);report.mediaOnly=await analyze(); // Manual seconds now work before optional CFR confirmation.
 await page.locator('#manual-fps').fill('24');await page.locator('#confirm-manual-fps').click();assert.match(await page.locator('#timing-status').innerText(),/24.0000/);assert.equal(await page.locator('#mode-fine').isEnabled(),true);assert.equal(await page.locator('#btn-start-analysis').isEnabled(),true);report.confirmed=await analyze();assert.equal(report.confirmed.events.release.timeSec,r);assert.equal(report.confirmed.events.glove.timeSec,g);
 await page.locator('#mode-fine').click();await slider();report.assumedPreview=await preview(.311111111111);await page.locator('#mode-source').click();await seek(.3333333333);await mark('release');report.reanalysis=await analyze();
 await page.locator('#video-upload-input').setInputFiles(resolve('test-results/fps-fixtures/synthetic-30.mp4'));await page.waitForFunction(()=>document.querySelector('#current-time-status')?.textContent.includes('來源 30.0000'));assert.match(await page.locator('#jump-release-time').innerText(),/未設定/);assert.match(await page.locator('#jump-glove-time').innerText(),/未設定/);assert.equal(Number(await page.locator('#video-timeline').getAttribute('max'))>41,true);
 await page.locator('#mode-source').click();assert.equal(Number(await page.locator('#video-timeline').getAttribute('max')),41);await slider();await page.locator('#mode-fine').click();await slider();assert.equal(await preview(.311111111111),'ready');await mark('release');assert.equal(await preview(.911111111111),'ready');await mark('glove');report.knownPts=await analyze();report.previewSize=await canvas.evaluate(c=>[c.width,c.height]);assert.deepEqual(report.previewSize,[320,240]);
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;process.exitCode=1;await page.screenshot({path:'test-results/emergency/failure.png',fullPage:true}).catch(()=>{});}
finally{await writeFile('test-results/emergency/report.json',JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
