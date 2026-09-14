/* 営業名刺帳 — 共通処理（Supabase：データ保存・リアルタイム反映・名刺画像・読み取り） */
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

const CFG = window.MEISHI_CONFIG || {};
const CONFIGURED = !!(CFG.supabaseUrl && CFG.supabaseKey && !/YOUR-/.test(CFG.supabaseUrl + CFG.supabaseKey));
const sb = CONFIGURED && window.supabase
  ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

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
    if (!COLUMNS[col].includes(s)) continue; // created_at などはデータベース側で自動設定
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
  mode: "loading", // "setup"（接続先が未設定）| "ready"
  canReadImages: !!window.Tesseract,
  assets: !!sb,
  profile: { displayName: prefs.get("me") }, // 記入者名はこの端末に保存
  data: { companies: [], contacts: [], visits: [] },
  channel: null,
  onChange: () => {}, onError: () => {}, onReady: () => {},

  async init() {
    if (!sb) { this.mode = "setup"; this.onReady("setup"); return; }
    this.mode = "ready";
    this.onReady("ready");
    await this.loadAll();
    this.subscribe();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.loadAll();
    });
  },

  async saveDisplayName(name) {
    prefs.set("me", name);
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
  if (code === "42501") return "保存が拒否されました。Supabase に最新の schema.sql が実行されているか、管理者に確認してください。";
  if (code === "PGRST301" || /JWT|apikey|API key/i.test(msg)) return "Supabase に接続できませんでした。config.js の公開キーが正しいか確認してください。";
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

/* ── 名刺の読み取り（ブラウザ内の無料文字認識 Tesseract.js。写真は外部に送らない） ── */
const CARD_FIELDS = ["company", "department", "title", "name", "kana", "phone", "mobile", "email", "fax", "address", "url"];

let ocrWorkerPromise = null;
function getOcrWorker() {
  // 読み取り用データ（日本語＋英語）の準備は初回だけ。以後は同じワーカーを使い回す
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = window.Tesseract.createWorker("jpn+eng", 1).catch((e) => { ocrWorkerPromise = null; throw e; });
  }
  return ocrWorkerPromise;
}

async function readCard(blob, signal) {
  if (!window.Tesseract) throw { code: "unavailable" };
  let worker;
  try { worker = await getOcrWorker(); } catch { throw { code: "load_failed" }; }
  if (signal?.aborted) throw { code: "cancelled" };
  let text = "";
  try { ({ data: { text } } = await worker.recognize(blob)); } catch { throw { code: "image_rejected" }; }
  if (signal?.aborted) throw { code: "cancelled" };
  return parseCardText(text);
}

const CORP_RE = /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|公益社団法人|一般財団法人|公益財団法人|医療法人|社会福祉法人|学校法人|NPO法人|\(株\)|\(有\)|㈱|㈲|Co\.,?\s?Ltd|Inc\.|Corporation|K\.K\.)/i;
const TITLE_SRC = "代表取締役|取締役|執行役員|副社長|社長|会長|専務|常務|本部長|事業部長|部長|次長|課長代理|課長|係長|主任|主査|室長|所長|支店長|営業所長|店長|工場長|センター長|マネージャー|マネジャー|リーダー|チーフ|CEO|COO|CFO|CTO|Manager|Director|President";
const DEPT_RE = /(部|課|室|係|グループ|チーム|センター|事業所|支店|営業所|本部|工場|Division|Dept)/;
const PREF_RE = /(北海道|東京都|京都府|大阪府|[^\s\d]{2,3}県)/;
const PHONE_RE = /(?:\+81[\s-]?)?\(?0\d{1,4}\)?[\s\-.]?\d{1,4}[\s\-.]?\d{3,4}/g;

/* 読み取った文字を、名刺の各項目に振り分ける（氏名・部署・役職は推測） */
function parseCardText(rawText) {
  const res = {};
  CARD_FIELDS.forEach((k) => (res[k] = ""));
  const lines = String(rawText || "").normalize("NFKC").split(/\r?\n/)
    // 日本語の文字の間に入りがちな空白を詰める
    .map((l) => l.replace(/([^\x00-\x7F])\s+(?=[^\x00-\x7F])/g, "$1").replace(/\s{2,}/g, " ").trim())
    .filter((l) => l.length > 1);
  res.raw = lines.join("\n");
  const used = new Set();

  lines.forEach((l, i) => {
    const flat = l.replace(/\s/g, "");
    // メール
    const mail = flat.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
    if (mail && !res.email) { res.email = mail[0]; used.add(i); return; }
    // URL
    const url = flat.match(/(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+(\/[\w\-./?%&=]*)?/i);
    if (url && /https?:|www\.|\.(jp|com|net|org|biz|info|co)\b/i.test(url[0]) && !res.url) { res.url = url[0]; used.add(i); return; }
    // 電話・携帯・FAX（1行に複数あっても、直前のラベルで判定）
    let last = 0, hit = false;
    for (const m of l.matchAll(PHONE_RE)) {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 12) continue;
      const label = l.slice(last, m.index);
      last = m.index + m[0].length;
      const local = digits.startsWith("81") ? "0" + digits.slice(2) : digits;
      const kind = /fax|ファ[クッ]ス|(^|\s)F[\s.:：]/i.test(label) ? "fax"
        : /携帯|mobile|cell|(^|\s)M[\s.:：]/i.test(label) || /^0[789]0/.test(local) ? "mobile" : "phone";
      if (!res[kind]) res[kind] = m[0].trim();
      hit = true;
    }
    if (hit) used.add(i);
  });

  // 住所（〒 か都道府県を含む行。郵便番号だけの行や、番地・ビル名の続きの行は結合）
  for (let i = 0; i < lines.length && !res.address; i++) {
    if (used.has(i) || !(/〒/.test(lines[i]) || PREF_RE.test(lines[i]))) continue;
    let addr = lines[i];
    used.add(i);
    for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
      const next = lines[j];
      if (used.has(j) || CORP_RE.test(next)) break;
      const zipOnly = /^〒?\s?\d{3}-?\d{4}$/.test(addr);
      if (!zipOnly && !/(ビル|階|号|丁目|番地|\d-\d|F)$/.test(next)) break;
      addr += " " + next;
      used.add(j);
    }
    res.address = addr.replace(/^(住所|所在地|address)[:：\s]*/i, "").trim();
  }

  // 会社名
  lines.forEach((l, i) => { if (!res.company && !used.has(i) && CORP_RE.test(l)) { res.company = l; used.add(i); } });

  // 役職・部署
  lines.forEach((l, i) => {
    if (used.has(i) || l.length > 30) return;
    const titles = [...l.matchAll(new RegExp(TITLE_SRC, "gi"))];
    if (titles.length && !res.title) {
      const first = titles[0], lastT = titles[titles.length - 1];
      res.title = l.slice(first.index, lastT.index + lastT[0].length).trim();
      const rest = (l.slice(0, first.index) + " " + l.slice(lastT.index + lastT[0].length)).trim();
      if (rest && DEPT_RE.test(rest) && !res.department) res.department = rest;
      used.add(i);
    } else if (!res.department && DEPT_RE.test(l) && !/\d/.test(l)) {
      res.department = l;
      used.add(i);
    }
  });

  // ふりがな（ひらがな・カタカナだけの行）
  lines.forEach((l, i) => {
    if (!res.kana && !used.has(i) && /^[ぁ-んァ-ヶー\s]{2,20}$/.test(l)) {
      res.kana = l.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
      used.add(i);
    }
  });

  // 氏名（残った行のうち、漢字を含む短い行。無ければローマ字の2語）
  const nameIdx = lines.findIndex((l, i) => !used.has(i) && /^[一-龠々ぁ-んァ-ヶー\s]{2,8}$/.test(l) && /[一-龠々]/.test(l));
  if (nameIdx >= 0) { res.name = lines[nameIdx]; used.add(nameIdx); }
  else {
    const romaji = lines.find((l, i) => !used.has(i) && /^[A-Z][a-zA-Z]+\s[A-Z][a-zA-Z]+$/.test(l));
    if (romaji) res.name = romaji;
  }
  return res;
}

function sampleErrorText(e) {
  switch (e && e.code) {
    case "cancelled": return "";
    case "unavailable": case "load_failed": return "文字読み取りの準備ができませんでした。電波の良い場所で撮り直すか、名刺を見ながら手で入力してください。";
    case "image_rejected": return "この写真は読み取れませんでした。明るい場所で名刺全体を撮り直すか、手で入力してください。";
    default: return "読み取り中にエラーが起きました。撮り直すか、手で入力してください。";
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
