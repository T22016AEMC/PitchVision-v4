import {chromium} from '@playwright/test';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://127.0.0.1:4175',report={base,environment:'Desktop Chrome mobile viewport; physical phone not tested',errors:[]};
await mkdir('test-results/manual-media',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto(base);await page.locator('#video-upload-input').setInputFiles(resolve('test-results/emergency/unknown-timing.webm'));
 await page.locator('#manual-fps').waitFor();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 assert.match(await page.locator('#current-time-status').innerText(),/未知／待確認/);
 assert.equal(await page.locator('#btn-start-analysis').isEnabled(),false);
 await page.getByRole('button',{name:'播放影片',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('video').paused);await page.getByRole('button',{name:'暫停影片',exact:true}).click();
 for(const [name,t] of [['release',.31],['glove',.91]]){
  await page.locator('#timeline-time-input').fill(String(t));await page.waitForFunction(()=>!document.querySelector('video').seeking);
  const media=await page.locator('video').first().evaluate(v=>v.currentTime);await page.locator(`#set-${name}-time`).click();report[name]=media;
 }
 assert.equal(await page.locator('#btn-start-analysis').isEnabled(),true);
 await page.locator('#btn-start-analysis').click();await page.waitForFunction(()=>document.querySelector('#analysis-readiness').textContent.includes('分析已完成'),null,{timeout:20000});
 const el=page.locator('#event-time-provenance'),events=JSON.parse(await el.getAttribute('data-events')),dt=Number(await el.getAttribute('data-engine-flight-seconds'));
 assert.equal(events.release.timeSec,report.release);assert.equal(events.glove.timeSec,report.glove);assert.ok(Math.abs(dt-(report.glove-report.release))<1e-9);report.engineFlightSeconds=dt;
 assert.match(await page.locator('#right-column').innerText(),/來源 FPS／PTS 未確認/);assert.equal(await page.locator('#manual-fps').count(),1);
 await page.locator('#timeline-time-input').fill('.4');await page.waitForFunction(()=>!document.querySelector('video').seeking);await page.locator('#set-release-time').click();assert.equal(await page.locator('#btn-start-analysis').isEnabled(),true);await page.locator('#btn-start-analysis').click();await page.waitForFunction(()=>document.querySelector('#analysis-readiness').textContent.includes('分析已完成'));report.reanalysis=true;
 await page.locator('#video-upload-input').setInputFiles(resolve('test-results/fps-fixtures/synthetic-30.mp4'));await page.waitForFunction(()=>document.querySelector('#current-time-status')?.textContent.includes('30.0000'));
 assert.match(await page.locator('#jump-release-time').innerText(),/未設定/);assert.equal(await page.locator('#btn-start-analysis').isEnabled(),false);report.uploadReset=true;
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;process.exitCode=1;await page.screenshot({path:'test-results/manual-media/failure.png',fullPage:true}).catch(()=>{});}
finally{await writeFile('test-results/manual-media/report.json',JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
