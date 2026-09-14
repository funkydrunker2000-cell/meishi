/* 営業名刺帳 — 共通処理（Supabase：ログイン・データ保存・名刺画像・読み取り） */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = (s) => (s ? s.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3") : "");
const shortDate = (s) => (s ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : "");
const WEEK = "日月火水木金土";
const weekday = (s) => (s ? WEEK[new Date(s + "T00:00:00").getDay()] : "");
const daysUntil = (s) => (s ? Math.round((new Date(s + "T00:00:00") - new Date(todayStr() + "T00:00:00")) / 86400000) : null);

/* 会社名の表記ゆれをそろえて照合する */
function normCompany(s) {
  return String(s || "").normalize("NFKC").toLowerCase()
    .replace(/株式会社|有限会社|合同会社|一般社団法人|\(株\)|\(有\)|㈱|㈲|\s|・|\.|,/g, "");
}

const prefs = {
  get(k) { try { return localStorage.getItem("meishi." + k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem("meishi." + k, v); } catch {} },
};

/* 招待メール・パスワード再設定メールのリンクから来たかを、Supabase が URL を読み取る前に控えておく */
const AUTH_LINK_TYPE = new URLSearchParams(location.hash.replace(/^#/, "")).get("type") || "";

const CFG = window.MEISHI_CONFIG || {};
const CONFIGURED = !!(CFG.supabaseUrl && CFG.supabaseKey && !/YOUR-/.test(CFG.supabaseUrl + CFG.supabaseKey));
const sb = CONFIGURED && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;

/* 画面側の項目名（camelCase）と、テーブルの列名（snake_case）の対応 */
const COLUMNS = {
  companies: ["name", "industry", "phone", "address", "url", "memo", "stage", "prospect", "next_action", "next_date", "steps"],
  contacts: ["company_id", "name", "kana", "department", "title", "phone", "mobile", "email", "fax", "photo_path"],
  visits: ["company_id", "date", "method", "staff", "contact_ids", "other_contact", "memo", "prospect", "next_action", "next_date"],
};
const DATE_COLS = new Set(["date", "next_date"]);
const toSnake = (k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const toCamel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function toRow(col, obj) {
  const row = {};
  for (const [k, v] of Object.entries(obj)) {
    const s = toSnake(k);
    if (!COLUMNS[col].includes(s)) continue; // created_by などはデータベース側で自動設定
    row[s] = DATE_COLS.has(s) && !v ? null : v;
  }
  return row;
}
function fromRow(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) o[toCamel(k)] = v;
  return o;
}

const COLS = ["companies", "contacts", "visits"];
const Store = {
  mode: "loading", // "setup"（接続先が未設定）| "signedOut" | "needPassword" | "signedIn"
  canReadImages: !!sb,
  assets: !!sb,
  user: null,
  profile: { displayName: "" },
  data: { companies: [], contacts: [], visits: [] },
  needPassword: AUTH_LINK_TYPE === "invite" || AUTH_LINK_TYPE === "recovery",
  channel: null,
  onChange: () => {}, onError: () => {}, onAuth: () => {},

  async init() {
    if (!sb) { this.mode = "setup"; this.onAuth("setup"); return; }
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") this.needPassword = true;
      // コールバック内で Supabase の処理を待つと固まることがあるため、次の順番で処理する
      setTimeout(() => this.handleSession(session), 0);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.mode === "signedIn") this.loadAll();
    });
  },

  async handleSession(session) {
    const uid = session?.user?.id || null;
    if (!uid) {
      this.stop();
      this.mode = "signedOut"; this.onAuth("signedOut");
      return;
    }
    if (this.needPassword) { this.user = session.user; this.mode = "needPassword"; this.onAuth("needPassword"); return; }
    if (this.mode === "signedIn" && this.user?.id === uid) return;
    this.user = session.user;
    this.mode = "signedIn";
    await this.loadProfile();
    this.onAuth("signedIn");
    await this.loadAll();
    this.subscribe();
  },

  /* ── ログイン ── */
  async signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async sendReset(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw error;
  },
  async setPassword(password) {
    const { data, error } = await sb.auth.updateUser({ password });
    if (error) throw error;
    this.needPassword = false;
    history.replaceState(null, "", location.pathname + location.search);
    const { data: s } = await sb.auth.getSession();
    await this.handleSession(s.session || { user: data.user });
  },
  async signOut() { await sb.auth.signOut(); },

  async loadProfile() {
    const { data } = await sb.from("profiles").select("display_name").eq("id", this.user.id).maybeSingle();
    this.profile = { displayName: data?.display_name || "" };
  },
  async saveDisplayName(name) {
    const { error } = await sb.from("profiles").upsert({ id: this.user.id, display_name: name });
    if (error) throw error;
    this.profile = { displayName: name };
  },

  /* ── データ ── */
  async loadAll() {
    try {
      for (const col of COLS) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await sb.from(col).select("*").order("created_at").range(from, from + 999);
          if (error) throw error;
          rows.push(...data);
          if (data.length < 1000) break;
        }
        this.data[col] = rows.map(fromRow);
      }
      this.onChange();
    } catch (e) { this.onError(e); }
  },
  subscribe() {
    if (this.channel) return;
    let ch = sb.channel("meishi-changes");
    COLS.forEach((col) => {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table: col }, (p) => {
        if (p.eventType === "DELETE") this.removeLocal(col, p.old.id);
        else this.upsertLocal(col, p.new);
      });
    });
    let first = true;
    this.channel = ch.subscribe((status) => {
      // 通信が切れて再接続したときは、その間の変更を取りこぼさないよう読み直す
      if (status === "SUBSCRIBED") { if (!first) this.loadAll(); first = false; }
    });
  },
  stop() {
    if (this.channel) { sb.removeChannel(this.channel); this.channel = null; }
    this.user = null; this.profile = { displayName: "" };
    this.data = { companies: [], contacts: [], visits: [] };
    this.photoCache.clear();
  },
  upsertLocal(col, row) {
    const item = fromRow(row);
    const i = this.data[col].findIndex((r) => r.id === item.id);
    this.data[col] = i < 0 ? [...this.data[col], item] : this.data[col].map((r, j) => (j === i ? item : r));
    this.onChange();
  },
  removeLocal(col, id) {
    this.data[col] = this.data[col].filter((r) => r.id !== id);
    this.onChange();
  },

  async add(col, obj) {
    const { data, error } = await sb.from(col).insert(toRow(col, obj)).select().single();
    if (error) throw error;
    this.upsertLocal(col, data);
    return data.id;
  },
  async update(col, id, patch) {
    const { data, error } = await sb.from(col).update(toRow(col, patch)).eq("id", id).select().single();
    if (error) throw error;
    this.upsertLocal(col, data);
  },
  async remove(col, id) {
    const { error } = await sb.from(col).delete().eq("id", id);
    if (error) throw error;
    this.removeLocal(col, id);
  },

  /* ── 名刺画像（Storage の非公開バケット「cards」） ── */
  photoCache: new Map(), // path → { url, exp }
  photoQueue: new Set(),
  photoTimer: null,
  async upload(blob) {
    const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from("cards").upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (error) throw error;
    return path;
  },
  async removeAsset(path) {
    if (!path) return;
    try { await sb.storage.from("cards").remove([path]); } catch {}
    this.photoCache.delete(path);
  },
  /* 表示用の期限付きURL。まだ無ければ空文字を返し、取得できたら再描画する */
  photoUrl(path) {
    if (!path) return "";
    const hit = this.photoCache.get(path);
    if (hit && hit.exp > Date.now()) return hit.url;
    this.photoQueue.add(path);
    clearTimeout(this.photoTimer);
    this.photoTimer = setTimeout(() => this.fetchPhotoUrls(), 30);
    return hit?.url || "";
  },
  async fetchPhotoUrls() {
    const paths = [...this.photoQueue]; this.photoQueue.clear();
    if (!paths.length) return;
    const { data, error } = await sb.storage.from("cards").createSignedUrls(paths, 3600);
    const now = Date.now();
    paths.forEach((p, i) => {
      const url = !error && data?.[i]?.signedUrl ? data[i].signedUrl : "";
      // 失敗した画像は1分間は取り直さない（再描画の繰り返しを防ぐ）
      this.photoCache.set(p, { url, exp: now + (url ? 50 * 60000 : 60000) });
    });
    this.onChange();
  },
};

function dbErrorText(e) {
  const code = e?.code || "";
  const msg = String(e?.message || "");
  if (code === "42501") return "保存する権限がありません。ログインし直してから、もう一度保存してください。";
  if (code === "PGRST301" || /JWT|token/i.test(msg)) return "ログインの有効期限が切れました。ログインし直してください。";
  if (code === "23503") return "関連する訪問先が見つかりません。画面を読み込み直してから、もう一度保存してください。";
  if (code.startsWith("23")) return "入力内容に不足があります。必須項目を確認してください。";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "通信できませんでした。電波の良い場所で、もう一度保存してください。";
  return "保存できませんでした。時間をおいて、もう一度保存してください。";
}

/* ── 名刺写真：送信・保存用に縮小（長辺1600px の JPEG） ── */
async function shrinkImage(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.85));
    return blob || file;
  } catch { return file; }
}

/* ── 名刺の読み取り（Supabase Edge Function「read-card」経由で Claude API） ── */
const CARD_FIELDS = ["company", "department", "title", "name", "kana", "phone", "mobile", "email", "fax", "address", "url"];

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function readCard(blob, signal) {
  const image = await blobToBase64(blob);
  if (signal?.aborted) throw { code: "cancelled" };
  const { data, error } = await sb.functions.invoke("read-card", {
    body: { image, mediaType: blob.type === "image/png" ? "image/png" : "image/jpeg" },
  });
  if (signal?.aborted) throw { code: "cancelled" };
  if (error) {
    let code = "upstream_error";
    try { const body = await error.context.json(); code = body.error || code; }
    catch { if (error.context?.status === 401) code = "unauthorized"; }
    throw { code };
  }
  const res = {};
  CARD_FIELDS.forEach((k) => { res[k] = data && typeof data[k] === "string" ? data[k].trim() : ""; });
  return res;
}

function sampleErrorText(e) {
  switch (e && e.code) {
    case "cancelled": return "";
    case "not_configured": return "読み取り機能の設定（APIキー）がまだ済んでいません。管理者に連絡し、今回は名刺を見ながら手で入力してください。";
    case "unauthorized": return "ログインの有効期限が切れました。ログインし直してから撮り直してください。";
    case "image_rejected": return "この写真は読み取れませんでした。明るい場所で名刺全体を撮り直してください。";
    case "rate_limited": return "読み取りが混み合っています。1分ほど待って撮り直すか、手で入力してください。";
    case "refused": case "invalid_output": return "文字をうまく読み取れませんでした。撮り直すか、手で入力してください。";
    default: return "読み取り中に通信エラーが起きました。撮り直すか、手で入力してください。";
  }
}

/* ── 小物：トースト・確認ダイアログ ── */
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function ask({ title = "確認", text = "", ok = "OK", danger = false, input = null }) {
  const dlg = $("#dlgAsk");
  $("#askTitle").textContent = title;
  $("#askText").textContent = text;
  $("#askOk").textContent = ok;
  $("#askOk").style.background = danger ? "var(--shu)" : "";
  $("#askOk").style.borderColor = danger ? "var(--shu)" : "";
  $("#askField").hidden = !input;
  if (input) { $("#askLabel").textContent = input.label; $("#askInput").value = input.value || ""; }
  dlg.returnValue = "";
  dlg.showModal();
  if (input) $("#askInput").focus();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => {
      if (dlg.returnValue !== "ok") return resolve(null);
      resolve(input ? $("#askInput").value.trim() : true);
    }, { once: true });
  });
}
