// Release → net distance prior (5.0.3 D1).
// 5.0.2 used 18.44 m − extension + 0.90 m "catcher glove recession" (17.5 m for the default pitcher). The project is built for
// single-person practice with no catcher (HANDOFF §1), so the recession term has no basis there; the distance from the release
// point to where the ball stops is the plate distance minus the pitcher's extension. This is still a PRIOR (the video cannot
// measure range), reported with an uncertainty, and the owner can override it.
import type {PitcherBiometrics} from '../types';

export const PLATE_DISTANCE_M=18.44;
export interface DistancePrior{priorM:number;sigmaM:number;legacyM:number;basis:string}
export function distancePrior(bio:Pick<PitcherBiometrics,'calculatedExtensionM'|'effectiveTravelDistanceM'|'pitcherHeightCm'>):DistancePrior{
  const prior=Math.round((PLATE_DISTANCE_M-bio.calculatedExtensionM)*100)/100;
  return {priorM:prior,sigmaM:.7,legacyM:bio.effectiveTravelDistanceM,basis:`${PLATE_DISTANCE_M} m − 出手延伸 ${bio.calculatedExtensionM} m（沒有捕手，不加手套後縮）；身高 ${bio.pitcherHeightCm} cm 推算，±0.7 m`};
}
