// Local-only functional smoke test on ONE owner clip (never committed; skipped when the file is absent): the whole flow
// (upload → mark → analyse → result) runs without an exception or console error, the six final numbers are shown in the
// 5.0.3.2 format, backend data stays hidden, debug mode opens, the 2D view returns to the video. No accuracy is judged here.
//   node tests/browser-real-smoke.mjs [file-name]   (default: 直球.mp4 = the 720p straight clip)
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {readFinalCards,checkFinalCards} from './tools/final-cards-check.mjs';

const name=process.argv[2]??'直球.mp4',file=resolve('..','test videos',name);
if(!existsSync(file)){console.log(JSON.stringify({skipped:'clip not found: '+name}));process.exit(0);}
const marks=name.startsWith('直')?{release:127,glove:139}:{release:97,glove:111};
const out=resolve('test-results/mobile-v5');await mkdir(out,{recursive:true});
let server=null,base=process.env.BASE_URL;
if(!base){base='http://127.0.0.1:4178';server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port','4178','--strictPort','--host','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
  await new Promise((ok,fail)=>{const t=setTimeout(()=>fail(Error('preview did not start')),20000);server.stdout.on('data',d=>{if(String(d).includes('4178')){clearTimeout(t);ok();}});server.on('exit',c=>fail(Error('preview exited '+c)));});}
const report={clip:name,marks,checks:[],errors:[]};
const ok=(n,v)=>{report.checks.push({name:n,ok:Boolean(v)});assert.ok(v,n);};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'zh-TW'});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push('console: '+m.text());});
  await page.goto(base,{waitUntil:'networkidle'});
  const waitSeek=()=>page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.seeking&&v.readyState>=2;});
  const gotoFrame=async f=>{await page.locator('#player-menu-btn').click();await page.locator('#player-menu').waitFor();await page.locator('#mode-source').click();await page.locator('#source-frame-input').fill(String(f));
    await page.locator('#player-menu-close').click();await page.locator('#player-menu').waitFor({state:'detached'});await waitSeek();await page.waitForFunction(()=>!document.querySelector('#set-release-time')?.disabled);};
  await page.locator('#video-upload-input').setInputFiles(file);
  await page.locator('#video-summary').waitFor({timeout:90000});
  await page.locator('#view-pitcher_rear').click();
  await page.locator('#btn-next-mark').click();await page.locator('#set-release-time').waitFor();await waitSeek();
  await gotoFrame(marks.release);await page.locator('#set-release-time').click();await gotoFrame(marks.glove);await page.locator('#set-glove-time').click();
  await page.locator('#btn-next-analyze').click();await page.locator('#btn-start-analysis').click();
  const t0=Date.now();
  await Promise.race([page.locator('#result-screen').waitFor({timeout:300000}),page.locator('#assist-banner').waitFor({timeout:300000}).then(async()=>{await page.locator('#assist-skip').click();await page.locator('#result-screen').waitFor({timeout:120000});})]);
  report.analysisSeconds=+((Date.now()-t0)/1000).toFixed(1);
  const cards=await readFinalCards(page);report.cards=cards.map(c=>`${c.key}: ${c.value} (${c.range})`);
  checkFinalCards(cards,ok);
  ok('AI mode: top three pitch types shown',await page.locator('#pitch-type-top3 li').count()===3);
  ok('no backend data on the default page',await page.locator('#debug-panel').count()===0&&!/相機|出手角|出手高度|擬合信心|撞網時間|平均球速|資料庫匹配/.test(await page.locator('#result-screen').innerText()));
  const ver=page.locator('#app-version');await ver.scrollIntoViewIfNeeded();const vb=await ver.boundingBox();
  await page.mouse.move(vb.x+vb.width/2,vb.y+vb.height/2);await page.mouse.down();await page.waitForTimeout(900);await page.mouse.up();
  ok('debug mode opens (long press on the version)',await page.locator('#debug-panel').isVisible());
  await page.locator('#view-tab-twod').scrollIntoViewIfNeeded();await page.locator('#view-tab-twod').click();await page.locator('#pitch-canvas').waitFor();
  ok('2D view shows 回到影片 and it returns to the video',await page.locator('#btn-twod-back').isVisible()&&await (async()=>{await page.locator('#btn-twod-back').click();return (await page.locator('#view-tab-video').getAttribute('aria-selected'))==='true';})());
  await page.screenshot({path:resolve(out,'90-real-smoke-result.png'),fullPage:true});
  ok('no page error or console error during the whole flow',report.errors.length===0);
  report.passed=true;
}catch(e){report.failure=String(e?.stack||e).split('\n')[0];report.passed=false;}
finally{await browser.close();server?.kill();await writeFile(resolve(out,'report-real-smoke.json'),JSON.stringify(report,null,1));}
console.log(JSON.stringify({passed:report.passed,clip:report.clip,analysisSeconds:report.analysisSeconds,checks:`${report.checks.filter(c=>c.ok).length}/${report.checks.length}`,cards:report.cards,errors:report.errors,failure:report.failure},null,1));
if(!report.passed)process.exitCode=1;
