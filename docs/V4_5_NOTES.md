# PitchVision V4.5 開發交付

本版沿用 V4.4，未變更部署架構或播放器／90 FPS。這是程式交付，追蹤效果、手機實機與科學準確度由使用者驗收。

## 實際修改

- `src/App.tsx`：預設啟用既有追蹤入口，以出手／進手套媒體秒數選取原始 PTS 區間；傳遞候選搜尋先驗、取消判斷、觀測及明確回退原因。原手動事件、球速、分析按鈕資料流程保持不變。
- `src/baseballTracker.ts`：重用 VideoTimingService；隔離於隱藏本機解碼器逐張擷取，保留三張影像緩衝。只接受呈現時間符合來源 PTS、未重複的畫面；擷取不確定的影格跳過並記錄。分析畫面最長邊上限1280，不更改播放器或補幀畫質；只存小型候選列表。
- `src/services/ballCandidateDetector.ts`：重用現有亮度、局部反差與前後影格差分，加入實際局部形狀／質心／尺寸計算；保留24個候選。分條帶讓出主執行緒，不使用假固定圓形分數。
- `src/services/robustTemporalTracker.ts`：新增16路有限多假設時序關聯，以真實時間差、速度／加速度與預測殘差關聯；短缺口只用於內部預測，不輸出假觀測。舊追蹤API保留。
- `src/services/projectedDatabaseMatcher.ts`：重用V4.4相機與投影。搜尋先驗最多取24筆速度合理候選、25個時間節點及7／14組姿態，僅柔性輔助關聯，不排除先驗外的影像候選。真實觀測以信心加權投影位置殘差排名；不再把同源球速／時間當兩份證據。缺少可靠軌跡時保留原時間／球速路徑。
- `src/services/conditionedPhysics.ts`、`physicalCandidates.ts`：新增候選專用RK4積分，沿用既有重力、阻力與升力係數，Magnus方向採有效橫向旋轉向量與速度的叉積；XYZ同時積分，不再線性填入深度。以原庫時間／距離、原出手高度及共同0.65m接球高度先驗求初值；初始水平速度設零是條件先驗，不是影片量測。舊逆推API與球速公式不改。
- `src/matchingEngine.ts`：資料庫仍提供最終RPM、Axis、Efficiency與IVB/HB；條件逆推只在有真實觀測時提供方向／加速度／有效旋轉的診斷，不另加一份評分。保留候選RPM、效率與軸的歧義範圍，明示低辨識度情境。
- `package.json`、`index.html`：版本4.5.0／V4.5。
- `tests/v45.mjs`：15項最小開發檢查，接入原regression入口。`tests/v411.mjs`保留歷史雜湊檢查：已變更的追蹤器使用既有v4快照，baseballTracker與conditionedPhysics使用新增v44原檔快照；其餘原檔仍受保護。

## 重用與參考

沒有複製外部專案程式、下載模型權重或新增套件。以下僅參考公開方法說明，再以既有TypeScript模組獨立實作：

- [ML-auto-baseball-pitching-overlay](https://github.com/chonyy/ML-auto-baseball-pitching-overlay)：偵測與SORT運動關聯分工；本版不是YOLO或完整SORT/Kalman實作。
- [baseball-tracking](https://github.com/pascalewalters/baseball-tracking)：偵測點資料、追蹤與遮蔽限制。其插補點不被本版當作觀測。
- [TrackNetV3](https://github.com/qaz812345/TrackNetV3)：多影格／背景與缺口處理的概念；未引入TrackNet、InpaintNet或其修補網路。
- [pitchphys](https://github.com/jman4162/pitchphys)、[BallFlight](https://github.com/diamondkinetics/BallFlight)、[Baseball-Flight-Calculator](https://github.com/AndRoo88/Baseball-Flight-Calculator)：重力／阻力／Magnus、有效旋轉與無旋轉基準、數值積分的概念。本版保留PitchVision既有係數，未搬用這些專案的公式程式碼或完整模型。
- ball_flight_simulator連結讀取失敗；未將未能確認的內容列為實作依據。

## 開發檢查與限制

- TypeScript與Production Build通過；Build仍有既有大型bundle提示。
- V4.5最小檢查15項通過：移動小球、靜態亮點排除、多候選與單張缺失、無假觀測、積分深度與端點、無旋轉基準、投影排名、逆推接線、手動無PTS回退、原始JSON保留。
- 直接受影響的V4.4檢查3329項、V4.1.1輕量回歸70項通過。這些只驗證開發一致性，不是追蹤或科學準確度驗收；有相機擾動時近似候選可互換。
- 未跑真實投球影片、瀏覽器E2E、手機效能／準確率或部署驗收，依本次精簡驗收要求執行。
- 原始1,080筆JSON、球種數量、球速公式、事件秒數、PTS解析、90FPS與相機標定均未修改。原資料庫IVB/HB與新積分位移仍可能不一致，結果診斷會同時列出兩者；未覆寫原庫或宣稱已修正所有科學不一致。
- 這是傳統視覺與時序追蹤，沒有受訓棒球辨識器，不能保證明亮候選就是球。白色衣物、攝影機移動、過小／嚴重模糊球體仍可能誤判或無觀測。
- 無真實PTS、瀏覽器不回報呈現時間或定位不可靠時，不捏造逐格觀測；手動媒體時間分析仍保留。初始化／定位有逾時與資源清理，三次連續解碼錯誤停止掃描。
- 逆推依賴候選積分深度、相機姿態和固定阻力係數；不能獨立量測Drag、總RPM、Spin Efficiency或唯一3D。多姿態範圍及評分容許候選不是統計信賴區間；未使用逆推硬裁剪弱幾何情境，以免排除真球。
