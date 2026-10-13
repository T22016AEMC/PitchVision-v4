import {
  PitchRecord,
  DatabaseMatchCandidate,
  MovementMatcherConfig,
  CameraViewMode
} from '../types';

export const DEFAULT_MATCHER_CONFIG: MovementMatcherConfig = {
  velocityWeight: 0.30,
  ivbWeight: 0.40,
  hbWeight: 0.30,
  initialVelocityWindowKmh: 4.0, // ±4.0 km/h 速度窗口
  maxVelocityWindowKmh: 14.0,   // 當資料密度不足時最大延伸窗口
  topNCandidates: 3
};

export interface MatcherInput {
  observedVelocityKmh: number;
  observedIvbInch: number;
  observedHbInch: number;
  selectedPitchType: string;
  cameraView: CameraViewMode;
  db: PitchRecord[];
  strictPitchTypeMode?: boolean; // 預設 ON (true)：若指定球種無資料，不默默啟用 Cross-Type Fallback
  allowCrossTypeFallback?: boolean; // 使用者顯式勾選時才允許 Cross-Type Fallback
  config?: Partial<MovementMatcherConfig>;
}

export interface MatcherResult {
  candidates: DatabaseMatchCandidate[];
  matchedRecordCount: number;
  velocityWindowCandidateCount: number;
  totalDbRecords: number;
  isCrossTypeFallback: boolean;
  isInsufficientPitchTypeData: boolean;
  effectiveVelocityWindowKmh: number;
  activePitchType: string;
  notes: string[];
}

/**
 * 球路位移與特徵空間比對引擎 (Movement Database Matcher)
 * 責任：
 * 1. 【第一級 Filter】：限定在使用者指定之 Pitch Type，預設開啟 STRICT MODE，絕不默默混雜其他球路
 * 2. 【第二級 Filter】：依據實測球速建立動態速度窗口 (±4 -> ±6 -> ±8 -> ±10 -> ±12 -> ±14 km/h)
 * 3. 【第三級 比對】：Velocity (30%) + IVB (40%) + HB (30%) 多維空間距離評估
 * 4. 【第四級 物理一致性校驗】：剔除/懲罰不合常理之候選點 (Physics Consistency Check)
 * 5. 輸出 Top N (3~5) 候選分布與內插權重
 */
export class MovementDatabaseMatcher {
  static matchCandidates(input: MatcherInput): MatcherResult {
    const {
      observedVelocityKmh,
      observedIvbInch,
      observedHbInch,
      selectedPitchType,
      cameraView,
      db,
      strictPitchTypeMode = true,
      allowCrossTypeFallback = false,
      config = {}
    } = input;

    const fullConfig: MovementMatcherConfig = {
      ...DEFAULT_MATCHER_CONFIG,
      ...config
    };

    const notes: string[] = [];
    let isCrossTypeFallback = false;
    let isInsufficientPitchTypeData = false;

    // 視角過濾 (若有視角標註則優先使用，若無則全部適用)
    let viewPool = db.filter((r) => !r.camera_view || r.camera_view === cameraView);
    if (viewPool.length === 0) viewPool = db;

    // =========================================================================
    // STEP 1: 使用者指定 Pitch Type 成為第一級 Filter (STRICT MODE 預設開啟)
    // =========================================================================
    let typeFilteredPool: PitchRecord[] = [];
    const normalizedTargetType = selectedPitchType.trim();

    if (
      normalizedTargetType &&
      normalizedTargetType !== '🤖 AI 全數據庫自動辨識' &&
      normalizedTargetType !== 'ALL'
    ) {
      typeFilteredPool = viewPool.filter((r) => {
        return (
          r.pitch_type.includes(normalizedTargetType) ||
          normalizedTargetType.includes(r.pitch_type) ||
          this.matchPitchTypeAlias(r.pitch_type, normalizedTargetType)
        );
      });

      if (typeFilteredPool.length > 0) {
        notes.push(
          `[STRICT PITCH TYPE FILTER] 鎖定指定球種【${normalizedTargetType}】，自 ${viewPool.length} 筆資料中篩選出 ${typeFilteredPool.length} 筆同球種參考空間`
        );
      } else if (!strictPitchTypeMode || allowCrossTypeFallback) {
        // 使用者主動允許 Cross-Type Fallback 時才進入跨球種備援
        isCrossTypeFallback = true;
        typeFilteredPool = viewPool;
        notes.push(
          `⚠️ 警告：資料庫無【${normalizedTargetType}】紀錄，已依使用者設定啟用【Cross-Type Fallback】跨球種廣義參考`
        );
      } else {
        // STRICT MODE 開啟且無該球種資料：誠實標記資料不足，不偷偷混入其他球種
        isInsufficientPitchTypeData = true;
        notes.push(
          `❌ 指定球種【${normalizedTargetType}】資料不足 (0 筆)，STRICT MODE 已阻擋跨球種混入，無法可靠推估 RPM / Spin Axis`
        );
        return {
          candidates: [],
          matchedRecordCount: 0,
          velocityWindowCandidateCount: 0,
          totalDbRecords: db.length,
          isCrossTypeFallback: false,
          isInsufficientPitchTypeData: true,
          effectiveVelocityWindowKmh: fullConfig.initialVelocityWindowKmh,
          activePitchType: normalizedTargetType,
          notes
        };
      }
    } else {
      typeFilteredPool = viewPool;
      notes.push(`未指定單一球種，搜尋空間為全參考資料集 (${viewPool.length} 筆 Synthetic Physics Prior)`);
    }

    const matchedTypeRecords = typeFilteredPool.length;

    // =========================================================================
    // STEP 2: Velocity Window Filtering (±4 -> ±6 -> ±8 -> ±10 -> ±12 -> ±14 km/h)
    // =========================================================================
    let currentWindow = fullConfig.initialVelocityWindowKmh; // 預設 ±4 km/h
    let velFilteredPool: PitchRecord[] = [];

    while (currentWindow <= fullConfig.maxVelocityWindowKmh) {
      velFilteredPool = typeFilteredPool.filter(
        (r) => Math.abs(r.velocity_kmh - observedVelocityKmh) <= currentWindow
      );

      if (velFilteredPool.length >= 4) {
        break;
      }
      currentWindow += 2.0;
    }

    if (velFilteredPool.length === 0) {
      velFilteredPool = typeFilteredPool;
      currentWindow = fullConfig.maxVelocityWindowKmh;
      notes.push(`速度窗口擴展至最大範圍 (±${currentWindow.toFixed(1)} km/h)，共 ${velFilteredPool.length} 筆候選`);
    } else {
      notes.push(
        `依實測速度 ${observedVelocityKmh} km/h 建立有效速度窗口 (±${currentWindow.toFixed(1)} km/h)，篩出 ${velFilteredPool.length} 筆候選樣本`
      );
    }

    // =========================================================================
    // STEP 3: Movement Matching (Velocity 30% + IVB 40% + HB 30% 多維空間距離)
    // =========================================================================
    const wV = fullConfig.velocityWeight;
    const wIVB = fullConfig.ivbWeight;
    const wHB = fullConfig.hbWeight;

    const vNormScale = Math.max(8.0, currentWindow * 1.5);
    const ivbNormScale = 14.0;
    const hbNormScale = 14.0;

    const scoredCandidates = velFilteredPool.map((record) => {
      const velError = Math.abs(record.velocity_kmh - observedVelocityKmh);
      const normVelError = velError / vNormScale;

      const ivbError = Math.abs(record.ivb_inch - observedIvbInch);
      const normIvbError = ivbError / ivbNormScale;

      const hbError = Math.abs(record.hb_inch - observedHbInch);
      const normHbError = hbError / hbNormScale;

      const movementError = wIVB * normIvbError + wHB * normHbError;
      const baseDistance = wV * normVelError + movementError;

      // =======================================================================
      // STEP 4: Physics Consistency Check (物理一致性審核)
      // =======================================================================
      const consistencyScore = this.evaluatePhysicsConsistency(
        record,
        observedVelocityKmh,
        observedIvbInch,
        observedHbInch
      );

      const consistencyPenalty = (100 - consistencyScore) * 0.015;
      const totalDistance = baseDistance + consistencyPenalty;

      const similarity = Number(
        Math.max(10.0, Math.min(97.0, (1.0 - Math.min(1.0, totalDistance * 0.85)) * 100)).toFixed(1)
      );

      const velSim = Number(
        Math.max(20.0, Math.min(98.0, 100 - velError * 2.0)).toFixed(1)
      );

      return {
        record,
        velError: Number(velError.toFixed(2)),
        movementError: Number(movementError.toFixed(3)),
        totalDistance: Number(totalDistance.toFixed(3)),
        similarity,
        velSim,
        consistencyScore
      };
    });

    scoredCandidates.sort((a, b) => a.totalDistance - b.totalDistance);

    const topN = scoredCandidates.slice(0, fullConfig.topNCandidates);

    // 計算每個候選點的內插權重 (Inverse error + physics consistency)
    const rawWeights = topN.map((c) => {
      const errFactor = 1.0 / (Math.pow(c.totalDistance, 1.5) + 0.08);
      const physFactor = Math.max(0.2, c.consistencyScore / 100.0);
      return errFactor * physFactor;
    });
    const weightSum = rawWeights.reduce((a, b) => a + b, 0) || 1.0;

    const candidates: DatabaseMatchCandidate[] = topN.map((c, idx) => ({
      rank: idx + 1,
      pitch_type: c.record.pitch_type,
      code: c.record.code,
      similarity_score: c.similarity,
      velocity_kmh: c.record.velocity_kmh,
      velocity_similarity: c.velSim,
      spin_rate_rpm: c.record.spin_rate_rpm,
      spin_axis: c.record.spin_axis,
      spin_axis_decimal: c.record.spin_axis_decimal,
      spin_efficiency_pct: c.record.spin_efficiency_pct,
      ivb_inch: c.record.ivb_inch,
      hb_inch: c.record.hb_inch,
      record_id: c.record.id,
      source_type: c.record.source_type || 'synthetic',
      source_label: isCrossTypeFallback
        ? 'Cross-Type Fallback (Synthetic Physics Prior)'
        : (c.record.source_label || 'PitchVision Synthetic Physics Reference Dataset'),
      velocity_error: c.velError,
      movement_error: c.movementError,
      total_error: c.totalDistance,
      physics_consistency_score: c.consistencyScore,
      interpolation_weight: Number((rawWeights[idx] / weightSum).toFixed(4))
    }));

    return {
      candidates,
      matchedRecordCount: matchedTypeRecords,
      velocityWindowCandidateCount: velFilteredPool.length,
      totalDbRecords: db.length,
      isCrossTypeFallback,
      isInsufficientPitchTypeData,
      effectiveVelocityWindowKmh: currentWindow,
      activePitchType: normalizedTargetType || 'ALL',
      notes
    };
  }

  /**
   * 物理一致性檢驗 (Physics Consistency Check)
   * 驗證位移量、速度、轉速與轉軸是否具備合理之運動學協調性
   */
  private static evaluatePhysicsConsistency(
    record: PitchRecord,
    obsVelKmh: number,
    obsIvbInch: number,
    obsHbInch: number
  ): number {
    let score = 95;

    // 1. Bauer Units 檢驗 (RPM / MPH，大聯盟常規在 16 ~ 32 之間)
    const velMph = record.velocity_kmh * 0.621371;
    const bauer = velMph > 0 ? record.spin_rate_rpm / velMph : 22.0;
    if (bauer < 13.0 || bauer > 34.0) {
      score -= 25; // 異常轉速與球速比率
    }

    // 2. 轉軸方向與 IVB 符號協調性
    // 時鐘 11:00 ~ 1:00 (Backspin) 應對應正揚力 (IVB > 0)
    // 時鐘 5:00 ~ 7:00 (Topspin) 應對應下墜負揚力 (IVB < 0)
    const axisH = record.spin_axis_decimal;
    const isBackspinClock = (axisH >= 10.5 && axisH <= 12.0) || (axisH >= 0.0 && axisH <= 1.5);
    const isTopspinClock = axisH >= 4.5 && axisH <= 7.5;

    if (isBackspinClock && record.ivb_inch < -2.0) {
      score -= 30; // 矛盾：高仰角自旋卻產生負揚力
    }
    if (isTopspinClock && record.ivb_inch > 8.0) {
      score -= 30; // 矛盾：下旋自旋卻產生大正揚力
    }

    // 3. 觀測位移方向與參考資料位移方向一致性
    const sameIvbSign = Math.sign(record.ivb_inch) === Math.sign(obsIvbInch);
    const sameHbSign = Math.sign(record.hb_inch) === Math.sign(obsHbInch);
    if (!sameIvbSign && Math.abs(obsIvbInch) > 5.0) {
      score -= 20;
    }
    if (!sameHbSign && Math.abs(obsHbInch) > 5.0) {
      score -= 15;
    }

    return Math.max(15, Math.min(100, score));
  }

  /**
   * 球種名稱別名映射
   */
  private static matchPitchTypeAlias(dbType: string, selectedType: string): boolean {
    const s = selectedType.toLowerCase();
    const d = dbType.toLowerCase();

    if (s.includes('fastball') || s.includes('四縫線') || s.includes('ff')) {
      return d.includes('fastball') || d.includes('四縫線') || d.includes('ff');
    }
    if (s.includes('sinker') || s.includes('二縫線') || s.includes('伸卡') || s.includes('si')) {
      return d.includes('sinker') || d.includes('二縫線') || d.includes('伸卡') || d.includes('si');
    }
    if (s.includes('slider') || s.includes('滑球') || s.includes('sl')) {
      return d.includes('slider') || d.includes('滑球') || d.includes('sl');
    }
    if (s.includes('cutter') || s.includes('卡特') || s.includes('fc')) {
      return d.includes('cutter') || d.includes('卡特') || d.includes('fc');
    }
    if (s.includes('curve') || s.includes('曲球') || s.includes('cu')) {
      return d.includes('curve') || d.includes('曲球') || d.includes('cu');
    }
    if (s.includes('change') || s.includes('變速') || s.includes('ch')) {
      return d.includes('change') || d.includes('變速') || d.includes('ch');
    }
    if (s.includes('split') || s.includes('指叉') || s.includes('fs')) {
      return d.includes('split') || d.includes('指叉') || d.includes('fs');
    }
    if (s.includes('sweep') || s.includes('橫掃') || s.includes('st')) {
      return d.includes('sweep') || d.includes('橫掃') || d.includes('st');
    }

    return false;
  }
}
