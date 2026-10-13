import { PitchRecord } from '../types';

export interface PublicVideoImportMetadata {
  videoUrl: string;
  sourcePlatform: 'YouTube' | 'Vimeo' | 'DirectLink' | 'UserUpload';
  videoTitle?: string;
  licenseNotes: string;
  isCopyrightCompliant: boolean;
  containsOfficialMeasurementOverlay: boolean;
}

export interface IngestedVideoPitchCandidate {
  id: string;
  metadata: PublicVideoImportMetadata;
  measuredVelocityKmh: number | null;
  observedMovementNorm: { dx: number; dy: number } | null;
  qualityScore: number;
  sourceType: 'public_video';
  status: 'pending_human_validation' | 'validated_to_database' | 'rejected';
}

/**
 * PublicVideoIngestionService
 * 負責規範第三方公開影片分析資料匯入管線：
 * 遵守條款、保留 provenance、禁止把未校準影片資料偽裝成真實量測 ground truth。
 */
export class PublicVideoIngestionService {
  /**
   * 驗證公開影片匯入合規性
   */
  static validateImportCompliance(url: string): { isCompliant: boolean; reason?: string } {
    if (!url || typeof url !== 'string') {
      return { isCompliant: false, reason: 'URL 不能為空' };
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { isCompliant: false, reason: '僅支援 HTTP / HTTPS 協議' };
      }
      return { isCompliant: true };
    } catch {
      return { isCompliant: false, reason: 'URL 格式無效' };
    }
  }

  /**
   * 將公開影片萃取特徵轉換為 PitchRecord 候選物件
   */
  static createDatabaseCandidateFromPublicVideo(
    id: number,
    pitchType: string,
    measuredVelocityKmh: number,
    metadata: PublicVideoImportMetadata
  ): Partial<PitchRecord> {
    return {
      id,
      pitch_type: pitchType,
      velocity_kmh: measuredVelocityKmh,
      source_type: 'public_video',
      source_label: `Public Video: ${metadata.videoTitle || metadata.sourcePlatform}`,
      source_url: metadata.videoUrl,
      provenance: `Extracted via PitchVision CV Temporal Pipeline. Platform: ${metadata.sourcePlatform}. Official overlay: ${metadata.containsOfficialMeasurementOverlay ? 'Yes' : 'No'}`,
      quality_score: metadata.containsOfficialMeasurementOverlay ? 85 : 70
    };
  }
}
