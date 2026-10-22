# Gemini Video CLI

在終端機完成 Gemini 影片理解：本機影片上傳、inline、YouTube、多影片比較、時間區間、FPS、agentic 分析、串流與多輪對話。使用官方 `@google/genai` SDK 的 Interactions API。

## 安裝與快速開始

需要 **Node.js 22 以上**及 Gemini API 金鑰。

```bash
cd /Users/will/demo/gemini-video-cli
npm ci
npm install --global .
export GEMINI_API_KEY='你的金鑰'

gemini-video --help
gemini-video -v ./meeting.mp4 -p '用繁體中文摘要這段影片，附上重要時間點。'
printf '%s\n' '列出主要事件及音訊與畫面細節。' | gemini-video -v ./meeting.mp4
```

不安裝全域命令也能使用 `node src/cli.js`。例如：

```bash
node src/cli.js -v 'https://www.youtube.com/watch?v=9hE5-98ZeCg' \
  -p '用三句話摘要。' --dry-run
```

`--dry-run` 不需要金鑰，不連線、不上傳、不讀入完整影片的 base64；它會檢查本機檔案並顯示預計的請求。預設模型是 `gemini-3.8-flash`，可用 `--model` 或 `GEMINI_MODEL` 覆寫。

金鑰依序讀取 `GEMINI_API_KEY`、`GOOGLE_API_KEY`。CLI 不自動載入 `.env`，也不提供會將金鑰留在 shell 歷史的金鑰旗標。可以複製 `.env.example` 後使用：

```bash
node --env-file=.env src/cli.js -v ./meeting.mp4 -p '摘要這段影片。'
```

## 提示詞與輸出

```bash
# 旗標可重複；依序以空行連接
 gemini-video -v ./clip.mp4 -p '摘要內容。' -p '用 MM:SS 標示重點。'

# 明確將 STDIN 接在旗標提示詞之後
cat questions.txt | gemini-video -v ./clip.mp4 -p '請回答下列問題：' -p -

# UTF-8 文字檔；接在所有 --prompt 內容之後
 gemini-video -v ./clip.mp4 --prompt-file ./questions.txt

# 完整回應 JSON（含 id、steps、usage），或純文字存檔
 gemini-video -v ./clip.mp4 -p '摘要。' --json -o response.json
 gemini-video -v ./clip.mp4 -p '摘要。' -o summary.txt
```

未指定 `--prompt` 或 `--prompt-file` 時會讀取 STDIN。終端機互動模式下缺少提示詞會顯示錯誤；不會等待使用者猜測如何結束輸入。STDIN 用於提示詞，影片請用檔案路徑。

分析預設輸出純文字。進度寫入 STDERR，可用 `--quiet` 關閉，不會污染管線的 STDOUT。`files`、`jobs` 與 `--no-wait` 一律輸出 JSON。`--output` 將輸出寫入指定檔案，新檔案使用 `0600` 權限；既有檔案會被覆寫。

## 影片來源與檔案處理

```bash
# 預設 auto：小影片 inline，超過剩餘請求空間時走 Files API 並等待 ACTIVE
 gemini-video -v ./video.mp4 -p '列出影片重點。'

# 長影片或預計重複使用的影片，可明確指定上傳
 gemini-video -v ./long-lecture.mp4 --transport upload -p '列出課程大綱。'

# 短影片 inline；總請求包含 base64、文字、歷史及 JSON 必須小於 20 MB
 gemini-video -v ./short.mp4 --transport inline -p '畫面裡發生什麼事？'

# 多影片也會自動計算剩餘請求空間，不需指定 --transport auto
 gemini-video -v ./a.mp4 -v ./b.mp4 -p '比較兩段影片。'

# 公開 YouTube；不需要先下載
 gemini-video -v 'https://www.youtube.com/watch?v=9hE5-98ZeCg' -p '產生測驗及答案。'

# 重用既有上傳檔案；也接受完整 Gemini Files API URI
 gemini-video files upload ./lecture.mp4 -o uploaded.json
 gemini-video -v files/FILE_ID -p '第一個論點是什麼？'
 gemini-video files list
 gemini-video files get files/FILE_ID
 gemini-video files delete files/FILE_ID

# 無副檔名的影片
 gemini-video -v ./recording --mime-type video/mp4 -p '摘要。'

# 分析完清理本次上傳檔案
 gemini-video -v ./lecture.mp4 -p '摘要。' --cleanup
```

`files upload` 會等待檔案處理完成，並回傳含 `name`、`uri` 的 JSON。`files list` 會取得全部分頁。檔案處理失敗會停止分析，不會把尚未可用的檔案送給模型。每個檔案上限採 2 GB；Files API 檔案通常在 48 小時後自動刪除。實際配額由 Google 帳戶與 API 決定。

支援 `.mp4`、`.mpeg`、`.mpg`、`.mov`、`.avi`、`.flv`、`.webm`、`.wmv`、`.3gp`、`.3gpp`，並對應官方 MIME。CLI 不轉碼、不裁切本機檔案；時間區間交由 Gemini 處理。一般 HTTP 下載網址需先自行下載；CLI 接受公開 YouTube URL 與 Gemini Files URI。

`--cleanup` 只刪除本次命令上傳的檔案，不刪除透過 `files/ID` 引用的既有檔案。同步失敗時仍會嘗試清理。背景工作發生連線中斷或等待逾時時，檔案會保留，避免仍在執行的工作失去來源；終端機會顯示檔案名稱。`--cleanup` 不能與 `--no-wait` 同用。若後續還需要檔案或對話重播，請保留上傳資料。

## 時間點、區間、FPS 與解析度

```bash
# 在提示詞中詢問指定時間；官方建議使用 MM:SS
 gemini-video -v ./clip.mp4 -p '01:15 時的畫面與聲音是什麼？'

# 只分析第 20 到 25 分鐘；時間也可直接使用秒數
 gemini-video -v ./lecture.mp4 --start 20:00 --end 25:00 -p '摘要這一段。'

# 每 2 秒取樣一幀，提高解析度以查看細節
 gemini-video -v ./clip.mp4 --fps 0.5 --resolution high -p '閱讀畫面文字。'
```

`--start`、`--end` 接受非負秒數、`MM:SS`、`HH:MM:SS`，最後一段可有小數。結束時間須大於開始時間。CLI 將秒數轉成目前 SDK 型別要求的 duration 字串，例如 `"120s"`。這與影片教學頁部分範例的數字格式不同；本專案以安裝版 SDK 型別及實際序列化測試為依據。

`--fps` 必須大於 0。區間與 FPS 僅能搭配 `static`。預設為 static；省略自訂 FPS 時採 API 預設取樣。解析度可用 `low`、`medium`、`high`、`ultra_high`；模型實際支援及 token 成本由 API 決定。Interactions 請求欄位使用 `resolution`。

## Agentic、多影片與個別設定

```bash
 gemini-video -v ./long-lecture.mp4 --processing agentic \
  -p '找出講者解釋實驗失敗原因的片段，附時間點。' --background

 gemini-video --manifest examples/mixed-videos.json \
  --prompt-file examples/compare.txt --dry-run
```

每次最多 10 部影片。重複 `--video` 使用相同的全域設定；`--manifest` 允許各影片覆寫設定，也可以與 `--video` 同用。manifest 的相對檔案路徑以 **manifest 所在資料夾**為基準。欄位如下：

```json
[
  {
    "source": "./lecture.mp4",
    "name": "full_lecture",
    "transport": "upload",
    "processing": "agentic",
    "resolution": "low"
  },
  {
    "source": "./demo.mp4",
    "name": "demo_segment",
    "processing": "static",
    "start": "00:30",
    "end": "01:30",
    "fps": 2,
    "resolution": "high",
    "mimeType": "video/mp4"
  }
]
```

Agentic 會依問題探索影片，適合長影片與特定事件搜尋。模型相容性依官方文件為準。`--json` 的 `steps` 中若出現 `processing_call` 與 `processing_result`，可用來確認模型實際進行了動態探索。CLI 只要求模式，不偽造處理步驟。

## 串流與背景工作

```bash
# 即時輸出文字
 gemini-video -v ./clip.mp4 -p '詳細描述。' --stream

# 背景執行並等待；長影片建議使用
 gemini-video -v ./lecture.mp4 -p '整理重點。' --background --timeout 1800

# 立即取得 id，稍後查詢
 gemini-video -v ./lecture.mp4 -p '整理重點。' --background --no-wait -o job.json
 gemini-video jobs get INTERACTION_ID
 gemini-video jobs get INTERACTION_ID --wait --timeout 1800
 gemini-video jobs cancel INTERACTION_ID
 gemini-video jobs delete INTERACTION_ID
```

`--stream` 與 `--background` 分開使用。`--stream --json` 或 `--stream -o file` 會緩衝輸出，不會將文字片段混入 JSON。要取得串流的完整 JSON 或儲存歷史，CLI 會在完成後讀回完整 Interaction，因此不能同時指定 `--no-store`。

`--timeout` 預設 600 秒，分別適用於 SDK HTTP 請求、各影片處理等待、背景工作等待；**不是整條命令的共同總時限**。`--poll` 預設 2 秒。等待逾時不會取消伺服器上的背景工作，可依顯示的 ID 繼續 `jobs get --wait`。`jobs get` 未指定 `--wait` 時回傳目前狀態；指定後若以失敗、取消或未完成狀態終止會回報錯誤。

## 多輪對話與無狀態重播

```bash
# 伺服器保存對話：第一次回應 JSON 的 id 用於下一次
 gemini-video -v ./lecture.mp4 -p '主要論點是什麼？' --json -o first.json
 gemini-video --previous INTERACTION_ID -p '第二個論點有哪些證據？'

# 自行保存完整 steps；可關閉伺服器儲存
 gemini-video -v ./lecture.mp4 -p '摘要。' --no-store --save-history history.json
 gemini-video --history history.json -p '請展開第二點。' \
  --no-store --save-history history.json
```

`--history` 接受完整的 **steps 陣列**，不是單一回應物件。`--save-history` 保存使用者輸入與模型所有步驟，包含 agentic 處理步驟；後續不要只保留文字摘要。SDK 的 `input` 會傳送完整 steps 陣列，對應文件所說的 stateless `step_list` 語意。

`--previous` 與 `--history` 不可同用。`--save-history` 不能搭配 `--previous`，因為僅憑上一個 ID 無法在本機重建完整較早歷史；請選擇上述其中一種工作流程。`--no-wait` 尚未產生完整回應，不能同時儲存歷史。

預設 `store=true`；`--no-store` 會關閉伺服器對話儲存，但與 `--background`、`--previous` 不相容。Files API 儲存與 Interaction 儲存是兩件事。重播仍會使用已上傳的影片 URI，其有效期不會因儲存 JSON 而延長。API 金鑰不會寫入歷史，但影片 URI、提示詞及模型回應會，請妥善管理這些檔案。

系統提示及生成設定只適用於當輪；後續命令若需要相同設定，必須重複指定 `--system`、`--max-tokens`。

## 官方影片理解功能對照

| 官方教學用途 | CLI 對應 |
| --- | --- |
| 上傳與等待影片處理 | `--video path`、`files upload` |
| 小影片 inline | `--transport inline` |
| 公開 YouTube URL | `--video https://...` |
| 影片摘要、問答、測驗、音訊與畫面洞察 | `--prompt`、`--prompt-file`、STDIN |
| 指定時間點 | 提示詞中的 `MM:SS` |
| Agentic 影片探索 | `--processing agentic` |
| 同一請求混合 static / agentic | `--manifest` |
| 裁切區間 | `--start`、`--end` |
| 自訂取樣率 | `--fps` |
| 影片幀解析度 | `--resolution` |
| 多影片 | 重複 `--video` 或 manifest |
| 多輪對話與完整步驟保留 | `--previous`、`--history`、`--save-history` |
| 長請求串流或背景執行 | `--stream`、`--background`、`jobs get --wait` |
| Token 使用與處理步驟 | `--json` 的 `usage`、`steps` |

影片長度、模型上下文、YouTube 配額及可存取性仍受 Gemini API 限制。CLI 無法在本機事先確認 YouTube 是否公開、模型額度或影片實際 token 數；相關錯誤會由 API 回傳。預設 `auto` 依影片的 base64 大小與整體請求剩餘空間選擇 inline 或上傳，不會探測影片時長；長影片或預計重複使用的影片請明確指定 `--transport upload`。未設定 `transport` 的 manifest 項目也採用 `auto`，但仍可由全域旗標或各項設定覆寫。

## 開發與驗證

專案提供 Makefile。執行 `make` 或 `make help` 可列出常用任務：

```bash
make install         # 依 lockfile 安裝相依套件
make install-global  # 安裝 gemini-video 全域命令
make verify          # 執行測試與 JavaScript 語法檢查
make test            # 只執行測試
make check           # 只執行語法檢查
make demo            # 離線預覽多影片範例，不需要 API 金鑰
make pack            # 在 dist/ 產生 npm 安裝封裝
make clean           # 只刪除 dist/ 產物
```

`make run` 預設顯示 CLI 說明，可用 `ARGS` 傳入參數；也支援提示詞 STDIN：

```bash
make run ARGS='-v ./clip.mp4 -p "用繁體中文摘要。"'
printf '%s\n' '描述重要事件。' | make run ARGS='-v ./clip.mp4'
```

`run` 與 `demo` 不會把 Make recipe 印到 STDOUT，可將結果直接接到其他程式。需要指定執行檔時可覆寫 `NODE` 或 `NPM`，例如 `make demo NODE=/path/to/node`。Makefile 任務均須在專案目錄執行；`install-global` 會更新目前 npm 全域環境中的命令。

也可以直接執行原本的 npm 指令：

```bash
npm ci
npm test
npm run check
npm pack --dry-run
```

目前 23 項測試涵蓋 CLI 輸入、處理狀態、錯誤、清理、串流、背景工作、對話步驟與 SDK 請求序列化。測試只使用模擬服務與本機 HTTP 伺服器，不消耗 Gemini 配額。**尚未進行真實 Google API 上傳／推論測試**；要驗證帳戶、模型及真實影片相容性，可先執行 dry-run，再用自己的短影片送出一次請求。

退出碼：`0` 成功、`1` API／I/O／處理失敗、`2` 參數或必要設定錯誤。

專案有獨立 Git 儲存庫，開發階段均以繁體中文詳細 commit 記錄：

```bash
git log --format=fuller
```

## 初始 npm 占位版本

`release/placeholder/` 是獨立的 `gemini-video-cli@0.0.0` 發布內容，只包含套件描述、README 及 MIT 授權，沒有 CLI 程式、執行入口或相依套件。現有完整 CLI 留在專案根目錄，版本仍為 `0.1.0`，未包含在占位版本內。

```bash
make pack-placeholder     # 檢查 dist/gemini-video-cli-0.0.0.tgz
npm login --registry=https://registry.npmjs.org/
make publish-placeholder  # 僅發布占位版本
```

發布需要有效的 npm 登入狀態，以及該名稱的發布權限。`make pack` 仍會封裝根目錄的完整 CLI；初始空套件請使用 `pack-placeholder` 與 `publish-placeholder`。

## 官方來源

查閱日期：2026-10-22。Gemini API 仍會更新，請以官方文件及帳戶可用模型為準。

- [Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Files API](https://ai.google.dev/gemini-api/docs/files)
- [Interactions API](https://ai.google.dev/gemini-api/docs/interactions)
- [Background execution](https://ai.google.dev/gemini-api/docs/background-execution)
- [Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
