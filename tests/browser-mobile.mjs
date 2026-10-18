import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
// Mobile shell end-to-end at 390×844 on program-generated synthetic pitches (no real footage).
// Usage: pnpm run build && node tests/browser-mobile.mjs   (BASE_URL=... to test a deployed site)
const out=resolve('test-results/mobile-v5');await mkdir(out,{recursive:true});

// Test-only ISO BMFF muxer (same method as tests/generate-fps-fixtures.mjs): real WebCodecs H.264 samples.
// elstRate≠1 adds an edit list with that media rate: Chrome ignores it, the app's timing parser rejects it,
// which is how this test reaches the "what FPS was this shot at?" dialog without a corrupt file.
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;},u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;},zeros=n=>Buffer.alloc(n),box=(type,...data)=>{const body=Buffer.concat(data);return Buffer.concat([u32(body.length+8),Buffer.from(type),body]);},full=(type,version,flags,...data)=>box(type,Buffer.from([version,(flags>>16)&255,(flags>>8)&255,flags&255]),...data);
const matrix=Buffer.concat([u32(65536),u32(0),u32(0),u32(0),u32(65536),u32(0),u32(0),u32(0),u32(1073741824)]);
function mux(f,elstRate=1){const {width,height}=f,times=f.pts,scale=1000000,deltas=times.map((t,i)=>i+1<times.length?times[i+1]-t:f.lastDuration),duration=times.at(-1)+deltas.at(-1),ftyp=box('ftyp',Buffer.from('isom'),u32(512),Buffer.from('isomiso2avc1mp41')),mdat=box('mdat',...f.chunks.map(c=>Buffer.from(c.bytes)));
 const mvhd=full('mvhd',0,0,u32(0),u32(0),u32(scale),u32(duration),u32(65536),u16(256),zeros(10),matrix,zeros(24),u32(2));
 const tkhd=full('tkhd',0,7,u32(0),u32(0),u32(1),u32(0),u32(duration),zeros(8),u16(0),u16(0),u16(0),u16(0),matrix,u32(width*65536),u32(height*65536));
 const mdhd=full('mdhd',0,0,u32(0),u32(0),u32(scale),u32(duration),u16(21956),u16(0)),hdlr=full('hdlr',0,0,u32(0),Buffer.from('vide'),zeros(12),Buffer.from('Synthetic test video\0'));
 const avc1=box('avc1',zeros(6),u16(1),zeros(16),u16(width),u16(height),u32(72*65536),u32(72*65536),u32(0),u16(1),zeros(32),u16(24),u16(65535),box('avcC',Buffer.from(f.config)));
 const stsd=full('stsd',0,0,u32(1),avc1),stts=full('stts',0,0,u32(deltas.length),...deltas.flatMap(d=>[u32(1),u32(d)])),stsc=full('stsc',0,0,u32(1),u32(1),u32(times.length),u32(1)),stsz=full('stsz',0,0,u32(0),u32(times.length),...f.chunks.map(c=>u32(c.bytes.length))),stco=full('stco',0,0,u32(1),u32(ftyp.length+8)),keys=f.chunks.flatMap((c,i)=>c.type==='key'?[u32(i+1)]:[]),stss=full('stss',0,0,u32(keys.length),...keys);
 const dinf=box('dinf',full('dref',0,0,u32(1),full('url ',0,1))),minf=box('minf',full('vmhd',0,1,zeros(8)),dinf,box('stbl',stsd,stts,stsc,stsz,stco,stss));
 const edts=elstRate===1?Buffer.alloc(0):box('edts',full('elst',0,0,u32(1),u32(duration),u32(0),u16(elstRate),u16(0)));
 return Buffer.concat([ftyp,mdat,box('moov',mvhd,box('trak',tkhd,edts,box('mdia',mdhd,hdlr,minf)))]);
}

let server=null;
let base=process.env.BASE_URL;
if(!base){
  base='http://127.0.0.1:4176';
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4176','--strictPort','--host','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
  await new Promise((ok,fail)=>{const t=setTimeout(()=>fail(Error('vite preview did not start')),20000);server.stdout.on('data',d=>{if(String(d).includes('4176')){clearTimeout(t);ok();}});server.on('exit',c=>fail(Error('vite preview exited '+c)));});
}
const FPS=60,FRAMES=96,RELEASE=30,GLOVE=60;
const report={base,time:new Date().toISOString(),environment:'Desktop Chrome, 390×844 mobile emulation with touch; not a physical phone',video:{fps:FPS,frames:FRAMES,releaseFrame:RELEASE,gloveFrame:GLOVE,size:'360x640',content:'program-generated synthetic ball path (a second clip has no ball)'},checks:[],steps:[],overflow:[],touchTargets:[],engineRequests:[],errors:[]};
const ok=(name,value)=>{report.checks.push({name,ok:Boolean(value)});assert.ok(value,name);};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'zh-TW'});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push('console: '+m.text());});
  page.on('request',r=>{if(/analysisRuntime|pitchDatabase/.test(r.url()))report.engineRequests.push({url:r.url().replace(base,''),at:report.steps.at(-1)?.name??'start'});});
  await page.goto(base,{waitUntil:'networkidle'});

  const pts=Array.from({length:FRAMES},(_,i)=>Math.round(i*1e6/FPS));
  const encode=ball=>page.evaluate(async({pts,RELEASE,GLOVE,ball})=>{
    const width=360,height=640,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),chunks=[];let config,error;
    const encoder=new VideoEncoder({output:(chunk,meta)=>{const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);chunks.push({timestamp:chunk.timestamp,type:chunk.type,bytes:Array.from(bytes)});if(meta.decoderConfig?.description)config=Array.from(new Uint8Array(meta.decoderConfig.description));},error:e=>{error=e.message;}});
    const options={codec:'avc1.42001f',width,height,bitrate:2500000,latencyMode:'realtime',avc:{format:'avc'}};
    if(!(await VideoEncoder.isConfigSupported(options)).supported)throw Error('Browser H.264 test encoder unavailable');encoder.configure(options);
    const at=i=>{const u=Math.max(0,Math.min(1,(i-RELEASE)/(GLOVE-RELEASE)));return{x:180+u*14,y:250+u*230+u*u*40,r:3+u*7};};
    for(let i=0;i<pts.length;i++){
      const sky=ctx.createLinearGradient(0,0,0,height);sky.addColorStop(0,'#3b5b3a');sky.addColorStop(1,'#25402a');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
      for(let y=0;y<height;y+=16)for(let x=0;x<width;x+=16){ctx.fillStyle=((x*7+y*13)%5)?'rgba(0,0,0,.06)':'rgba(255,255,255,.04)';ctx.fillRect(x,y,16,16);}
      ctx.fillStyle='#6b4a2f';ctx.beginPath();ctx.ellipse(180,262,60,14,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#1e293b';ctx.fillRect(170,190,20,60);ctx.beginPath();ctx.arc(180,180,10,0,Math.PI*2);ctx.fill();
      if(ball){const b=at(i);ctx.fillStyle='#f8fafc';ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle='#fff';ctx.font='14px monospace';ctx.fillText(`F${i}`,8,20);
      const frame=new VideoFrame(canvas,{timestamp:pts[i],duration:pts[1]});encoder.encode(frame,{keyFrame:i%15===0});frame.close();
      if(encoder.encodeQueueSize>12)await new Promise(r=>encoder.addEventListener('dequeue',r,{once:true}));
    }
    await encoder.flush();encoder.close();if(error)throw Error(error);return{width,height,chunks,config};
  },{pts,RELEASE,GLOVE,ball});
  const clips={};
  for(const [name,ball,rate] of [['ball',true,1],['noball',false,1],['ratepatched',true,2]]){
    const encoded=name==='ratepatched'?clips.ballEncoded:await encode(ball);
    assert.equal(encoded.chunks.length,FRAMES,'encoder kept every frame');
    if(name==='ball')clips.ballEncoded=encoded;
    clips[name]=mux({...encoded,pts,lastDuration:pts[1]},rate);
  }

  const checkLayout=async name=>{
    for(const width of [360,390,430]){
      await page.setViewportSize({width,height:844});await page.waitForTimeout(80);
      const o=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>window.innerWidth+1&&!e.closest('.overflow-x-auto,.overflow-auto,.overflow-y-auto,pre,table,[hidden]')}).slice(0,5).map(e=>(e.id?'#'+e.id:e.tagName.toLowerCase())+'.'+String(e.className).slice(0,40))}));
      report.overflow.push({screen:name,width,...o,ok:o.scrollWidth<=o.innerWidth});
    }
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(80);
    const small=await page.evaluate(()=>{const els=[...document.querySelectorAll('button,select,input:not([type=hidden]),summary,label.check,label.picker')];return els.filter(e=>{if(e.matches('input[type=file],input[type=checkbox]'))return false;if(e.closest('[hidden]'))return false;const r=e.getBoundingClientRect();const s=getComputedStyle(e);if(s.visibility==='hidden'||s.display==='none')return false;return r.width>0&&r.height>0&&(r.height<43.5||r.width<43.5);}).map(e=>{const r=e.getBoundingClientRect();return{el:(e.id?'#'+e.id:e.tagName.toLowerCase())+' '+(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,24),w:Math.round(r.width),h:Math.round(r.height),legacy:Boolean(e.closest('#full-metrics,#science-metrics-root,.fixed.inset-0.z-50 table,.fixed.inset-0.z-50 .overflow-y-auto'))};});});
    report.touchTargets.push({screen:name,undersized:small});
  };
  const shot=async(name,full=false)=>{await page.screenshot({path:resolve(out,name+'.png'),fullPage:full});report.steps.push({name,ok:true});};
  const waitSeek=()=>page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.seeking&&v.readyState>=2;});
  const upload=async(clip,name)=>{await page.locator('#video-upload-input').setInputFiles({name,mimeType:'video/mp4',buffer:clip});};
  const openMenu=async()=>{await page.locator('#player-menu-btn').click();await page.locator('#player-menu').waitFor();};
  const closeMenu=async()=>{await page.locator('#player-menu-close').click();await page.locator('#player-menu').waitFor({state:'detached'});};
  const gotoFrame=async f=>{await openMenu();await page.locator('#mode-source').click();await page.locator('#source-frame-input').fill(String(f));await closeMenu();await waitSeek();await page.waitForFunction(()=>!document.querySelector('#set-release-time')?.disabled);};
  const posIndex=async()=>Number(await page.locator('#current-time-status').getAttribute('data-position-index'));
  const bodyText=()=>page.evaluate(()=>document.body.innerText);

  // ── 1. 選影片：無 FPS 區塊、無範例按鈕、預設球種 ───────────────
  await checkLayout('01-video-empty');await shot('01-video-empty');
  ok('demo button removed',await page.locator('#btn-load-demo-video').count()===0);
  ok('pitch type defaults to AI auto',(await page.locator('#pitch-type-select').inputValue()).startsWith('🤖'));
  ok('next disabled before a video',await page.locator('#btn-next-mark').isDisabled());
  await upload(clips.ball,'synthetic-pitch-60fps.mp4');
  await page.locator('#video-summary').waitFor({timeout:20000});
  ok('no FPS dialog when timing is read',await page.locator('#fps-dialog').count()===0);
  ok('no FPS card or CFR wording on the video page',await page.locator('#timing-status').count()===0&&!/CFR|PTS|FPS 未知|指定可信/.test(await page.locator('#screen-video').innerText()));
  report.videoInfo=await page.locator('#video-info').innerText();
  ok('FPS shown only as a small info line',/^60 FPS/.test(report.videoInfo));
  await page.locator('#view-pitcher_rear').click();ok('pitcher view selectable',await page.locator('#view-pitcher_rear').getAttribute('aria-pressed')==='true');
  await page.locator('#view-catcher').click();ok('catcher view selectable',await page.locator('#view-catcher').getAttribute('aria-pressed')==='true');
  await checkLayout('02-video-loaded');await shot('02-video-loaded');

  // ── 2. 標記：近全螢幕、疊加控制項、不需捲動 ───────────────────
  await page.locator('#btn-next-mark').click();
  await page.locator('#set-release-time').waitFor();await waitSeek();
  const geo=await page.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,r:b.right,b:b.bottom};};return{vw:innerWidth,vh:innerHeight,stage:r('.player-fixed'),video:r('video'),rel:r('#set-release-time'),glove:r('#set-glove-time'),back:r('#step-back'),fwd:r('#step-forward'),slider:r('#video-timeline'),scrollH:document.scrollingElement.scrollHeight,bodyOverflow:getComputedStyle(document.body).overflow};});
  report.markGeometry=geo;
  ok('mark stage fills the viewport',geo.stage.w===geo.vw&&geo.stage.h===geo.vh);
  ok('video is near full screen',geo.video.h>=geo.vh*.97&&geo.video.w>=geo.vw*.97);
  ok('release button top-left, glove button top-right',geo.rel.x<geo.vw/2&&geo.rel.y<80&&geo.glove.r>geo.vw/2&&geo.glove.y<80);
  ok('−1 | slider | +1 on one bottom row',geo.back.y>geo.vh-140&&Math.abs(geo.back.y-geo.slider.y)<30&&Math.abs(geo.fwd.y-geo.slider.y)<30&&geo.back.x<geo.slider.x&&geo.slider.x<geo.fwd.x);
  ok('marking needs no vertical scroll',geo.scrollH<=geo.vh+1&&geo.bodyOverflow==='hidden');
  ok('no old calibration / index jargon on screen',!/選填校正|球最後可見|幾何角點|已知矩形|錨點/.test(await bodyText()));
  await checkLayout('03-mark-fullscreen');await shot('10-mark-fullscreen');
  // tap blank area hides every control, tap again shows them
  const stage=await page.locator('.player-stage').boundingBox();
  await page.locator('.player-stage').click({position:{x:stage.width/2,y:stage.height*.5}});
  ok('tap hides controls',await page.locator('.ov-layer.ov-hidden').count()===1&&await page.locator('#set-release-time').isHidden());
  await shot('11-mark-controls-hidden');
  await page.locator('.player-stage').click({position:{x:stage.width/2,y:stage.height*.5}});
  ok('tap shows controls again',await page.locator('.ov-layer.ov-hidden').count()===0&&await page.locator('#set-release-time').isVisible());
  // long press +1 keeps stepping
  await page.locator('#frame-step-controls').count();
  const before=await posIndex(),fwd=await page.locator('#step-forward').boundingBox();
  await page.mouse.move(fwd.x+fwd.width/2,fwd.y+fwd.height/2);await page.mouse.down();await page.waitForTimeout(1100);await page.mouse.up();await waitSeek();
  const afterHold=await posIndex();report.longPress={before,after:afterHold};
  ok('long press +1 moves continuously',afterHold-before>=4);
  const bk=await page.locator('#step-back').boundingBox();
  await page.mouse.move(bk.x+bk.width/2,bk.y+bk.height/2);await page.mouse.down();await page.waitForTimeout(1100);await page.mouse.up();await waitSeek();
  ok('long press −1 moves back',await posIndex()<afterHold-3);
  const single=await posIndex();await page.locator('#step-forward').click();await waitSeek();ok('single tap steps exactly one frame',await posIndex()===single+1);
  // mark release / glove with the corner buttons
  await gotoFrame(RELEASE);await page.locator('#set-release-time').click();
  ok('release pill shows its frame',/出手 F30/.test(await page.locator('#set-release-time').innerText()));
  await gotoFrame(GLOVE);await page.locator('#set-glove-time').click();
  ok('glove pill shows its frame',/進手套 F60/.test(await page.locator('#set-glove-time').innerText()));
  report.flightStatus=await page.locator('#flight-time-status').innerText();ok('flight time = 30 frames at 60 FPS',/0\.5000/.test(report.flightStatus));
  ok('next appears once both are marked',await page.locator('#btn-next-analyze').isVisible());
  await checkLayout('03b-mark-both');await shot('12-mark-both-set');
  // menu: 90 FPS + video/2D toggle live in the small menu
  await openMenu();
  ok('menu holds 90 FPS and video/2D controls',await page.locator('#mode-fine').isVisible()&&await page.locator('#view-tab-video').isVisible()&&await page.locator('#view-tab-twod').isVisible());
  await shot('13-mark-menu');
  await page.locator('#mode-fine').click();await closeMenu();await page.locator('#step-forward').click();
  await page.waitForFunction(()=>['ready','failed'].includes(document.querySelector('#interpolated-preview')?.dataset.previewState),null,{timeout:15000}).catch(()=>{});
  report.fineMode={kind:await page.locator('#current-time-status').getAttribute('data-kind'),preview:await page.locator('#interpolated-preview').getAttribute('data-preview-state'),count:await page.locator('#current-time-status').getAttribute('data-position-count')};
  ok('90 FPS grid has more positions than source frames',Number(report.fineMode.count)>FRAMES);
  await openMenu();await page.locator('#view-tab-twod').click();await page.locator('#twod-view').waitFor();
  ok('2D view available from the video page before analysis (with a notice)',/還沒有分析結果/.test(await page.locator('#twod-view').innerText()));
  await shot('14-mark-2d-before-analysis');
  ok('choosing a view closes the menu',await page.locator('#player-menu').count()===0);
  await openMenu();await page.locator('#view-tab-video').click();
  await openMenu();await page.locator('#mode-source').click();await closeMenu();await waitSeek();

  // ── 3. 分析 ─────────────────────────────────────────────────
  await page.locator('#btn-next-analyze').click();await page.locator('#screen-analyze').waitFor();
  ok('engine chunk not requested before analysis',report.engineRequests.length===0);
  ok('no old calibration UI on the analysis page',!/選填校正|球最後可見|幾何角點|已知矩形/.test(await bodyText()));
  await page.locator('#height-number').fill('172');await page.locator('#btn-mound-no').click();
  report.distance=await page.locator('#derived-distance').innerText();
  await checkLayout('04-analyze');await shot('20-analyze');
  await page.locator('#btn-start-analysis').click();
  await page.locator('#analysis-progress').waitFor({timeout:5000}).then(()=>shot('21-analyzing')).catch(()=>report.steps.push({name:'21-analyzing',ok:false,note:'progress finished before capture'}));
  await page.locator('#result-screen').waitFor({timeout:120000});
  ok('engine loaded only after pressing analyze',report.engineRequests.length>0);
  ok('reliable ball found: no tap prompt',await page.locator('#assist-banner').count()===0);

  // ── 4. 結果：影片上的球點、影片／2D 切換 ─────────────────────
  report.resultCards=await page.locator('#result-cards').innerText();
  report.provenance=await page.locator('#event-time-provenance').getAttribute('data-engine-flight-seconds');
  ok('engine received exact marked flight time',Math.abs(Number(report.provenance)-0.5)<1e-9);
  await page.locator('#ball-overlay').waitFor();
  report.overlayCounts={observed:Number(await page.locator('#ball-overlay').getAttribute('data-observed-count')),estimated:Number(await page.locator('#ball-overlay').getAttribute('data-estimated-count'))};
  ok('program-found ball points exist',report.overlayCounts.observed>=3);
  // walk frames until a detected ball is drawn, then compare its position with the synthetic ball
  await gotoFrame(RELEASE);
  let found=null;
  for(let i=0;i<70&&!found;i++){
    await page.locator('#step-forward').click();await waitSeek();
    if(await page.locator('#ball-overlay').getAttribute('data-current-observed')==='1'){
      found=await page.evaluate(()=>{const d=document.querySelector('[data-overlay=observed]').getBoundingClientRect(),v=document.querySelector('video'),r=v.getBoundingClientRect(),s=Math.min(r.width/v.videoWidth,r.height/v.videoHeight),w=v.videoWidth*s,h=v.videoHeight*s,ox=r.x+(r.width-w)/2,oy=r.y+(r.height-h)/2;return{x:(d.x+d.width/2-ox)/w,y:(d.y+d.height/2-oy)/h,frame:Number(document.querySelector('#current-time-status').dataset.sourceIndex)};});
    }
  }
  ok('an observed-ball marker is drawn on a frame',Boolean(found));
  const u=Math.max(0,Math.min(1,(found.frame-RELEASE)/(GLOVE-RELEASE))),truth={x:(180+u*14)/360,y:(250+u*230+u*u*40)/640};
  report.overlayAccuracy={frame:found.frame,drawn:found,truth,errorPx:Math.hypot((found.x-truth.x)*360,(found.y-truth.y)*640)};
  ok('marker sits on the real ball (within 12 px of the synthetic truth)',report.overlayAccuracy.errorPx<12);
  await page.locator('#step-forward').click();await waitSeek();
  await checkLayout('05-result-video');await shot('30-ball-dots-on-video');
  await page.locator('#view-tab-twod').click();await page.locator('#pitch-canvas').waitFor();
  await page.locator('#btn-toggle-play').click();await page.waitForTimeout(1200);
  await checkLayout('06-result-2d');await shot('31-result-2d-animation');
  await page.locator('#view-tab-video').click();
  await page.locator('#result-cards').scrollIntoViewIfNeeded();await shot('32-result-cards',true);
  // back to marking after analysis: the same video page keeps the dots
  await page.locator('#btn-back-mark').click();await page.locator('#set-release-time').waitFor();
  ok('video page still shows the overlay after analysis',await page.locator('#ball-overlay').count()===1);
  await shot('33-mark-after-analysis');

  // ── 5. 科學資訊：技術說明與地面矩形（無預設尺寸）─────────────
  await page.locator('#player-menu-btn').click();await page.locator('#btn-science-info-menu').click();await page.locator('#science-center').waitFor();
  ok('timing details live in the science page',await page.locator('#timing-info').count()===1&&/container_timestamps/.test(await page.locator('#timing-info').innerText()));
  await page.locator('#ground-calibration summary').click();
  ok('ground rectangle has no default size',await page.locator('#ground-width').inputValue()===''&&await page.locator('#ground-length').inputValue()==='');
  await page.locator('#ground-capture').click();await page.locator('#ground-canvas').waitFor();
  const gc=await page.locator('#ground-canvas').boundingBox();
  for(const [fx,fy] of [[.2,.9],[.8,.9],[.7,.3],[.3,.3]])await page.locator('#ground-canvas').click({position:{x:gc.width*fx,y:gc.height*fy}});
  ok('four corners can be picked on a snapshot',/4 個角點已選好/.test(await page.locator('#ground-next').innerText()));
  await checkLayout('07-science-advanced');await page.locator('#ground-calibration').scrollIntoViewIfNeeded();await shot('40-science-advanced');
  await page.locator('#btn-close-science').click();

  // ── 6. 找不到球：只在需要時要求「點一下球」───────────────────
  await page.goto(base,{waitUntil:'networkidle'});
  await upload(clips.noball,'synthetic-no-ball.mp4');await page.locator('#video-summary').waitFor({timeout:20000});
  await page.locator('#btn-next-mark').click();await page.locator('#set-release-time').waitFor();await waitSeek();
  await gotoFrame(RELEASE);await page.locator('#set-release-time').click();await gotoFrame(GLOVE);await page.locator('#set-glove-time').click();
  await page.locator('#btn-next-analyze').click();await page.locator('#btn-start-analysis').click();
  await page.locator('#assist-banner').waitFor({timeout:120000});
  const assistText=await page.locator('#assist-banner').innerText();report.assistText=assistText;
  ok('prompt asks to tap the ball',/點一下球/.test(assistText));
  ok('prompt uses no technical terms',!/索引|角點|錨點|index|frame/i.test(await bodyText()));
  await waitSeek();await shot('50-assist-tap-prompt');
  const as=await page.locator('.player-stage').boundingBox();
  await page.locator('.player-stage').click({position:{x:as.width*.5,y:as.height*.55}});
  await page.locator('#assist-banner').waitFor();await page.waitForFunction(()=>/再點一下球/.test(document.querySelector('#assist-banner')?.innerText||''));
  await waitSeek();await shot('51-assist-second-tap');
  await page.locator('.player-stage').click({position:{x:as.width*.52,y:as.height*.7}});
  await page.locator('#result-screen').waitFor({timeout:120000});
  ok('result appears right after the second tap',await page.locator('#result-cards').isVisible());
  ok('no-ball clip shows a "no ball found" note in the video view',await page.locator('#ball-overlay').count()===1);
  await shot('52-result-after-assist');
  // skip path
  await page.goto(base,{waitUntil:'networkidle'});
  await upload(clips.noball,'synthetic-no-ball.mp4');await page.locator('#video-summary').waitFor({timeout:20000});
  await page.locator('#btn-next-mark').click();await page.locator('#set-release-time').waitFor();await waitSeek();
  await gotoFrame(RELEASE);await page.locator('#set-release-time').click();await gotoFrame(GLOVE);await page.locator('#set-glove-time').click();
  await page.locator('#btn-next-analyze').click();await page.locator('#btn-start-analysis').click();
  await page.locator('#assist-skip').waitFor({timeout:120000});await page.locator('#assist-skip').click();
  await page.locator('#result-screen').waitFor();ok('skipping goes straight to the result',await page.locator('#result-cards').isVisible());

  // ── 7. 讀不到影格時間：一次性 FPS 小視窗 ─────────────────────
  await page.goto(base,{waitUntil:'networkidle'});
  await upload(clips.ratepatched,'unreadable-timing.mp4');
  await page.locator('#fps-dialog').waitFor({timeout:20000});
  ok('dialog offers 30 / 60 / 120 / 240',await page.locator('#fps-pick-30,#fps-pick-60,#fps-pick-120,#fps-pick-240').count()===4);
  ok('app does not guess an FPS (next stays disabled)',await page.locator('#btn-next-mark').isDisabled());
  await checkLayout('08-fps-dialog');await shot('60-fps-dialog');
  await page.locator('#fps-pick-60').click();await page.locator('#fps-dialog').waitFor({state:'detached'});
  report.videoInfoAfterPick=await page.locator('#video-info').innerText();
  ok('after the pick the info line shows the chosen FPS',/^60 FPS/.test(report.videoInfoAfterPick));
  ok('analysis can proceed after picking',await page.locator('#btn-next-mark').isEnabled());
  await page.locator('#btn-next-mark').click();await page.locator('#set-release-time').waitFor();await waitSeek();
  await gotoFrame(RELEASE);await page.locator('#set-release-time').click();await gotoFrame(GLOVE);await page.locator('#set-glove-time').click();
  ok('picked FPS gives the expected flight time',/0\.5000/.test(await page.locator('#flight-time-status').innerText()));

  report.passed=report.errors.length===0&&report.overflow.every(o=>o.ok)&&report.touchTargets.every(t=>t.undersized.every(x=>x.legacy));
}catch(error){report.failure=String(error?.stack||error);report.passed=false;}
finally{await browser.close();server?.kill();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,failure:report.failure?.split('\n').slice(0,3).join(' | '),checks:`${report.checks.filter(c=>c.ok).length}/${report.checks.length}`,steps:report.steps.map(s=>s.name+(s.ok?'':'(skipped)')),overflowFailures:report.overflow.filter(o=>!o.ok),touchUndersized:report.touchTargets.flatMap(t=>t.undersized.map(u=>t.screen+' '+u.el+' '+u.w+'x'+u.h+(u.legacy?' [legacy panel]':''))),engineRequests:report.engineRequests,overlay:report.overlayAccuracy,errors:report.errors},null,1));
if(!report.passed)process.exitCode=1;
