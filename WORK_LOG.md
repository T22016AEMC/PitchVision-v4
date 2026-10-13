# 接續工作紀錄

## 已保存

- 主目錄 pitchvision-v4；分支 baseline-v4；origin 為 Public T22016AEMC/PitchVision-v4（使用者最新決定）。
- 原 ZIP 保留在上層；v3-original 與 baseline/v3 快照已建立；manifest 錨定原檔雜湊。
- Mobile-first CSS、影片步驟導覽、原始 props/型別修復、估計 FPS 標籤、缺示範檔明確錯誤、probe 資源清理、RVFC callback 取消。
- 原科學引擎、資料庫未改；型別、256組回歸、正式 build 通過。
- 兩部真實影片本地正常流程與手機模擬已完成，report 在 test-results/local/acceptance.json。
- 所有影片與其截圖只在本機，不提交、不部署。
- 本機 Git 已經由使用者完成 GCM 裝置登入；2026-10-13 成功 push baseline-v4，commit 2b2de2eaa361f2a954714e00ff98d6066678ebbe。

## 最新部署方案

使用者改選 Public GitHub → Render Static Site。已停止 GHCR/PAT/Existing Image 流程，移除自動映像發布 workflow；既有科學功能未變。

Static Site 已成功建立且首部署為 live，詳見 DEPLOYMENT.md。測試影片僅在本機。

- workspace tea-db6qffon74is738k4q30
- name pitchvision-v4-baseline
- service srv-db74o5rncjis73fgq31g
- URL https://pitchvision-v4-baseline.onrender.com
- branch baseline-v4 / publish dist；Public Git URL模式無內建自動部署，Actions hook待使用者設定一次Secret
- 前端不需後端、憑證或登入

公開 HTTPS 兩支影片已完成測試，17項檢查通過、沒有pageerror。記錄在 test-results/public/acceptance.json，結果與本地一致。ACCEPTANCE.md及清單已更新。不可把測試影片或截圖放到 public。

另有使用者既存 Docker Web Service srv-db74lvs9v7es73afaa80（https://pitchvision-v4.onrender.com）。正式選用上述 Static Site；未擅自刪除舊服務或私人GHCR套件。

尚待實機、多網路、完整人工影格真值驗證；V3 缺 demo、Knuckle Curve 別名錯配、POOR 擬合等詳見 SCIENTIFIC_ISSUES.md。不要修改演算法以讓結果變好。

## 2026-10-14 V4.1 授權升級

使用者已授權時間／追蹤／空間及物理反推修正。已在原專案完成 UI 整合、PTS 解析、候選品質、已知矩形相機條件校正與阻力／Magnus整合；沒有改資料庫或部署架構。baseline/v4/src保留升級前source，其餘資源與設定沿用原V3快照，完整歷史基準为Git b41c312。

TypeScript、Build、256組凍結V3/V4歷史比對與50項V4.1科學測試通過；舊手動直球RPM／Axis／Efficiency在相同輸入回歸不變。兩支影片本地功能與320至1440px布局通過，影片與圖像不提交。自動真正投球事件、實際球軌跡、自動球種差異與完整自動3D尚未通過，详見V41_ACCEPTANCE.md。

Actions Secret RENDER_DEPLOY_HOOK已設定並於前次b41c312證明能推送觸發，V4.1沿用原流程。公開驗收與實際部署SHA另由最後交付記錄確認；不要把此處本地測試當作公開發佈成功。
