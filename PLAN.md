# 實作計畫與驗收範圍

來源：https://ai.google.dev/gemini-api/docs/video-understanding
查閱日期：2026-10-22。另查閱 Files、Background execution、Interactions 與 Media resolution 官方文件。

## 階段一：專案基礎

- 建立獨立 Git 儲存庫、Node.js 22+ CLI 套件及官方 @google/genai SDK。
- 排除 API 金鑰、環境設定與相依套件，使用 lockfile 固定可重現安裝。

## 階段二：完整影片理解工作流程

- 分析本機影片、inline 資料、YouTube URL、既有 Files API 資源。
- 旗標、文字檔、STDIN 提示詞；多影片與 JSON manifest 個別參數。
- static / agentic、開始與結束秒數、FPS、media resolution。
- 串流、背景提交與查詢、JSON 輸出、儲存結果。
- previous_interaction_id 多輪對話與完整 step_list 無狀態重播。
- 檔案上傳、等待 ACTIVE、列出、取得、刪除及選用的自動清理。
- 提供離線 dry-run、輸入驗證、逾時、錯誤退出碼及標準輸出／錯誤分流。

## 階段三：測試、文件與封裝驗證

- 以模擬 SDK 驗證請求格式、檔案生命週期、錯誤、串流與背景工作。
- 以子行程驗證真正的 CLI 旗標、STDIN、dry-run 與錯誤退出碼。
- 撰寫繁中 README 與可執行範例，建立官方文件功能對照表。
- API 實測需可用金鑰；未執行時明確記錄，絕不宣稱已驗證線上推論。

每個階段完成後使用繁體中文標題與詳細內文建立 commit。
