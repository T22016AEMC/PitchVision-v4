import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const base=process.env.BASE_URL || 'http://127.0.0.1:4173';
const reportDir=resolve('test-results',base.includes('127.0.0.1')?'local':'public');
await mkdir(reportDir,{recursive:true});
const options=process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {channel:'chrome'};
const browser=await chromium.launch({...options,headless:true});
const report={url:base,time:new Date().toISOString(),environment:'Desktop Chrome with mobile viewport/touch emulation; NOT a physical phone',scenarios:[],checks:[]};
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function checkLayout(label) {
  const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(size.scroll<=size.viewport+1,`${label}: overflow ${JSON.stringify(size)}`);
  report.checks.push({name:label,...size,passed:true});
}
try {
  await page.goto(base,{waitUntil:'networkidle'});
  for (const width of [320,390,430,768,1440]) {
    await page.setViewportSize({width,height:844});await checkLayout(`home-${width}`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#btn-view-database').click();
  await checkLayout('database-modal');
  const search=page.getByPlaceholder('搜尋球種、代碼或 ID (如: 滑球, SL, #42)...');
  await search.fill('Fastball');
  assert.ok(await page.locator('tbody tr').count()>0);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'下載 JSON (1080 筆)'}).click();
  const file=await download;const data=JSON.parse(await readFile(await file.path(),'utf8'));assert.equal(data.length,1080);
  report.checks.push({name:'database-search-download',passed:true});
  await page.screenshot({path:resolve(reportDir,'database-mobile.png')});
  await page.locator('.fixed.inset-0.z-50 button').last().click();
  await page.locator('#btn-view-code').click();
  assert.ok((await page.locator('pre').innerText()).includes('def main'));
  await checkLayout('python-modal');
  const pyDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下載 app.py'}).click();await pyDownload;
  await page.locator('.fixed.inset-0.z-50 button').last().click();
  report.checks.push({name:'python-source-view-download',passed:true});
  await page.locator('#btn-load-demo-video').click();
  await page.getByText(/原始 V3 ZIP 未附/).waitFor();
  report.checks.push({name:'missing-original-demo-honest-error',passed:true});
  await page.locator('#video-upload-input').setInputFiles({name:'broken.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')});
  await page.getByText(/影片無法讀取/).first().waitFor();
  report.checks.push({name:'corrupt-video-error',passed:true});
  for (const [fileName,pitch] of [['直球.mp4','四縫線直球 (Fastball)'],['彈指曲球.mp4','彈指曲球 (Knuckle Curve)']]) {
    await page.goto(base,{waitUntil:'networkidle'});
    const item={fileName,pitch,errors:[]};report.scenarios.push(item);
    console.log('Starting',base,fileName);
    await page.locator('#video-upload-input').setInputFiles(resolve(process.env.TEST_VIDEO_DIR || '../test videos',fileName));
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
    await page.locator('#btn-ai-auto-detect-frames').waitFor();
    await page.locator('#pitch-type-select').selectOption(pitch);
    item.metadata=await page.locator('video').first().evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,readyState:v.readyState}));
    // Source files are fed through the ordinary upload control, never served or committed.
    await page.getByRole('button',{name:'播放',exact:true}).click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('video').first().evaluate(v=>v.paused),false);
    await page.getByRole('button',{name:'暫停',exact:true}).click();
    await checkLayout(`${fileName}-preview`);
    const started=Date.now();
    await page.locator('#btn-ai-auto-detect-frames').click();
    await page.waitForFunction(()=>!document.querySelector('#btn-ai-auto-detect-frames')?.disabled,{},{timeout:180000});
    item.autoDurationMs=Date.now()-started;
    item.autoFrames={release:await page.locator('#slider-release-frame').inputValue(),glove:await page.locator('#slider-glove-frame').inputValue()};
    item.autoDetectionText=await page.locator('#left-column').innerText();
    console.log('Auto completed',fileName,item.autoFrames,item.autoDurationMs);
    await page.locator('#btn-start-analysis').click();
    await page.waitForFunction(()=>!document.querySelector('#btn-start-analysis')?.disabled,{},{timeout:180000});
    await page.locator('#right-column').getByText('等待上傳影片並自定義影格後啟動數據庫比對').waitFor({state:'hidden'});
    item.resultsText=await page.locator('#right-column').innerText();
    await checkLayout(`${fileName}-results`);
    await page.locator('#right-column').screenshot({path:resolve(reportDir,`${fileName}-results.png`)});
    await page.locator('#tab-dual-track-visualizer').click();
    await page.locator('#pitch-canvas').waitFor();
    await page.locator('#btn-view-pitcher-rear').click();
    await page.locator('#btn-view-catcher').click();
    await page.locator('#toggle-video-track').click();
    await page.locator('#toggle-model-track').click();
    await page.locator('#btn-toggle-play').click();
    await page.waitForTimeout(200);
    await page.locator('#btn-reset-frame').click();
    await checkLayout(`${fileName}-chart`);
    await page.locator('#pitch-visualizer-container').screenshot({path:resolve(reportDir,`${fileName}-chart.png`)});
    const prior=Number(await page.locator('#slider-release-frame').inputValue());
    await page.getByTitle('出手影格 +1 幀',{exact:true}).click();
    assert.equal(Number(await page.locator('#slider-release-frame').inputValue()),prior+1);
    await page.getByTitle('出手影格 -1 幀',{exact:true}).click();
    item.manualFrameAdjustment=true;item.chartControls=true;item.analysisExecuted=true;
    const oldUrl=await page.locator('video').first().getAttribute('src');
    await page.locator('#video-upload-input').setInputFiles(resolve(process.env.TEST_VIDEO_DIR || '../test videos',fileName));
    await page.waitForFunction(old=>{const v=document.querySelector('video');return v?.readyState>=2&&v.src!==old},oldUrl);
    item.repeatedUpload=true;
    console.log('Completed',fileName);
  }
  assert.deepEqual(errors,[]);
  report.pageErrors=errors;
  report.completed=true;
} catch(error) {
  report.failure=error.stack;report.pageErrors=errors;console.error(error);
  await page.screenshot({path:resolve(reportDir,'failure.png'),fullPage:true}).catch(()=>{});
  process.exitCode=1;
} finally {
  await writeFile(resolve(reportDir,'acceptance.json'),JSON.stringify(report,null,2));
  await browser.close();
  console.log('Report:',resolve(reportDir,'acceptance.json'));
}
