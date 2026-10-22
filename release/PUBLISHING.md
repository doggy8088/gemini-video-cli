# 初始占位版本發布紀錄

日期：2026-10-22

- 套件：`gemini-video-cli`
- 提交版本：`0.0.0`
- npm 帳號：`willh`
- Registry：`https://registry.npmjs.org/`
- npm 套件頁：https://www.npmjs.com/package/gemini-video-cli
- 發布指令：`make publish-placeholder`
- 存取設定：public；dist-tag：latest。

## 已完成

- 確認 npm 登入帳號及新套件名稱。
- 完成 npm 瀏覽器發布驗證。
- npm publish 以退出碼 0 結束，回報 `+ gemini-video-cli@0.0.0`。
- npm 同時告知套件仍在處理，可能需要數分鐘才能提供下載。
- 公開 registry 已建立套件，maintainer 為 `willh`。

提交的 tarball 僅有三個檔案：

- `package.json`
- `README.md`
- `LICENSE`

沒有 CLI 程式碼、bin、exports、scripts 或 dependencies。

SHA-1：`5dbfda4cfd3857a38eb929bb685b085f6c923768`

## 提交後觀察到的狀態

Registry 目前提供暫時的 `0.0.0-stage` 版本，`latest` 指向該版本。
`0.0.0` 查詢尚未成功；因此這份紀錄只確認發布請求已接受與名稱已建立，
不宣稱提交版本已可下載。`npm stage list` 為空，未發現需要手動核准的 staged release。

稍後可確認最終版本與檔案雜湊：

```bash
npm view gemini-video-cli@0.0.0 version dist.shasum --registry=https://registry.npmjs.org/
```

預期版本為 `0.0.0`，雜湊應符合上列 SHA-1。npm 尚在處理時不要重複提交相同版本。
