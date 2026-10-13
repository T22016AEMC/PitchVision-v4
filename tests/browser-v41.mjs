import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const timingEngine=await import(pathToFileURL(resolve('test-results/v41.mjs')).href);
const base=process.env.BASE_URL||'http://127.0.0.1:4174',dir=resolve('test-results',base.includes('127.0.0.1')?'v41-local':'v41-public');await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={base,environment:'Desktop Chrome mobile viewport/touch simulation; not physical phone',cases:[],errors};
const annotations=JSON.parse(await readFile('test-results/v41-manual-selections.json','utf8'));
report.manualSelectionBasis=annotations.basis;
try{
 await page.goto(base,{waitUntil:'networkidle'});await page.locator('#btn-load-demo-video').click();await page.getByText(/原始 V3 ZIP 未附/).waitFor();
 await page.locator('#video-upload-input').setInputFiles({name:'broken.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')});await page.getByText(/影片無法讀取/).first().waitFor();report.errorPaths=true;
 for(const file of ['直球.mp4','彈指曲球.mp4']){
  await page.goto(base,{waitUntil:'networkidle'});await page.locator('#video-upload-input').setInputFiles(resolve('../test videos',file));await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  const item={file};report.cases.push(item);item.timing=await page.locator('#timing-status').innerText();item.metadata=await page.locator('video').first().evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
  // No filename, case label, or known pitch type is supplied as an answer to the analysis engine.
  await page.locator('#pitch-type-select').selectOption('🤖 AI 全數據庫自動辨識');
  await page.getByRole('button',{name:/投手後方平視視角/}).click();
  assert.equal(await page.getByText('超大播放視窗',{exact:true}).count(),0);
  const timing=await timingEngine.readMp4Timing(new Blob([await readFile(resolve('../test videos',file))]));
  await page.waitForTimeout(200);
  const beforeStep=Number(await page.locator('input[aria-label="影片時間軸"]').inputValue());
  await page.getByTitle('前進 1 幀',{exact:true}).click();await page.waitForTimeout(120);
  item.stepTime=await page.locator('video').first().evaluate(v=>v.currentTime);
  const afterStep=Number(await page.locator('input[aria-label="影片時間軸"]').inputValue());assert.equal(afterStep,beforeStep+1);assert.ok(Math.abs(item.stepTime-timing.timestamps[afterStep])<0.005,'PTS seek location');
  await page.getByTitle('後退 1 幀',{exact:true}).click();await page.waitForTimeout(120);assert.equal(Number(await page.locator('input[aria-label="影片時間軸"]').inputValue()),beforeStep);
  const selection=annotations[file];
  const nearest=t=>timing.timestamps.reduce((best,x,i)=>Math.abs(x-t)<Math.abs(timing.timestamps[best]-t)?i:best,0);
  const release=nearest(selection.releaseTime),glove=nearest(selection.gloveTime);
  await page.locator('#manual-controls input[type=number]').nth(0).fill(String(release));await page.locator('#manual-controls input[type=number]').nth(1).fill(String(glove));
  assert.equal(await page.locator('#slider-release-frame').inputValue(),String(release));
  item.manualFrames={release,glove};
  item.selectedTimes={release:timing.timestamps[release],glove:timing.timestamps[glove],flight:timing.timestamps[glove]-timing.timestamps[release]};
  await page.locator('#btn-ai-auto-detect-frames').click();await page.waitForFunction(()=>!document.querySelector('#btn-ai-auto-detect-frames')?.disabled,{},{timeout:180000});
  assert.equal(await page.locator('#slider-release-frame').inputValue(),String(release),'auto must not overwrite manual state');
  item.autoText=(await page.locator('#left-column').innerText()).split('5. 出手')[1]||'';
  await page.locator('#btn-start-analysis').click();await page.waitForFunction(()=>!document.querySelector('#btn-start-analysis')?.disabled,{},{timeout:180000});
  item.mainResults=await page.locator('#right-column').innerText();
  item.cameraGeometry=await page.locator('#camera-geometry-status').textContent();
  await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForTimeout(200);assert.equal(await page.locator('video').first().evaluate(v=>v.paused),false);await page.getByRole('button',{name:'暫停',exact:true}).click();item.playback=true;
  await page.locator('#btn-science-info').click();item.scienceResults=await page.locator('#science-center').innerText();await page.locator('#btn-view-database').click();await page.getByPlaceholder('搜尋球種、代碼或 ID (如: 滑球, SL, #42)...').fill('Knuckle');assert.equal(await page.locator('tbody tr').count(),120);await page.locator('.fixed.inset-0.z-50 button').last().click();
  if(report.cases.length===1){
   await page.locator('#btn-view-database').click();const dbDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下載 JSON (1080 筆)'}).click();assert.equal(JSON.parse(await readFile(await (await dbDownload).path(),'utf8')).length,1080);await page.locator('.fixed.inset-0.z-50 button').last().click();
   await page.locator('#btn-view-code').click();const pyDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下載 app.py',exact:true}).click();assert.ok((await readFile(await (await pyDownload).path(),'utf8')).includes('streamlit'));await page.locator('.fixed.inset-0.z-50 button').last().click();report.scienceDownloads=true;
  }
  await page.locator('#science-center').getByRole('button',{name:'返回分析操作'}).click();
  await page.locator('#tab-dual-track-visualizer').click();await page.locator('#pitch-canvas').waitFor();await page.locator('#btn-view-catcher').click();await page.locator('#btn-view-pitcher-rear').click();await page.locator('#btn-toggle-play').click();await page.locator('#btn-reset-frame').click();
  item.chart=true;
  await page.locator('#left-column').screenshot({path:resolve(dir,file+'-controls.png')});
  item.overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(item.overflow<=1,'page overflow');
  for(const width of [320,430,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'responsive layout');}await page.setViewportSize({width:390,height:844});
  console.log(file,item.timing,item.autoText.slice(0,700));
  const oldUrl=await page.locator('video').first().getAttribute('src');await page.locator('#video-upload-input').setInputFiles(resolve('../test videos',file));await page.waitForFunction(old=>{const v=document.querySelector('video');return v?.readyState>=2&&v.src!==old},oldUrl);item.repeatedUpload=true;
 }
 assert.deepEqual(errors,[]);report.completed=true;
}catch(e){report.failure=e.stack;process.exitCode=1;console.error(e);await page.screenshot({path:resolve(dir,'failure.png'),fullPage:true}).catch(()=>{});}
finally{await writeFile(resolve(dir,'acceptance.json'),JSON.stringify(report,null,2));await browser.close();}
