/* 営業名刺帳 — 画面 */
"use strict";

const ui = { selected: null, filter: "all", q: "", pendingPhoto: null, scanCtl: null, editingVisit: null, editingCompany: null, editingContact: null };
const ICON_CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const STAGES = ["営業中", "受注", "見送り"];
const FLOW_STEPS = [
  ["ad", "広告管理システム①（簡易求人作成）に入力"],
  ["ringi", "稟議書を上申（直接原価率を確認）"],
  ["hearing", "③ 新規受注時ヒアリングシート・勤務説明書を入力"],
];

/* ── データの組み立て ── */
function me() { return Store.profile.displayName; }
function contactsOf(cid) { return Store.data.contacts.filter((c) => c.companyId === cid).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")); }
function visitsOf(cid) { return Store.data.visits.filter((v) => v.companyId === cid).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || "")); }
function company(id) { return Store.data.companies.find((c) => c.id === id); }

function summary(co) {
  const vs = visitsOf(co.id);
  const last = vs[0];
  const d = daysUntil(co.nextDate);
  return {
    visits: vs, last, contacts: contactsOf(co.id),
    late: co.stage !== "見送り" && co.nextDate && d < 0,
    soon: co.nextDate && d >= 0 && d <= 7,
    sortKey: (last && last.date) || (co.createdAt || "").slice(0, 10),
  };
}

const FILTERS = [
  ["all", "すべて", () => true],
  ["A", "見込みA", (c) => c.prospect === "A" && c.stage !== "見送り"],
  ["soon", "7日以内の予定", (c, s) => s.soon],
  ["late", "予定日超過", (c, s) => s.late],
  ["won", "受注", (c) => c.stage === "受注"],
];

/* ── 一覧 ── */
function renderList() {
  const rows = Store.data.companies.map((c) => ({ c, s: summary(c) }));
  const q = normCompany(ui.q);
  const hit = ({ c, s }) => !q || [c.name, c.industry, c.memo, ...s.contacts.map((k) => `${k.name}${k.kana}${k.department}`), ...s.visits.map((v) => `${v.memo}${v.staff}`)]
    .some((t) => normCompany(t).includes(q));

  $("#chips").innerHTML = FILTERS.map(([key, label, fn]) => {
    const n = rows.filter((r) => fn(r.c, r.s)).length;
    return `<button type="button" class="chip" data-filter="${key}" aria-pressed="${ui.filter === key}">${label}<span class="n">${n}</span></button>`;
  }).join("");

  const fn = FILTERS.find((f) => f[0] === ui.filter)[2];
  const list = rows.filter((r) => fn(r.c, r.s) && hit(r)).sort((a, b) => b.s.sortKey.localeCompare(a.s.sortKey));

  if (!Store.data.companies.length) {
    $("#clist").innerHTML = `<li class="empty-list">まだ訪問先がありません。<br>「名刺を撮影」から最初の1枚を登録してください。</li>`;
    return;
  }
  if (!list.length) { $("#clist").innerHTML = `<li class="empty-list">条件に合う訪問先はありません。</li>`; return; }

  $("#clist").innerHTML = list.map(({ c, s }) => {
    const next = c.nextDate && c.stage !== "見送り"
      ? `<span class="pill ${s.late ? "late" : s.soon ? "soon" : ""}">次回 ${shortDate(c.nextDate)}</span>` : "";
    const stage = c.stage === "受注" ? `<span class="pill won">受注</span>` : c.stage === "見送り" ? `<span class="pill lost">見送り</span>` : "";
    return `<li><button type="button" class="citem" data-id="${c.id}" aria-current="${ui.selected === c.id}">
      <span class="nm">${esc(c.name)}</span>
      <span class="side">${stage}${c.prospect ? `<span class="mark ${c.prospect}">${c.prospect}</span>` : ""}</span>
      <span class="sub">
        <span>名刺 <span class="mono">${s.contacts.length}</span></span>
        <span>${s.last ? `最終 <span class="mono">${shortDate(s.last.date)}</span> ${esc(s.last.staff || "")}` : "履歴なし"}</span>
        ${next}
      </span>
    </button></li>`;
  }).join("");
}

/* ── 詳細 ── */
function cardHtml(k) {
  const url = Store.photoUrl(k.photoPath);
  if (url) return `<button type="button" class="card" data-contact="${k.id}" aria-label="${esc(k.name)}の名刺"><img src="${esc(url)}" alt="" loading="lazy"><span class="tag">${esc(k.name)}</span></button>`;
  const tel = [k.phone && `TEL ${k.phone}`, k.mobile && `携帯 ${k.mobile}`, k.email].filter(Boolean).map(esc).join("<br>");
  return `<button type="button" class="card" data-contact="${k.id}" aria-label="${esc(k.name)}の名刺"><span class="typeset">
    <span class="co">${esc(company(k.companyId)?.name || "")}</span>
    <span class="who"><span class="role">${esc([k.department, k.title].filter(Boolean).join("　"))}</span><span class="pname" style="display:block">${esc(k.name)}</span><span class="kana">${esc(k.kana || "")}</span></span>
    <span class="ct">${tel}</span></span></button>`;
}

function renderDetail() {
  const el = $("#detail");
  const co = ui.selected && company(ui.selected);
  document.body.classList.toggle("has-detail", !!co);
  if (!co) {
    el.innerHTML = `<div class="welcome">
      <div class="card"><span class="typeset"><span class="co">株式会社〇〇〇〇</span><span class="who"><span class="role">営業部　部長</span><span class="pname" style="display:block">名刺 太郎</span></span><span class="ct">TEL 03-0000-0000</span></span></div>
      <h2>訪問先を選んでください</h2>
      <p>左の一覧から訪問先を選ぶと、もらった名刺と営業履歴が表示されます。新しい名刺は「名刺を撮影」から登録できます。</p>
      <button type="button" class="btn primary" data-act="scan">${ICON_CAM}名刺を撮影</button></div>`;
    return;
  }
  const s = summary(co);
  const d = daysUntil(co.nextDate);
  const dLabel = co.nextDate ? (d < 0 ? `${-d}日超過` : d === 0 ? "今日" : `あと${d}日`) : "";

  const meta = [["業種", esc(co.industry)], ["電話", co.phone ? `<span class="mono">${esc(co.phone)}</span>` : ""], ["住所", esc(co.address)],
    ["Web", co.url ? `<a href="${esc(/^https?:/i.test(co.url) ? co.url : "https://" + co.url)}" target="_blank" rel="noopener">${esc(co.url)}</a>` : ""],
    ["メモ", co.memo ? `<span style="white-space:pre-wrap">${esc(co.memo)}</span>` : ""]]
    .filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  const flow = co.stage === "受注" ? `<section class="flow" aria-label="受注後の手続き">
      <h3>受注後の手続き</h3>
      <ol class="steps">${FLOW_STEPS.map(([key, label], i) => `${i ? '<li class="arrow" aria-hidden="true">↓</li>' : ""}<li><label><input type="checkbox" data-step="${key}" ${co.steps && co.steps[key] ? "checked" : ""}> <span>${label}</span></label></li>`).join("")}</ol>
      <details><summary style="cursor:pointer;font-size:13px">ヒアリングシート・稟議用に、会社情報と営業経緯をまとめて表示</summary>
        <div style="display:grid;gap:8px;margin-top:8px"><textarea id="handoff" readonly>${esc(handoffText(co, s))}</textarea>
        <button type="button" class="btn small" data-act="copy" style="justify-self:start">まとめをコピー</button></div></details>
    </section>` : "";

  el.innerHTML = `
    <div class="d-head">
      <div><button type="button" class="btn ghost small back" data-act="back">← 一覧に戻る</button></div>
      <div class="d-title">
        <h2>${esc(co.name)}</h2>
        ${co.prospect ? `<span class="mark ${co.prospect}" title="見込み度">${co.prospect}</span>` : ""}
      </div>
      <div class="d-tools">
        <label class="sr" style="font-size:12px;color:var(--ink-3)" for="stageSel">状況</label>
        <select class="stage" id="stageSel">${STAGES.map((x) => `<option ${ (co.stage || "営業中") === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        <button type="button" class="btn small" data-act="editCompany">会社情報を編集</button>
      </div>
      ${meta ? `<dl class="meta">${meta}</dl>` : ""}
    </div>
    ${co.nextAction || co.nextDate ? `<div class="next ${s.late ? "late" : ""}">
      <span class="lbl">次にやること</span><span class="what">${esc(co.nextAction || "（内容未記入）")}</span>
      ${co.nextDate ? `<span class="mono">${fmtDate(co.nextDate)}（${weekday(co.nextDate)}）</span><span class="pill ${s.late ? "late" : s.soon ? "soon" : ""}">${dLabel}</span>` : ""}
    </div>` : ""}
    ${flow}
    <section class="sec">
      <div class="sec-h"><h3>名刺<span class="count">${s.contacts.length}枚</span></h3></div>
      <div class="cards">${s.contacts.map(cardHtml).join("")}
        <button type="button" class="card-add" data-act="scan">${ICON_CAM}<span>名刺を追加</span></button></div>
    </section>
    <section class="sec">
      <div class="sec-h"><h3>営業履歴<span class="count">${s.visits.length}件</span></h3><button type="button" class="btn primary small" data-act="visit">履歴を記入</button></div>
      ${s.visits.length ? `<ol class="log">${s.visits.map(visitHtml).join("")}</ol>` : `<p class="empty">まだ履歴がありません。訪問・電話のたびに記入すると、誰が見ても経緯がわかります。</p>`}
    </section>`;
}

function visitHtml(v) {
  const names = [...(v.contactIds || []).map((id) => Store.data.contacts.find((k) => k.id === id)?.name).filter(Boolean), v.otherContact].filter(Boolean);
  return `<li class="entry">
    <div class="when">${fmtDate(v.date)}<small>${weekday(v.date)}曜</small></div>
    <div class="body">
      <div class="line1"><span class="pill">${esc(v.method || "訪問")}</span><span class="staff">${esc(v.staff)}</span>${names.length ? `<span class="with">面談：${esc(names.join("、"))}</span>` : ""}${v.prospect ? `<span class="mark ${v.prospect}">${v.prospect}</span>` : ""}</div>
      <div class="memo">${esc(v.memo)}</div>
      ${v.nextAction || v.nextDate ? `<div class="todo">次回：<b>${esc(v.nextAction || "")}</b>${v.nextDate ? ` <span class="mono">${fmtDate(v.nextDate)}</span>` : ""}</div>` : ""}
      <div class="acts"><button type="button" class="btn ghost small" data-visit="${v.id}">編集</button></div>
    </div></li>`;
}

function handoffText(co, s) {
  const L = [`【企業情報】`, `企業名：${co.name}`];
  if (co.industry) L.push(`業種：${co.industry}`);
  if (co.address) L.push(`住所：${co.address}`);
  if (co.phone) L.push(`電話：${co.phone}`);
  if (co.url) L.push(`Web：${co.url}`);
  if (co.memo) L.push(`メモ：${co.memo}`);
  L.push("", "【先方担当者】");
  s.contacts.forEach((k) => {
    const reach = [k.phone, k.mobile, k.email].filter(Boolean).join(" / ");
    L.push(`・${[k.department, k.title, k.name].filter(Boolean).join(" ")}${reach ? `（${reach}）` : ""}`);
  });
  if (!s.contacts.length) L.push("（名刺未登録）");
  L.push("", "【営業経緯】");
  [...s.visits].reverse().forEach((v) => L.push(`${fmtDate(v.date)} ${v.method || "訪問"}（${v.staff}）${v.prospect ? " 見込み" + v.prospect : ""}`, `  ${String(v.memo || "").replace(/\n/g, "\n  ")}`));
  if (!s.visits.length) L.push("（履歴なし）");
  return L.join("\n");
}

function render() {
  if (ui.selected && !company(ui.selected)) ui.selected = null;
  $("#meBtn").textContent = me() ? `記入者：${me()}` : "記入者名を設定";
  renderList();
  // 入力中のダイアログがある間も詳細は更新してよい（フォームは別要素）
  renderDetail();
}

function select(id) {
  ui.selected = id;
  render();
  if (id && matchMedia("(max-width:899px)").matches) window.scrollTo(0, 0);
}

/* ── 名刺の取り込み ── */
function fillTargets(preferId) {
  const opts = [`<option value="__new">新しい訪問先として登録</option>`]
    .concat([...Store.data.companies].sort((a, b) => a.name.localeCompare(b.name, "ja")).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`));
  $("#s_target").innerHTML = opts.join("");
  $("#s_target").value = preferId && company(preferId) ? preferId : "__new";
}

function matchCompany(name) {
  const n = normCompany(name);
  if (!n) return null;
  return Store.data.companies.find((c) => normCompany(c.name) === n)
    || Store.data.companies.find((c) => { const m = normCompany(c.name); return m.length > 2 && (m.includes(n) || n.includes(m)); });
}

function setScanStatus(text, kind = "") { const s = $("#scanStatus"); s.textContent = text; s.className = "status " + kind; }

function openScan({ withPhoto = true } = {}) {
  const f = $("#scanForm");
  f.reset();
  f.querySelectorAll(".filled").forEach((i) => i.classList.remove("filled"));
  ui.pendingPhoto = null;
  $("#scanFrame").textContent = "写真なし";
  $("#scanRaw").value = "";
  $("#scanRawBox").hidden = true;
  fillTargets(ui.selected);
  if (ui.selected && company(ui.selected)) $("#s_company").value = company(ui.selected).name;
  setScanStatus(Store.canReadImages ? "名刺の写真を選ぶと、会社名・氏名などを自動で読み取ります。" : "自動読み取りはこの環境では使えません。名刺を見ながら入力してください。", Store.canReadImages ? "" : "warn");
  $("#dlgScan").returnValue = ""; $("#dlgScan").showModal();
  if (withPhoto) $("#cardFile").click();
}

async function onPhoto(file) {
  if (!file) return;
  if (!$("#dlgScan").open) openScan({ withPhoto: false });
  const blob = await shrinkImage(file);
  ui.pendingPhoto = blob;
  const url = URL.createObjectURL(blob);
  $("#scanFrame").innerHTML = `<img src="${url}" alt="取り込んだ名刺">`;
  if (!Store.assets) setScanStatus("閲覧のみの権限のため、名刺の画像は保存されません（文字の情報は保存されます）。", "warn");
  if (!Store.canReadImages) return;

  ui.scanCtl?.abort();
  const ctl = (ui.scanCtl = new AbortController());
  setScanStatus("名刺の文字を読み取っています…（初回は読み取り用データの準備に30秒ほどかかります。待つ間に入力を始めても大丈夫です）", "busy");
  try {
    const r = await readCard(blob, ctl.signal);
    if (ctl.signal.aborted) return;
    $("#scanRaw").value = r.raw || "";
    $("#scanRawBox").hidden = !r.raw;
    let n = 0;
    CARD_FIELDS.forEach((k) => {
      const inp = $("#s_" + k);
      if (r[k] && (!inp.value || (k === "company" && ui.selected && inp.value === company(ui.selected)?.name))) { inp.value = r[k]; inp.classList.add("filled"); n++; }
    });
    const hit = matchCompany($("#s_company").value);
    if (hit) $("#s_target").value = hit.id;
    setScanStatus(n ? `${n}項目を自動で入れました。色のついた欄を名刺と見比べて直し、空いている項目は手で入力してください。${hit ? `「${hit.name}」の名刺として登録します。` : ""}` : "文字を読み取れませんでした。撮り直すか、手で入力してください。", n ? "" : "warn");
  } catch (e) {
    const t = sampleErrorText(e);
    if (t) setScanStatus(t, "err");
  }
}

async function saveScan() {
  const v = (k) => $("#s_" + k).value.trim();
  const btn = $("#scanSave"); btn.disabled = true;
  try {
    let photo = null;
    if (ui.pendingPhoto && Store.assets) {
      try { photo = await Store.upload(ui.pendingPhoto); }
      catch (e) { toast("名刺の画像を保存できなかったため、文字の情報だけ登録しました。"); }
    }
    let cid = $("#s_target").value;
    if (cid === "__new") {
      cid = await Store.add("companies", { name: v("company"), address: v("address"), phone: v("phone"), url: v("url"), industry: "", memo: "", stage: "営業中", prospect: "", nextAction: "", nextDate: "", createdBy: me() });
    } else {
      const co = company(cid), patch = {};
      ["address", "phone", "url"].forEach((k) => { if (!co[k] && v(k)) patch[k] = v(k); });
      if (Object.keys(patch).length) await Store.update("companies", cid, patch);
    }
    const kid = await Store.add("contacts", { companyId: cid, name: v("name"), kana: v("kana"), department: v("department"), title: v("title"), phone: v("phone"), mobile: v("mobile"), email: v("email"), fax: v("fax"), photoPath: photo });
    $("#dlgScan").close();
    toast("名刺を登録しました");
    select(cid);
    if ($("#s_thenVisit").checked) openVisit(null, [kid]);
  } catch (e) {
    toast(dbErrorText(e));
  } finally { btn.disabled = false; }
}

/* ── 営業履歴 ── */
function openVisit(visitId, preContacts = []) {
  const co = company(ui.selected); if (!co) return;
  const v = visitId ? Store.data.visits.find((x) => x.id === visitId) : null;
  ui.editingVisit = v ? v.id : null;
  $("#visitTitle").textContent = v ? "営業履歴を編集" : `営業履歴を記入 — ${co.name}`;
  $("#v_date").value = v ? v.date : todayStr();
  $("#v_method").value = v ? v.method || "訪問" : "訪問";
  $("#v_staff").value = v ? v.staff : me();
  $("#v_otherContact").value = v ? v.otherContact || "" : "";
  $("#v_memo").value = v ? v.memo : "";
  $("#v_nextAction").value = v ? v.nextAction || "" : "";
  $("#v_nextDate").value = v ? v.nextDate || "" : "";
  const pr = v ? v.prospect || "" : co.prospect || "";
  document.querySelectorAll('input[name="v_prospect"]').forEach((r) => (r.checked = r.value === pr));
  const chosen = new Set(v ? v.contactIds || [] : preContacts);
  const ks = contactsOf(co.id);
  $("#v_contacts").innerHTML = ks.length ? ks.map((k) => `<label><input type="checkbox" value="${k.id}" ${chosen.has(k.id) ? "checked" : ""}> ${esc(k.name)}${k.title ? `（${esc(k.title)}）` : ""}</label>`).join("") : `<span class="empty" style="padding:0">名刺が未登録です</span>`;
  $("#visitDelete").hidden = !v;
  $("#dlgVisit").returnValue = ""; $("#dlgVisit").showModal();
}

async function saveVisit() {
  const co = company(ui.selected); if (!co) return;
  const body = {
    companyId: co.id, date: $("#v_date").value, method: $("#v_method").value, staff: $("#v_staff").value.trim(),
    otherContact: $("#v_otherContact").value.trim(), memo: $("#v_memo").value.trim(),
    contactIds: [...document.querySelectorAll("#v_contacts input:checked")].map((i) => i.value),
    prospect: document.querySelector('input[name="v_prospect"]:checked')?.value || "",
    nextAction: $("#v_nextAction").value.trim(), nextDate: $("#v_nextDate").value,
  };
  try {
    let savedId = ui.editingVisit;
    if (savedId) await Store.update("visits", savedId, body);
    else savedId = await Store.add("visits", body);
    // この履歴がいちばん新しい日付なら、見込み度・次回予定を訪問先に反映
    const isLatest = visitsOf(co.id).filter((x) => x.id !== savedId).every((x) => (x.date || "") <= body.date);
    if (isLatest) await Store.update("companies", co.id, { prospect: body.prospect, nextAction: body.nextAction, nextDate: body.nextDate });
    toast("営業履歴を保存しました");
  } catch (e) { toast(dbErrorText(e)); }
}

/* ── 訪問先 ── */
function openCompany(id) {
  const co = id ? company(id) : null;
  ui.editingCompany = co ? co.id : null;
  $("#companyTitle").textContent = co ? "会社情報を編集" : "訪問先を追加";
  ["name", "industry", "phone", "address", "url", "memo"].forEach((k) => ($("#c_" + k).value = co ? co[k] || "" : ""));
  $("#companyDelete").hidden = !co;
  $("#dlgCompany").returnValue = ""; $("#dlgCompany").showModal();
}

async function saveCompany() {
  const body = {}; ["name", "industry", "phone", "address", "url", "memo"].forEach((k) => (body[k] = $("#c_" + k).value.trim()));
  try {
    if (ui.editingCompany) { await Store.update("companies", ui.editingCompany, body); toast("会社情報を保存しました"); }
    else {
      const dup = matchCompany(body.name);
      if (dup && !(await ask({ title: "同じ名前の訪問先があります", text: `「${dup.name}」がすでに登録されています。別の訪問先として追加しますか？`, ok: "別に追加する" }))) { select(dup.id); return; }
      const id = await Store.add("companies", { ...body, stage: "営業中", prospect: "", nextAction: "", nextDate: "", createdBy: me() });
      toast("訪問先を追加しました"); select(id);
    }
  } catch (e) { toast(dbErrorText(e)); }
}

async function deleteCompany() {
  const co = company(ui.editingCompany); if (!co) return;
  const ks = contactsOf(co.id), vs = visitsOf(co.id);
  $("#dlgCompany").close();
  const ok = await ask({ title: "訪問先を削除", text: `「${co.name}」と、名刺${ks.length}枚・営業履歴${vs.length}件をすべて削除します。社内の全員の画面から消え、元に戻せません。`, ok: "削除する", danger: true });
  if (!ok) return;
  try {
    for (const k of ks) { await Store.removeAsset(k.photoPath); await Store.remove("contacts", k.id); }
    for (const v of vs) await Store.remove("visits", v.id);
    await Store.remove("companies", co.id);
    ui.selected = null; render(); toast("削除しました");
  } catch (e) { toast(dbErrorText(e)); }
}

/* ── 名刺の詳細 ── */
function openContact(id) {
  const k = Store.data.contacts.find((x) => x.id === id); if (!k) return;
  ui.editingContact = k.id;
  const url = Store.photoUrl(k.photoPath);
  $("#k_photo").innerHTML = url ? `<img class="bigcard" src="${esc(url)}" alt="${esc(k.name)}の名刺">` : k.photoPath ? `<p class="empty">名刺の画像を読み込んでいます。表示されないときは、閉じて開き直してください。</p>` : "";
  ["name", "kana", "department", "title", "phone", "mobile", "email", "fax"].forEach((f) => ($("#k_" + f).value = k[f] || ""));
  $("#k_company").innerHTML = [...Store.data.companies].sort((a, b) => a.name.localeCompare(b.name, "ja")).map((c) => `<option value="${c.id}" ${c.id === k.companyId ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  $("#dlgContact").returnValue = ""; $("#dlgContact").showModal();
}

async function saveContact() {
  const body = {}; ["name", "kana", "department", "title", "phone", "mobile", "email", "fax"].forEach((f) => (body[f] = $("#k_" + f).value.trim()));
  body.companyId = $("#k_company").value;
  try { await Store.update("contacts", ui.editingContact, body); toast("名刺を保存しました"); } catch (e) { toast(dbErrorText(e)); }
}

async function deleteContact() {
  const k = Store.data.contacts.find((x) => x.id === ui.editingContact); if (!k) return;
  $("#dlgContact").close();
  if (!(await ask({ title: "名刺を削除", text: `${k.name}さんの名刺を削除します。画像も消え、元に戻せません。営業履歴は残ります。`, ok: "削除する", danger: true }))) return;
  try { await Store.removeAsset(k.photoPath); await Store.remove("contacts", k.id); toast("名刺を削除しました"); } catch (e) { toast(dbErrorText(e)); }
}

/* ── イベント ── */
function bind() {
  $("#scanBtn").onclick = $("#fab").onclick = () => openScan();
  $("#addCompanyBtn").onclick = () => openCompany(null);
  $("#scanRetake").onclick = () => $("#cardFile").click();
  $("#cardFile").onchange = (e) => { onPhoto(e.target.files[0]); e.target.value = ""; };
  $("#meBtn").onclick = async () => {
    const name = await ask({ title: "記入者名", text: "営業履歴を記入するとき、担当者欄に自動で入る名前です。", ok: "保存", input: { label: "氏名", value: me() } });
    if (name) {
      try { await Store.saveDisplayName(name); render(); toast("記入者名を保存しました"); }
      catch (e) { toast(dbErrorText(e)); }
    }
  };
  $("#q").oninput = (e) => { ui.q = e.target.value; renderList(); };
  $("#chips").onclick = (e) => { const b = e.target.closest("[data-filter]"); if (b) { ui.filter = b.dataset.filter; renderList(); } };
  $("#clist").onclick = (e) => { const b = e.target.closest("[data-id]"); if (b) select(b.dataset.id); };

  $("#detail").addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act],[data-contact],[data-visit]"); if (!t) return;
    if (t.dataset.contact) return openContact(t.dataset.contact);
    if (t.dataset.visit) return openVisit(t.dataset.visit);
    const act = t.dataset.act;
    if (act === "scan") openScan();
    else if (act === "visit") openVisit(null);
    else if (act === "editCompany") openCompany(ui.selected);
    else if (act === "back") select(null);
    else if (act === "copy") {
      const ta = $("#handoff"); ta.select();
      try { await navigator.clipboard.writeText(ta.value); toast("コピーしました"); }
      catch { toast("テキストを選択しました。長押しまたは Ctrl+C でコピーしてください"); }
    }
  });
  $("#detail").addEventListener("change", async (e) => {
    const co = company(ui.selected); if (!co) return;
    try {
      if (e.target.id === "stageSel") { await Store.update("companies", co.id, { stage: e.target.value }); toast(`状況を「${e.target.value}」にしました`); }
      if (e.target.dataset.step) await Store.update("companies", co.id, { steps: { ...(co.steps || {}), [e.target.dataset.step]: e.target.checked } });
    } catch (err) { toast(dbErrorText(err)); }
  });

  const onClose = (id, fn) => $(id).addEventListener("close", () => { if ($(id).returnValue === "save") fn(); });
  onClose("#dlgScan", saveScan);
  onClose("#dlgVisit", saveVisit);
  onClose("#dlgCompany", saveCompany);
  onClose("#dlgContact", saveContact);
  // 保存ボタンで閉じる前に必須項目を確認（method=dialog は required を検証する）
  $("#dlgScan").addEventListener("close", () => { ui.scanCtl?.abort(); });
  $("#visitDelete").onclick = async () => {
    const id = ui.editingVisit; $("#dlgVisit").close();
    if (await ask({ title: "営業履歴を削除", text: "この履歴を削除します。社内の全員の画面から消え、元に戻せません。", ok: "削除する", danger: true })) {
      try { await Store.remove("visits", id); toast("履歴を削除しました"); } catch (e) { toast(dbErrorText(e)); }
    }
  };
  $("#companyDelete").onclick = deleteCompany;
  $("#contactDelete").onclick = deleteContact;
}

/* ── 起動（接続先の確認・記入者名の登録と Store.init() の呼び出しは start.js） ── */
Store.onChange = render;
Store.onError = (e) => {
  const n = $("#modeNote"); n.hidden = false;
  n.textContent = /JWT|token/i.test(String(e?.message || ""))
    ? "Supabase に接続できませんでした。config.js の公開キーが正しいか確認してください。"
    : "最新のデータを読み込めませんでした。通信状態を確認して、ページを開き直してください。";
};
bind();
render();
