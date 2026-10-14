import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// Preserve all original 256 cases against the frozen V4. Intentional V4.1 fixes have separate tests.
execFileSync(process.execPath,['tests/legacy-regression.mjs'],{env:{...process.env,CANDIDATE_ROOT:'baseline/v4'},stdio:'inherit'});
for(const path of ['src/pitchDatabase.json','amateur_pitch_database_v3.json']) {
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 if(hash(path)!==hash('baseline/v3/'+path))throw Error('Original database changed: '+path);
}
execFileSync(process.execPath,['tests/v41-science.mjs'],{stdio:'inherit'});

execFileSync(process.execPath,['tests/v411.mjs'],{stdio:'inherit'});

execFileSync(process.execPath,['tests/v421.mjs'],{stdio:'inherit'});

execFileSync(process.execPath,['tests/v422.mjs'],{stdio:'inherit'});

execFileSync(process.execPath,['tests/manual-media-time.mjs'],{stdio:'inherit'});

execFileSync(process.execPath,['tests/v43-controls.mjs'],{stdio:'inherit'});
