---
name: bump-and-release
description: 為 gemini-video-cli 升版、透過既有 GitHub Actions 發布至 npm，並建立 GitHub Release。使用者要求 release、發布 patch/minor/major 或指定版本時使用；僅調整版本而不發布時依使用者限定範圍執行。
---

# Bump and Release

完成版本調整、驗證、提交及既有發布流程，直到 npm 可查到對應版本與發布提交，且 GitHub Release 已公開並指向相同提交。使用正體中文回報與撰寫發布說明。

所有專案路徑皆相對於 `git rev-parse --show-toplevel`，不依賴技能目錄或軟連結的位置。

* * *

## 呼叫語意

明確呼叫本技能並附上 `patch`、`minor` 或 `major`，即表示要求以該類型升版並完成發布，等同於「發布 patch／minor／major 版本」，授權範圍包含相關版本調整、驗證、提交、依儲存庫規則推送與 npm 發布、建立 GitHub Release 與對應標籤，以及發布結果核對。

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
5. npm 驗證成功後，依下節建立 GitHub Release。若 workflow 已建立 Release，核對現有結果即可。
6. 回報已發布版本、主要變更、驗證結果、發布提交、workflow 與 GitHub Release URL，以及工作目錄是否仍有變更。只有 workflow 成功、registry 核對與 GitHub Release 核對皆完成，才宣告完整發布完成。

若 workflow 失敗，先檢查失敗步驟與 registry。npm 已接受發布但 registry 尚未傳播時，沿用現有流程的等待期限；目前驗證腳本最多等待 10 分鐘。逾時後回報未完成的驗證與執行 URL，不自動升到另一版。確認同一提交尚未發布且已排除失敗原因後，才重試原 workflow；同一原因再次失敗時停止自動重試並回報。若版本或 `gitHead` 不符，停止並查明衝突，不覆寫 dist-tag。

* * *

## 建立 GitHub Release

使用 `v<target>` 作為標籤與 Release 標題；如儲存庫已有其他標籤命名慣例，依現行慣例處理。發布目標一律使用 npm 已驗證的完整 `gitHead`，避免 `main` 在等待期間前進而指向其他提交。

1. 查詢同名 GitHub Release 與遠端標籤。區分查無物件與認證、網路錯誤；查詢失敗時先處理原因。既有標籤須解析至實際 commit，含 annotated tag 的解參照。若提交與 npm `gitHead` 不一致，停止並回報；不移動或覆寫標籤。
2. 依前一個已發布 Release 至目標提交的實際 diff 與提交記錄，撰寫正體中文 Markdown 發布說明，涵蓋主要變更、相容性影響、驗證結果與 npm 安裝指令。首次 Release 以目標提交中的已驗證功能為依據。將說明寫入亂數 UTF-8 暫存檔，交由 `--notes-file` 讀取。
3. 同名 Release 不存在且標籤不存在時，執行 `gh release create "v<target>" --target "<published-sha>" --title "v<target>" --notes-file "<notes-file>"`，由 GitHub 在指定提交建立標籤。若標籤已存在且提交核對相符，加上 `--verify-tag`。以上佔位值執行前須替換成已確認的資料。
4. 若同名 Release 已公開且核對相符，沿用並回報其 URL；若為同版本同提交的草稿，檢查內容後完成公開。使用 `gh release view` 核對 tag、URL、發布說明、`isDraft=false` 與穩定版的 `isPrerelease=false`，並再次確認遠端標籤解析後的提交等於 npm `gitHead`。

GitHub Release 建立失敗時，明確回報「npm 已發布，GitHub Release 尚未完成」。重試前先查現有 Release 與標籤，僅補完缺漏步驟，不重新發布 npm 或遞增版本；同一原因再次失敗時停止自動重試。此步驟由技能透過 GitHub CLI 執行，不代表單獨 push 就會自動建立 GitHub Release。

指令語意參考：[GitHub CLI release create](https://cli.github.com/manual/gh_release_create)。
