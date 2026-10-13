import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root='baseline/v3';
const entries=[];
async function walk(dir) {
  for(const e of await readdir(dir,{withFileTypes:true})) {
    const path=dir+'/'+e.name;
    if(e.isDirectory()) await walk(path);
    else {
      const buf=await readFile(path);
      entries.push({path:path.slice(root.length+1),bytes:buf.length,sha256:createHash('sha256').update(buf).digest('hex'),exports:[...buf.toString().matchAll(/(?:export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+(\w+)|^def\s+(\w+)|^class\s+(\w+))/gm)].map(x=>x[1]||x[2]||x[3])});
    }
  }
}
await walk(root);
await writeFile('baseline/MANIFEST.json',JSON.stringify({zip:'PitchVision_V3.zip',zipSha256:'15c39e7cc6ad639bb3d2d4950682120a6a597b6eaba3cba9ffb0028d2ea6de8c',files:entries},null,2));
await writeFile('SOURCE_INVENTORY.md','# V3 完整來源盤點\n\n原始 ZIP 保留在專案上層。每個檔案均保存快照，雜湊見 baseline/MANIFEST.json。以下包含未掛接 UI 的模組；保留不代表均經端對端驗收。\n\n| 路徑 | bytes | 匯出/頂層入口 |\n|---|---:|---|\n'+entries.map(e=>`| ${e.path} | ${e.bytes} | ${e.exports.join(', ')||'資源／設定／內容'} |`).join('\n')+'\n');
console.log('Inventoried',entries.length,'original files');
