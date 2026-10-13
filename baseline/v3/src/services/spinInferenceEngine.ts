import {
  DatabaseMatchCandidate,
  ReleaseAngleCorrectionConfig,
  MeasurementUncertainty
} from '../types';

export const DEFAULT_RELEASE_CORRECTION_CONFIG: ReleaseAngleCorrectionConfig = {
  rpmCorrectionPerDegree: 5.5,          // 每偏離參考出手角 1 度，RPM 修正約 5.5 RPM
  axisCorrectionMinutesPerDegree: 0.75, // 每偏離 1 度，自旋軸時鐘修正約 0.75 分鐘
  maxRpmCorrection: 55,                 // RPM 最大修正上限 (保持微調，絕不主導結果)
  maxAxisCorrectionMinutes: 12          // 轉軸最大修正上限 (約 12 分鐘)
};

export interface SpinInferenceInput {
  candidates: DatabaseMatchCandidate[];
  observedReleaseAngleDeg: number;
  isReleaseAngleEstimated: boolean;
  referenceReleaseAngleDeg?: number;
  correctionConfig?: Partial<ReleaseAngleCorrectionConfig>;
  movementUncertaintyInch?: number;
  velocityUncertaintyKmh?: number;
}

export interface InferredSpinResult {
  baseSpinRateRpm: number;
  finalSpinRateRpm: number;
  rpmCorrectionApplied: number;

  baseSpinAxis: string;
  baseSpinAxisDecimal: number;
  finalSpinAxis: string;
  finalSpinAxisDecimal: number;
  axisCorrectionMinutesApplied: number;

  inferredEfficiencyPct: number;
  candidateWeights: { recordId: number; weight: number; contributionPct: number }[];
  uncertainty: MeasurementUncertainty;
  notes: string[];
}

/**
 * 轉速與轉軸反查推估引擎 (Spin Inference Engine)
 * 責任：
 * 1. 依據 Top N 候選資料之距離進行加權內插 (Weighted Interpolation)
 * 2. 嚴格採用循環量幾何內插 (Circular Interpolation) 處理 12 小時制轉軸時鐘
 * 3. 將 Release Angle 作為微幅修正參數 (Correction Parameter)，絕不喧賓奪主
 * 4. 輸出模型不確定度 (Uncertainty) 與平滑精度標籤
 */
export class SpinInferenceEngine {
  static inferSpinParameters(input: SpinInferenceInput): InferredSpinResult {
    const {
      candidates = [],
      observedReleaseAngleDeg,
      isReleaseAngleEstimated,
      referenceReleaseAngleDeg = 54.0,
      correctionConfig = {},
      movementUncertaintyInch = 1.2,
      velocityUncertaintyKmh = 1.5
    } = input;

    const fullCorrectionConfig: ReleaseAngleCorrectionConfig = {
      ...DEFAULT_RELEASE_CORRECTION_CONFIG,
      ...correctionConfig
    };

    const notes: string[] = [];

    if (candidates.length === 0) {
      // 容錯邊界保護
      return {
        baseSpinRateRpm: 2150,
        finalSpinRateRpm: 2150,
        rpmCorrectionApplied: 0,
        baseSpinAxis: '12:00',
        baseSpinAxisDecimal: 12.0,
        finalSpinAxis: '12:00',
        finalSpinAxisDecimal: 12.0,
        axisCorrectionMinutesApplied: 0,
        inferredEfficiencyPct: 90.0,
        candidateWeights: [],
        uncertainty: {
          velocity_range: '±2.0 km/h',
          spin_rate_range: '±250 RPM',
          spin_axis_range: '±0:30',
          ivb_range: '±2.0"',
          hb_range: '±2.0"',
          spin_rate_min: 1900,
          spin_rate_max: 2400,
          uncertainty_basis: '候選資料庫不足，使用廣義先驗邊界'
        },
        notes: ['無有效候選點，採用安全預設先驗']
      };
    }

    // =========================================================================
    // STEP 1: 計算每筆候選點之加權權重 (Weighting by Similarity / Error)
    // =========================================================================
    const rawWeights = candidates.map((cand) => {
      // 相似度轉換為誤差尺度 (similarity 95 -> err 0.05)
      const err = Math.max(0.02, (100 - cand.similarity_score) / 100);
      // 指數衰減權重
      return Math.exp(-err * 3.2);
    });

    const totalWeight = rawWeights.reduce((a, b) => a + b, 0) || 1.0;
    const normWeights = rawWeights.map((w) => w / totalWeight);

    const candidateWeights = candidates.map((cand, idx) => ({
      recordId: cand.record_id,
      weight: Number(normWeights[idx].toFixed(4)),
      contributionPct: Number((normWeights[idx] * 100).toFixed(1))
    }));

    // =========================================================================
    // STEP 2: 加權內插 Base Spin Rate (RPM)
    // =========================================================================
    let weightedRpmSum = 0;
    let weightedEffSum = 0;

    for (let i = 0; i < candidates.length; i++) {
      weightedRpmSum += normWeights[i] * candidates[i].spin_rate_rpm;
      weightedEffSum += normWeights[i] * candidates[i].spin_efficiency_pct;
    }

    // 平滑四捨五入至接近 10 RPM (避免假精準)
    const baseSpinRateRpm = Math.round(weightedRpmSum / 10) * 10;
    const inferredEfficiencyPct = Number(weightedEffSum.toFixed(1));

    // =========================================================================
    // STEP 3: 循環幾何平均 Base Spin Axis (Circular Interpolation)
    // 12:00 = 0° (0 rad), 3:00 = 90° (π/2), 6:00 = 180° (π), 9:00 = 270° (3π/2)
    // =========================================================================
    let circX = 0;
    let circY = 0;

    for (let i = 0; i < candidates.length; i++) {
      const dec = candidates[i].spin_axis_decimal;
      // 轉換為 0 ~ 360 度角度
      const deg = ((dec % 12) / 12) * 360;
      const rad = (deg * Math.PI) / 180;

      circX += normWeights[i] * Math.cos(rad);
      circY += normWeights[i] * Math.sin(rad);
    }

    let meanRad = Math.atan2(circY, circX);
    if (meanRad < 0) meanRad += 2 * Math.PI;

    const meanDeg = (meanRad * 180) / Math.PI;
    let baseAxisDecimal = Number(((meanDeg / 360) * 12).toFixed(2));
    if (baseAxisDecimal <= 0.05) baseAxisDecimal = 12.0;

    const baseSpinAxis = this.formatClock(baseAxisDecimal);

    // =========================================================================
    // STEP 4: Release Angle 修正 (作為 Correction Parameter，非主要來源)
    // =========================================================================
    const angleDelta = observedReleaseAngleDeg - referenceReleaseAngleDeg;

    // RPM 修正：出手角較高時，手臂釋放時往往帶有較強的垂直下壓旋轉力
    const rawRpmCorrection = angleDelta * fullCorrectionConfig.rpmCorrectionPerDegree;
    const rpmCorrectionApplied = Math.round(
      Math.max(
        -fullCorrectionConfig.maxRpmCorrection,
        Math.min(fullCorrectionConfig.maxRpmCorrection, rawRpmCorrection)
      )
    );

    const finalSpinRateRpm = Math.round((baseSpinRateRpm + rpmCorrectionApplied) / 10) * 10;

    // 自旋軸修正：出手角每偏離 1 度，時鐘轉軸微調幾分鐘
    const rawAxisCorrectionMin = angleDelta * fullCorrectionConfig.axisCorrectionMinutesPerDegree;
    const axisCorrectionMinutesApplied = Math.round(
      Math.max(
        -fullCorrectionConfig.maxAxisCorrectionMinutes,
        Math.min(fullCorrectionConfig.maxAxisCorrectionMinutes, rawAxisCorrectionMin)
      )
    );

    let finalAxisDecimal = baseAxisDecimal + axisCorrectionMinutesApplied / 60.0;
    while (finalAxisDecimal > 12.5) finalAxisDecimal -= 12.0;
    while (finalAxisDecimal < 0.5) finalAxisDecimal += 12.0;
    finalAxisDecimal = Number(finalAxisDecimal.toFixed(2));

    const finalSpinAxis = this.formatClock(finalAxisDecimal);

    if (Math.abs(rpmCorrectionApplied) > 0 || Math.abs(axisCorrectionMinutesApplied) > 0) {
      notes.push(
        `Angle correction applied: 出手角 ${observedReleaseAngleDeg.toFixed(1)}° (基準 ${referenceReleaseAngleDeg}°)，微調自旋 RPM ${rpmCorrectionApplied >= 0 ? '+' : ''}${rpmCorrectionApplied}、轉軸 ${axisCorrectionMinutesApplied >= 0 ? '+' : ''}${axisCorrectionMinutesApplied} 分鐘`
      );
    } else {
      notes.push(`出手角與參考基準一致 (${observedReleaseAngleDeg.toFixed(1)}°)，未施加角度修正`);
    }

    // =========================================================================
    // STEP 5: 估計不確定度 (Dynamic Uncertainty Estimation)
    // =========================================================================
    // 依據候選分布的標準差、圓周結果向量長度 (R) 與影像量測品質動態估計區間
    const rpmDiffs = candidates.map((c) => Math.abs(c.spin_rate_rpm - baseSpinRateRpm));
    const candRpmSpread = Math.max(...rpmDiffs, 60);
    const estimatedRpmUncertainty =
      Math.round(
        Math.max(100, Math.min(300, candRpmSpread * 0.75 + movementUncertaintyInch * 42)) / 10
      ) * 10;

    // 圓周一致性 R = hypot(circX, circY) (越接近 1 代表候選轉軸越集中)
    const circularResultantLength = Math.min(1.0, Math.hypot(circX, circY));
    const axisSpreadMin = Math.round(
      Math.max(12, Math.min(35, (1.0 - circularResultantLength) * 45 + movementUncertaintyInch * 6)) / 5
    ) * 5;
    const dynamicAxisRange = `±0:${axisSpreadMin < 10 ? '0' : ''}${axisSpreadMin}`;

    const uncertainty: MeasurementUncertainty = {
      velocity_range: `±${velocityUncertaintyKmh.toFixed(1)} km/h`,
      spin_rate_range: `±${estimatedRpmUncertainty} RPM`,
      spin_axis_range: dynamicAxisRange,
      ivb_range: `±${movementUncertaintyInch.toFixed(1)}"`,
      hb_range: `±${movementUncertaintyInch.toFixed(1)}"`,
      velocity_plus_minus_kmh: Number(velocityUncertaintyKmh.toFixed(1)),
      spin_rate_plus_minus_rpm: estimatedRpmUncertainty,
      ivb_plus_minus_inch: Number(movementUncertaintyInch.toFixed(1)),
      hb_plus_minus_inch: Number(movementUncertaintyInch.toFixed(1)),
      spin_rate_min: Math.max(800, finalSpinRateRpm - estimatedRpmUncertainty),
      spin_rate_max: finalSpinRateRpm + estimatedRpmUncertainty,
      uncertainty_basis: `基於 Top ${candidates.length} 筆候選離散度 (±${candRpmSpread} RPM, 轉軸集中度 ${(circularResultantLength * 100).toFixed(0)}%) 與位移量測不確定度 (±${movementUncertaintyInch}") 動態推估`
    };

    return {
      baseSpinRateRpm,
      finalSpinRateRpm,
      rpmCorrectionApplied,
      baseSpinAxis,
      baseSpinAxisDecimal: baseAxisDecimal,
      finalSpinAxis,
      finalSpinAxisDecimal: finalAxisDecimal,
      axisCorrectionMinutesApplied,
      inferredEfficiencyPct,
      candidateWeights,
      uncertainty,
      notes
    };
  }

  /**
   * 格式化時鐘時分字串
   */
  private static formatClock(decimalHours: number): string {
    let normalized = decimalHours;
    while (normalized > 12.5) normalized -= 12.0;
    while (normalized < 0.5) normalized += 12.0;
    let h = Math.floor(normalized);
    let m = Math.round((normalized - h) * 60);
    if (m >= 60) {
      h += 1;
      m -= 60;
    }
    if (h === 0) h = 12;
    if (h > 12) h -= 12;
    return `${h}:${m < 10 ? '0' : ''}${m}`;
  }
}
