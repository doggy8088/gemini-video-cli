# GitHub CI 與 npm Trusted Publishing

公開儲存庫：https://github.com/doggy8088/gemini-video-cli

## PR 驗證

`.github/workflows/ci.yml` 在對 main 的 pull request 上執行，並可供發布流程重用。

- 在 Ubuntu、macOS、Windows 各測試 Node.js 22 與 24。
- 執行 `npm ci`、語法檢查、自動測試與 npm 封裝預覽。
- 六組測試全部成功後，`Tests passed` 檢查才會通過。
- PR 不會取得 npm 發布權限，也不需要 Gemini API 金鑰。

## 每次 main push 發布

`.github/workflows/publish.yml` 在每次 main push 執行，也提供手動重試。

1. 重用完整 CI 流程，全部測試通過後才進入發布工作。
2. 發布工作在 GitHub-hosted Ubuntu runner 上執行，使用 Node 24 與 npm 12.2.1。
3. 使用 GitHub OIDC 與 `npm` environment，不設定 NPM_TOKEN。
4. 從 npm registry 決定新版本；第一個完整版本為 0.1.0，後續 push 自動遞增最高穩定版本的 patch。
5. 若原始碼的 package.json 設定更高的穩定版本，使用該版本。例如從 0.1.x 升至 0.2.0。
6. 發布完整 CLI，附帶 provenance；等待 registry 中的版本與 gitHead 相符才完成。

版本調整只發生在 runner，不回寫版本 commit，避免觸發無限發布。CLI 的 `--version` 讀取封裝內的 package.json。

同一 commit 若已發布，重跑工作會跳過。發布流程使用 `queue: max` 排隊，避免兩個工作同時選取相同版本；GitHub 的佇列最多容納 100 個等待工作。一次 push 含多個 commit 時，發布該次 push 的最終版本。

## Trusted Publisher 設定

在 npm 套件設定頁，以瀏覽器建立 GitHub Actions 連線：

- Organization or user：`doggy8088`
- Repository：`gemini-video-cli`
- Workflow filename：`publish.yml`
- Environment name：`npm`
- Allowed actions：允許 `npm publish`。

GitHub `npm` environment 僅允許 main 分支部署。OIDC 權限只給發布工作；其餘工作採唯讀儲存庫權限。GitHub Actions 以完整 commit SHA 固定版本。

## 設定與實測紀錄（2026-10-22）

- 已透過 npm 網站建立 Trusted Publisher；畫面確認「Successfully added new Trusted Publisher connection.」。
- 已核對儲存的 GitHub repo、publish.yml、npm environment 與 npm publish 權限。
- 第一個 main CI 及 PR #1 均通過六組作業系統／Node.js 組合，各執行全部 28 項測試。
- PR #1 的 Tests passed 必要檢查成功後已合併，確認 PR 與 main push 事件均能觸發對應流程。
- 設定保存後，已重跑 main 的發布作業；GitHub OIDC 認證與 npm publish 步驟成功。發布流程會等待 registry 驗證版本才判定整體成功。
- 發布執行紀錄：https://github.com/doggy8088/gemini-video-cli/actions/runs/39775145170

## 查看與重試

```bash
gh run list --repo doggy8088/gemini-video-cli
gh workflow run publish.yml --repo doggy8088/gemini-video-cli --ref main
npm view gemini-video-cli version
```

若發布已被 npm 接受，但 registry 尚在處理，應等待版本可查詢後再重試；工作最多等待 10 分鐘完成傳播驗證。

官方參考：

- https://docs.npmjs.com/trusted-publishers/
- https://docs.github.com/en/actions/how-tos/use-cases-and-examples/building-and-testing/building-and-testing-nodejs
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
