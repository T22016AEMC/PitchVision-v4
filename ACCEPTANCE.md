# 驗收紀錄

## 已完成本機驗證

- TypeScript：補齊 React 型別，修復 12 項原始介面型別／props 問題。
- 科學回歸：256 組全輸出 deepStrictEqual；23 份科學檔逐 byte 不變。
- 資料庫：540 與 1080 筆，SHA-256 與原始快照完全相同。
- 正式 Build：成功；資料庫較大，需實機評估低記憶體與慢網路。
- 桌面 Chrome 手機模擬：首頁 320/390/430/768/1440px 無水平溢出；390px 上兩部影片預覽、結果、圖表均無頁面水平溢出。
- 資料庫搜尋／1080筆 JSON 下載、Python 檢視／下載、缺示範影片提示、損壞 MP4 錯誤提示：通過。
- 兩片獨立跑正常影片選擇、播放暫停、自動搜尋、追蹤／科學流程、結果、雙軌圖表控制、出手手動 ±1、重複選片。無 pageerror。無檔名結果分支、無假結果。

## 本地真實影片結果（程式輸出，不是實測真值）

| 項目 | 直球.mp4 | 彈指曲球.mp4 |
|---|---|---|
| 手動球種 | Fastball | Knuckle Curve |
| 解析度 | 720×1280 | 720×1280 |
| 使用 FPS | 30 ESTIMATED | 30 ESTIMATED |
| 自動出手／接球 | 16 / 38 | 15 / 37 |
| 飛行時間 | 0.733 s | 0.733 s |
| 球速 | 85.9 km/h | 85.9 km/h |
| RPM | 1880 | 1680 |
| Axis | 1:25 | 11:18 |
| Spin Efficiency | 93.8% | 60.1% |
| IVB / HB | +25.6 / -27 吋 | +25.6 / -1.9 吋 |
| 觀測點 | 17 | 16 |
| RMSE | 89.8 px / POOR | 126.9 px / POOR |
| 綜合信賴 | 47.1% | 53.1% |
| 問題 | 精度與偵測點未人工標註驗證 | 同左，且 Strict Mode 候選錯配 Cutter |

完整執行紀錄與截圖保留在本機 `test-results/local/acceptance.json`，不提交影片或其畫面。

## 公開驗收與尚未完成項目

公開網址：https://pitchvision-v4-baseline.onrender.com

Render Static Site `srv-db74o5rncjis73fgq31g`，首部署 `dep-db74o6bncjis73fgq3og` 狀態 live。Render 上完成 pnpm install、TypeScript、256組回歸及正式 Build。

2026-10-13 正式公開 HTTPS 驗收完成，使用桌面 Chrome 手機尺寸／觸控模擬，17 項檢查通過、pageErrors 為空。首頁在320/390/430/768/1440px無水平溢出；兩部真實影片獨立完成上傳、播放暫停、自動搜尋、追蹤與原科學分析、結果、圖表視角／播放／重置／雙軌開關、出手手動±1、重複選片。兩片 metadata 分別為720×1280、6.773333s及6.53s。結果與上表本機數據一致。

公開站資料庫搜尋與1080筆JSON下載、Python程式碼檢視／下載、損壞MP4錯誤、缺demo提示皆通過。完整正式紀錄在本機 `test-results/public/acceptance.json`，畫面證據不提交。

網站可匿名透過公網HTTPS開啟，不依賴localhost或同一Wi-Fi。實際手機行動網路／不同網路的物理裝置測試尚未執行，不能以桌面驗收宣稱完成。

尚未完成真實 iPhone／Android、多網路／行動網路、長影片／4K 壓力測試、Python Streamlit 獨立執行。原始 demo 缺檔；科學與座標限制見 SCIENTIFIC_ISSUES.md。不宣稱全部驗收通過。
