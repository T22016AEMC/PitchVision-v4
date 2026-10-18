# 手機版部署：mobile-v5 → 新的 Render Static Site

手機版與舊網站（`baseline-v4`，見 `DEPLOYMENT.md`、`render.yaml`）是**兩個獨立的 Render 服務**。`render.yaml` 屬於舊網站，不修改、不給新站使用；新站在 Render Dashboard 手動建立。

全部運算在瀏覽器本機執行，不需後端、不需任何秘密憑證。

## 新站設定值

| 欄位 | 值 |
|---|---|
| 服務類型 | Static Site |
| 建議服務名稱 | `PitchVision-v4-1` |
| Repository | `https://github.com/T22016AEMC/PitchVision-v4`（Public Git repository） |
| Branch | `mobile-v5` |
| Root Directory | 留空 |
| Build Command | `corepack pnpm install --frozen-lockfile && corepack pnpm run verify && corepack pnpm run build` |
| Publish Directory | `dist` |
| Environment | `NODE_VERSION=22`、`SKIP_INSTALL_DEPS=true` |
| Redirects/Rewrites | Source `/*` → Destination `/index.html`，Action `Rewrite` |
| （選填）Headers | Path `/*`，Name `X-Content-Type-Options`，Value `nosniff`（與舊站相同） |

Build Command 會先跑 `verify`（256 組回歸、資料庫雜湊、手機外殼檢查），失敗就不發佈。

## 在 Render Dashboard 建立

1. 登入 https://dashboard.render.com ，右上角 **New** → **Static Site**。
2. 選 **Public Git Repository**，貼上 `https://github.com/T22016AEMC/PitchVision-v4`，按 **Connect**。
3. Name 填 `PitchVision-v4-1`；Branch 選 `mobile-v5`；Root Directory 留空。
4. Build Command、Publish Directory 依上表填入。
5. 展開 **Advanced** → **Add Environment Variable**，新增 `NODE_VERSION`=`22` 與 `SKIP_INSTALL_DEPS`=`true`。
6. 按 **Create Static Site**，等待第一次建置完成（Logs 內應看到 `verify` 與 `vite build` 成功）。
7. 進入服務 **Redirects/Rewrites** 頁，新增 Source `/*`、Destination `/index.html`、Action `Rewrite`，儲存。
8. 記下新網址（預設 `https://pitchvision-v4-1.onrender.com`；若名稱已被使用，Render 會加上尾碼）。

## 自動更新（Deploy Hook）

Public Git URL 模式不會因 push 自動部署（見 `DEPLOYMENT.md` 的實測說明），因此沿用 GitHub Actions 呼叫 Deploy Hook：

1. 在新站 **Settings** → **Deploy Hook**，按複製。**不要貼到聊天、issue 或程式碼。**
2. 到 GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**。
3. Name 填 `RENDER_DEPLOY_HOOK_MOBILE`，Secret 貼上剛才的網址，按 **Add secret**。

`.github/workflows/verify.yml` 的行為：

| 推送分支 | verify + build | 部署呼叫 |
|---|---|---|
| `baseline-v4` | 執行 | `RENDER_DEPLOY_HOOK`（舊網站，行為不變） |
| `mobile-v5` | 執行 | `RENDER_DEPLOY_HOOK_MOBILE`；未設定時記錄「沒有自動部署」並以成功結束 |
| 其他分支 / PR | 執行 | 不部署 |

## 更新流程

```powershell
pnpm run verify
pnpm run build
pnpm run test:mobile     # 390×844 手機尺寸流程，使用程式產生的合成影片
git push origin mobile-v5
```

公開網址驗收（同一支測試，不啟動本機伺服器）：

```powershell
$env:BASE_URL='https://pitchvision-v4-1.onrender.com'
pnpm run test:mobile
```

截圖與報告寫入 `test-results/mobile-v5/`（已在 `.gitignore`，不提交）。測試影片由程式即時產生，不使用真實影片。真實手機、行動網路與量測精度仍須另外驗證。
