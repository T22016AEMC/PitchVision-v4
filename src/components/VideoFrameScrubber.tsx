import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, ChevronLeft, ChevronRight, Target, Flame, CheckCircle2 } from 'lucide-react';

interface VideoFrameScrubberProps {
  videoUrl: string | null;
  totalFrames: number;
  fps?: number;
  releaseFrame: number;
  gloveFrame: number;
  onSetReleaseFrame: (frame: number) => void;
  onSetGloveFrame: (frame: number) => void;
  isDemo?: boolean;
}

export const VideoFrameScrubber: React.FC<VideoFrameScrubberProps> = ({
  videoUrl,
  totalFrames,
  fps = 60,
  releaseFrame,
  gloveFrame,
  onSetReleaseFrame,
  onSetGloveFrame,
  isDemo = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [currentFrame, setCurrentFrame] = useState<number>(releaseFrame || 0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeMarkerTarget, setActiveMarkerTarget] = useState<'release' | 'glove' | null>(null);

  // Sync current frame when releaseFrame is set externally
  useEffect(() => {
    if (releaseFrame >= 0) {
      setCurrentFrame(releaseFrame);
    }
  }, [releaseFrame]);

  // Sync HTML5 video currentTime with currentFrame
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.duration) {
      const targetTime = Math.min(video.duration, Math.max(0, currentFrame / fps));
      if (Math.abs(video.currentTime - targetTime) > 0.02) {
        video.currentTime = targetTime;
      }
    }
  }, [currentFrame, fps]);

  // Video playback loop for uploaded real video or demo simulation
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();
    const frameInterval = 1000 / fps;

    const loop = (now: number) => {
      if (isPlaying && totalFrames > 0) {
        if (now - lastTime >= frameInterval) {
          setCurrentFrame((prev) => {
            const next = prev + 1;
            if (next >= totalFrames) {
              setIsPlaying(false);
              return 0;
            }
            return next;
          });
          lastTime = now;
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, totalFrames, fps]);

  // Step forward or backward by single frame
  const stepFrame = (delta: number) => {
    setIsPlaying(false);
    setCurrentFrame((prev) => Math.max(0, Math.min(totalFrames, prev + delta)));
  };

  const jumpToFrame = (frame: number) => {
    setIsPlaying(false);
    setCurrentFrame(Math.max(0, Math.min(totalFrames, frame)));
  };

  const markCurrentAsRelease = () => {
    onSetReleaseFrame(currentFrame);
    setActiveMarkerTarget('release');
    setTimeout(() => setActiveMarkerTarget(null), 1200);
  };

  const markCurrentAsGlove = () => {
    onSetGloveFrame(currentFrame);
    setActiveMarkerTarget('glove');
    setTimeout(() => setActiveMarkerTarget(null), 1200);
  };

  const currentSeconds = (currentFrame / fps).toFixed(3);
  const flightSpanFrames = Math.max(0, gloveFrame - releaseFrame);
  const flightSpanSeconds = (flightSpanFrames / fps).toFixed(3);

  // Whether current frame is at release or glove
  const isAtRelease = currentFrame === releaseFrame;
  const isAtGlove = currentFrame === gloveFrame;

  return (
    <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-4 space-y-3.5 shadow-md">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500"></span>
          </span>
          <span className="text-xs font-bold text-white tracking-wide">
            🎬 上傳影片逐格同步檢視器 (60 FPS 精準對齊)
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-400">當前影格:</span>
          <span className="px-2 py-0.5 rounded bg-slate-950 text-cyan-400 font-bold border border-cyan-500/30">
            F{currentFrame}
          </span>
          <span className="text-slate-500">({currentSeconds}s)</span>
        </div>
      </div>

      {/* Embedded Video Display Screen */}
      <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-slate-800 shadow-inner flex items-center justify-center">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            playsInline
            muted
            onTimeUpdate={() => {
              if (videoRef.current) {
                setCurrentFrame(Math.round(videoRef.current.currentTime * fps));
              }
            }}
          />
        ) : (
          <div className="text-center p-6 space-y-2">
            <div className="w-10 h-10 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-400">
              🎞️
            </div>
            <p className="text-xs text-slate-400">未上傳影片或處於範例狀態</p>
          </div>
        )}

        {/* Floating Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5 pointer-events-none">
          {isAtRelease && (
            <div className="px-2.5 py-1 rounded-md bg-red-600/90 text-white text-[11px] font-bold tracking-wider flex items-center gap-1.5 shadow-lg border border-red-400 animate-bounce">
              <Flame className="w-3.5 h-3.5" />
              🔴 當前影格為：【出手時間 (Release Point)】F{releaseFrame}
            </div>
          )}
          {isAtGlove && (
            <div className="px-2.5 py-1 rounded-md bg-amber-500/90 text-slate-950 text-[11px] font-bold tracking-wider flex items-center gap-1.5 shadow-lg border border-amber-300 animate-bounce">
              <Target className="w-3.5 h-3.5" />
              🟡 當前影格為：【進手套時間 (Glove Catch)】F{gloveFrame}
            </div>
          )}
          {activeMarkerTarget && (
            <div className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-bold tracking-wider flex items-center gap-1.5 shadow-md">
              <CheckCircle2 className="w-3.5 h-3.5" />
              已成功鎖定{activeMarkerTarget === 'release' ? '出手影格' : '進手套影格'}！
            </div>
          )}
        </div>

        {/* Bottom Left: Quick Frame Scrubber Indicators */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-800 text-[10.5px] font-mono">
          <span className="text-red-400 font-bold">出手: F{releaseFrame}</span>
          <span className="text-slate-600">|</span>
          <span className="text-amber-400 font-bold">進手套: F{gloveFrame}</span>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-400 font-bold">區間: {flightSpanFrames} 幀 ({flightSpanSeconds}s)</span>
        </div>
      </div>

      {/* Frame Stepping & Playback Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {/* Playback Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsPlaying(!isPlaying)}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow transition-colors"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? '暫停' : '播放影片'}</span>
          </button>

          <button
            type="button"
            onClick={() => stepFrame(-5)}
            className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition-colors"
            title="後退 5 影格"
          >
            -5F
          </button>

          <button
            type="button"
            onClick={() => stepFrame(-1)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1 transition-colors"
            title="後退 1 影格 (微調)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            前一格
          </button>

          <button
            type="button"
            onClick={() => stepFrame(1)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1 transition-colors"
            title="前進 1 影格 (微調)"
          >
            下一格
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => stepFrame(5)}
            className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition-colors"
            title="前進 5 影格"
          >
            +5F
          </button>
        </div>

        {/* Quick Jump Buttons to Release / Glove */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => jumpToFrame(releaseFrame)}
            className="px-2.5 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-900/80 text-red-300 border border-red-500/30 text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <Flame className="w-3 h-3 text-red-400" />
            跳至出手 F{releaseFrame}
          </button>

          <button
            type="button"
            onClick={() => jumpToFrame(gloveFrame)}
            className="px-2.5 py-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900/80 text-amber-300 border border-amber-500/30 text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <Target className="w-3 h-3 text-amber-400" />
            跳至進手套 F{gloveFrame}
          </button>

          <button
            type="button"
            onClick={() => jumpToFrame(0)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title="回到影片起點 (F0)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Visual Scrubber Timeline with Release & Glove Markers */}
      <div className="space-y-1.5 pt-1">
        <div className="relative pt-3 pb-1">
          {/* Release Point Marker Pin */}
          <div
            className="absolute top-0 -translate-x-1/2 z-10 flex flex-col items-center pointer-events-none cursor-pointer"
            style={{ left: `${(releaseFrame / Math.max(1, totalFrames)) * 100}%` }}
          >
            <span className="text-[9px] font-bold font-mono bg-red-600 text-white px-1.5 py-0.2 rounded shadow">
              出手 F{releaseFrame}
            </span>
            <div className="w-1.5 h-2 bg-red-500 clip-path-triangle"></div>
          </div>

          {/* Glove Arrival Marker Pin */}
          <div
            className="absolute top-0 -translate-x-1/2 z-10 flex flex-col items-center pointer-events-none cursor-pointer"
            style={{ left: `${(gloveFrame / Math.max(1, totalFrames)) * 100}%` }}
          >
            <span className="text-[9px] font-bold font-mono bg-amber-500 text-slate-950 px-1.5 py-0.2 rounded shadow">
              進手套 F{gloveFrame}
            </span>
            <div className="w-1.5 h-2 bg-amber-400 clip-path-triangle"></div>
          </div>

          {/* Slider input */}
          <input
            id="video-timeline-scrubber"
            type="range"
            min={0}
            max={totalFrames}
            value={currentFrame}
            onChange={(e) => {
              setIsPlaying(false);
              setCurrentFrame(Number(e.target.value));
            }}
            className="w-full h-2.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
          />
        </div>

        {/* Flight span highlighted bar info */}
        <div className="flex items-center justify-between text-[10.5px] text-slate-400 font-mono">
          <span>0s (F0)</span>
          <span className="text-cyan-300 font-semibold">
            {currentFrame} 幀 ({currentSeconds}s)
          </span>
          <span>{(totalFrames / fps).toFixed(2)}s (F{totalFrames})</span>
        </div>
      </div>

      {/* 自定義定義出手與進手套時間影格按鈕 (重點功能) */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-200 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-cyan-400" />
            自己定義出手與進手套影格 (直接設定當前畫面幀)
          </span>
          <span className="text-[11px] text-slate-400">
            請播放或逐格按鈕移動至目標瞬間後點擊
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          {/* Button 1: Set Current Frame as Release */}
          <button
            id="btn-set-current-as-release"
            type="button"
            onClick={markCurrentAsRelease}
            className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-between transition-all border shadow-sm ${
              isAtRelease
                ? 'bg-red-600/30 border-red-500 text-red-200 ring-1 ring-red-500/50'
                : 'bg-slate-900 hover:bg-red-950/50 border-slate-700 hover:border-red-500/60 text-slate-200 hover:text-red-300'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0"></span>
              <span>設當前影格為【出手點】</span>
            </span>
            <span className="font-mono text-red-400 bg-slate-950 px-2 py-0.5 rounded border border-red-500/30">
              設定為 F{currentFrame}
            </span>
          </button>

          {/* Button 2: Set Current Frame as Glove */}
          <button
            id="btn-set-current-as-glove"
            type="button"
            onClick={markCurrentAsGlove}
            className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-between transition-all border shadow-sm ${
              isAtGlove
                ? 'bg-amber-500/30 border-amber-400 text-amber-200 ring-1 ring-amber-400/50'
                : 'bg-slate-900 hover:bg-amber-950/50 border-slate-700 hover:border-amber-500/60 text-slate-200 hover:text-amber-300'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0"></span>
              <span>設當前影格為【進手套點】</span>
            </span>
            <span className="font-mono text-amber-400 bg-slate-950 px-2 py-0.5 rounded border border-amber-500/30">
              設定為 F{currentFrame}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
