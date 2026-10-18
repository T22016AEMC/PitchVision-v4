// Local test harness: serves one video file, opens it in desktop Chrome, and gives Node a page whose
// window.__pv has the decoded-frame helpers. Videos are never copied or committed.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve,basename} from 'node:path';
import {mkdir} from 'node:fs/promises';

let timingModule=null;
export async function containerTimes(file){
  if(!timingModule){
    await mkdir('test-results',{recursive:true});
    await build({entryPoints:['src/services/mp4Timing.ts'],outfile:'test-results/harness-mp4timing.mjs',bundle:true,platform:'node',format:'esm',logLevel:'silent'});
    timingModule=await import(pathToFileURL(resolve('test-results/harness-mp4timing.mjs')).href);
  }
  const timing=await timingModule.readMp4Timing(new Blob([await readFile(file)]));
  if(!timing)throw Error('no container timing for '+file);
  return timing;
}

/** Bundle an in-page entry (TypeScript) as an IIFE string; it must assign to window.__pv. */
export async function bundlePage(entry){
  const r=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'iife',logLevel:'silent',target:'es2022'});
  return r.outputFiles[0].text;
}

/** Open `file` (a path) in Chrome. Returns {page, timing, close}. `pageScript` is an IIFE bundle for window.__pv. */
export async function openVideo(file,{pageScript,viewport={width:1280,height:900},headless=true}={}){
  const server=createServer(async(req,res)=>{
    if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><meta charset=utf-8><body></body>');return;}
    if(req.url==='/video'){
      const size=(await stat(file)).size,range=req.headers.range;
      const type=file.toLowerCase().endsWith('.mov')?'video/quicktime':'video/mp4';
      if(range){const m=/bytes=(\d+)-(\d*)/.exec(range),start=Number(m[1]),end=m[2]?Number(m[2]):size-1;
        res.writeHead(206,{'content-type':type,'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${size}`,'content-length':end-start+1});createReadStream(file,{start,end}).pipe(res);}
      else{res.writeHead(200,{'content-type':type,'accept-ranges':'bytes','content-length':size});createReadStream(file).pipe(res);}
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const port=server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless});
  const page=await browser.newPage({viewport});
  page.on('pageerror',e=>console.error('[page error]',e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  if(pageScript)await page.addScriptTag({content:pageScript});
  const timing=await containerTimes(file);
  return {page,timing,name:basename(file),close:async()=>{await browser.close();server.close();}};
}

/** A blank page on http://127.0.0.1 (a secure context, so WebCodecs is available) with the page script loaded. */
export async function openBlank({pageScript,viewport={width:1280,height:900}}={}){
  const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><meta charset=utf-8><body></body>');});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  if(pageScript)await page.addScriptTag({content:pageScript});
  return {page,close:async()=>{await browser.close();server.close();}};
}
