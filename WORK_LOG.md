# 接續工作紀錄

## 已保存

- 主目錄 pitchvision-v4；分支 baseline-v4；origin 為私人 T22016AEMC/PitchVision-v4。
- 原 ZIP 保留在上層；v3-original 與 baseline/v3 快照已建立；manifest 錨定原檔雜湊。
- Mobile-first CSS、影片步驟導覽、原始 props/型別修復、估計 FPS 標籤、缺示範檔明確錯誤、probe 資源清理、RVFC callback 取消。
- 原科學引擎、資料庫未改；型別、256組回歸、正式 build 通過。
- 兩部真實影片本地正常流程與手機模擬已完成，report 在 test-results/local/acceptance.json。
- 所有影片與其截圖只在本機，不提交、不部署。
- 本機 Git 已經由使用者完成 GCM 裝置登入；2026-10-13 成功 push baseline-v4，commit 2b2de2eaa361f2a954714e00ff98d6066678ebbe。

## 當前阻礙及下一步

Render create_static_site 回應 400 repository URL invalid or unfetchable。已請使用者將私人新 repo 加入 Render GitHub App 的可存取範圍。

授權後重試 Render Static Site（免費；不建立付費資源）：

- workspace tea-db6qffon74is738k4q30
- name pitchvision-v4
- repo https://github.com/T22016AEMC/PitchVision-v4
- branch baseline-v4 / autoDeploy yes
- build `corepack pnpm install --frozen-lockfile && corepack pnpm run verify && corepack pnpm run build`
- publish dist
- NODE_VERSION=22 / SKIP_INSTALL_DEPS=true

部署 live 後在 BASE_URL=實際公開網址下執行 `node tests/browser.mjs`，讀取 test-results/public/acceptance.json，更新 ACCEPTANCE.md 與功能清單並推送。不可把測試影片放到 public。

尚待實機、多網路、完整人工影格真值驗證；V3 缺 demo、Knuckle Curve 別名錯配、POOR 擬合等詳見 SCIENTIFIC_ISSUES.md。不要修改演算法以讓結果變好。
