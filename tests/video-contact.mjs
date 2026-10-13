import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
await mkdir('test-results/v41-contact',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1400,height:1600}});
await page.goto('http://127.0.0.1:4174');
for(const file of ['直球.mp4','彈指曲球.mp4']){
 await page.goto('http://127.0.0.1:4174');
 await page.locator('#video-upload-input').setInputFiles(resolve('../test videos',file));
 await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 await page.evaluate(async()=>{
  const video=document.querySelector('video');const canvas=document.createElement('canvas');canvas.id='contact-sheet';canvas.width=1280;canvas.height=1400;const ctx=canvas.getContext('2d');
  for(let i=0;i<40;i++){const t=video.duration-2.2+i*1.5/40;await new Promise(r=>{if(Math.abs(video.currentTime-t)<0.001){r();return;}video.addEventListener('seeked',r,{once:true});video.currentTime=t;});
   const x=i%8*160,y=Math.floor(i/8)*280;ctx.drawImage(video,x,y,160,260);ctx.fillStyle='white';ctx.font='16px sans-serif';ctx.fillText(t.toFixed(3)+'s',x+4,y+277);
  }document.querySelector('#contact-sheet')?.remove();document.body.append(canvas);
 });
 await page.locator('#contact-sheet').screenshot({path:resolve('test-results/v41-contact',file+'-fine.png')});
}
await browser.close();
