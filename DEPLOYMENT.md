# 簡單部署：Public GitHub → Render Static Site

React / TypeScript 影片載入、追蹤及物理計算全部在瀏覽器本機執行，不需常駐後端。停止 GHCR/PAT/Existing Image 流程，已移除自動映像發布 workflow。既有 Docker 檔案保留為備用；Static Site 不使用它們。

## 設定

- 正式網址：https://pitchvision-v4-baseline.onrender.com
- Render service：srv-db74o5rncjis73fgq31g（Static Site）
- Dashboard：https://dashboard.render.com/static/srv-db74o5rncjis73fgq31g
- Repository：https://github.com/T22016AEMC/PitchVision-v4 （Public）
- Branch：baseline-v4
- Root Directory：留空
- Build Command：`corepack pnpm install --frozen-lockfile && corepack pnpm run verify && corepack pnpm run build`
- Publish Directory：dist
- Environment：NODE_VERSION=22、SKIP_INSTALL_DEPS=true；無秘密憑證
- 自動更新：Actions 驗證成功後呼叫 RENDER_DEPLOY_HOOK；初次需下方一次性設定
- 設定參考：render.yaml

實測文件推送未產生部署事件。Render Public Git URL 模式不支援內建自動部署，API autoDeploy=yes 不代表有 webhook 連線。參考 https://render.com/docs/deploys 。

一次性設定（不需要PAT或映像憑證）：到上述 Static Site 的 Settings → Deploy Hook 複製URL，直接存入 GitHub repo Settings → Secrets and variables → Actions → New repository secret，名稱 `RENDER_DEPLOY_HOOK`。不要貼到聊天或程式碼。既有 verify workflow 已加入成功建置後的安全呼叫，未設定時會明確記錄沒有自動部署。

亦可在 Render 連接 Git provider 改用內建 auto deploy；本方案使用 Deploy Hook以避免額外GitHub App。

## 更新

執行 `pnpm run verify`、`pnpm run build`，commit 並 push `origin baseline-v4`。Render 也執行相同驗證，通過才發布 dist。公開影片驗收：

```powershell
$env:BASE_URL='https://pitchvision-v4-baseline.onrender.com'
pnpm run test:e2e
```

使用本機上層 test videos 中的兩部影片，影片及其畫面不提交。真實手機、行動網路及人工量測精度仍须另驗證。

## 原始碼與歷史檢查

`node scripts/audit-history.mjs` 檢查所有可達 Git 歷史的影片／實際 .env 路徑，以及常見 GitHub、Render、OpenAI、Google、AWS 金鑰及 private key 格式。只輸出位置，不輸出秘密。2026-10-13 檢查123個物件、80份文字blob，無命中。原 `.env.example` 僅有佔位值。

此檢查不保證識別所有未知秘密格式。GitHub 登入僅使用 OS credential helper，不存憑證於程式碼。
