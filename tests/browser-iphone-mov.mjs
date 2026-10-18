import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
// Local-only check with the user's iPhone originals (never committed): ../test videos/*.mov
// 390×844 mobile emulation in desktop Chrome. Desktop Chromium may not decode HEVC; in that case this
// records "needs iPhone Safari on a real device" and does NOT substitute a converted file.
const out=resolve('test-results/mobile-v5');await mkdir(out,{recursive:true});
const files=[{name:'直球.mov',frames:162,fps:'24'},{name:'彈指曲球.mov',frames:131,fps:null}].filter(f=>existsSync(resolve('..','test videos',f.name)));
if(!files.length){console.log(JSON.stringify({skipped:'no .mov originals in ../test videos'}));process.exit(0);}
let server=null,base=process.env.BASE_URL;
if(!base){base='http://127.0.0.1:4177';server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4177','--strictPort','--host','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
  await new Promise((ok,fail)=>{const t=setTimeout(()=>fail(Error('preview did not start')),20000);server.stdout.on('data',d=>{if(String(d).includes('4177')){clearTimeout(t);ok();}});server.on('exit',c=>fail(Error('preview exited '+c)));});}
const report={base,environment:'Desktop Chrome, 390×844 mobile emulation with touch; not a physical phone',files:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const hevc=await (await browser.newPage()).evaluate(()=>({hevcCanPlay:document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"'),mediaCapabilities:null}));
  report.hevcCanPlayType=hevc.hevcCanPlay||'(empty: not supported)';
  for(const f of files){
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'zh-TW'});
    const page=await context.newPage(),row={name:f.name,expectedFrames:f.frames};
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#video-upload-input').setInputFiles(resolve('..','test videos',f.name));
    const outcome=await Promise.race([
      page.locator('#video-summary').waitFor({timeout:60000}).then(()=>'loaded'),
      page.locator('#app-error').waitFor({timeout:60000}).then(()=>'error'),
      page.locator('#fps-dialog').waitFor({timeout:60000}).then(()=>'fps-dialog')
    ]).catch(()=> 'timeout');
    row.outcome=outcome;
    row.appError=await page.locator('#app-error').count()?await page.locator('#app-error').innerText():null;
    row.fpsDialogShown=await page.locator('#fps-dialog').count()===1;
    row.fpsUnknownTextShown=/FPS 未知|未知／待確認/.test(await page.evaluate(()=>document.body.innerText));
    row.videoInfo=await page.locator('#video-info').count()?await page.locator('#video-info').innerText():null;
    if(outcome==='loaded'){
      const video=await page.evaluate(()=>{const v=document.querySelector('video');return v?{readyState:v.readyState,width:v.videoWidth,height:v.videoHeight,duration:v.duration}:null;});
      row.video=video;
      row.pass=(f.fps?row.videoInfo?.startsWith(f.fps+' FPS'):/FPS/.test(row.videoInfo||''))&&row.videoInfo.includes(`${f.frames} 格`)&&!row.fpsDialogShown&&!row.fpsUnknownTextShown;
      // Frame mapping: does the picture the browser shows for index i carry the timestamp we parsed for i?
      await page.locator('#btn-next-mark').click();await page.locator('#set-release-time').waitFor();
      const probe=[];
      for(const index of [0,1,2,5,40,100,f.frames-1]){
        await page.locator('#player-menu-btn').click();await page.locator('#mode-source').click();
        await page.locator('#source-frame-input').fill(String(index));await page.locator('#player-menu-close').click();
        await page.waitForFunction(()=>{const v=document.querySelector('video'),s=document.querySelector('#current-time-status');return v&&!v.seeking&&s&&s.dataset.decodedTime!=='';},null,{timeout:30000}).catch(()=>{});
        const s=await page.locator('#current-time-status').evaluate(e=>({time:Number(e.dataset.time),decoded:e.dataset.decodedTime===''?null:Number(e.dataset.decodedTime),index:Number(e.dataset.sourceIndex)}));
        probe.push({index,parsedTimeSec:s.time,shownFrameTimeSec:s.decoded,diffSec:s.decoded===null?null:s.decoded-s.time});
      }
      row.frameMapping=probe;
      row.mappingOk=probe.every(p=>p.diffSec!==null&&Math.abs(p.diffSec)<.0015);
      // 90 FPS interpolation preview on the 4K original: must switch on (previewed at a reduced size) and allow marking.
      await page.locator('#player-menu-btn').click();
      const fineEnabled=await page.locator('#mode-fine').isEnabled();
      await page.locator('#mode-fine').click();await page.locator('#player-menu-close').click();
      await page.locator('#step-forward').click();
      await page.waitForFunction(()=>['ready','failed'].includes(document.querySelector('#interpolated-preview')?.dataset.previewState),null,{timeout:120000}).catch(()=>{});
      const preview=await page.locator('#interpolated-preview').evaluate(c=>({state:c.dataset.previewState,width:c.width,height:c.height})).catch(()=>null);
      const shrunkChip=await page.locator('#preview-shrunk-chip').count()===1&&await page.locator('#preview-shrunk-chip').isVisible();
      await page.screenshot({path:resolve(out,'72-iphone-mov-90fps-'+(f.name.startsWith('直')?'straight':'knuckle')+'.png')});
      await page.locator('#set-release-time').click();
      const marked=/出手 F\d+\.\d/.test(await page.locator('#set-release-time').innerText());
      row.fps90={fineEnabled,preview,shrunkChip,marked,sourceSize:row.video?[row.video.width,row.video.height]:null};
      row.fps90Ok=fineEnabled&&preview?.state==='ready'&&Math.max(preview.width,preview.height)<=1920&&shrunkChip&&marked;
      row.pass=row.pass&&row.mappingOk&&row.fps90Ok;
      await page.screenshot({path:resolve(out,'71-iphone-mov-mark-'+(f.name.startsWith('直')?'straight':'knuckle')+'.png')});
    }else row.pass=false;
    await page.screenshot({path:resolve(out,'70-iphone-mov-'+(f.name.startsWith('直')?'straight':'knuckle')+'.png')});
    row.errors=errors;report.files.push(row);await context.close();
  }
  report.passed=report.files.every(r=>r.pass);
  if(!report.passed)report.note='若 outcome 是 error 且訊息為影像軌／無法播放，代表桌面 Chromium 無法解碼 HEVC；這種情況需 iPhone Safari 實機驗證，不以轉檔版本代替。';
}catch(error){report.failure=String(error?.stack||error);report.passed=false;}
finally{await browser.close();server?.kill();await writeFile(resolve(out,'report-iphone-mov.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,1));
if(!report.passed)process.exitCode=1;
