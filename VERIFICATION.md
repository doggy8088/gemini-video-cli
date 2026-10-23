# 驗證紀錄

日期：2026-10-22
環境：macOS、Node.js v24.22.1、npm 12.2.1、@google/genai 2.30.0。

## 音檔支援更新（2026-10-23）

- 新增 `-a`／`--audio`，涵蓋官方音訊 MIME、inline、自動選擇傳輸、上傳與既有 Files URI。
- 支援影音混合 manifest、音訊取樣率／聲道數、串流、背景工作及對話重播。
- 拒絕音檔搭配影片專用參數，以及明確指定類型與來源 MIME 不符的輸入。
- `npm test`：36 項測試全部通過。包含官方 SDK 對本機 HTTP 服務的音訊 inline／URI JSON 序列化、中文與 emoji 音檔名稱及原始上傳位元組驗證。
- `npm run check`、`npm pack --dry-run`、`git diff --check` 通過。
- 尚未呼叫真實 Google API；未驗證真實音檔的辨識品質與模型可用性。

## 預設 auto 傳輸更新

- `--video` 與未設定 `transport` 的 manifest 項目，預設改為 `auto`。
- `make verify`：23 項測試及 JavaScript 語法檢查全部通過。
- 新增 CLI 回歸測試：未指定傳輸模式的小影片使用 inline；大影片與超過總請求預算的後續影片改為上傳；明確指定 `--transport upload` 仍優先適用。
- manifest 測試確認未指定傳輸模式時使用 inline；既有上傳與清理測試明確指定 upload，持續驗證該流程。
- 更新 CLI 說明與 README 的預設值、操作範例及長影片建議。未進行真實 Google API 上傳或推論。

## 已通過

- `npm test`：22 項全部通過，無略過測試。
- `npm run check`：CLI 與核心模組語法檢查通過。
- 官方 SDK 對本機 HTTP 伺服器的整合測試：實際 JSON 請求及輸出文字解析通過。
- `node src/cli.js --manifest examples/mixed-videos.json --prompt-file examples/compare.txt --dry-run`：混合 agentic 與 static 請求正確產生。
- `npm pack --dry-run`：封裝包含 CLI、核心模組、README、範例、授權；不包含金鑰、測試暫存檔或 node_modules。
- 將實際 `.tgz` 安裝到獨立暫存目錄後執行 `gemini-video --version`：回傳 `0.1.0`。
- 使用安裝後的執行檔執行繁中提示詞 dry-run：成功。
- `git diff --check`：無空白錯誤。
- 初次 `npm install` 相依套件稽核：0 個已知漏洞。

## Makefile 任務驗證

- `make`：正確列出常用任務；`make run` 預設顯示 CLI 說明。
- `make verify`：22 項測試及 JavaScript 語法檢查全部通過。
- `make demo`：輸出可解析的混合影片請求 JSON。
- 繁中提示詞經 STDIN 傳入 `make run ARGS='-v https://youtu.be/test --dry-run'`：內容完整，STDOUT 無 recipe 雜訊。
- `make pack`：成功將 npm tarball 寫入 `dist/`；`make clean`：成功移除該產物目錄。
- `make -n install install-global`：確認分別呼叫 `npm ci` 與 `npm install --global .`；本次未重新安裝相依套件或全域命令。

## 未驗證

- 尚未呼叫真實 Google API，因此不宣稱已驗證帳戶權限、實際上傳、模型可用性、YouTube 存取、額度或模型輸出品質。
- 跨平台驗證已由 GitHub Actions 完成：Ubuntu、macOS、Windows 各 Node.js 22 與 24 均通過 28 項自動測試。

## 文件差異處理

- 影片教學頁部分範例以數字表示 `start_offset`／`end_offset`。
- 安裝版官方 SDK 定義要求帶 `s` 的 duration 字串；CLI 採該型別並以 SDK 序列化測試驗證。
- stateless `step_list` 在此版 SDK 以 `input` 的 steps 陣列表達；CLI 保留完整輸入與所有模型步驟。
- 串流 lifecycle event 僅含部分 Interaction。要求完整 JSON／歷史時，完成後取得儲存的完整 Interaction，避免遺漏 agentic 處理步驟。
