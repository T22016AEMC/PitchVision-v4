# V3 完整來源盤點

原始 ZIP 保留在專案上層。每個檔案均保存快照，雜湊見 baseline/MANIFEST.json。以下包含未掛接 UI 的模組；保留不代表均經端對端驗收。

| 路徑 | bytes | 匯出/頂層入口 |
|---|---:|---|
| .env.example | 445 | 資源／設定／內容 |
| .gitignore | 73 | 資源／設定／內容 |
| amateur_pitch_database_v3.json | 179843 | 資源／設定／內容 |
| app.py | 49770 | format_clock_time, generate_amateur_database, load_or_init_database, PitchCVModule, match_velocity_module, match_spin_movement_module, calibrate_with_ai_visual, match_pitch_data, main |
| bun.lock | 0 | 資源／設定／內容 |
| index.html | 1144 | 資源／設定／內容 |
| metadata.json | 331 | 資源／設定／內容 |
| package.json | 845 | 資源／設定／內容 |
| public/assets/aistudio/.gitignore | 2 | 資源／設定／內容 |
| public/favicon.jpg | 814650 | 資源／設定／內容 |
| public/flaming_jet_baseball.jpg | 814650 | 資源／設定／內容 |
| README.md | 542 | 資源／設定／內容 |
| src/App.tsx | 57481 | 資源／設定／內容 |
| src/appPyCode.ts | 51713 | APP_PY_CODE |
| src/assets/images/flaming_jet_baseball_1789640472028.jpg | 814650 | 資源／設定／內容 |
| src/baseballDetector.ts | 4916 | BallCandidate, detectBaseballInFrame |
| src/baseballTracker.ts | 10780 | SparseTrackingOptions, SparseTrackingResult, trackBaseballSparse |
| src/components/CodeViewerModal.tsx | 3143 | CodeViewerModal |
| src/components/DatabaseModal.tsx | 9906 | DatabaseModal |
| src/components/FrameSlidersCard.tsx | 11174 | FrameSlidersCard |
| src/components/ManualAnchorPanel.tsx | 8221 | ManualAnchorPanel |
| src/components/MetricsPanel.tsx | 39221 | MetricsPanel |
| src/components/PitcherSetupCard.tsx | 12570 | PitcherSetupCard |
| src/components/PitchVideoPlayer.tsx | 22694 | PitchVideoPlayer |
| src/components/PitchVisualizer.tsx | 31075 | CameraViewMode, PitchVisualizer |
| src/components/VideoFrameScrubber.tsx | 15580 | VideoFrameScrubber |
| src/components/VideoQualityCard.tsx | 3976 | VideoQualityCard |
| src/confidenceEngine.ts | 8215 | ConfidenceInput, calculateUnifiedConfidence |
| src/index.css | 23 | 資源／設定／內容 |
| src/main.tsx | 231 | 資源／設定／內容 |
| src/matchingEngine.ts | 27715 | PITCH_DATABASE, PITCH_TYPE_OPTIONS, STANDARD_DISTANCE_METERS, FrameDetectionResult, getTopDatabaseCandidates, formatClockTime, analyzePitchFramesFrameByFrame, calculateVelocity, matchVelocityModule, matchSpinMovementModule, calibrateWithAIVisual, matchPitchData |
| src/motionDetector.ts | 6567 | CandidateSearchOptions, extractMotionCandidates |
| src/pitchDatabase.json | 11416330 | 資源／設定／內容 |
| src/services/autoFrameDetectionEngine.ts | 21150 | AutoFrameDetectionInput, AutoFrameDetectionOutput, AutoFrameDetectionEngine |
| src/services/ballCandidateDetector.ts | 6321 | CandidateRegion, BallVisualCandidate, CandidateSearchContext, detectBallCandidatesInFrame |
| src/services/ballDetectionEngine.ts | 6257 | BallDetectionEngineOptions, BallDetectionEngine |
| src/services/movementDatabaseMatcher.ts | 13456 | DEFAULT_MATCHER_CONFIG, MatcherInput, MatcherResult, MovementDatabaseMatcher |
| src/services/physicsMeasurementEngine.ts | 15591 | PhysicsMeasurementInput, PhysicsMeasurementEngine |
| src/services/publicVideoIngestionService.ts | 2260 | PublicVideoImportMetadata, IngestedVideoPitchCandidate, PublicVideoIngestionService |
| src/services/robustTemporalTracker.ts | 16311 | TrackingPipelineOptions, TrackingPipelineResult, RobustTemporalTracker |
| src/services/spinInferenceEngine.ts | 10696 | DEFAULT_RELEASE_CORRECTION_CONFIG, SpinInferenceInput, InferredSpinResult, SpinInferenceEngine |
| src/services/syntheticPitchGenerator.ts | 5531 | SyntheticPitchGeneratorOptions, DatabaseMetadata, SyntheticPitchGenerator |
| src/services/trajectoryFitEngine.ts | 3482 | TrajectoryFitInput, TrajectoryFitEngine |
| src/services/trajectoryValidationService.ts | 8801 | ValidationInput, TrajectoryValidationResult, validateAndReconstructVideoTrack |
| src/services/videoLoadService.ts | 6248 | VideoLoadStatus, LoadedVideoSession, VideoLoadService |
| src/services/videoMetadataService.ts | 4138 | VideoMetadata, VideoQualityAssessment, probeVideoFps, assessVideoQuality, VideoMetadataService |
| src/services/videoTimingService.ts | 7188 | VideoTimingService |
| src/spatialCalibration.ts | 17692 | STANDARD_GLOVE_DISTANCE_METERS, DEFAULT_PITCHER_BIOMETRICS, computePitcherBiometrics, calibrate3DSpatialContext, alignAndStandardizeVideoSpatialContext, PhysicsReconstructionParams, reconstructPhysicsModelTrack, extractBaseballTrajectoryPoints |
| src/trajectoryProcessor.ts | 6937 | TrajectoryReconstructOptions, reconstructVideoTrack |
| src/types.ts | 16151 | CameraViewMode, PitcherBiometrics, PitchDistanceConfig, DecodedVideoFrame, VideoTiming, VideoQuality, ReleaseCandidate, BallCandidate, BallObservation, BaseballTrackPoint, TrackStatus, VideoTrackMetrics, TrajectoryValidation, PitchRecord, DatabaseFrameTrajectoryPoint, DatabaseMatchCandidate, VelocityMatchModuleResult, SpinMovementMatchModuleResult, SpatialCalibrationInfo, TrajectoryPoint, ManualAnchorInput, UnifiedConfidenceScores, MatchResult, ObservedPhysicsMetrics, TrajectoryFitMetrics, MeasurementUncertainty, AnalysisBasisInfo, MovementMatcherConfig, ReleaseAngleCorrectionConfig, MotionCandidate |
| tsconfig.json | 508 | 資源／設定／內容 |
| vite.config.ts | 708 | 資源／設定／內容 |
| __pycache__/app.cpython-310.pyc | 24487 | 資源／設定／內容 |
