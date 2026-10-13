import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Video, SkipBack, SkipForward, Pin, Target, Maximize2, Minimize2, CheckCircle2 } from 'lucide-react';
import { CameraViewMode } from './PitchVisualizer';
import { SpatialCalibrationInfo } from '../types';

interface PitchVideoPlayerProps {
  videoUrl: string | null;
  releaseFrame: number;
  gloveFrame: number;
  totalFrames: number;
  fps?: number;
  timestamps?: number[];
  isFpsEstimated?: boolean;
  viewMode: CameraViewMode;
  velocityKmh?: number;
  pitchName?: string;
  hasAnalyzed?: boolean;
  onCurrentFrameChange?: (frame: number) => void;
  targetFrameSeek?: number | null;
  onSetReleaseFrame?: (frame: number) => void;
  onSetGloveFrame?: (frame: number) => void;
  spatialCalibration?: SpatialCalibrationInfo;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onVideoElementReady?: (el: HTMLVideoElement | null) => void;
  isSelectingPoint?: 1 | 2 | null;
  onSelectCoordinate?: (xNorm: number, yNorm: number) => void;
  manualPoint1?: { frame: number; x_norm: number; y_norm: number } | null;
  manualPoint2?: { frame: number; x_norm: number; y_norm: number } | null;
}

export const PitchVideoPlayer: React.FC<PitchVideoPlayerProps> = ({
  videoUrl,
  releaseFrame,
  gloveFrame,
  totalFrames,
  fps = 30,
  timestamps,
  isFpsEstimated = false,
  viewMode,
  velocityKmh = 0,
  hasAnalyzed = false,
  onCurrentFrameChange,
  targetFrameSeek,
  onSetReleaseFrame,
  onSetGloveFrame,
  isExpanded = false,
  onToggleExpand,
  onVideoElementReady,
  isSelectingPoint = null,
  onSelectCoordinate,
  manualPoint1,
  manualPoint2
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentFrame, setCurrentFrame] = useState<number>(releaseFrame || 0);
  const [isMetadataReady, setIsMetadataReady] = useState<boolean>(false);

  // Helper: frame -> timestamp (優先使用 timestamps[]，否則使用 frame / fps)
  const frameToTimeSec = (frameIdx: number): number => {
    const safeFps = fps > 0 ? fps : 30;
    if (timestamps && timestamps.length > frameIdx && timestamps[frameIdx] !== undefined) {
      return timestamps[frameIdx];
    }
    return Math.max(0, frameIdx / safeFps);
  };

  // Helper: timestamp -> frame (優先二分搜尋或線性比對 timestamps[])
  const timeSecToFrame = (timeSec: number): number => {
    const safeFps = fps > 0 ? fps : 30;
    if (timestamps && timestamps.length > 0) {
      let bestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < timestamps.length; i++) {
        const d = Math.abs(timestamps[i] - timeSec);
        if (d < minDiff) {
          minDiff = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    }
    return Math.round(timeSec * safeFps);
  };

  // 當 videoUrl 改變時，強制執行 load() 並等待 loadedmetadata 完成後再通知 onVideoElementReady
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !videoUrl) {
      setIsMetadataReady(false);
      onVideoElementReady?.(null);
      return;
    }

    setIsPlaying(false);
    setIsMetadataReady(false);

    const handleLoadedMeta = () => {
      setIsMetadataReady(true);
      const initialFrame = releaseFrame > 0 ? releaseFrame : 0;
      setCurrentFrame(initialFrame);
      const safeDuration = videoEl.duration || (totalFrames > 0 ? totalFrames / Math.max(1, fps) : 10);
      const initialTime = Math.min(safeDuration, Math.max(0, frameToTimeSec(initialFrame)));
      try {
        videoEl.currentTime = initialTime;
      } catch {
        // Ignore seek error before readyState
      }
      onVideoElementReady?.(videoEl);
    };

    videoEl.addEventListener('loadedmetadata', handleLoadedMeta);
    videoEl.preload = 'metadata';
    videoEl.load();

    // 若瀏覽器已經快取 metadata (readyState >= 1)
    if (videoEl.readyState >= 1) {
      handleLoadedMeta();
    }

    return () => {
      videoEl.removeEventListener('loadedmetadata', handleLoadedMeta);
    };
  }, [videoUrl]);

  // Seek video when targetFrameSeek changes
  useEffect(() => {
    if (targetFrameSeek !== undefined && targetFrameSeek !== null && videoRef.current) {
      setCurrentFrame(targetFrameSeek);
      const safeDuration = videoRef.current.duration || (totalFrames > 0 ? totalFrames / Math.max(1, fps) : 10);
      const targetTime = Math.min(safeDuration, Math.max(0, frameToTimeSec(targetFrameSeek)));
      if (videoRef.current.readyState >= 1) {
        videoRef.current.currentTime = targetTime;
      }
    }
  }, [targetFrameSeek, fps, totalFrames, timestamps, isMetadataReady]);

  // Video timeupdate sync with currentFrame
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const frame = timeSecToFrame(videoRef.current.currentTime);
      setCurrentFrame(frame);
      if (onCurrentFrameChange) {
        onCurrentFrameChange(frame);
      }
    }
  };

  const handleVideoLoadedMetadata = () => {
    if (videoRef.current) {
      setIsMetadataReady(true);
      const initialFrame = releaseFrame > 0 ? releaseFrame : 0;
      setCurrentFrame(initialFrame);
      const initialTime = frameToTimeSec(initialFrame);
      videoRef.current.currentTime = initialTime;
      onVideoElementReady?.(videoRef.current);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (currentFrame >= totalFrames - 1) {
        videoRef.current.currentTime = 0;
      }
      videoRef.current.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  };

  // Step exact frames forward or backward
  const stepFrame = (delta: number) => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
    const maxF = totalFrames > 0 ? totalFrames : 500;
    const nextFrame = Math.max(0, Math.min(currentFrame + delta, maxF));
    setCurrentFrame(nextFrame);
    videoRef.current.currentTime = frameToTimeSec(nextFrame);
    if (onCurrentFrameChange) {
      onCurrentFrameChange(nextFrame);
    }
  };

  const seekToFrame = (targetFrame: number) => {
    if (!videoRef.current) return;
    const maxF = totalFrames > 0 ? totalFrames : 500;
    const safeTarget = Math.max(0, Math.min(targetFrame, maxF));
    setCurrentFrame(safeTarget);
    videoRef.current.currentTime = frameToTimeSec(safeTarget);
    if (onCurrentFrameChange) {
      onCurrentFrameChange(safeTarget);
    }
  };

  const playPitchInterval = () => {
    if (!videoRef.current) return;
    const startFrame = Math.max(0, releaseFrame - 10);
    videoRef.current.currentTime = frameToTimeSec(startFrame);
    setCurrentFrame(startFrame);
    videoRef.current.play().catch(() => setIsPlaying(false));
    setIsPlaying(true);
  };

  // Keyboard controls for fine frame inspection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepFrame(e.shiftKey ? -5 : -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepFrame(e.shiftKey ? 5 : 1);
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === '[' && onSetReleaseFrame) {
        e.preventDefault();
        onSetReleaseFrame(currentFrame);
      } else if (e.key === ']' && onSetGloveFrame) {
        e.preventDefault();
        onSetGloveFrame(currentFrame);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFrame, isPlaying, totalFrames, onSetReleaseFrame, onSetGloveFrame]);

  const isIntervalValid = gloveFrame > releaseFrame;

  return (
    <div className="space-y-3">
      {/* 乾淨無遮擋、高解析特大尺寸影片播放視窗 */}
      <div 
        className={`video-stage relative w-full rounded-2xl overflow-hidden bg-black border-2 border-slate-700/80 shadow-2xl flex items-center justify-center group transition-all duration-300 ${
          isExpanded ? 'min-h-[660px] h-[740px]' : 'min-h-[500px] h-[560px] lg:h-[620px]'
        }`}
      >
        {/* Real HTML5 Video - 純淨原始畫面，已完全移除覆蓋軌跡，讓使用者清晰檢視每一影格 */}
        {videoUrl ? (
          <div
            className={`w-full h-full relative flex items-center justify-center ${
              isSelectingPoint ? 'cursor-crosshair' : ''
            }`}
            onClick={(e) => {
              if (!isSelectingPoint || !onSelectCoordinate) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const clickY = e.clientY - rect.top;
              const xNorm = Number((Math.max(0, Math.min(1, clickX / rect.width))).toFixed(4));
              const yNorm = Number((Math.max(0, Math.min(1, clickY / rect.height))).toFixed(4));
              onSelectCoordinate(xNorm, yNorm);
            }}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-contain select-none"
              playsInline
              muted
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onEnded={() => setIsPlaying(false)}
            />

            {/* Manual Anchor Point 1 Marker */}
            {manualPoint1 && (
              <div
                className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-1/2 z-10 transition-transform"
                style={{
                  left: `${manualPoint1.x_norm * 100}%`,
                  top: `${manualPoint1.y_norm * 100}%`
                }}
              >
                <div className="w-5 h-5 rounded-full border-2 border-cyan-400 bg-cyan-500/40 animate-ping absolute -inset-0.5" />
                <div className="w-4 h-4 rounded-full border-2 border-white bg-cyan-500 shadow flex items-center justify-center text-[8px] font-bold text-slate-950">
                  1
                </div>
                <div className="absolute top-4 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-950/90 border border-cyan-500/60 text-cyan-300 text-[9px] font-mono whitespace-nowrap shadow">
                  錨點1: F{manualPoint1.frame}
                </div>
              </div>
            )}

            {/* Manual Anchor Point 2 Marker */}
            {manualPoint2 && (
              <div
                className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-1/2 z-10 transition-transform"
                style={{
                  left: `${manualPoint2.x_norm * 100}%`,
                  top: `${manualPoint2.y_norm * 100}%`
                }}
              >
                <div className="w-5 h-5 rounded-full border-2 border-amber-400 bg-amber-500/40 animate-ping absolute -inset-0.5" />
                <div className="w-4 h-4 rounded-full border-2 border-white bg-amber-500 shadow flex items-center justify-center text-[8px] font-bold text-slate-950">
                  2
                </div>
                <div className="absolute top-4 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-950/90 border border-amber-500/60 text-amber-300 text-[9px] font-mono whitespace-nowrap shadow">
                  錨點2: F{manualPoint2.frame}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-3 select-none">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-400 shadow-inner">
              <Video className="w-7 h-7 text-slate-500" />
            </div>
            <div className="space-y-1.5">
              <p className="text-base font-bold text-slate-200">尚未載入投球影片</p>
              <p className="text-xs text-slate-400 max-w-md">
                請於上方上傳 60fps 投球短片（或載入範例影片）。影片視窗已移除任何覆蓋軌跡，確保畫面純淨、逐格檢視清晰無阻。
              </p>
            </div>
          </div>
        )}

        {/* Top Overlay Bar */}
        {videoUrl && (
          <div className="absolute top-3.5 left-3.5 right-3.5 z-20 flex items-center justify-between pointer-events-auto">
            {/* Left Status Chips */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-slate-950/85 backdrop-blur-md border border-slate-700 text-slate-200 text-xs font-mono font-medium shadow">
                {viewMode === 'catcher' ? '📷 捕手平視視角' : '📷 投手後方平視視角'}
              </span>

              <span className="px-2.5 py-1 rounded-lg bg-slate-950/85 backdrop-blur-md border border-emerald-500/40 text-emerald-300 text-xs font-medium shadow flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>純淨影格檢視 (已移除覆蓋軌跡)</span>
              </span>

              {hasAnalyzed && velocityKmh > 0 && isIntervalValid && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-950/85 backdrop-blur-md border border-cyan-500/50 text-cyan-300 text-xs font-mono font-bold shadow">
                  初速: {velocityKmh} km/h
                </span>
              )}
            </div>

            {/* Right: Expand/Contract Button & Real-time Frame Counter */}
            <div className="flex items-center gap-2">
              {onToggleExpand && (
                <button
                  type="button"
                  onClick={onToggleExpand}
                  className="px-2.5 py-1 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium shadow flex items-center gap-1.5 transition-all"
                  title={isExpanded ? '切換標準大小' : '放大播放視窗 (劇院模式)'}
                >
                  {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  <span>{isExpanded ? '標準視窗' : '放大視窗'}</span>
                </button>
              )}

              {totalFrames > 0 && (
                <div className="px-3 py-1 rounded-lg bg-slate-950/90 backdrop-blur-md border border-slate-700 text-xs font-mono shadow-md">
                  <span className="text-slate-400">影格: </span>
                  <span className="text-cyan-400 font-bold text-sm">F{currentFrame}</span>
                  <span className="text-slate-500"> / F{totalFrames}</span>
                  <span className="text-slate-500 ml-1.5">({frameToTimeSec(currentFrame).toFixed(2)}s)</span>
                  {isFpsEstimated && (
                    <span className="text-amber-400 ml-1.5 text-[10px]">[FPS ESTIMATED]</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bottom Left Frame Markers indicator */}
        {videoUrl && (
          <div className="absolute bottom-3.5 left-3.5 z-20 pointer-events-none flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-slate-950/90 backdrop-blur-md border border-slate-800 text-xs font-mono shadow-lg flex items-center gap-2.5">
              <span className="text-red-400 font-bold flex items-center gap-1">
                <Pin className="w-3 h-3 fill-current" /> 出手: F{releaseFrame}
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-amber-400 font-bold flex items-center gap-1">
                <Target className="w-3 h-3 text-amber-400" /> 進手套: F{gloveFrame}
              </span>
            </div>
          </div>
        )}

        {/* Play/Pause Quick Float on Bottom Right */}
        {videoUrl && (
          <div className="absolute bottom-3.5 right-3.5 z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="p-2.5 rounded-xl bg-blue-600/90 hover:bg-blue-500 text-white shadow-xl backdrop-blur-sm transition-all active:scale-95 flex items-center gap-2 text-xs font-semibold px-4"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>暫停</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>播放</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Frame Scrubber and Micro-Navigation Toolbar */}
      {videoUrl && totalFrames > 0 && (
        <div className="bg-[#0b1329]/90 border border-slate-800 rounded-xl p-3 space-y-2.5 text-xs">
          {/* Timeline Range Slider */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
              <span className="text-slate-400 font-medium">影片時間軸逐格巡航 (按住滑桿可平滑檢視每一影格)</span>
              <span className="text-cyan-400 font-bold">第 {currentFrame} 幀 / 共 {totalFrames} 幀</span>
            </div>
            <input
              type="range"
              min={0}
              max={totalFrames}
              value={currentFrame}
              onChange={(e) => seekToFrame(Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
            />
          </div>

          {/* Stepping and Quick Marking Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1.5 border-t border-slate-800/80">
            {/* Left: Fine Stepping */}
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <span className="text-slate-500 mr-1 hidden sm:inline">逐格微調:</span>
              <button
                type="button"
                onClick={() => stepFrame(-5)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold active:scale-95 transition-all flex items-center gap-0.5"
                title="後退 5 幀"
              >
                <SkipBack className="w-3.5 h-3.5" />
                <span>-5</span>
              </button>
              <button
                type="button"
                onClick={() => stepFrame(-1)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold active:scale-95 transition-all"
                title="後退 1 幀"
              >
                -1
              </button>
              <button
                type="button"
                onClick={() => stepFrame(1)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold active:scale-95 transition-all"
                title="前進 1 幀"
              >
                +1
              </button>
              <button
                type="button"
                onClick={() => stepFrame(5)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold active:scale-95 transition-all flex items-center gap-0.5"
                title="前進 5 幀"
              >
                <span>+5</span>
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Middle: Set Current Frame as Release / Glove */}
            <div className="flex items-center gap-2">
              {onSetReleaseFrame && (
                <button
                  type="button"
                  onClick={() => onSetReleaseFrame(currentFrame)}
                  className="px-3 py-1.5 rounded-lg bg-red-950/80 hover:bg-red-900/90 border border-red-500/50 text-red-200 text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all"
                  title="將當前畫面影格設為出手影格"
                >
                  <Pin className="w-3.5 h-3.5 text-red-400" />
                  <span>設為出手 (F{currentFrame})</span>
                </button>
              )}

              {onSetGloveFrame && (
                <button
                  type="button"
                  onClick={() => onSetGloveFrame(currentFrame)}
                  className="px-3 py-1.5 rounded-lg bg-amber-950/80 hover:bg-amber-900/90 border border-amber-500/50 text-amber-200 text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all"
                  title="將當前畫面影格設為進手套影格"
                >
                  <Target className="w-3.5 h-3.5 text-amber-400" />
                  <span>設為進手套 (F{currentFrame})</span>
                </button>
              )}
            </div>

            {/* Right: Quick Jump to defined frames */}
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <button
                type="button"
                onClick={() => seekToFrame(releaseFrame)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-red-400 transition-colors"
                title="跳轉至已定義出手影格"
              >
                跳至出手(F{releaseFrame})
              </button>
              <button
                type="button"
                onClick={() => seekToFrame(gloveFrame)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-amber-400 transition-colors"
                title="跳轉至已定義進手套影格"
              >
                跳至進手套(F{gloveFrame})
              </button>
              <button
                type="button"
                onClick={playPitchInterval}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="重播投球區間"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
