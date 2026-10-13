# PitchVision V4.1 驗收紀錄

日期：2026-10-14。基於 V4 b41c312；沿用 baseline-v4 分支、現有 Render Static Site、Actions 與 Deploy Hook。本次有實際底層修正，但**尚未達成全部科學驗收**。

## A. 功能狀態

| 項目 | 狀態與驗證 |
|---|---|
| UI 排列 | 通過手機尺寸操作測試；上傳／基本設定 → 原播放器 → 播放、時間軸及手動控制 → 自動辨識／分析 → 結果／圖表 |
| 放大播放器 | 按鈕、額外視窗及專用 state／props 已移除；主播放器既有尺寸規則與比例保留 |
| 手動影格／錨點 | 統一在播放器下方；單一出手／接球狀態，原必要位置提示与幾何角點整合於同區。自動候選不覆蓋手動設定；需明確點選採用 |
| 科學資訊中心 | 通過；右上入口、原資料库、JSON／Python 下載、品質與完整結果診斷保留 |
| FPS／時間軸 | 通過兩支 MP4 容器 sample PTS 與非整數／VFR／壞 box 測試；不以檔名或無條件 30 FPS 分析。未知格式僅能估計時要求確認可信 CFR FPS |
| 逐格控制 | 移到相鄰 PTS，前後索引與 seek 時間通過；HTMLVideoElement 無法保证精確逐樣本解碼，介面已明示 |
| 自動事件辨識 | 已改善全片動態候選、外觀／連續性／殘差配對，兩部真實片仍未通過真正投球事件辨識；不輸出錯誤的高信心事件 |
| 球體追蹤 | 白色連通外觀、移動人體區排除、速度／加速度／殘差與短遮蔽閘門已實作；兩片手動投球區間未形成有效棒球軌跡，實際球體身份驗收未通過 |
| 攝影角度／3D | 沿用 spatialCalibration 入口；本機梯度提供可能 roll。已知矩形尺度角點可解 homography、焦距／姿態、條件座標，合成針孔回復測試通過；真實片沒有已知幾何參考，yaw／pitch 未可靠估定，非完整自動3D |
| 球速 | PTS 時差與距離一致；距離區分已知平面長度與身高／跨步先驗。時間敏感度不含距離系統誤差 |
| IVB／HB | 校正分支以真觀測二次擬合、中段阻力修正及同初值無旋轉重力＋阻力軌跡計算；缺尺度時保留原模型，揭露未截限值與受限參考值，不能當量測 |
| RPM／Axis／Efficiency | 保留舊手動模型；可靠條件重建才使用 Magnus 合力約束 active RPM／方向。Efficiency仍為先驗，總RPM不唯一；原手動直球旋轉欄位回歸通過 |
| 球種 | Knuckle Curve、Curveball、Cutter 精確別名修正通過；資料庫作先驗。兩片全資料庫自動分類仍無法可靠區別，未通過 |
| 可信度 | 真觀測與插值分離；無3個獨立重疊觀測時 fit_score=0、NOT_VALIDATED、RMSE未驗證。影像、幾何、先驗分來源；品質分數非成功機率 |

## B. 兩部真實影片

影片只在上層 test videos，本機瀏覽器處理，不提交、不部署。测试使用正常上傳與手動 UI，兩片都選「AI 全數據庫自動辨識」，**未把已知球種交給引擎作答案**。

人工密集影格檢視只能近似出手動作；遠端接球無法確認。下列手動時間是操作回歸選取，不是真值，不能拿來驗證絕對球速或旋轉精度。F 索引從0起。

| 項目 | 直球.mp4 | 彈指曲球.mp4 |
|---|---|---|
| 載入／播放／逐格／手動／分析／圖表 | 功能通過 | 功能通過 |
| 解析度、長度、影格數 | 720×1280；6.773333s；162 | 720×1280；6.530000s；156 |
| 時間表 FPS／平均呈現 FPS | 23.916811／23.917323 | 23.889032／23.889740 |
| 時間來源 | MP4 sample PTS；可變間隔 | MP4 sample PTS；可變間隔 |
| 自動出手／接球 | 未取得可靠配對；4個候選鏈點不足 | 未取得可靠配對；5個候選鏈點不足 |
| 手動操作選取 | F123 5.148333s → F133 5.565000s | F118 4.945000s → F130 5.446667s |
| 選取飛行時間 | 0.416667s | 0.501667s |
| 球速輸出（17.5m先驗距離） | 151.1km/h；一格時間敏感度±15.1 | 125.5km/h；一格時間敏感度±10.5 |
| 有效棒球軌跡 | 不足，0個保留觀測 | 不足，1個保留候選觀測 |
| 幾何校正 | 影像梯度已執行但證據不足，assumed／roll=0；yaw/pitch未估定 | 影像梯度已執行但證據不足，assumed／roll=0；yaw/pitch未估定 |
| 原模型 IVB／HB 參考（吋） | +25.6／+0.7；未截限 +33.1／+0.7 | +25.6／+0.7；未截限 +48.2／+0.7 |
| 原模型 RPM／Axis／Efficiency | 1750／12:49／95.1% | 2080／1:01／96.8% |
| 球種候選 | 直球先驗，不能視為已驗證分類 | 直球先驗，與已知彈指曲球不符：失敗 |

IVB/HB、RPM、Axis、Efficiency均為缺乏軌跡約束時保留的舊模型參考，**不是量測答案**。兩片均無雷達、光學真值、已知場地尺度或可靠接球標註，绝對精度未驗證。相同受限IVB值是保留的旧模型边界；新分支不以该截限冒充量測。

## C. 程式、測試與發佈

- TypeScript無錯、Vite正式Build通過；bundle約6.83MB（gzip約1.02MB）有大小警告，未為此更改架構。
- 原256組V3/V4全輸出比較，在凍結 baseline/v4/src 上通過；新版本有意修正時間／別名／物理與品質，**不宣稱V4.1所有輸出仍與V3相同**。
- V4.1科學测试50項通過：非整數／VFR、壞MP4範圍、相機重投影与條件3D、加速度／拖曳／旋轉方向、短轨迹质量、Knuckle Curve分類範圍、舊手動旋轉、無觀測不授予擬合分數。真實檔案只在本機執行，CI明確跳過缺少影片的4項（46項）。
- 两份JSON保留540／1080筆與原SHA-256；未生成／修改分布。Python與舊資料生成入口保留原樣，未當成網頁新科學引擎。
- 手机模擬：320／390／430／1440px無整頁水平溢出；影片、錯誤提示、重複上傳、手動優先、圖表、科學中心與下載已測。**沒有真實iPhone／Android或行動網路測試**。
- 原tests/browser.mjs与browser-v4.mjs保留歷史；舊主畫面資料庫入口與自動覆盖影格期待不再適用。V4.1版本保留上傳／播放／逐格／資料下載等覆蓋，并新增不覆盖手動與科學中心測試；未刪除舊失敗測試。
- 主要修改：App、PitchVideoPlayer、FrameSlidersCard、MetricsPanel、VideoQualityCard、ScientificInfoPanel、時間/載入服務、原tracker与候選/連續性服務、spatialCalibration、cameraGeometry、conditionedPhysics、physicsMeasurementEngine、matchingEngine、pitchTypeIdentity、trajectoryFitEngine、confidenceEngine及測試。React／TypeScript／Vite與依賴不更換。
- 發佈維持 https://pitchvision-v4-baseline.onrender.com 。沿用 origin baseline-v4 → Actions verify/build → 既有Hook → 同一Render Static Site。公開驗收資料記於忽略的test-results/v41-public/acceptance.json，實際部署SHA與結果以最終交付紀錄為準。

後續更新：pnpm run verify、pnpm run build → 檢查diff／不含影片憑證 → commit、push origin baseline-v4 → 確認Actions與Render live → 在公開網址執行test:e2e。不得重建服務或更换部署流程。

## 未通過與限制

1. 两支真实影片自动真正事件、有效球体追踪、自動球種差異辨識未通過。
2. 無已知場地幾何時，自動完整yaw／pitch／尺度／3D尚未完成；手動已知平面只建立條件重建。離地深度採時間與距離假設，仍存在投影與參數耦合。
3. RPM／Efficiency不能從單鏡頭唯一分離；保留合成資料庫先驗；實測精度無真值。
4. 容器PTS定位不等於瀏覽器精確解碼保證；不支持的容器仍需可信CFR設定。
5. 舊demo缺檔、獨立Python環境未部署，維持既有明確限制。

幾何方法參考：[OpenCV平面Homography與姿態限制](https://docs.opencv.org/4.5.5/d9/dab/tutorial_homography.html)。未加入模型、雲端API、後端或新付費資源。
