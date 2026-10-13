import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const root = resolve(process.env.STATIC_ROOT || fileURLToPath(new URL('./dist/', import.meta.url)));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2' };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if (!['GET','HEAD'].includes(req.method)) {
    res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;
  }
  if (req.url === '/healthz') { res.writeHead(200,{'Content-Type':'text/plain'});res.end(req.method==='HEAD'?'':'ok');return; }
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file=resolve(root,'.'+pathname);
    if (file!==resolve(root) && !file.startsWith(resolve(root)+sep)) {res.writeHead(403);res.end();return;}
    let info;
    try {info=await stat(file);} catch {}
    if (info?.isDirectory()) {file=resolve(file,'index.html');info=await stat(file).catch(()=>null);}
    // Preserve real missing-asset errors, including the original missing demo video.
    if (!info?.isFile()) {
      if (extname(pathname)) {res.writeHead(404);res.end();return;}
      file=resolve(root,'index.html');info=await stat(file);
    }
    const type=mime[extname(file)] || 'application/octet-stream';
    const gzip=/\bgzip\b/.test(req.headers['accept-encoding']||'') && /^(text\/|application\/json)/.test(type);
    res.setHeader('Content-Type',type);
    res.setHeader('Cache-Control',pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache');
    res.setHeader('Vary','Accept-Encoding');
    if (gzip) res.setHeader('Content-Encoding','gzip');else res.setHeader('Content-Length',info.size);
    res.writeHead(200);
    if (req.method==='HEAD') {res.end();return;}
    const stream=createReadStream(file);
    stream.on('error',()=>res.destroy());
    res.on('close',()=>stream.destroy());
    if (gzip) stream.pipe(createGzip()).pipe(res);else stream.pipe(res);
  } catch {if (!res.headersSent) res.writeHead(400);res.end();}
});
server.listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('PitchVision static server ready'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
