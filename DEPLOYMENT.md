# 簡單部署：Public GitHub → Render Static Site

React / TypeScript 影片載入、追蹤及物理計算全部在瀏覽器本機執行，不需常駐後端。停止 GHCR/PAT/Existing Image 流程，已移除自動映像發布 workflow。既有 Docker 檔案保留為備用；Static Site 不使用它們。

## 設定

- Repository：https://github.com/T22016AEMC/PitchVision-v4 （Public）
- Branch：baseline-v4
- Root Directory：留空
- Build Command：`corepack pnpm install --frozen-lockfile && corepack pnpm run verify && corepack pnpm run build`
- Publish Directory：dist
- Environment：NODE_VERSION=22、SKIP_INSTALL_DEPS=true；無秘密憑證
- Auto Deploy：Yes / On Commit
- 設定參考：render.yaml

若 Public Git Repository 模式未收到推送事件，需在 Dashboard 連接 Git provider，或用 Render trigger_deploy 手動部署。以實際服務設定及新推送部署事件確認自動更新。

## 更新

執行 `pnpm run verify`、`pnpm run build`，commit 並 push `origin baseline-v4`。Render 也執行相同驗證，通過才發布 dist。公開影片驗收：

```powershell
$env:BASE_URL='https://YOUR-STATIC-SITE.onrender.com'
pnpm run test:e2e
```

使用本機上層 test videos 中的兩部影片，影片及其畫面不提交。真實手機、行動網路及人工量測精度仍须另驗證。

## 原始碼與歷史檢查

`node scripts/audit-history.mjs` 檢查所有可達 Git 歷史的影片／實際 .env 路徑，以及常見 GitHub、Render、OpenAI、Google、AWS 金鑰及 private key 格式。只輸出位置，不輸出秘密。2026-10-13 檢查123個物件、80份文字blob，無命中。原 `.env.example` 僅有佔位值。

此檢查不保證識別所有未知秘密格式。GitHub 登入僅使用 OS credential helper，不存憑證於程式碼。
