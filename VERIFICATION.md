# 驗證紀錄

日期：2026-10-22
環境：macOS、Node.js v24.22.1、npm 12.2.1、@google/genai 2.30.0。

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

## 未驗證

- 尚未呼叫真實 Google API，因此不宣稱已驗證帳戶權限、實際上傳、模型可用性、YouTube 存取、額度或模型輸出品質。
- 未執行跨平台實機測試；使用 Node.js 標準檔案與參數 API，以維持跨平台可攜性。

## 文件差異處理

- 影片教學頁部分範例以數字表示 `start_offset`／`end_offset`。
- 安裝版官方 SDK 定義要求帶 `s` 的 duration 字串；CLI 採該型別並以 SDK 序列化測試驗證。
- stateless `step_list` 在此版 SDK 以 `input` 的 steps 陣列表達；CLI 保留完整輸入與所有模型步驟。
- 串流 lifecycle event 僅含部分 Interaction。要求完整 JSON／歷史時，完成後取得儲存的完整 Interaction，避免遺漏 agentic 處理步驟。
