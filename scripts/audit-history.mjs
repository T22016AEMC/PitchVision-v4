import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const objects=execFileSync('git',['rev-list','--objects','--all'],{encoding:'utf8'}).trim().split('\n').map(line=>{const i=line.indexOf(' ');return {sha:line.slice(0,i),path:line.slice(i+1)}}).filter(o=>o.path&&o.sha);
const prohibited=objects.filter(o=>/\.(mp4|mov|m4v|webm)$/i.test(o.path)||/(^|\/)(test videos|test-results)\//i.test(o.path)||/(^|\/)\.env($|\.(?!example$))/.test(o.path));
const textObjects=objects.filter(o=>/\.(ts|tsx|js|mjs|json|yaml|yml|py|ps1|md|html)$/.test(o.path)||o.path.endsWith('.env.example'));
const batch=execFileSync('git',['cat-file','--batch'],{input:textObjects.map(o=>o.sha).join('\n')+'\n',maxBuffer:150*1024*1024});
const patterns=[/gh[pousr]_[A-Za-z0-9]{30,}/g,/github_pat_[A-Za-z0-9_]{30,}/g,/rnd_[A-Za-z0-9]{20,}/g,/AIza[A-Za-z0-9_-]{30,}/g,/sk-(?:proj-)?[A-Za-z0-9_-]{30,}/g,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,/AKIA[0-9A-Z]{16}/g];
const findings=[];let offset=0;
for (const o of textObjects) {
  const end=batch.indexOf(10,offset);const header=batch.subarray(offset,end).toString();const size=Number(header.split(' ')[2]);offset=end+1;
  const text=batch.subarray(offset,offset+size).toString('utf8');offset+=size+1;
  for(let p=0;p<patterns.length;p++) {patterns[p].lastIndex=0;if(patterns[p].test(text)) findings.push({path:o.path,sha:o.sha,pattern:p});}
}
const result={scope:'All reachable Git history, known credential formats and private video paths; not a guarantee against every possible secret format',objects:objects.length,textBlobs:textObjects.length,prohibitedPaths:prohibited.map(o=>o.path),credentialFindings:findings,passed:!prohibited.length&&!findings.length};
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/history-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
