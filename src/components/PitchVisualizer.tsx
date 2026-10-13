import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, Sparkles, Eye, CheckCircle2 } from 'lucide-react';
import { BaseballTrackPoint, TrajectoryPoint } from '../types';

export type CameraViewMode = 'catcher' | 'pitcher_rear';

interface PitchVisualizerProps {
  releaseFrame: number;
  gloveFrame: number;
  totalFrames: number;
  velocityKmh: number;
  pitchName: string;
  userVideoUrl?: string | null;
  videoUrl?: string | null;
  onFrameSelect?: (frame: number) => void;
  isRendered?: boolean;
  viewMode?: CameraViewMode;
  onViewModeChange?: (mode: CameraViewMode) => void;
  ivbInch?: number;
  hbInch?: number;
  hasVideoUploaded?: boolean;
  videoTrack?: BaseballTrackPoint[];
  modelTrack?: TrajectoryPoint[];
  flightTimeSec?: number;
  spatialCalibration?: any;
  spinAxis?: string;
}

export const PitchVisualizer: React.FC<PitchVisualizerProps> = ({
  releaseFrame,
  gloveFrame,
  totalFrames,
  velocityKmh,
  pitchName,
  userVideoUrl,
  videoUrl,
  isRendered = true,
  viewMode = 'catcher',
  onViewModeChange,
  ivbInch = 15.0,
  hbInch = 0.0,
  hasVideoUploaded = true,
  videoTrack = [],
  modelTrack = []
}) => {
  const effectiveVideoUrl = userVideoUrl || videoUrl || null;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentFrame, setCurrentFrame] = useState<number>(releaseFrame || 0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [internalViewMode, setInternalViewMode] = useState<CameraViewMode>(viewMode);
  // 雙軌顯示獨立開關
  const [showVideoTrack, setShowVideoTrack] = useState<boolean>(true);
  const [showModelTrack, setShowModelTrack] = useState<boolean>(true);

  // Sync internal viewMode with external prop if provided
  useEffect(() => {
    setInternalViewMode(viewMode);
  }, [viewMode]);

  // Keep currentFrame in sync when releaseFrame changes upon video upload
  useEffect(() => {
    if (releaseFrame) {
      setCurrentFrame(releaseFrame);
    }
  }, [releaseFrame]);

  const handleViewChange = (mode: CameraViewMode) => {
    setInternalViewMode(mode);
    if (onViewModeChange) {
      onViewModeChange(mode);
    }
  };

  // Play animation loop (60 FPS = ~16.6ms per frame)
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (time: number) => {
      if (isPlaying && totalFrames > 0) {
        if (time - lastTime >= 16.6) {
          setCurrentFrame((prev) => {
            const next = prev + 1;
            if (next >= totalFrames) {
              return 0;
            }
            return next;
          });
          lastTime = time;
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, totalFrames]);

  // Render canvas frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Draw field background according to the selected view mode
    if (effectiveVideoUrl && videoRef.current && videoRef.current.readyState >= 2 && internalViewMode === 'catcher') {
      try {
        ctx.drawImage(videoRef.current, 0, 0, width, height);
      } catch {
        drawField(ctx, width, height, internalViewMode);
      }
    } else {
      drawField(ctx, width, height, internalViewMode);
    }

    if (hasVideoUploaded && releaseFrame > 0 && gloveFrame > releaseFrame) {
      if (internalViewMode === 'catcher') {
        renderCatcherPerspective(ctx, width, height);
      } else {
        renderPitcherRearPerspective(ctx, width, height);
      }
    }

    // Common HUD Overlay
    renderHUD(ctx, width, height, internalViewMode);

  }, [currentFrame, isRendered, isPlaying, pitchName, gloveFrame, releaseFrame, totalFrames, effectiveVideoUrl, velocityKmh, internalViewMode, ivbInch, hbInch, hasVideoUploaded]);

  // ===========================================================================
  // 視角一：捕手低視角平視 (Catcher Eye-Level / Umpire POV)
  // 低角度水平視角：直接從本壘板後方水平看向投手丘，好球帶九宮格立體呈現於正前方
  // 能清楚看見球路的橫向位移 (HB: 伸卡尾勁/滑球橫移) 與垂直位移 (IVB: 升直球/曲球垂直下墜)
  // ===========================================================================
  const renderCatcherPerspective = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // 遠處投手丘釋球點 (遠景平視: y ≈ 43%)
    const pRel = { x: width * 0.475, y: height * 0.43 };
    // 前景好球帶中心 (近景平視: y ≈ 54%)
    const pPlt = { x: width * 0.50, y: height * 0.54 };

    // 1. 正前方立體好球帶九宮格 (Eye-Level Strike Zone)
    const zoneW = width * 0.22;
    const zoneH = height * 0.32;
    const zoneX = pPlt.x - zoneW / 2;
    const zoneY = pPlt.y - zoneH / 2;

    // 好球帶外框高亮 (黃色: #FACC15)
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(zoneX, zoneY, zoneW, zoneH);

    // 九宮格內隔線
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(zoneX + zoneW / 3, zoneY);
    ctx.lineTo(zoneX + zoneW / 3, zoneY + zoneH);
    ctx.moveTo(zoneX + (zoneW * 2) / 3, zoneY);
    ctx.lineTo(zoneX + (zoneW * 2) / 3, zoneY + zoneH);
    ctx.moveTo(zoneX, zoneY + zoneH / 3);
    ctx.lineTo(zoneX + zoneW, zoneY + zoneH / 3);
    ctx.moveTo(zoneX, zoneY + (zoneH * 2) / 3);
    ctx.lineTo(zoneX + zoneW, zoneY + (zoneH * 2) / 3);
    ctx.stroke();

    // 好球帶標籤
    ctx.fillStyle = '#FACC15';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('STRIKE ZONE (平視好球帶)', zoneX - 8, zoneY - 8);

    // 2. 遠方紅色釋球點標記 (OpenCV 紅色: #EF4444)
    if (isRendered || currentFrame >= releaseFrame) {
      ctx.beginPath();
      ctx.arc(pRel.x, pRel.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#EF4444';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pRel.x, pRel.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 十字準心
      ctx.strokeStyle = '#FCA5A5';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pRel.x - 16, pRel.y);
      ctx.lineTo(pRel.x + 16, pRel.y);
      ctx.moveTo(pRel.x, pRel.y - 16);
      ctx.lineTo(pRel.x, pRel.y + 16);
      ctx.stroke();

      ctx.fillStyle = '#EF4444';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillText('RELEASE (釋球點)', pRel.x + 18, pRel.y - 4);

      // 3. 綠色飛行拋物軌跡 Trace (動態加入真實馬格努斯效應橫向 HB 與垂直 IVB 位移)
      const flightDuration = Math.max(1, gloveFrame - releaseFrame);
      const effectiveFrame = isRendered ? Math.max(currentFrame, gloveFrame) : currentFrame;
      const progress = Math.min(1, Math.max(0, (effectiveFrame - releaseFrame) / flightDuration));

      const calcBallPos = (t: number) => {
        // 馬格努斯力在後 1/3 飛行路徑大幅放大 (晚期位移 Late Break)
        const breakPower = Math.pow(t, 1.9);
        // 水平位移 HB: 17 英吋對應好球帶寬度
        const lateralPx = (hbInch / 17.0) * (zoneW * 0.60) * breakPower;
        // 垂直位移 IVB: 正值抗地心引力 (直球)，負值急墜 (曲球)
        const verticalPx = (-ivbInch / 17.0) * (zoneH * 0.42) * breakPower;
        // 自然重力弧線
        const naturalDrop = Math.pow(t, 1.8) * (zoneH * 0.26);

        const x = pRel.x + (pPlt.x - pRel.x) * t + lateralPx;
        const y = pRel.y + (pPlt.y - pRel.y) * t + verticalPx + naturalDrop;
        return { x, y };
      };

      // 3A. MODEL TRACK: 物理模型拋物線軌跡 (Emerald / Dashed or Solid)
      if (showModelTrack && effectiveFrame > releaseFrame) {
        ctx.beginPath();
        const steps = Math.floor(progress * 50);
        for (let i = 0; i <= steps; i++) {
          const t = i / 50;
          const { x, y } = calcBallPos(t);
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = 3.5;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      // 3B. VIDEO TRACK: 真實手機影片追蹤點 (Cyan / Points & Path)
      if (showVideoTrack && videoTrack && videoTrack.length > 0) {
        // 繪製 video track 點與折線
        ctx.beginPath();
        let started = false;
        for (const pt of videoTrack) {
          if (pt.frame <= effectiveFrame) {
            const px = pt.x_norm * width;
            const py = pt.y_norm * height;
            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else {
              ctx.lineTo(px, py);
            }
          }
        }
        if (started) {
          ctx.strokeStyle = '#06B6D4'; // Cyan
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 4]); // 虛線標記真實追蹤線
          ctx.stroke();
          ctx.setLineDash([]);

          // 繪製各影格追蹤錨點
          for (const pt of videoTrack) {
            if (pt.frame <= effectiveFrame) {
              const px = pt.x_norm * width;
              const py = pt.y_norm * height;
              const isRealObs = (pt.source as string) === 'observation' || pt.source === 'vision';
              ctx.beginPath();
              ctx.arc(px, py, isRealObs ? 4 : 3, 0, Math.PI * 2);
              ctx.fillStyle = isRealObs ? '#22D3EE' : '#F59E0B'; // 琥珀色為插值，青色為實測
              ctx.fill();
            }
          }
        }
      }

      // 4. 當前棒球動態位置 (透視放大 4px -> 17px)
      if (currentFrame >= releaseFrame && currentFrame <= gloveFrame + 8) {
        const t = Math.min(1, Math.max(0, (currentFrame - releaseFrame) / flightDuration));
        const { x: ballX, y: ballY } = calcBallPos(t);
        const ballR = 4 + t * 13; // 由遠處小球放大為近處大球

        ctx.shadowColor = '#22C55E';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(ballX, ballY, ballR, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.shadowBlur = 0;

        // 棒球紅色縫線細節
        if (ballR > 8) {
          ctx.strokeStyle = '#DC2626';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(ballX - ballR * 0.35, ballY, ballR * 0.65, -0.6, 0.6);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ballX + ballR * 0.35, ballY, ballR * 0.65, Math.PI - 0.6, Math.PI + 0.6);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(ballX, ballY, ballR + 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#22C55E';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  };

  // ===========================================================================
  // 視角二：投手後方低視角平視 (Pitcher Rear View / Broadcast Centerfield View)
  // 攝影機置於投手右肩/腰部後方平視本壘板，直視遠方好球帶與捕手
  // 能清楚看到球從手腕釋出後，朝遠方捕手手套橫移竄動或急速縱墜的完整軌跡
  // ===========================================================================
  const renderPitcherRearPerspective = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // 前景投手右手釋球點 (近景平視: y ≈ 56%)
    const pRel = { x: width * 0.43, y: height * 0.56 };
    // 遠方本壘好球帶中心 (遠景平視: y ≈ 47%)
    const pPlt = { x: width * 0.50, y: height * 0.47 };

    // 1. 遠方好球帶與捕手定位 (Eye-Level Target Zone)
    const zoneW = width * 0.12;
    const zoneH = height * 0.16;
    const zoneX = pPlt.x - zoneW / 2;
    const zoneY = pPlt.y - zoneH / 2;

    // 好球帶外框九宮格 (黃色: #FACC15)
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 2;
    ctx.strokeRect(zoneX, zoneY, zoneW, zoneH);

    // 九宮格虛線
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(zoneX + zoneW / 3, zoneY);
    ctx.lineTo(zoneX + zoneW / 3, zoneY + zoneH);
    ctx.moveTo(zoneX + (zoneW * 2) / 3, zoneY);
    ctx.lineTo(zoneX + (zoneW * 2) / 3, zoneY + zoneH);
    ctx.moveTo(zoneX, zoneY + zoneH / 3);
    ctx.lineTo(zoneX + zoneW, zoneY + zoneH / 3);
    ctx.moveTo(zoneX, zoneY + (zoneH * 2) / 3);
    ctx.lineTo(zoneX + zoneW, zoneY + (zoneH * 2) / 3);
    ctx.stroke();

    ctx.fillStyle = '#FACC15';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillText('TARGET ZONE (好球帶)', zoneX - 16, zoneY - 6);

    // 2. 近處紅色釋球點標記 (OpenCV 紅色: #EF4444)
    if (isRendered || currentFrame >= releaseFrame) {
      ctx.beginPath();
      ctx.arc(pRel.x, pRel.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#EF4444';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pRel.x, pRel.y, 16, 0, Math.PI * 2);
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 十字準心
      ctx.strokeStyle = '#FCA5A5';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pRel.x - 20, pRel.y);
      ctx.lineTo(pRel.x + 20, pRel.y);
      ctx.moveTo(pRel.x, pRel.y - 20);
      ctx.lineTo(pRel.x, pRel.y + 20);
      ctx.stroke();

      ctx.fillStyle = '#EF4444';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('RELEASE (釋球點)', pRel.x + 22, pRel.y + 4);

      // 3. 綠色飛行拋物軌跡 (向遠處鑽入)
      const flightDuration = Math.max(1, gloveFrame - releaseFrame);
      const effectiveFrame = isRendered ? Math.max(currentFrame, gloveFrame) : currentFrame;
      const progress = Math.min(1, Math.max(0, (effectiveFrame - releaseFrame) / flightDuration));

      const calcRearBallPos = (t: number) => {
        const breakPower = Math.pow(t, 1.9);
        const lateralPx = (hbInch / 17.0) * (zoneW * 0.65) * breakPower;
        const verticalPx = (-ivbInch / 17.0) * (zoneH * 0.45) * breakPower;
        const naturalDrop = Math.pow(t, 1.8) * (zoneH * 0.28);

        const x = pRel.x + (pPlt.x - pRel.x) * t + lateralPx;
        const y = pRel.y + (pPlt.y - pRel.y) * t + verticalPx + naturalDrop;
        return { x, y };
      };

      // 3A. MODEL TRACK: 物理模型拋物軌跡
      if (showModelTrack && effectiveFrame > releaseFrame) {
        ctx.beginPath();
        const steps = Math.floor(progress * 50);
        for (let i = 0; i <= steps; i++) {
          const t = i / 50;
          const { x, y } = calcRearBallPos(t);
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = 3.5;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      // 3B. VIDEO TRACK: 真實手機影片追蹤點
      if (showVideoTrack && videoTrack && videoTrack.length > 0) {
        ctx.beginPath();
        let started = false;
        for (const pt of videoTrack) {
          if (pt.frame <= effectiveFrame) {
            const px = pt.x_norm * width;
            const py = pt.y_norm * height;
            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else {
              ctx.lineTo(px, py);
            }
          }
        }
        if (started) {
          ctx.strokeStyle = '#06B6D4';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          for (const pt of videoTrack) {
            if (pt.frame <= effectiveFrame) {
              const px = pt.x_norm * width;
              const py = pt.y_norm * height;
              const isRealObs = (pt.source as string) === 'observation' || pt.source === 'vision';
              ctx.beginPath();
              ctx.arc(px, py, isRealObs ? 4 : 3, 0, Math.PI * 2);
              ctx.fillStyle = isRealObs ? '#22D3EE' : '#F59E0B';
              ctx.fill();
            }
          }
        }
      }

      // 4. 當前棒球動態位置 (透視縮小 16px -> 4.5px)
      if (currentFrame >= releaseFrame && currentFrame <= gloveFrame + 8) {
        const t = Math.min(1, Math.max(0, (currentFrame - releaseFrame) / flightDuration));
        const { x: ballX, y: ballY } = calcRearBallPos(t);
        const ballR = Math.max(4, 16 - t * 11.5); // 由前景大球縮小為遠景小球

        ctx.shadowColor = '#22C55E';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(ballX, ballY, ballR, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(ballX, ballY, ballR + 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#22C55E';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  };

  // ===========================================================================
  // 球場底圖繪製 (支援 捕手視角 / 投手後方視角 - 低角度平視，非俯瞰)
  // ===========================================================================
  const drawField = (ctx: CanvasRenderingContext2D, width: number, height: number, mode: CameraViewMode) => {
    const horizonY = height * 0.48;

    if (mode === 'catcher') {
      // 捕手平視低角度球場
      // 1. 遠方球場外野看台與綠色全壘打牆 (上半部)
      ctx.fillStyle = '#0F1E17';
      ctx.fillRect(0, 0, width, horizonY);

      // 外野綠色牆面與深色打擊之眼 (Batter's Eye)
      ctx.fillStyle = '#173322';
      ctx.fillRect(0, horizonY - 45, width, 45);
      ctx.fillStyle = '#0D1B13';
      ctx.fillRect(width * 0.35, horizonY - 60, width * 0.30, 60);

      // 外野警示帶 (Warning Track)
      ctx.fillStyle = '#4E3321';
      ctx.fillRect(0, horizonY - 8, width, 8);

      // 2. 內野草皮 (下半部平視延伸)
      const turfGrad = ctx.createLinearGradient(0, horizonY, 0, height);
      turfGrad.addColorStop(0, '#1E3D2B');
      turfGrad.addColorStop(1, '#13281C');
      ctx.fillStyle = turfGrad;
      ctx.fillRect(0, horizonY, width, height - horizonY);

      // 遠方投手丘 (平視透視微凸形)
      ctx.fillStyle = '#6E4933';
      ctx.beginPath();
      ctx.ellipse(width * 0.48, horizonY + 6, width * 0.14, height * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();

      // 投手板白色細條
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(width * 0.46, horizonY + 1, width * 0.04, 3);

      // 前景本壘板紅土扇形區 (底部近景)
      ctx.fillStyle = '#5A3825';
      ctx.beginPath();
      ctx.ellipse(width * 0.50, height * 0.82, width * 0.36, height * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();

      // 本壘板 (平視透視五邊形，位於好球帶下方)
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.moveTo(width * 0.50, height * 0.74);
      ctx.lineTo(width * 0.45, height * 0.71);
      ctx.lineTo(width * 0.45, height * 0.69);
      ctx.lineTo(width * 0.55, height * 0.69);
      ctx.lineTo(width * 0.55, height * 0.71);
      ctx.closePath();
      ctx.fill();

      // 左右打擊區白線
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(width * 0.28, height * 0.64, width * 0.09, height * 0.14);
      ctx.strokeRect(width * 0.63, height * 0.64, width * 0.09, height * 0.14);

      // 遠方投手站立投球動作剪影 (迎面平視)
      if (hasVideoUploaded && releaseFrame > 0 && currentFrame < releaseFrame) {
        const armRatio = currentFrame / Math.max(1, releaseFrame);
        const headX = width * 0.48;
        const headY = horizonY - 32;

        ctx.fillStyle = '#CBD5E1';
        ctx.beginPath();
        ctx.arc(headX, headY, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(headX, headY + 7);
        ctx.lineTo(headX, horizonY + 2);
        ctx.stroke();

        const armAngle = armRatio * Math.PI * 0.8;
        const handX = headX - 18 * Math.cos(armAngle);
        const handY = headY + 5 + 14 * Math.sin(armAngle);
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(headX, headY + 5);
        ctx.lineTo(handX, handY);
        ctx.stroke();
      }
    } else {
      // 投手後方低角度平視球場 (Over-the-shoulder POV)
      // 1. 遠方本壘後方看台與擋網 (上半部)
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, width, horizonY);

      // 擋網細格紋理
      ctx.strokeStyle = '#1F2937';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, horizonY);
        ctx.stroke();
      }

      // 2. 內野草地
      const turfGrad = ctx.createLinearGradient(0, horizonY, 0, height);
      turfGrad.addColorStop(0, '#193324');
      turfGrad.addColorStop(1, '#234430');
      ctx.fillStyle = turfGrad;
      ctx.fillRect(0, horizonY, width, height - horizonY);

      // 遠方本壘板紅土小圓
      ctx.fillStyle = '#6E4933';
      ctx.beginPath();
      ctx.ellipse(width * 0.50, horizonY + 12, width * 0.12, height * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();

      // 遠方蹲捕之捕手剪影
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(width * 0.50, horizonY + 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.roundRect(width * 0.48, horizonY + 7, width * 0.04, 14, 3);
      ctx.fill();

      // 近處投手丘前緣與投球板
      ctx.fillStyle = '#5A3825';
      ctx.beginPath();
      ctx.ellipse(width * 0.45, height * 0.88, width * 0.35, height * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(width * 0.41, height * 0.84, width * 0.08, 4);

      // 投手身後背影 (低角度過肩呈現)
      const pX = width * 0.36;
      const pY = height * 0.76;

      ctx.fillStyle = '#1E3A8A'; // 深藍球衣背影
      ctx.beginPath();
      ctx.ellipse(pX, pY, 26, 38, -0.15, 0, Math.PI * 2);
      ctx.fill();

      // 背號
      ctx.fillStyle = '#FACC15';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('18', pX - 9, pY + 2);

      // 投手後腦帽簷
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(pX, pY - 40, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // ===========================================================================
  // HUD 抬頭顯示儀
  // ===========================================================================
  const renderHUD = (ctx: CanvasRenderingContext2D, width: number, height: number, mode: CameraViewMode) => {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(14, 14, 260, 72, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(`AI EST. VELOCITY: ${velocityKmh} km/h`, 24, 36);

    ctx.fillStyle = '#E2E8F0';
    ctx.font = '500 11.5px system-ui, sans-serif';
    ctx.fillText(`PITCH: ${pitchName.replace('🤖 ', '')}`, 24, 56);

    const modeLabel = mode === 'catcher' ? '🧤 捕手視角 (Catcher)' : '⚾ 投手後方視角 (Rear)';
    ctx.fillStyle = '#FACC15';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`CAM: ${modeLabel}`, 24, 73);

    // Frame counter
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.beginPath();
    ctx.roundRect(width - 130, 14, 116, 28, 6);
    ctx.fill();
    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px monospace';
    ctx.fillText(`FRAME: ${currentFrame.toString().padStart(2, '0')} / ${totalFrames}`, width - 120, 32);
  };

  return (
    <div id="pitch-visualizer-container" className="space-y-3">
      {/* Perspective Switcher Buttons */}
      <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 p-1.5 rounded-xl text-xs">
        <span className="text-slate-400 font-medium pl-2 flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5 text-blue-400" />
          攝影機視角切換：
        </span>
        <div className="flex items-center gap-1">
          <button
            id="btn-view-catcher"
            type="button"
            onClick={() => handleViewChange('catcher')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              internalViewMode === 'catcher'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <span>🧤 捕手視角</span>
            <span className="text-[10px] opacity-75">(Catcher)</span>
          </button>
          <button
            id="btn-view-pitcher-rear"
            type="button"
            onClick={() => handleViewChange('pitcher_rear')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              internalViewMode === 'pitcher_rear'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <span>⚾ 投手後方視角</span>
            <span className="text-[10px] opacity-75">(Pitcher Rear)</span>
          </button>
        </div>
      </div>

      {/* Video Canvas Container */}
      <div className="relative rounded-xl overflow-hidden border border-slate-700/60 bg-slate-950 shadow-lg aspect-[4/3] w-full flex items-center justify-center">
        <canvas
          id="pitch-canvas"
          ref={canvasRef}
          width={640}
          height={480}
          className="w-full h-full object-cover"
        />

        {effectiveVideoUrl && (
          <video
            ref={videoRef}
            src={effectiveVideoUrl}
            className="hidden"
            muted
            playsInline
          />
        )}

        {isRendered && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/80 border border-emerald-500/40 rounded-full text-emerald-400 text-xs font-semibold backdrop-blur-sm shadow-sm">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            AI 軌跡渲染已就緒 ({internalViewMode === 'catcher' ? '捕手視角' : '投手後方視角'})
          </div>
        )}
      </div>

      {/* Playback Controls & Frame Scrubber */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <button
              id="btn-toggle-play"
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-1.5 transition-colors shadow-sm text-xs"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? '暫停' : '播放投球動畫'}
            </button>
            <button
              id="btn-reset-frame"
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setCurrentFrame(releaseFrame);
              }}
              className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              重置至釋球點
            </button>
          </div>
          <div className="font-mono text-slate-400">
            影格：<span className="text-blue-400 font-bold">{currentFrame}</span> / {totalFrames}
          </div>
        </div>

        {/* Interactive scrubber */}
        <input
          id="scrubber-slider"
          type="range"
          min={0}
          max={totalFrames}
          value={currentFrame}
          onChange={(e) => {
            setIsPlaying(false);
            setCurrentFrame(Number(e.target.value));
          }}
          className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />

        {/* Legend & Track Toggles (符合需求：完全分開 Video Track 與 Model Track) */}
        <div className="flex flex-wrap items-center justify-between pt-2 text-[11px] text-slate-400 border-t border-slate-800/80 gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
              釋球點 (F{releaseFrame})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-yellow-400 inline-block"></span>
              進手套 (F{gloveFrame})
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Video Track */}
            <button
              type="button"
              id="toggle-video-track"
              onClick={() => setShowVideoTrack(!showVideoTrack)}
              className={`px-2 py-0.5 rounded text-[10.5px] font-mono flex items-center gap-1 border transition-all ${
                showVideoTrack
                  ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-300'
                  : 'bg-slate-900 border-slate-800 text-slate-500 line-through'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block"></span>
              <span>VIDEO TRACK (影片實測)</span>
              {videoTrack.length > 0 && <span className="text-[9px] opacity-75">({videoTrack.length}幀)</span>}
            </button>

            {/* Toggle Model Track */}
            <button
              type="button"
              id="toggle-model-track"
              onClick={() => setShowModelTrack(!showModelTrack)}
              className={`px-2 py-0.5 rounded text-[10.5px] font-mono flex items-center gap-1 border transition-all ${
                showModelTrack
                  ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-500 line-through'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
              <span>MODEL TRACK (物理模型)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
