# PitchVision V4 Baseline

以原始 PitchVision_V3.zip 為唯一基準，保留科學引擎與兩份資料庫，調整手機介面及資源生命週期。

## 開發與驗證

需要 Node.js 22+、Corepack、pnpm 11.4.0。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run verify
pnpm run build
pnpm run dev
```

`verify` 執行 TypeScript、原檔保留、資料庫 SHA-256 與 256 組 V3/V4 全輸出相等測試。`baseline/v3` 是原碼快照，禁止跟隨 V4 修改。

## 真實影片驗收

安裝 Chrome，將「直球.mp4」「彈指曲球.mp4」放在上層 `test videos`。本機先啟動 `pnpm exec vite --port 4173`，執行 `pnpm run test:e2e`。公開版 PowerShell 範例：

```powershell
$env:BASE_URL='https://YOUR-SITE.onrender.com'
pnpm run test:e2e
```

可以設定 TEST_VIDEO_DIR 及 CHROMIUM_PATH。測試僅透過正常檔案選擇器將影片交给瀏覽器本地處理；影片和包含其畫面的 test-results 不提交、不部署。輸出在 `test-results/local` 或 `test-results/public`。桌面觸控模擬不代表實機測試。

## 更新與部署

公開來源庫 https://github.com/T22016AEMC/PitchVision-v4 ，開發分支 `baseline-v4`。部署使用 Render Static Site，建置與更新見 DEPLOYMENT.md。基本 React 分析不需使用者登入或 Python 伺服器。

修改後執行 verify / build，檢查 git diff，commit 並 push `origin baseline-v4`；Render 自動建置。到公開 HTTPS 再執行上述影片驗收。失敗時先查看 Actions／Render log；不要修改 baseline 或資料庫使測試通過。

Python `app.py` 與 UI 可下載的原始碼均保留；其 Streamlit 執行環境未部署、未驗收。它與 React 引擎並不等價。

完整狀態見 MIGRATION_CHECKLIST.md、SCIENTIFIC_ISSUES.md、ACCEPTANCE.md、SOURCE_INVENTORY.md。
