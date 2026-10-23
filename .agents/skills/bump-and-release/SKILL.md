---
name: bump-and-release
description: 為 gemini-video-cli 升版並透過既有 GitHub Actions 發布至 npm。使用者要求 release、發布 patch/minor/major 或指定版本時使用；僅調整版本而不發布時依使用者限定範圍執行。
---

# Bump and Release

完成版本調整、驗證、提交及既有發布流程，直到 npm 可查到對應版本與發布提交。使用正體中文回報。

所有專案路徑皆相對於 `git rev-parse --show-toplevel`，不依賴技能目錄或軟連結的位置。

* * *

## 呼叫語意

明確呼叫本技能並附上 `patch`、`minor` 或 `major`，即表示要求以該類型升版並完成發布，等同於「發布 patch／minor／major 版本」，授權範圍包含相關版本調整、驗證、提交、依儲存庫規則推送與發布，以及發布結果核對。

- `$bump-and-release patch` 等同於 `$bump-and-release 發布 patch 版本`。
- `$bump-and-release minor` 與 `$bump-and-release major` 套用相同規則。
- Claude Code 的 `/bump-and-release patch` 等 slash 呼叫套用相同規則。

使用者附加的明確限制優先，例如「僅升版」「不提交」「不推送」「不發布」。詢問用法、引用呼叫範例或討論技能內容不構成發布指令。簡寫不授權納入無關變更或繞過儲存庫保護規則。

* * *

## 確認發布範圍與版本

1. 讀取根目錄的適用指示、`release/CI.md`、`.github/workflows/publish.yml`、`scripts/prepare-release.mjs` 與 `scripts/verify-release.mjs`。以目前檔案為準，不沿用上次發布的版本或執行編號。
2. 檢查工作目錄、目前分支、remote、尚未推送的提交，並 `git fetch` 更新遠端狀態。確認此次發布將包含哪些提交；保留無關變更，若無法隔離發布內容才詢問使用者。
3. 從 `package.json` 取得套件名稱，使用 `npm view <name> versions dist-tags --json` 查詢目前 registry。查詢失敗時先釐清原因，不把網路或權限錯誤視為未發布套件。
4. 對照本機版本與 registry 最高穩定版，依使用者要求計算目標 SemVer。minor 將次版本加一並將 patch 歸零；major 將主版本加一並將其餘歸零；patch 將修訂版本加一。目標必須高於已發布穩定版，且不降低本機預定版本。明確版本須確認未被占用。未指定升版類型且無既定規則時，先詢問類型。

本專案每次 `main` push 都會自動發布；原始碼版本高於 registry 時優先使用該版本，否則 runner 自動遞增 patch。因此明確要求 minor 或 major 時，要更新原始碼版本。一般穩定版流程不適用預發布版本；使用者要求預發布時，先確認 workflow 與 dist-tag 支援。

* * *

## 準備與驗證

- 執行 `npm version <target> --no-git-tag-version --ignore-scripts`，同步更新 `package.json` 與 `package-lock.json`，Git 標籤依現行發布流程處理。
- 執行目前專案規定的檢查。本專案至少執行 `npm run check`、`npm test`、`npm pack --dry-run`；前一項失敗即停止後續發布。
- CLI 的 `--version` 測試應核對 `package.json`，而非固定版本字串。若升版暴露此問題，修正測試後重新驗證，保留版本正確性的斷言。
- 檢查封裝版本與內容，確保發布的是完整 CLI。`release/placeholder/` 僅為歷史占位資料，不作為發布來源。
- 檢查完整 diff，僅暫存此次發布相關檔案，並執行 `git diff --cached --check`。

提交訊息遵守 Conventional Commits 1.0.0。以亂數暫存檔保存 UTF-8 訊息，包含必要的第二行空白行，再以 `git commit -F` 提交。例如：

```sh
set -e
commit_msg_file="$(mktemp -t codex-commit-message)"
printf '%s\n' 'chore(release): prepare <target>' '' > "$commit_msg_file"
git commit -F "$commit_msg_file"
rm "$commit_msg_file"
```

執行時將 `<target>` 換成已確認的版本。

* * *

## 發布與完成條件

1. 使用者要求發布，且授權涵蓋推送與發布時，依儲存庫規則推進至發布分支。若規則要求 PR，走 PR 與必要檢查；不以管理員權限繞過保護。僅準備版本的請求，完成範圍止於使用者指定位置。
2. 由既有 GitHub Actions 與 npm Trusted Publishing 發布。不要額外執行本機 `npm publish`，也不要為同一提交製造另一個發布入口。
3. 找到對應發布提交 SHA 的 workflow run，記錄 URL 並追蹤到結束。確認所有 CI 與發布工作成功；等待期間持續提供簡短進度。
4. 使用 `npm view <name>@<target> version gitHead dist-tags --json` 核對：版本正確、`gitHead` 等於發布提交 SHA、`latest` 指向目標穩定版。若採 PR 合併，使用實際觸發發布的合併提交 SHA。
5. 回報已發布版本、主要變更、驗證結果、發布提交與 workflow URL，以及工作目錄是否仍有變更。只有 workflow 成功與 registry 核對皆完成，才宣告發布完成。

若 workflow 失敗，先檢查失敗步驟與 registry。npm 已接受發布但 registry 尚未傳播時，沿用現有流程的等待期限；目前驗證腳本最多等待 10 分鐘。逾時後回報未完成的驗證與執行 URL，不自動升到另一版。確認同一提交尚未發布且已排除失敗原因後，才重試原 workflow；同一原因再次失敗時停止自動重試並回報。若版本或 `gitHead` 不符，停止並查明衝突，不覆寫 dist-tag。
