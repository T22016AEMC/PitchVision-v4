# PitchVision V4.2.2 嚴格驗收報告

2026-10-14。以9c13802的V4.2.1為基準，僅修復上傳來源時間資訊、滑桿、事件介面与建立跨FPS驗證。UI配置／播放器尺寸、運動估計與原像素合成算法、科學模型／係數／資料庫及部署流程不變。

## 根因與修復

1. 原上傳路徑直接信任actualFps，缺少與PTS、樣本數一致性檢查；未知容器會默認30FPS並用duration×FPS產生位置。未發現將所有來源固定為24FPS的上傳邏輯。舊檔名FPS helper仍保留原碼，但這條上傳路徑不呼叫它。sourceTiming重算PTS平均間距FPS，驗證單調／數量／時長，MP4另核對STSZ／STTS數。未知來源現在是未知FPS、沒有已確認來源索引，須明確確認CFR才產生標示為假設的操作位置。
2. 未能以提供的合法實片直接重現0.0000FPS。可確認舊UI無驗證地toFixed，0值可被當來源显示。現在零／NaN／無效資料顯示「未知／待確認」，合法PTS可修復錯誤零值；零FPS不能進分析。沒有根據檔名或球種設定FPS。上傳清空舊資料，載入generation忽略過期回傳，避免前片污染新片。
3. V4.2.1滑桿有Pointer與Input兩套更新，preventDefault／捕捉與原生值可能競爭。直接改用原生range的第一輪測試仍在實片重現：點擊拇指附近新位置時值完全不變。最終只保留一套Pointer／鍵盤控制器，readOnly阻止原生值作第二狀態來源，拖曳／點擊映射操作位置，四鍵共用seek。取消／失去捕捉／换片／切模式會清除拖曳状态；请求ID及選取revision拒絕舊畫面。
4. 未知PTS改成空表後，測試發現get(0)产生undefined時間，確認FPS時畫面toFixed崩潰。已加入安全空游標與seek有效性檢查；真正WebM未知時間→確認24FPS→原手動分析回歸通過。沒有刪除失敗案例取得綠燈。

使用者手機30FPS／203格資料是另一份未取得檔案，不能當成本地23.9FPS／162格的相同影格序列。先前V3對電腦端檔案估計203位置的比較，不能用來否定手機203格可能是真實拍攝樣本。本次沒有宣稱已驗證手機原檔，或把傳輸／轉檔損失歸因於PitchVision。

## 時間與事件介面

原始模式只用這次檔案PTS；90Hz使用獨立時間索引，VFR按左右來源時刻求alpha；來源≥90FPS保持來源索引，0.001FPS邊界容差處理微秒時間戳量化的90FPS。没有降幀、重編碼或全片補幀快取。來源數與精細位置數始終分開。

SelectedEvent保存實際時間、original／interpolated／cfr_assumed與左右來源支持。eventAnalysisView新增sourceTimestamps（原PTS）、eventTimes（兩事件scalar）、engineTimingBridge（舊接口專用副本）。驗證事件與來源區間及橋的单調性；原PTS不修改，橋不傳到影片解碼／追蹤。保留timestamps旧別名供既有測試，App明確只將bridge用於原計算接口，解析與觀測一直用原PTS。

引擎未改公式：仍用距離／事件時間差。E2E從真正matchPitchData產生的flight_time_sec讀取data-engine-flight-seconds，核對與畫面選事件精確差相等；不是只檢查UI顯示或只直接呼叫函式。各FPS同一組精細事件0.311111→0.911111的實際模型時差均0.6秒。原始最近PTS事件29.97的差0.6006、VFR的差0.625002也被精確保留，没有偷偷改回0.6。

## 實際編碼跨FPS驗證

tests/generate-fps-fixtures.mjs：Canvas逐格畫9bit二進位編號與移動紋理，WebCodecs AVC baseline真正編碼每張影像，再以测试用ISO BMFF mux写入每樣本数据与时间表；不是只改FPS標籤。DTS=PTS（不含B影格）已知，既有MP4解析仍處理CTTS。素材／truth manifest僅在test-results，沒有新增依賴或生產編碼功能。

| 合成來源 | 實際原始數 | 容器／平均FPS | PTS間距FPS | 原始事件引擎差 | 精細事件引擎差 |
|---|---:|---:|---:|---:|---:|
| 30 | 42 | 30.000000 | 29.999993 | 0.600000s | 0.600000s |
| 60 | 84 | 60.000000 | 60.000014 | 0.600000s | 0.600000s |
| 90 | 126 | 90.000000 | 89.999993 | 0.600000s | 原始保留，不補幀 |
| 120 | 168 | 120.000000 | 119.999971 | 0.600000s | 原始保留，不降幀 |
| 29.97 | 42 | 29.970030 | 29.970037 | 0.600600s | 0.600000s |
| VFR | 48 | 34.285616 | 34.181719 | 0.625002s | 0.600000s |

合计510张合成來源畫面，逐一以真正解碼像素的二進位標記核對索引，同时核對rVFC的mediaTime与manifest PTS（誤差<0.00001秒）。畫面時刻、原始數、UI來源FPS都比對。順序30→24實片→60→30→90→120→29.97→VFR，每次檢查事件／索引／快取重設。鼠標、觸控模擬、原始與精細拖曳／點擊、四鍵、快速選取、模式切換、精細R/G与重新分析均測；90／120維持原模式並驗證按鈕無需補幀。

FPS小數差来自編碼的微秒量化，平均FPS（count／duration）與PTS間距FPS在VFR不同是有意区分，非前片FPS殘留。

## 真實電腦端影片與畫質

直球：平均23.917323FPS、間距23.916811、162PTS；曲球：平均23.889740、間距23.889032、156PTS。兩片全部318PTS逐一定位，原生呈現時刻对应、相鄰畫面不重複。片首／中段／尾段與原始／推算事件、重新分析、换片、資料庫／圖表均保留測試。没有根據檔名提供球種或預期結果。

原有人工近似投球事件結果維持：直球原始5.148333→5.565000秒、151.2km/h，精細5.166667→5.588889、149.2km/h；曲球原始4.945000→5.446667、125.6km/h，精細4.966667→5.466667、126.0km/h。這是17.5m先驗與人工時間的功能回歸，不是絕對測速精度。旋轉、位移與不可觀測限制沿用原模型。

插值仍低解析度估計局部運動、從原RGBA合成；兩片實际canvas720×1280，與左右端點RGB像素不同，比例及原視窗尺寸保持。品質皆low，沒有宣稱球位置恢復或90FPS拍攝精度；嚴重遮蔽可回原始。Worker不可用、未知PTS確認FPS与重新分析保留。

## 程式／部署與限制

TypeScript、正式Build、既有256／56（CI52）／70／830回歸及本版42項時間／非法FPS／事件桥單元通過，30份科學／資料檔雜湊未變。測試中發現的近距離點擊及未知時間回退失败已修正，舊測試檔保留。原大型bundle警告未因本次時間修復重構。

涉及App、Player、VideoQualityCard的時間顯示，以及sourceTiming／videoLoadService／videoTimingService／mp4Timing／analysisTimeline／readiness和測試文件。motionInterpolation、localFrameInterpolation、Worker、科學公式、資料庫、types、CSS配置、Render／Workflow均未更改。

最終公開E2E、SHA／Actions／Render live見本機test-results/V422_DELIVERY.md，沿用原網站与baseline-v4部署，沒有新服務或憑證。影片、manifest、截圖都不提交／公開部署。

只測真桌面Chrome與觸控／手機尺寸模擬，未完成實體iPhone／Android、手機原30FPS檔案或行動網路驗證。原生seek仍受codec／瀏覽器限制，沒有rVFC時不宣稱精確逐樣本解碼。未知或不支援的fragmented MP4／多edit段仍須明確CFR確認或重新匯出，不偽造PTS。长片／4K／低階手機完整壓力未測，記憶體預算與原始回退維持V4.2.1。沒有雷達、真事件與旋轉量測，不宣稱科學精度提高。

技術依據：[W3C WebCodecs](https://www.w3.org/TR/webcodecs/)。更新仍verify／build→push baseline-v4→原Actions／Deploy Hook→同一Static Site，live後以BASE_URL跑同一严格E2E。
