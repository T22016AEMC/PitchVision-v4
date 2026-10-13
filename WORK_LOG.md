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

原 Render Static Site 回應私人來源無法讀取。使用者明確拒絕 Render GitHub App／公開來源库；停止此方案，不再重試 Private Repo URL。

新方案：GitHub Actions 建置私人 GHCR 映像，Render Web Service Existing Image（Free），詳見 DEPLOYMENT.md。來源碼與測試片維持私人／本機。

- workspace tea-db6qffon74is738k4q30
- name pitchvision-v4
- image ghcr.io/t22016aemc/pitchvision-v4:sha-<commit>
- region singapore / plan free / health /healthz
- 私人 GHCR 拉取需由使用者在 Render registry credential 輸入 classic PAT read:packages
- image-backed 服務不會隨標籤更新自動部署；用 sha tag 或手動 trigger_deploy

部署 live 後在 BASE_URL=實際公開網址下執行 `node tests/browser.mjs`，讀取 test-results/public/acceptance.json，更新 ACCEPTANCE.md 與功能清單並推送。不可把測試影片放到 public。

尚待實機、多網路、完整人工影格真值驗證；V3 缺 demo、Knuckle Curve 別名錯配、POOR 擬合等詳見 SCIENTIFIC_ISSUES.md。不要修改演算法以讓結果變好。
