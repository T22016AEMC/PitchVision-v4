# 球點標記資料（Ball labels）

在結果頁的「確認球點」功能裡，使用者可以逐格對影片上程式找到的球點按「正確」、拖曳修正位置，或標「這格沒有球」。這份資料日後作為**學習式找球模型的訓練與評估資料**；本版本不使用任何學習式模型。

## 隱私與儲存

- 標記只存在使用者裝置的瀏覽器（`localStorage`），**不上傳**。瀏覽器禁用儲存時（例如無痕視窗）功能仍可使用，只是關閉後不保留。
- 以影片辨識：檔名、寬×高、FPS、影格數、時長相同才視為同一支影片（鍵：`pitchvision.ballLabels.v1:<檔名>|<寬>x<高>|<fps>|<影格數>|<時長>`）。不同影片的標記不會互相混用。
- 「匯出標記資料」把 JSON 交給瀏覽器下載成檔案；是否分享由使用者決定。匯出檔**只有座標與影片資訊，沒有任何影像**。
- 「清除這支影片的全部標記」會刪除該影片的本機資料。

## 三種標記

| `status` | 意義 | 座標 |
|---|---|---|
| `confirmed` | 使用者確認程式找到（或只有推估）的球點正確 | 取該格程式的點 |
| `corrected` | 使用者拖曳或點選，把球點修正到正確位置 | 使用者指定的位置 |
| `no_ball` | 這格看不到球（被擋、模糊、尚未離手） | 無（`null`） |

`confirmed` 與 `corrected` 在重新分析時是**強制錨點**（找球鏈必須經過）；`no_ball` 的格不會被當成觀測點。

## 匯出檔格式（`<影片名>.ball-labels.json`）

```json
{
  "schema": "pitchvision.ball-labels",
  "version": 1,
  "app": "5.0.2",
  "createdAt": "2026-10-18T12:00:00.000Z",
  "video": {
    "fileName": "直球.mov",
    "width": 2160,
    "height": 3840,
    "fps": 24,
    "frames": 162,
    "durationSec": 6.77,
    "timeBase": "timestamp"
  },
  "events": { "releaseFrame": 127, "gloveFrame": 139, "releaseTimeSec": 5.2917, "gloveTimeSec": 5.7917 },
  "coordinates": "normalised: x to the right, y downwards, both 0–1 over the whole (display-rotated) video frame",
  "labels": [
    {
      "frame": 128,
      "timeSec": 5.3333,
      "status": "corrected",
      "xNorm": 0.5069,
      "yNorm": 0.4573,
      "xPx": 1094.9,
      "yPx": 1756.0,
      "program": { "xNorm": 0.5056, "yNorm": 0.4630, "source": "observation" }
    },
    { "frame": 132, "timeSec": 5.5, "status": "no_ball", "xNorm": null, "yNorm": null, "xPx": null, "yPx": null, "program": null }
  ]
}
```

- `frame`：來源影格索引（從 0 起算，依容器時間表排序）；`timeSec`：該格在容器時間表上的時間（校正到瀏覽器媒體時間軸後的值）。
- 座標是**整個畫面**（含 iPhone 直拍已套用旋轉後的顯示方向）的正規化座標；`xPx`、`yPx` 是依 `video.width/height` 換算的像素值，方便對照。
- `program`：標記當下程式在該格的球點（`source` 為 `observation` 影像找到、`estimated` 僅內插推估、`user` 使用者點選），沒有時為 `null`。用於分析「程式哪裡錯」。
- `events`：使用者標記的出手與進手套格（沒有時為 `null`）。

## 用途與限制

- 作為學習式找球模型的**正例／負例**：`confirmed`/`corrected` 是球的位置，`no_ball` 是負例；影片檔本身不在匯出內，訓練時需要使用者另外提供對應影片。
- 一支影片標得越完整（連續多格），越能當作軌跡與事件擬合的真值；單點標記只是錨點。
- 標記由人眼完成，座標誤差約 ±2–3 像素（720p 尺度）；有動態模糊的格，「球中心」本身就有數像素的歧義。
