// Single entry point to the analysis runtime (matchingEngine + pitchDatabase.json).
import * as runtime from './analysisRuntime';
export type AnalysisRuntime=typeof runtime;
export type EngineLoadState='idle'|'loading'|'ready'|'failed';

export function loadAnalysisRuntime():Promise<AnalysisRuntime>{
  return Promise.resolve(runtime);
}
