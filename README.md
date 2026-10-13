# PitchVision V4.1

在既有 V4 Baseline 上改善影片時間、追蹤證據、條件式幾何／物理反演與操作排列；保留兩份原始資料庫、原手動旋轉模型與部署架構。科學能力仍有未通過項目，見 V41_ACCEPTANCE.md。

## 開發與驗證

需要 Node.js 22+、Corepack、pnpm 11.4.0。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run verify
pnpm run build
pnpm run dev
```

`verify` 執行 TypeScript、資料庫 SHA-256、凍結 V3/V4 的 256 組歷史全輸出相等測試，及 V4.1 時間／幾何／物理／手動旋轉回歸測試。`baseline/v3` 保留原碼；`baseline/v4/src` 保留升級前 source（b41c312），其其他檔案沿用 V3 資源與設定。V4.1 的必要修正不宣稱與 V3 全輸出相等。

## 真實影片驗收

安裝 Chrome，將兩部影片放在上層 `test videos`。先執行 `pnpm run verify` 生成测试用 bundle，然後 `pnpm run build`、`pnpm exec vite preview --port 4175`。在忽略的 `test-results/v41-manual-selections.json` 記錄人工檢視後選取的影片時間，格式為 `{ "basis": "人工選取依據與限制", "影片完整檔名": { "releaseTime": 秒數, "gloveTime": 秒數 } }`。此檔只控制正常手動 UI，不提供預期分析答案。接球不可確認時須明確註記，不作精度真值。

```powershell
$env:BASE_URL='http://127.0.0.1:4175'
pnpm run test:e2e
```

公開版 PowerShell 範例：

```powershell
$env:BASE_URL='https://YOUR-SITE.onrender.com'
pnpm run test:e2e
```

V4.1 測試僅透過正常檔案選擇器將影片交给瀏覽器本地處理；影片、人工選取檔與包含其畫面的 test-results 不提交、不部署。輸出在 `test-results/v41-local` 或 `test-results/v41-public`。桌面觸控模擬不代表實機測試。原 V4 瀏覽器測試保留於 tests/browser.mjs 與 tests/browser-v4.mjs；其舊 UI 定位需用 V4 版本執行。

## 更新與部署

公開來源庫 https://github.com/T22016AEMC/PitchVision-v4 ，開發分支 `baseline-v4`。部署使用 Render Static Site，建置與更新見 DEPLOYMENT.md。基本 React 分析不需使用者登入或 Python 伺服器。

修改後執行 verify / build，檢查 git diff，commit 並 push `origin baseline-v4`；設定一次 RENDER_DEPLOY_HOOK Secret 後，Actions 驗證成功會觸發 Render 建置。到公開 HTTPS 再執行上述影片驗收。失敗時先查看 Actions／Render log；不要修改 baseline 或資料庫使測試通過。

Python `app.py` 與 UI 可下載的原始碼均保留；其 Streamlit 執行環境未部署、未驗收。它與 React 引擎並不等價。

完整狀態見 MIGRATION_CHECKLIST.md、SCIENTIFIC_ISSUES.md、ACCEPTANCE.md、SOURCE_INVENTORY.md。
