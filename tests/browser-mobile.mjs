import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
// Mobile shell end-to-end on a program-generated synthetic pitch (no real footage).
// Usage: pnpm run build && node tests/browser-mobile.mjs   (BASE_URL=... to test a deployed site)
const out=resolve('test-results/mobile-v5');await mkdir(out,{recursive:true});

// Test-only ISO BMFF muxer (same method as tests/generate-fps-fixtures.mjs): real WebCodecs H.264 samples.
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;},u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;},zeros=n=>Buffer.alloc(n),box=(type,...data)=>{const body=Buffer.concat(data);return Buffer.concat([u32(body.length+8),Buffer.from(type),body]);},full=(type,version,flags,...data)=>box(type,Buffer.from([version,(flags>>16)&255,(flags>>8)&255,flags&255]),...data);
const matrix=Buffer.concat([u32(65536),u32(0),u32(0),u32(0),u32(65536),u32(0),u32(0),u32(0),u32(1073741824)]);
function mux(f){const {width,height}=f,times=f.pts,scale=1000000,deltas=times.map((t,i)=>i+1<times.length?times[i+1]-t:f.lastDuration),duration=times.at(-1)+deltas.at(-1),ftyp=box('ftyp',Buffer.from('isom'),u32(512),Buffer.from('isomiso2avc1mp41')),mdat=box('mdat',...f.chunks.map(c=>Buffer.from(c.bytes)));
 const mvhd=full('mvhd',0,0,u32(0),u32(0),u32(scale),u32(duration),u32(65536),u16(256),zeros(10),matrix,zeros(24),u32(2));
 const tkhd=full('tkhd',0,7,u32(0),u32(0),u32(1),u32(0),u32(duration),zeros(8),u16(0),u16(0),u16(0),u16(0),matrix,u32(width*65536),u32(height*65536));
 const mdhd=full('mdhd',0,0,u32(0),u32(0),u32(scale),u32(duration),u16(21956),u16(0)),hdlr=full('hdlr',0,0,u32(0),Buffer.from('vide'),zeros(12),Buffer.from('Synthetic test video\0'));
 const avc1=box('avc1',zeros(6),u16(1),zeros(16),u16(width),u16(height),u32(72*65536),u32(72*65536),u32(0),u16(1),zeros(32),u16(24),u16(65535),box('avcC',Buffer.from(f.config)));
 const stsd=full('stsd',0,0,u32(1),avc1),stts=full('stts',0,0,u32(deltas.length),...deltas.flatMap(d=>[u32(1),u32(d)])),stsc=full('stsc',0,0,u32(1),u32(1),u32(times.length),u32(1)),stsz=full('stsz',0,0,u32(0),u32(times.length),...f.chunks.map(c=>u32(c.bytes.length))),stco=full('stco',0,0,u32(1),u32(ftyp.length+8)),keys=f.chunks.flatMap((c,i)=>c.type==='key'?[u32(i+1)]:[]),stss=full('stss',0,0,u32(keys.length),...keys);
 const dinf=box('dinf',full('dref',0,0,u32(1),full('url ',0,1))),minf=box('minf',full('vmhd',0,1,zeros(8)),dinf,box('stbl',stsd,stts,stsc,stsz,stco,stss));return Buffer.concat([ftyp,mdat,box('moov',mvhd,box('trak',tkhd,box('mdia',mdhd,hdlr,minf)))]);
}

let server=null;
let base=process.env.BASE_URL;
if(!base){
  base='http://127.0.0.1:4176';
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4176','--strictPort','--host','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
  await new Promise((ok,fail)=>{const t=setTimeout(()=>fail(Error('vite preview did not start')),20000);server.stdout.on('data',d=>{if(String(d).includes('4176')){clearTimeout(t);ok();}});server.on('exit',c=>fail(Error('vite preview exited '+c)));});
}
const FPS=60,FRAMES=96,RELEASE=30,GLOVE=60;
const report={base,time:new Date().toISOString(),environment:'Desktop Chrome, 390×844 mobile emulation with touch; not a physical phone',video:{fps:FPS,frames:FRAMES,releaseFrame:RELEASE,gloveFrame:GLOVE,size:'360x640',content:'program-generated synthetic ball path'},steps:[],overflow:[],touchTargets:[],engineRequests:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'zh-TW'});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push('console: '+m.text());});
  page.on('request',r=>{if(/analysisRuntime|pitchDatabase/.test(r.url()))report.engineRequests.push({url:r.url().replace(base,''),at:report.steps.at(-1)?.name??'start'});});
  await page.goto(base,{waitUntil:'networkidle'});

  // Synthetic portrait 60 FPS clip: textured background, ball held, released at frame 30, caught at frame 60.
  const pts=Array.from({length:FRAMES},(_,i)=>Math.round(i*1e6/FPS));
  const encoded=await page.evaluate(async({pts,RELEASE,GLOVE})=>{
    const width=360,height=640,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),chunks=[];let config,error;
    const encoder=new VideoEncoder({output:(chunk,meta)=>{const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);chunks.push({timestamp:chunk.timestamp,type:chunk.type,bytes:Array.from(bytes)});if(meta.decoderConfig?.description)config=Array.from(new Uint8Array(meta.decoderConfig.description));},error:e=>{error=e.message;}});
    const options={codec:'avc1.42001f',width,height,bitrate:2500000,latencyMode:'realtime',avc:{format:'avc'}};
    if(!(await VideoEncoder.isConfigSupported(options)).supported)throw Error('Browser H.264 test encoder unavailable');encoder.configure(options);
    const ball=i=>{const u=Math.max(0,Math.min(1,(i-RELEASE)/(GLOVE-RELEASE)));return{x:180+u*14,y:250+u*230+u*u*40,r:3+u*7};};
    for(let i=0;i<pts.length;i++){
      const sky=ctx.createLinearGradient(0,0,0,height);sky.addColorStop(0,'#3b5b3a');sky.addColorStop(1,'#25402a');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
      for(let y=0;y<height;y+=16)for(let x=0;x<width;x+=16){ctx.fillStyle=((x*7+y*13)%5)?'rgba(0,0,0,.06)':'rgba(255,255,255,.04)';ctx.fillRect(x,y,16,16);}
      ctx.fillStyle='#6b4a2f';ctx.beginPath();ctx.ellipse(180,262,60,14,0,0,Math.PI*2);ctx.fill(); // mound
      ctx.fillStyle='#1e293b';ctx.fillRect(170,190,20,60);ctx.beginPath();ctx.arc(180,180,10,0,Math.PI*2);ctx.fill(); // pitcher
      const b=ball(i);ctx.fillStyle='#f8fafc';ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='14px monospace';ctx.fillText(`F${i}`,8,20);
      const frame=new VideoFrame(canvas,{timestamp:pts[i],duration:pts[1]});encoder.encode(frame,{keyFrame:i%15===0});frame.close();
      if(encoder.encodeQueueSize>12)await new Promise(r=>encoder.addEventListener('dequeue',r,{once:true}));
    }
    await encoder.flush();encoder.close();if(error)throw Error(error);return{width,height,chunks,config};
  },{pts,RELEASE,GLOVE});
  assert.equal(encoded.chunks.length,FRAMES,'encoder kept every frame');
  const mp4=mux({...encoded,pts,lastDuration:pts[1]});

  const checkLayout=async name=>{
    for(const width of [360,390,430]){
      await page.setViewportSize({width,height:844});await page.waitForTimeout(80);
      const o=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>window.innerWidth+1&&!e.closest('.overflow-x-auto,.overflow-auto,.overflow-y-auto,pre,table')}).slice(0,5).map(e=>(e.id?'#'+e.id:e.tagName.toLowerCase())+'.'+String(e.className).slice(0,40))}));
      report.overflow.push({screen:name,width,...o,ok:o.scrollWidth<=o.innerWidth});
    }
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(80);
    const small=await page.evaluate(()=>{const els=[...document.querySelectorAll('button,select,input:not([type=hidden]),summary,label.check,label.picker')];return els.filter(e=>{if(e.matches('input[type=file],input[type=checkbox]'))return false;const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(r.height<43.5||r.width<43.5);}).map(e=>{const r=e.getBoundingClientRect();return{el:(e.id?'#'+e.id:e.tagName.toLowerCase())+' '+(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,24),w:Math.round(r.width),h:Math.round(r.height),legacy:Boolean(e.closest('#full-metrics,#science-metrics-root,.fixed.inset-0.z-50'))};});});
    report.touchTargets.push({screen:name,undersized:small});
  };
  const shot=async(name,full=true)=>{await page.screenshot({path:resolve(out,name+'.png'),fullPage:full});report.steps.push({name,ok:true});};

  // 1. 選影片
  await checkLayout('01-video-empty');await shot('01-video-empty');
  assert.equal(await page.locator('#btn-next-mark').isDisabled(),true);
  await page.locator('#video-upload-input').setInputFiles({name:'synthetic-pitch-60fps.mp4',mimeType:'video/mp4',buffer:mp4});
  await page.locator('#video-summary').waitFor({timeout:20000});
  await page.locator('#view-pitcher_rear').click();assert.equal(await page.locator('#view-pitcher_rear').getAttribute('aria-pressed'),'true');
  await page.locator('#view-catcher').click();assert.equal(await page.locator('#view-catcher').getAttribute('aria-pressed'),'true');
  report.timingStatus=(await page.locator('#timing-status').innerText()).split('\n')[0];
  await checkLayout('02-video-loaded');await shot('02-video-loaded');

  // 2. 標記
  await page.locator('#btn-next-mark').click();
  await page.locator('#manual-controls').waitFor();
  const waitSeek=()=>page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.seeking&&v.readyState>=2;});
  const gotoFrame=async f=>{await page.locator('#mode-source').click();await page.locator('#source-frame-input').fill(String(f));await waitSeek();await page.waitForFunction(()=>!document.querySelector('#set-release-time').disabled);};
  await gotoFrame(RELEASE);await page.locator('#set-release-time').click();
  await gotoFrame(GLOVE);await page.locator('#set-glove-time').click();
  report.flightStatus=await page.locator('#flight-time-status').innerText();
  assert.match(report.flightStatus,/0\.5000/,'flight time = 30 frames at 60 FPS');
  await checkLayout('03-mark');await shot('03-mark');
  // 90 FPS fine grid (interpolation as selection aid only)
  await page.locator('#mode-fine').click();await page.locator('#frame-step-controls button').nth(2).click();
  await page.waitForFunction(()=>['ready','failed'].includes(document.querySelector('#interpolated-preview')?.dataset.previewState),null,{timeout:15000}).catch(()=>{});
  report.fineMode={kind:await page.locator('#current-time-status').getAttribute('data-kind'),preview:await page.locator('#interpolated-preview').getAttribute('data-preview-state'),count:await page.locator('#current-time-status').getAttribute('data-position-count')};
  await shot('03b-mark-90fps',false);
  await page.locator('#mode-source').click();await waitSeek();
  // Manual anchor (optional calibration)
  await page.locator('#calibration-panel summary').click();
  await page.locator('#mark-position-1').click();
  const stage=await page.locator('.player-stage').boundingBox();await page.locator('.player-stage').click({position:{x:stage.width/2,y:stage.height*.45}});
  report.anchorText=await page.locator('#calibration-panel').innerText().then(t=>t.match(/位置1[^/]*/)?.[0]?.trim());
  assert.match(report.anchorText,/位置1 F\d+/,'manual anchor stored');
  await checkLayout('03c-mark-calibration');await shot('03c-mark-calibration');

  // 3. 分析
  await page.locator('#btn-next-analyze').click();
  await page.locator('#screen-analyze').waitFor();
  assert.equal(report.engineRequests.length,0,'engine chunk not requested before analysis');
  await page.locator('#height-number').fill('172');await page.locator('#btn-mound-no').click();
  report.distance=await page.locator('#derived-distance').innerText();
  await checkLayout('04-analyze');await shot('04-analyze');
  await page.locator('#btn-start-analysis').click();
  await page.locator('#analysis-progress').waitFor({timeout:5000}).then(()=>shot('05-analyzing',false)).catch(()=>report.steps.push({name:'05-analyzing',ok:false,note:'progress finished before capture'}));
  await page.locator('#result-screen').waitFor({timeout:120000});
  report.engineLoadedAfterClick=report.engineRequests.length>0;

  // 4. 結果
  report.resultCards=await page.locator('#result-cards').innerText();
  report.provenance=await page.locator('#event-time-provenance').getAttribute('data-engine-flight-seconds');
  assert.ok(Math.abs(Number(report.provenance)-0.5)<1e-9,'engine received exact marked flight time');
  await checkLayout('06-result');await shot('06-result');
  await page.locator('#btn-toggle-play').click();await page.waitForTimeout(1400);
  await page.locator('#pitch-visualizer-container').screenshot({path:resolve(out,'07-animation.png')});report.steps.push({name:'07-animation',ok:true});
  await page.locator('#full-metrics summary').click();await checkLayout('06b-result-details');
  await page.locator('#btn-science-info').click();await page.locator('#science-center').waitFor();
  await checkLayout('08-science');await shot('08-science',false);
  await page.locator('#btn-view-database').click();await page.locator('.fixed.inset-0.z-50 table').waitFor({timeout:30000});
  await checkLayout('09-database');await shot('09-database',false);
  report.passed=report.errors.length===0&&report.overflow.every(o=>o.ok)&&report.touchTargets.every(t=>t.undersized.every(u=>u.legacy));
}catch(error){report.failure=String(error?.stack||error);report.passed=false;}
finally{await browser.close();server?.kill();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,failure:report.failure?.split('\n')[0],steps:report.steps.map(s=>s.name+(s.ok?'':'(skipped)')),overflowFailures:report.overflow.filter(o=>!o.ok),touchUndersized:report.touchTargets.flatMap(t=>t.undersized.map(u=>t.screen+' '+u.el+' '+u.w+'x'+u.h+(u.legacy?' [legacy panel]':''))),engineRequests:report.engineRequests,errors:report.errors},null,1));
if(!report.passed)process.exitCode=1;
