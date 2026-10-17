// Single entry point to the lazy analysis chunk (matchingEngine + pitchDatabase.json).
// Nothing in the initial bundle may import matchingEngine statically; see tests/mobile-shell.mjs.
export type AnalysisRuntime=typeof import('./analysisRuntime');
export type EngineLoadState='idle'|'loading'|'ready'|'failed';

let pending:Promise<AnalysisRuntime>|null=null;

export function loadAnalysisRuntime():Promise<AnalysisRuntime>{
  if(!pending)pending=import('./analysisRuntime').catch(error=>{pending=null;throw error;});
  return pending;
}
