# 部署：Private GitHub → GitHub Actions → Private GHCR → Render Existing Image

Render 不連接原始碼儲存庫，也不安裝 Render GitHub App。原 Git-backed Static Site 方案停止使用。現有 Render 連接器只能建立 Git-backed 服務，沒有直接產物上傳／預建映像建立能力；首次建立 image-backed Web Service 需 Render Dashboard。

## 已備妥的產物

工作流程 `.github/workflows/publish-image.yml` 在 baseline-v4 程式推送後以臨時 GITHUB_TOKEN（contents:read/packages:write）建置 linux/amd64，先執行型別、256組回歸與 Build，再測試容器 HTTP，發布到 `ghcr.io/t22016aemc/pitchvision-v4`。首次包預設 Private，不變更可見性。沒有在程式碼或映像存放憑證。

Docker 最終層只含 dist 與 Node 靜態伺服器。原碼快照只在 builder，測試影片被 gitignore/dockerignore 排除。使用 SHA tag 可追溯版本，baseline tag 供簡單更新。

## 一次性的必要設定（由使用者在官方頁面完成）

1. GitHub 建立 **Personal access token (classic)**，用途 `pitchvision-render-pull`，僅勾選 **read:packages**，自行選擇有效期限。不需要 repo/write:packages/delete:packages。不要把 token 貼到對話或程式碼。
2. Render Workspace Settings → **Container Registry Credentials** → Add Credential：名稱 `pitchvision-ghcr-read`，Registry GitHub Container Registry，Username `T22016AEMC`，在 PAT 欄輸入上一步 token。
3. Render + New → **Web Service** → **Existing Image**。輸入發布成功的 `ghcr.io/t22016aemc/pitchvision-v4:sha-<commit>`（完整值以 Actions summary 為準），選取上述 credential。
4. Name `pitchvision-v4`，Region **Singapore**，Instance Type **Free**，Health Check `/healthz`，保留映像預設 command，Deploy。沒有 Git Repo、build command 或 start override。
5. 回報 service ID 或公開網址即可，勿傳送任何密鑰。Codex 可用 Render connector 查部署狀態，再在公開網址執行兩支本機影片驗收。

官方說明：[Render prebuilt images](https://render.com/docs/deploying-an-image)、[GHCR 認證與 Private 預設](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

## 更新

修改、verify/build、commit、push baseline-v4；Actions 發布新的 sha tag。Render Dashboard 更換 Image URL 為新 sha tag並部署。若服務設定使用 baseline tag，發布後使用 Manual Deploy → Deploy latest image，或讓 Codex 呼叫 trigger_deploy。image-backed 服務不會只因 tag 更新而自動部署。

可選自動化：之後把 Render Deploy Hook 存為 GitHub Actions Secret，再接入發佈後的部署步驟；本次不要求此額外機密設定。

## 成本與限制

只選 Render Free，未購買資源。GitHub Actions 使用帳號既有額度。Render Free 冷啟動會延遲首頁，但影片運算仍在手機瀏覽器本機執行。Token 到期須在 Render 更新 registry credential，否則後續重新拉取映像會失敗。
