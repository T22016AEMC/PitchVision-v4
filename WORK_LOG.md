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

TypeScript、Build、256組凍結V3/V4歷史比對與56項V4.1科學測試通過；舊手動直球RPM／Axis／Efficiency在相同輸入回歸不變。兩支影片本地功能與320至1440px布局通過，影片與圖像不提交。自動真正投球事件、實際球軌跡、自動球種差異與完整自動3D尚未通過，详見V41_ACCEPTANCE.md。

Actions Secret RENDER_DEPLOY_HOOK已設定並於前次b41c312證明能推送觸發，V4.1沿用原流程。公開驗收與實際部署SHA另由最後交付記錄確認；不要把此處本地測試當作公開發佈成功。

首輪2e9c9f1已由Actions38439255882自動發佈Render dep-db76lnjrjlhs73a47rb0，兩片公開功能驗收通過（不含失敗科學項目）。最後核對修正了原三模組時間先round／範圍回退及模型速度/時間硬限，更新報告球速151.2／125.6；再由原流程發佈並驗收，以最後交付記錄為準。

## 2026-10-14 V4.1.1

本次範圍是手動啟動、原始PTS／逐格、影片與時間軸排列、重複事件UI移除及本機局部90Hz插值。P0先以兩片完成無自動辨識的分析及重分析。只有App／Player／最小影片載入時間介面與新插值服務修改，沒有科學模型改写。30份V4.1科學／資料檔以雜湊凍結於baseline/v41-engine-hashes.json。

唯一events狀態保存時間與原始／推算／CFR假設來源；物理模型使用事件時差，插值圖像不作觀測。主模型在try內真正執行並存結果；忙碌／錯誤／輸入變更受控。原追蹤選填、可停止自動，座標／幾何能力保留，不再掛載兩套事件滑桿。源影片尺寸與CSS不變。

新插值為Worker中的金字塔局部區塊運動匹配＋前後向檢查＋反向warp，512px長邊局部預覽、4張LRU來源、單一運動場對；虛擬時間軸保留所有原PTS及90Hz網格。兩片實際畫面已生成，但品質低且球位置未驗證。

256歷史比對、56項V4.1科學、70項V4.1.1測試及型別／Build通過。本地完整Browser E2E（原始／推算事件、重算、自動失敗、Worker失敗、FPS確認）與最後播放／暫停同步檢查通過。沒有真手機或儀器精度真值。流程仍是既有baseline-v4→Actions→Hook→同一Static Site；公開版本SHA與結果在最後交付記錄，詳見V411_ACCEPTANCE.md。
# 2026-10-14 V4.2.1

以現有3bfdb45（4.1.1）修復影格／滑桿／原尺寸補幀與指定UI；本地與遠端没有独立4.2分支。原始STSZ／STTS與PTS162／156一致，Chrome逐一定位全部318個PTS，沒有相鄰重複畫面；舊30FPS是估計203／196位置，不能據此宣稱已完整解釋使用者20→8的個案。

低解析度運動估計、原RGBA全尺寸合成已實際輸出720×1280；固定90Hz操作索引、Pointer Capture、單一TimePosition、同位置重試revision與過期请求保護。兩片原始與推算事件分析、重新分析、換片、Worker失敗回退、未知PTS手動FPS確認均通過本地Browser E2E；實際觸控模擬與桌面全寬滑桿另驗證成功。詳細數值／限制見V421_ACCEPTANCE.md。TypeScript、Build、256＋56＋70＋830回歸通過，30科學／資料檔案雜湊不變。

保留原Render Static Site、Workflow／Hook；推送後的公開验收證據另記忽略的test-results/V421_DELIVERY.md，不把本地測試當公開部署或真手機驗收。測試影片不提交。
# 2026-10-14 V4.2.2

基準9c13802。來源PTS／STSZ驗證、未知FPS不默認30、換片generation、单一Pointer／鍵盤滑桿、不可變PTS与單調事件橋；UI尺寸／科學模型／原像素插值／部署不變。WebCodecs實際編碼30／60／90／120／29.97／VFR共510影格，完整影像標記与PTS驗證及指定交替上傳通過，實際引擎事件差可核對。兩片電腦實片318PTS已逐一定位；手機原30FPS未取得，不与24FPS檔案混為同一序列。

測試抓到原生range近距離點擊不更新，改單一控制器重測通過；未知PTS空表在FPS確認時undefined游標崩潰已修，原WebM回退E2E重跑通過。舊測試保留。TypeScript／Build、256+56+70+830+42單元／回歸通過，30份科學／資料文件SHA不變。詳見V422_ACCEPTANCE.md；公開部署與最後完整E2E另記忽略的test-results/V422_DELIVERY.md，不假稱手機實機或精度驗證。
