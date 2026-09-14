/* 営業名刺帳 — 起動処理（接続先の確認と、記入者名の登録） */
"use strict";

(function () {
  Store.onReady = async (state) => {
    const setup = state === "setup";
    $("#authScreen").hidden = !setup;
    document.body.classList.toggle("locked", setup);
    if (setup) return;

    render();
    if (!Store.profile.displayName) {
      const name = await ask({
        title: "記入者名の登録",
        text: "営業履歴の担当者欄に入る名前です。社内の人が見て誰かわかる名前にしてください。この端末に保存され、あとから右上で変更できます。",
        ok: "登録", input: { label: "氏名", value: "" },
      });
      if (name) { await Store.saveDisplayName(name); render(); }
    }
  };

  Store.init();
})();
