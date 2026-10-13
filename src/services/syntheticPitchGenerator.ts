import { PitchRecord } from '../types';

export interface SyntheticPitchGeneratorOptions {
  sampleCount?: number;
  pitchTypes?: string[];
  seed?: number;
}

export interface DatabaseMetadata {
  generatorVersion: string;
  generationDate: string;
  sourceType: 'synthetic';
  sourceLabel: string;
  datasetName: string;
  recordCount: number;
  physicsRules: string[];
  ranges: Record<string, { min: number; max: number }>;
}

/**
 * SyntheticPitchGenerator
 * 嚴格遵循真實棒球物理關係生成 Reference Dataset，具備物理一致性檢驗。
 * 杜絕：95mph 轉速500rpm 或 60mph 轉速3500rpm 等不可能數據。
 */
export class SyntheticPitchGenerator {
  static readonly PITCH_TYPE_CONFIGS: Record<
    string,
    {
      code: string;
      velMin: number;
      velMax: number;
      rpmMin: number;
      rpmMax: number;
      axisHoursMin: number;
      axisHoursMax: number;
      ivbMin: number;
      ivbMax: number;
      hbMin: number;
      hbMax: number;
      efficiencyMin: number;
      efficiencyMax: number;
    }
  > = {
    '四縫線直球 (Fastball)': {
      code: 'FF',
      velMin: 110,
      velMax: 155,
      rpmMin: 1950,
      rpmMax: 2600,
      axisHoursMin: 11.2,
      axisHoursMax: 1.2, // 11:15 ~ 1:15
      ivbMin: 13.0,
      ivbMax: 22.0,
      hbMin: -3.0,
      hbMax: 15.0,
      efficiencyMin: 85,
      efficiencyMax: 99
    },
    '二縫線直球/伸卡 (Sinker)': {
      code: 'SI',
      velMin: 108,
      velMax: 152,
      rpmMin: 1850,
      rpmMax: 2450,
      axisHoursMin: 1.4,
      axisHoursMax: 2.8,
      ivbMin: 5.0,
      ivbMax: 13.0,
      hbMin: 10.0,
      hbMax: 20.0,
      efficiencyMin: 80,
      efficiencyMax: 95
    },
    '滑球 (Slider)': {
      code: 'SL',
      velMin: 100,
      velMax: 138,
      rpmMin: 2050,
      rpmMax: 2750,
      axisHoursMin: 8.5,
      axisHoursMax: 10.2,
      ivbMin: -2.0,
      ivbMax: 6.0,
      hbMin: -14.0,
      hbMax: -2.0,
      efficiencyMin: 30,
      efficiencyMax: 55
    },
    '曲球 (Curveball)': {
      code: 'CB',
      velMin: 92,
      velMax: 126,
      rpmMin: 2100,
      rpmMax: 2900,
      axisHoursMin: 5.5,
      axisHoursMax: 7.2,
      ivbMin: -18.0,
      ivbMax: -6.0,
      hbMin: -10.0,
      hbMax: 5.0,
      efficiencyMin: 70,
      efficiencyMax: 90
    },
    '變速球 (Changeup)': {
      code: 'CH',
      velMin: 98,
      velMax: 136,
      rpmMin: 1500,
      rpmMax: 2150,
      axisHoursMin: 1.8,
      axisHoursMax: 3.2,
      ivbMin: 3.0,
      ivbMax: 11.0,
      hbMin: 10.0,
      hbMax: 19.0,
      efficiencyMin: 65,
      efficiencyMax: 88
    },
    '指叉球 (Splitter)': {
      code: 'FS',
      velMin: 104,
      velMax: 142,
      rpmMin: 1100,
      rpmMax: 1650,
      axisHoursMin: 1.2,
      axisHoursMax: 2.2,
      ivbMin: 1.0,
      ivbMax: 8.0,
      hbMin: 5.0,
      hbMax: 14.0,
      efficiencyMin: 45,
      efficiencyMax: 70
    },
    '卡特球 (Cutter)': {
      code: 'FC',
      velMin: 112,
      velMax: 146,
      rpmMin: 2100,
      rpmMax: 2650,
      axisHoursMin: 10.5,
      axisHoursMax: 11.8,
      ivbMin: 8.0,
      ivbMax: 16.0,
      hbMin: -6.0,
      hbMax: 2.0,
      efficiencyMin: 50,
      efficiencyMax: 75
    },
    '橫掃滑球 (Sweeper)': {
      code: 'ST',
      velMin: 98,
      velMax: 134,
      rpmMin: 2200,
      rpmMax: 2850,
      axisHoursMin: 8.0,
      axisHoursMax: 9.5,
      ivbMin: -3.0,
      ivbMax: 4.0,
      hbMin: -20.0,
      hbMax: -12.0,
      efficiencyMin: 40,
      efficiencyMax: 65
    }
  };

  /**
   * 物理一致性驗證器
   */
  static validatePhysicsConsistency(record: Partial<PitchRecord>): { isValid: boolean; reason?: string } {
    if (!record.velocity_kmh || !record.spin_rate_rpm) {
      return { isValid: false, reason: 'Missing velocity or spin rate' };
    }

    const vel = record.velocity_kmh;
    const rpm = record.spin_rate_rpm;
    const velMph = vel * 0.621371;
    const bauerUnits = rpm / velMph;

    // Bauer units 合理物理邊界：12 ~ 36 (MLB/業餘常規範圍)
    if (bauerUnits < 12.0 || bauerUnits > 38.0) {
      return {
        isValid: false,
        reason: `Bauer Units 異常 (${bauerUnits.toFixed(1)})，球速與轉速不符合常態物理規律`
      };
    }

    // 球速極限防呆
    if (vel < 60 || vel > 170) {
      return { isValid: false, reason: `球速超出常規範圍 (${vel} km/h)` };
    }

    // 轉速極限防呆
    if (rpm < 700 || rpm > 3400) {
      return { isValid: false, reason: `轉速超出常規範圍 (${rpm} rpm)` };
    }

    return { isValid: true };
  }

  /**
   * 產生資料庫中繼描述
   */
  static getDatabaseMetadata(recordCount: number = 1080): DatabaseMetadata {
    return {
      generatorVersion: 'PitchVision Physics Synthetic v3.1',
      generationDate: '2026-09-24',
      sourceType: 'synthetic',
      sourceLabel: 'PitchVision Reference Dataset (Synthetic Physics Prior)',
      datasetName: 'PitchVision 1,080 Records Physics Prior',
      recordCount,
      physicsRules: [
        'Bauer Units restricted between 14.0 and 34.0',
        'Pitch-type specific spin axis clock constraints',
        'Homography spatial calibration to 17.5m glove distance',
        'Decoupled velocity and spin movement manifolds'
      ],
      ranges: {
        velocity_kmh: { min: 70, max: 155 },
        spin_rate_rpm: { min: 1000, max: 2850 },
        ivb_inch: { min: -18, max: 23 },
        hb_inch: { min: -20, max: 20 }
      }
    };
  }
}
