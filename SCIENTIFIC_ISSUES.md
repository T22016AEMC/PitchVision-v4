# V3 既有科學與資料問題（V4 Baseline 不修正）

本文件描述限制，不代表校準完成。公式、係數、權重、資料庫及信心計算保留 V3。

1. **FPS / VFR**：`videoTimingService.ts` 從檔名提示或 RVFC 估計 FPS，否則用 30。沒有真正解析 MP4 sample timestamps；生成等間隔時間戳且 `isVFR=false`。檔名提示被原碼標成 container_metadata。暫停的 probe video 常無法取得 10 個 RVFC，因而 fallback。V4 僅修正估計 FPS 警示欄位與 callback 清理，沒有改變推算方式。
2. **球種別名過寬**：`movementDatabaseMatcher.ts` 的 curve 分支使用 `d.includes('cu')`，亦可匹配 Cutter；Knuckle Curve 未獨立限定。本地彈指曲球測試在 Strict Mode 下產生 180 候選及 Cutter Top 3。此驗收項目失敗，需後續獨立演算法修正。
3. **擬合品質**：兩部真實影片本地結果均為 POOR。直球 RMSE 89.8px，彈指曲球 126.9px。追蹤器標示 VALID TRACK 不等於追蹤物體已人工確認為棒球，更不等於儀器測量準確。尚無真實出手/接球標註與雷達資料可驗證。
4. **出手角、幾何校正與位移**：V3 使用單視角與身高/跨步先驗，存在固定假設及位移截限；直球出手角達 80.5°、兩片 IVB 都達 +25.6 吋，需後續科學審查。本次不更改。
5. **品質與信心語義**：`videoMetadataService.ts` 的曝光與穩定度部分為固定先驗；介面若稱為客觀量測，不能據此認定已有影像實測。信心為既有品質分數，不是成功機率。
6. **兩份不同資料庫**：根目錄 `amateur_pitch_database_v3.json` 實際 540 筆，React 的 `src/pitchDatabase.json` 是 1,080 筆。兩者皆保留，不重新生成、不補筆數。
7. **Python 與 React 路徑不同**：`app.py` 為原附 Streamlit 程式，包含不同距離假設（介面 16.7m）及資料生成入口；React 使用自己的 TypeScript 引擎。不可將二者互相比較視為 V4 回歸。Python 檔與展示字串均原樣保留，未執行資料生成。
8. **影格擷取 timeout**：V3 seek 使用 160ms timeout，逾時可能擷取非預期影格；解碼時機可能造成不同執行間差異。未改此演算法行為。
9. **手動錨點**：原播放器以包含 object-contain 留白的容器座標正規化，直橫影片比例不符時可能偏移。保留原行為並標記未通過精度驗收。

確定性回歸通過只證明相同輸入的 V3/V4 結果一致，不證明上述模型正確。
