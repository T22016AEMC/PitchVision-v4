// Loads tests/tools/engine-entry.ts as a Node ES module (bundled once per process with esbuild).
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
let mod=null;
export async function loadEngine(entry='tests/tools/engine-entry.ts',out='test-results/engine-503.mjs'){
  if(mod)return mod;
  await mkdir('test-results',{recursive:true});
  await build({entryPoints:[entry],outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'silent',sourcemap:false,loader:{'.json':'json'}});
  mod=await import(pathToFileURL(resolve(out)).href+'?'+Date.now());
  mod.setAnalysisPacing(false);
  return mod;
}
