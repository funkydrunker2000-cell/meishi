/* 営業名刺帳 — ログイン・招待・パスワード再設定の画面 */
"use strict";

(function () {
  const SCREENS = ["loginForm", "resetForm", "passwordForm", "setupMsg"];

  function show(id) {
    $("#authScreen").hidden = !id;
    document.body.classList.toggle("locked", !!id);
    SCREENS.forEach((s) => ($("#" + s).hidden = s !== id));
    const first = id && $("#" + id + " input");
    if (first) first.focus();
  }

  function status(id, text, kind = "err") {
    const el = $("#" + id);
    el.hidden = !text;
    el.textContent = text || "";
    el.className = "status " + kind;
  }

  function authErrorText(e) {
    const code = e?.code || "";
    const msg = String(e?.message || "");
    if (code === "invalid_credentials" || /Invalid login credentials/i.test(msg)) return "メールアドレスかパスワードが違います。";
    if (code === "email_not_confirmed") return "招待メールのリンクを開いて、先にパスワードを設定してください。";
    if (code === "weak_password" || /at least|weak/i.test(msg)) return "パスワードが短すぎるか、推測されやすい文字列です。8文字以上で、英数字を組み合わせてください。";
    if (code === "same_password") return "今までと違うパスワードにしてください。";
    if (/rate limit/i.test(code + msg)) return "メールの送信回数が上限に達しました。1時間ほど待ってから、もう一度お試しください。";
    if (/Failed to fetch|NetworkError|network/i.test(msg)) return "通信できませんでした。電波の良い場所で、もう一度お試しください。";
    return `うまくいきませんでした。もう一度お試しください。（${msg || code}）`;
  }

  function busy(form, on) {
    form.querySelectorAll("button, input").forEach((el) => (el.disabled = on));
  }

  Store.onAuth = async (state) => {
    if (state === "setup") return show("setupMsg");
    if (state === "signedOut") { ui.selected = null; render(); return show("loginForm"); }
    if (state === "needPassword") {
      $("#passwordTitle").textContent = AUTH_LINK_TYPE === "invite" ? "ようこそ。パスワードを設定してください" : "新しいパスワードを設定";
      return show("passwordForm");
    }
    if (state === "signedIn") {
      show(null);
      render();
      if (!Store.profile.displayName) {
        const name = await ask({
          title: "記入者名の登録",
          text: "営業履歴の担当者欄に入る名前です。社内の人が見て誰かわかる名前にしてください。あとから右上で変更できます。",
          ok: "登録", input: { label: "氏名", value: "" },
        });
        if (name) {
          try { await Store.saveDisplayName(name); render(); } catch (e) { toast(dbErrorText(e)); }
        }
      }
    }
  };

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    status("loginStatus", "");
    busy(f, true);
    try { await Store.signIn($("#loginEmail").value.trim(), $("#loginPassword").value); }
    catch (err) { status("loginStatus", authErrorText(err)); }
    finally { busy(f, false); }
  });

  $("#forgotBtn").onclick = () => { $("#resetEmail").value = $("#loginEmail").value; status("resetStatus", ""); show("resetForm"); };
  $("#backToLogin").onclick = () => show("loginForm");

  $("#resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy(f, true);
    try {
      await Store.sendReset($("#resetEmail").value.trim());
      status("resetStatus", "再設定用のメールを送りました。メールのリンクを開いて、新しいパスワードを設定してください。", "");
    } catch (err) { status("resetStatus", authErrorText(err)); }
    finally { busy(f, false); }
  });

  $("#passwordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const p1 = $("#newPassword").value, p2 = $("#newPassword2").value;
    if (p1.length < 8) return status("pwStatus", "パスワードは8文字以上にしてください。");
    if (p1 !== p2) return status("pwStatus", "確認用のパスワードが一致しません。");
    status("pwStatus", "");
    busy(f, true);
    try { await Store.setPassword(p1); f.reset(); }
    catch (err) { status("pwStatus", authErrorText(err)); }
    finally { busy(f, false); }
  });

  $("#signOutBtn").onclick = async () => {
    try { await Store.signOut(); } catch (e) { toast("ログアウトできませんでした。ページを開き直してください。"); }
  };

  Store.init();
})();
