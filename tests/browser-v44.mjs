import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
await mkdir('test-results/v44-browser',{recursive:true});
let source=await readFile('tests/browser-manual-media.mjs','utf8');
source=source.replaceAll('test-results/manual-media/','test-results/v44-browser/');
const marker=" await page.locator('#video-upload-input').setInputFiles(resolve('test-results/fps-fixtures/synthetic-30.mp4'));";
if(!source.includes(marker))throw Error('Minimal browser fixture changed; update V4.4 injection');
source=source.replace(marker,`
 assert.match(await page.title(),/V4\\.4/);
 const priorText=await page.locator('#right-column').textContent(),priorId=priorText.match(/候選 (pv3-[\\w-]+)/)?.[1],savedEvents=await page.locator('#event-time-provenance').getAttribute('data-events');
 assert.ok(priorId);assert.match(priorText,/完整有效物理池 1080/);
 await page.getByRole('button',{name:/投手後方偏側/}).click();assert.equal(await page.locator('#btn-start-analysis').isEnabled(),true);
 await page.locator('#btn-start-analysis').click();await page.waitForFunction(()=>document.querySelector('#analysis-readiness').textContent.includes('分析已完成'));
 assert.equal(await page.locator('#event-time-provenance').getAttribute('data-events'),savedEvents);
 assert.ok((await page.locator('#right-column').textContent()).includes(priorId));report.bothCameraModes=true;report.physicalPool=1080;report.selectedPhysicalId=priorId;
`+marker);
await writeFile('test-results/browser-v44-run.mjs',source);
execFileSync(process.execPath,['test-results/browser-v44-run.mjs'],{stdio:'inherit',env:process.env});
