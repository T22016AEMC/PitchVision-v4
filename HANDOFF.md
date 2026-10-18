# PitchVision 手機版：本機 Claude Code 交接說明

> 把本檔放在 repo 根目錄，對本機 Claude Code 說：「讀 HANDOFF.md，從 Step 0 開始，每一步完成後停下來回報。」

## 1. 目標（使用者原話整理）

- 資料庫保存各球種在相同球速下、不同轉速與轉軸的球路。
- 使用者上傳影片並定義出手與進手套區間；程式追蹤每格球位置、建立球路，與資料庫比對，輸出最相似結果。
- 出手角、出手延伸、投手身高由程式判斷或校正；使用者可輸入自己的身高與投球距離。
- 球速：以平均速度（距離 ÷ 時間）回推**出手速度**。
- 轉速、轉軸：由出手角與位移量回推。
- FPS 不足：沿用既有 90Hz 補幀（僅輔助選取時間，不當作球的觀測）。
- 視角：**不改**。維持既有「捕手方向」與「投手方向」兩種，使用者兩種都會用。
- 使用情境是單人練習：**不假設有投手丘、投手板、捕手或其他場地設備**。
- 平台：手機瀏覽器，全部在本機執行，不需後端。
- 新專案採 mobile-first 重寫 UI；科學引擎、資料庫、動畫沿用。

## 2. 現況（已讀原始碼，分支 baseline-v4，V4.7，commit 893305b）

- 引擎在 `src/services/`，主流程在 `src/matchingEngine.ts` 的 `calibrateWithAIVisual`。
- 球速：`calculateVelocity` 只算 D/T 平均速度。`conditionedPhysics.ts` 的 `initialLongitudinalVelocity = expm1(kD·D)/(kD·T)` 已含阻力修正（kD=0.0062），17.5 m 時出手速度約比平均高 5.6%，但**沒有輸出到結果**。
- 位移回推轉速：`measureConditionedMovement` + `inferActiveSpin` 已實作，**但只有 `camera_geometry.method === 'planar_reference'`（點地面參照矩形）時才啟用**。無場地設備時會落到資料庫加權路徑，並套用「出手角修正」經驗係數（無物理依據）。
- `integrateCandidateFlight` 以固定接球高度 `CATCH_HEIGHT_M = 0.65` 求初速垂直分量，所以出手角是此假設的產物，不是量測。
- 補幀：`localFrameInterpolation.ts`、`motionInterpolation.ts`、`frameInterpolation.worker.ts` 已可用，推算像素不當觀測。
- 資料庫（`src/pitchDatabase.json`，1,080 筆）為生成資料；`velocity_kmh` 語義不清，原庫 IVB/HB 與 RK4 重建最大差 27.6 吋。不可改動原檔。
- 已記錄的未通過項目：自動出手/接球事件、實片軌跡擬合（POOR）。詳見 `SCIENTIFIC_ISSUES.md`、`docs/V4_7_PHYSICS.md`。

## 3. 不可違反的規則

1. **不改 `baseline/` 與兩份資料庫**；`tests/regression.mjs` 的雜湊與 256 組回歸要持續通過。
2. **不為了讓測試通過而調參數或改測試。** 測試失敗先找原因。
3. **每項改動都要有前後誤差對比**（見第 5 節基準）。變差就不採用。
4. 每個輸出數字標明來源：影像量測／物理模型推算／資料庫先驗，並附不確定區間。
5. **轉速與轉動效率不能由單鏡頭唯一決定**（見參考 R3）：以範圍輸出，不要輸出看似精確的單一值。
6. 參考他人專案時**只學方法與公式，不複製程式碼**；要使用其程式碼或模型權重前，先確認授權與訓練資料條款，並記入 `REFERENCES.md`（來源、版本、授權、用途、與本專案差異）。
7. 沒有真實儀器真值前，不得宣稱「實拍更準」。報告中分開寫「合成影片自洽」與「實拍驗證」。

## 4. 施工順序與各步參考

### Step 0：建立新的 mobile-first 專案
- 引擎、資料庫、`PitchVisualizer` 動畫原封搬入；重寫手機 UI（單手直式：選影片 → 標出手/接球 → 分析 → 結果卡片與動畫）。
- 資料庫改為延遲載入（11.4 MB）；確認雜湊不變。
- 驗收：`pnpm run verify` 通過、build 成功、手機尺寸流程可跑完；用 Playwright 實跑。

### Step 1：建立準確度基準
- 用既有 `syntheticPitchGenerator.ts` 與 `tests/generate-fps-fixtures.mjs` 的思路，產生**已知真值**的合成投球影片：兩種視角、30/60/120 FPS、不同球種／球速／轉速／轉軸／出手高度。
- 量化目前誤差：球速、出手速度、IVB、HB、球種、轉軸、出手角。輸出 `test-results/baseline-accuracy.json`。
- 參考：R1（驗證 RK4／Magnus 實作與已知算例一致）。

### Step 2：輸出出手速度
- 把 `integrateCandidateFlight` 的初速向量（vy、vz）合成為出手速度，與平均速度一併顯示。
- 阻力係數 kD 與升力係數需對照 R1 的參數化檢視；不確定時以區間顯示，不要偷偷調整。
- 驗收：合成真值下，出手速度誤差低於基準；平均↔出手轉換自洽。

### Step 3：位移回推轉速轉軸不再依賴地面參照
- 尺度來源（擇可用者並互相檢查）：使用者輸入身高與投球距離；人體姿態估計（R4）取得出手附近的像素/公尺；重力自我標定（球的垂直落下量對應 ½gt²，需實測可行性，先用合成資料檢驗）；球直徑（7.3 cm，遠處像素太少，僅輔助）。
- 用量到的出手角與接球高度取代 0.65 m 先驗；若量不到，明確標示為先驗。
- 加速度分解（阻力＋重力＋Magnus）採 R3 的 Technique 2 思路；不要用「只加 ½gt²」的簡化法，因為會過度修正。
- 注意：單球的轉動效率估計雜訊大，可能得出橫向轉速大於總轉速；輸出時要處理並標示。
- 手機感測器（DeviceOrientation）只適用於**程式內直接錄影**；上傳檔案沒有傾斜資料，不要依賴。

### Step 4：軌跡擬合與追蹤
- 把「出手與接球時間」從人工輸入改為擬合輸出，人工標記只作初始值。擬合參數：初始位置、速度向量、有效轉軸、有效轉速；目標：最小化重投影誤差。可自寫小型 Levenberg–Marquardt，或評估授權相容的函式庫。
- 追蹤：評估學習式偵測（R2：TrackNet 系列、WASB-SBDT）。注意其訓練資料不是棒球投球；需要在合成或自有資料上微調，並測量瀏覽器端（ONNX/TF.js）在手機的速度與體積。保留現有手寫偵測器作為回退。
- 動態模糊長度可作子格速度的證據，列為後續評估項目。

### Step 5：補幀
- 保留現有 90Hz 補幀作為選取時間的 UI 輔助。**補幀不增加資訊，不可當作球的觀測，也不可宣稱降低事件不確定度。**
- 不建議換成 RIFE、FILM 等學習式補幀，除非基準顯示選取時間誤差確實下降。

### Step 6：發佈
- push 新分支，`pnpm run verify` 與 Render 建置通過後再合併。公開網址上以手機尺寸實測並記錄結果。

## 5. 驗證標準

- 合成真值：每項指標列出平均誤差、最大誤差、各視角各 FPS 分項。
- 實拍：由使用者提供附雷達／Rapsodo 等讀數的影片；影片不提交、不部署。
- 報告格式：改動前、改動後、差異；失敗或變差的嘗試也要記錄。

## 6. 參考資料（R 編號）

- R1 Alan Nathan 的棒球軌跡物理：<https://physics.csuchico.edu/baseball/Pubs/Statcast.pdf>、<https://baseball.physics.illinois.edu/HawkeyeSpinAnalysis-Part%20I-rev1.pdf>、<https://baseball.physics.illinois.edu/trajectory-calculator-old.html>。用途：驗證 Magnus／阻力模型與單位，不複製程式碼。
- R2 球體偵測：TrackNet <https://arxiv.org/pdf/1907.03698>、TrackNetV4 <https://arxiv.org/pdf/2409.14543>、WASB-SBDT <https://arxiv.org/abs/2311.05237>（程式碼 <https://github.com/nttcom/WASB-SBDT>，授權待確認）。
- R3 位移、轉速、轉動效率的定義與限制：<https://tht.fangraphs.com/pitch-movement-spin-efficiency-and-all-that/>（Technique 2 加速度分解；陀螺式旋轉不可由球路觀測；單球效率雜訊）。
- R4 姿態估計：MediaPipe Pose Landmarker（Web）<https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js>（授權與模型條款待確認）。
- R5 單鏡頭軌跡重建的學術現況：桌球 3D 軌跡與旋轉 <https://arxiv.org/pdf/2511.20250>（旋轉只評估上/下旋二分類）；單視角棒球 <https://arxiv.org/html/2405.16296v1>（無數值誤差，不能當準確度依據）。
- 相機標定：OpenCV 的單應與 PnP 概念可參考；注意 opencv.js 預設建置可能不含 `solvePnP`，先評估專案既有 `cameraGeometry.ts` 是否已足夠。

## 7. 已知環境注意

- 需 Node 22、pnpm 11.4.0；部署流程見 `DEPLOYMENT.md`（Render Static Site，分支 baseline-v4，Actions 觸發 Deploy Hook）。
- 測試影片只在本機，不提交、不部署。

## 8. 5.0.3 狀態（相機／距離／事件／位移／球種／出手速度）

- 方法與限制見 `docs/GEOMETRY_FIT.md`；準確度對照見 `test-results/accuracy-5.0.3.json`（本機產生，不提交；`pnpm run eval:accuracy`）。
- 已做：C1 相機自動估計、D1 距離先驗（不含捕手後縮）、A4 撞網事件擬合、M1 位移重算（含範圍）、P1 球種前三名、A2 出手速度。
- 未做（5.0.4）：轉速、轉軸的物理回推。
- 未解：慣用手（資料庫沒有）、距離與尺度單鏡頭無法量測、IVB 範圍寬、直球實拍的球種前三名沒有出現四縫線直球。
