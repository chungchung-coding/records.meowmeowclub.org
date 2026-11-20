/* Meow Meow Club adoption records.
   Sign-in, records, photos and receipt numbers live in Supabase (see supabase/schema.sql).
   This page only talks to Supabase with the public "anon" key and the volunteer's own sign-in;
   the database rules decide who may read, add, edit or delete. */
(function () {
"use strict";

const cfg = window.MMC_CONFIG || {};
const BUCKET = "cat-photos";
const CLUB_UEN = "202622627H";
const TZ = "Asia/Singapore";
const hashAtLoad = location.hash || "";
const recoveryLink = /type=recovery/.test(hashAtLoad);
const linkError = (() => {
  const m = /error_description=([^&]+)/.exec(hashAtLoad);
  if (!m) return "";
  try { return decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { return "That link is not valid."; }
})();

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const configured = !!(cfg.supabaseUrl && cfg.supabaseKey && /^https:\/\//.test(cfg.supabaseUrl) && !/YOUR-/i.test(cfg.supabaseUrl + cfg.supabaseKey));
let sb = null;
if (configured && window.supabase) {
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
}

const S = {
  uid: null, staff: null, records: [], loaded: false, loadFailed: false,
  view: "loading", currentId: null, editing: null, photoDraft: null,
  query: "", recovering: recoveryLink, lastLoad: 0
};
let drawToken = 0;

/* ---------- small helpers ---------- */
const fmtNum = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n, c) => (c || "SGD") + " " + fmtNum(n);
function parseDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
function fmtDate(s) { const d = parseDate(s); return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "-"; }
function fmtStamp(iso) {
  const d = new Date(iso); if (isNaN(d)) return "";
  return d.toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}
function todayStr() { return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); }
const feeText = r => (r.method === "Waived" ? "Waived" : money(r.fee, r.currency));
const PAW = '<svg width="34" height="34" viewBox="0 0 100 100" aria-hidden="true"><g fill="currentColor"><ellipse cx="50" cy="68" rx="26" ry="21"/><ellipse cx="20" cy="42" rx="10" ry="13" transform="rotate(-20 20 42)"/><ellipse cx="40" cy="24" rx="10" ry="14" transform="rotate(-6 40 24)"/><ellipse cx="60" cy="24" rx="10" ry="14" transform="rotate(6 60 24)"/><ellipse cx="80" cy="42" rx="10" ry="13" transform="rotate(20 80 42)"/></g></svg>';
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
}

let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

const VIEWS = ["loading", "login", "recover", "noaccess", "records", "form", "detail"];
function show(v) {
  S.view = v;
  for (const n of VIEWS) $("#v-" + n).hidden = n !== v;
  $("#who").hidden = !S.staff;
  try { window.scrollTo(0, 0); } catch (e) {}
}
function setMsg(id, text) { const n = $(id); n.textContent = text || ""; n.hidden = !text; }

function friendlyError(e, fallback) {
  const m = String((e && e.message) || "");
  if (/failed to fetch|networkerror|load failed|network request/i.test(m)) return "There is no connection. Check your internet and try again.";
  if (e && (e.status === 401 || /jwt|not authenticated/i.test(m))) return "Your sign-in has expired. Please sign in again.";
  if (e && (e.code === "42501" || e.status === 403)) return "This account is not allowed to do that.";
  return fallback;
}
function expired(e) { return !!(e && (e.status === 401 || /jwt expired|invalid jwt/i.test(String((e && e.message) || "")))); }

/* ---------- row mapping (database snake_case <-> page camelCase) ---------- */
function toRec(r) {
  return {
    id: r.id, receiptNo: r.receipt_no, issuedOn: r.issued_on, adoptionDate: r.adoption_date,
    catName: r.cat_name, sex: r.sex, age: r.age, colour: r.colour, microchip: r.microchip,
    sterilised: r.sterilised, vaccinated: r.vaccinated, photoPath: r.photo_path,
    fee: Number(r.fee), currency: r.currency, method: r.method, handledBy: r.handled_by,
    adopterName: r.adopter_name, phone: r.phone, email: r.email, address: r.address, notes: r.notes,
    termsAgreed: !!r.terms_agreed, pdpaConsent: !!r.pdpa_consent, pdpaConsentAt: r.pdpa_consent_at,
    createdByName: r.created_by_name, createdAt: r.created_at, updatedByName: r.updated_by_name, updatedAt: r.updated_at
  };
}
function toRow(d, photoPath) {
  return {
    adoption_date: d.adoptionDate, cat_name: d.catName, sex: d.sex, age: d.age, colour: d.colour,
    microchip: d.microchip, sterilised: d.sterilised, vaccinated: d.vaccinated, photo_path: photoPath || null,
    fee: d.fee, currency: d.currency, method: d.method, handled_by: d.handledBy,
    adopter_name: d.adopterName, phone: d.phone, email: d.email, address: d.address, notes: d.notes,
    terms_agreed: d.termsAgreed, pdpa_consent: d.pdpa
  };
}

/* ---------- photos ---------- */
const urlCache = new Map();   // storage path -> { url, at } (signed link, for list thumbnails)
const blobCache = new Map();  // storage path -> object URL (downloaded copy, for the receipt canvas)
async function signThumbs(recs) {
  const now = Date.now();
  const need = [...new Set(recs.map(r => r.photoPath).filter(p => p && (!urlCache.has(p) || now - urlCache.get(p).at > 45 * 60 * 1000)))];
  for (let i = 0; i < need.length; i += 100) {
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), 3600);
      if (error || !data) continue;
      data.forEach(d => { if (d && d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, at: now }); });
    } catch (e) { /* thumbnails are optional */ }
  }
}
const thumbUrl = r => (r.photoPath && urlCache.has(r.photoPath)) ? urlCache.get(r.photoPath).url : "";
async function photoBlobUrl(path) {
  if (blobCache.has(path)) return blobCache.get(path);
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw error || new Error("photo");
  const u = URL.createObjectURL(data); blobCache.set(path, u); return u;
}
function clearPhotoCaches() {
  blobCache.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  blobCache.clear(); urlCache.clear();
}

/* ---------- sign in / out ---------- */
async function onLogin(ev) {
  ev.preventDefault();
  setMsg("#loginErr", ""); setMsg("#loginOk", "");
  const email = $("#loginEmail").value.trim(), password = $("#loginPass").value;
  if (!sb) { setMsg("#loginErr", "This site is not connected to its database yet. See the setup guide."); return; }
  if (!email || !password) { setMsg("#loginErr", "Enter your email and password."); return; }
  const btn = $("#loginBtn"); btn.disabled = true; btn.textContent = "Signing in...";
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      setMsg("#loginErr", /invalid login|invalid credentials/i.test(error.message || "") ? "That email or password is not right." : friendlyError(error, "Sign in did not work. Try again."));
    } else {
      $("#loginPass").value = "";
      if (data && data.session) await enter(data.session);
    }
  } catch (e) { setMsg("#loginErr", friendlyError(e, "Sign in did not work. Try again.")); }
  finally { btn.disabled = false; btn.textContent = "Sign in"; }
}
async function onForgot() {
  setMsg("#loginErr", ""); setMsg("#loginOk", "");
  const email = $("#loginEmail").value.trim();
  if (!sb) { setMsg("#loginErr", "This site is not connected to its database yet. See the setup guide."); return; }
  if (!email) { setMsg("#loginErr", "Type your email address above first, then choose Forgot password."); $("#loginEmail").focus(); return; }
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) setMsg("#loginErr", friendlyError(error, "The reset email could not be sent. Ask the club admin to reset your password."));
    else setMsg("#loginOk", "If that address is on the club's list, a link to choose a new password is on its way. Check your junk folder too.");
  } catch (e) { setMsg("#loginErr", friendlyError(e, "The reset email could not be sent. Ask the club admin to reset your password.")); }
}
async function onRecover(ev) {
  ev.preventDefault();
  const a = $("#newPass").value, b = $("#newPass2").value;
  if (a.length < 10) { setMsg("#recoverErr", "Use at least 10 characters."); return; }
  if (a !== b) { setMsg("#recoverErr", "The two passwords do not match."); return; }
  setMsg("#recoverErr", "");
  try {
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { setMsg("#recoverErr", friendlyError(error, "The password could not be saved. The link may have expired; request a new one.")); return; }
    $("#newPass").value = ""; $("#newPass2").value = "";
    S.recovering = false;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    const { data } = await sb.auth.getSession();
    toast("Password saved.");
    if (data && data.session) await enter(data.session); else resetToLogin("");
  } catch (e) { setMsg("#recoverErr", friendlyError(e, "The password could not be saved. Try again.")); }
}
function resetToLogin(msg) {
  S.uid = null; S.staff = null; S.records = []; S.loaded = false; S.loadFailed = false;
  S.currentId = null; S.editing = null; S.photoDraft = null; S.query = "";
  clearPhotoCaches();
  show("login");
  setMsg("#loginErr", msg || ""); setMsg("#loginOk", "");
}
async function signOut() {
  try { if (sb) await sb.auth.signOut(); } catch (e) {}
  resetToLogin("");
}

let entering = null;
async function enter(session) {
  const uid = session.user.id;
  if (S.uid === uid && S.staff) return;
  if (entering === uid) return;
  entering = uid;
  try {
    const { data, error } = await sb.from("staff").select("role, display_name").eq("user_id", uid).maybeSingle();
    if (error) throw error;
    S.uid = uid;
    if (!data) { S.staff = null; show("noaccess"); return; }
    S.staff = { role: data.role, name: data.display_name || session.user.email || "" };
    $("#whoName").textContent = S.staff.name + (S.staff.role === "admin" ? " (admin)" : "");
    $("#exportCsv").hidden = S.staff.role !== "admin";
    show("records"); renderRecords();
    await loadRecords();
  } catch (e) {
    if (expired(e)) resetToLogin("Your sign-in has expired. Please sign in again.");
    else { show("login"); setMsg("#loginErr", friendlyError(e, "Signed in, but the club records could not be reached. Try again in a moment.")); }
  } finally { entering = null; }
}

function handleSession(session, event) {
  if (event === "PASSWORD_RECOVERY" || (S.recovering && session && event !== "SIGNED_OUT")) {
    S.recovering = true; show("recover"); return;
  }
  if (event === "SIGNED_OUT" || !session) { if (S.view === "loading") show("login"); else if (S.view !== "login") resetToLogin(""); return; }
  if (event === "TOKEN_REFRESHED") return;
  enter(session);
}

/* ---------- loading records ---------- */
async function fetchAll() {
  const out = [], size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await sb.from("adoptions").select("*")
      .order("adoption_date", { ascending: false }).order("created_at", { ascending: false }).order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out.map(toRec);
}
async function loadRecords() {
  try {
    const recs = await fetchAll();
    await signThumbs(recs);
    S.records = recs; S.loaded = true; S.loadFailed = false; S.lastLoad = Date.now();
    setMsg("#conn", "");
  } catch (e) {
    if (expired(e)) { resetToLogin("Your sign-in has expired. Please sign in again."); return; }
    S.loaded = true; S.loadFailed = !S.records.length;
    setMsg("#conn", "Your records may be out of date. " + friendlyError(e, "Check your connection."));
  }
  if (S.view === "records") renderRecords();
  if (S.view === "detail") { const r = currentRec(); if (r) paintDetail(r); else { show("records"); renderRecords(); } }
}
async function refreshIfStale() {
  if (!sb || !S.staff || document.visibilityState !== "visible") return;
  if (S.view !== "records" || Date.now() - S.lastLoad < 20000) return;
  try {
    const { data, error } = await sb.from("staff").select("role").eq("user_id", S.uid).maybeSingle();
    if (!error && !data) { S.staff = null; show("noaccess"); return; }
  } catch (e) {}
  loadRecords();
}

/* ---------- records list ---------- */
function sortedRecords() {
  return S.records.slice().sort((a, b) =>
    (b.adoptionDate || "").localeCompare(a.adoptionDate || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
}
function recCard(r) {
  const src = thumbUrl(r);
  const thumb = src ? '<img class="thumb" src="' + esc(src) + '" alt="" loading="lazy">' : '<span class="thumb">' + PAW + "</span>";
  return '<li><button type="button" class="rec" data-id="' + esc(r.id) + '">' + thumb +
    '<span style="min-width:0"><span class="head2"><span class="nm">' + esc(r.catName) + '</span><span class="chip' + (r.method === "Waived" ? " waived" : "") + '">' + esc(feeText(r)) + '</span></span>' +
    '<span class="sub">Adopted by ' + esc(r.adopterName) + '</span><span class="sub">' + esc(fmtDate(r.adoptionDate)) + " &middot; " + esc(r.receiptNo) + "</span></span></button></li>";
}
function renderRecords() {
  const body = $("#recordsBody");
  $("#newBtn").disabled = !S.staff;
  if (!S.loaded) { body.innerHTML = '<p class="loading">Loading records...</p>'; return; }
  if (S.loadFailed) { body.innerHTML = '<p class="note">The records could not be loaded. <button type="button" class="btn btn-sm" id="retryBtn">Try again</button></p>'; $("#retryBtn").addEventListener("click", () => { S.loaded = false; renderRecords(); loadRecords(); }); return; }
  if (!S.records.length) {
    body.innerHTML = '<div class="empty"><canvas id="sample" width="200" height="283" aria-label="Sample receipt"></canvas><h3>No adoptions recorded yet</h3><p>Each adoption you save gets a numbered receipt like this sample, ready to save as a PDF or image.</p><button type="button" class="btn btn-ink" id="firstBtn">Record the first adoption</button></div>';
    $("#firstBtn").addEventListener("click", () => openForm(null));
    const t = todayStr();
    drawReceipt($("#sample"), { sample: true, receiptNo: "MMC-" + t.slice(0, 4) + "-0001", issuedOn: t, adoptionDate: t, catName: "Mochi", sex: "Female", age: "2 years", colour: "Orange tabby", sterilised: "Yes", vaccinated: "Yes", fee: 80, currency: "SGD", method: "PayNow", adopterName: "Sample Adopter", phone: "9123 4567", handledBy: "Volunteer", termsAgreed: true }, null, true);
    return;
  }
  const yr = t4(todayStr());
  const thisYear = S.records.filter(r => (r.adoptionDate || "").startsWith(yr)).length;
  const sums = {};
  for (const r of S.records) if (r.method !== "Waived" && r.fee > 0) sums[r.currency || "SGD"] = (sums[r.currency || "SGD"] || 0) + r.fee;
  const feeStr = Object.keys(sums).map(c => money(sums[c], c)).join("  /  ") || "None yet";
  const q = S.query.trim().toLowerCase();
  const rows = sortedRecords().filter(r => !q || [r.catName, r.adopterName, r.receiptNo, r.phone, r.email].join(" ").toLowerCase().includes(q));
  body.innerHTML =
    '<div class="stats">' +
    '<div class="stat"><b>' + S.records.length + '</b><span>Cats adopted</span></div>' +
    '<div class="stat"><b>' + thisYear + '</b><span>Adopted in ' + yr + '</span></div>' +
    '<div class="stat fees"><b>' + esc(feeStr) + '</b><span>Adoption fees received</span></div></div>' +
    '<div class="field search"><label class="vh" for="q">Search adoptions</label><input id="q" type="search" placeholder="Search cat, adopter or receipt" value="' + esc(S.query) + '"></div>' +
    (rows.length ? '<ul class="list">' + rows.map(recCard).join("") + "</ul>" : '<p class="loading">No adoptions match your search.</p>');
  const qi = $("#q");
  qi.addEventListener("input", () => { S.query = qi.value; const pos = qi.selectionStart; renderRecords(); const n = $("#q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} });
  body.querySelectorAll(".rec").forEach(b => b.addEventListener("click", () => showDetail(b.dataset.id)));
  body.querySelectorAll("img.thumb").forEach(i => i.addEventListener("error", () => { const s = document.createElement("span"); s.className = "thumb"; s.innerHTML = PAW; i.replaceWith(s); }));
}
const t4 = s => String(s).slice(0, 4);

/* ---------- receipt drawing (canvas) ---------- */
const DISP = '"Bricolage Grotesque","Avenir Next","Segoe UI",system-ui,sans-serif';
const BODY = 'Figtree,"Avenir Next","Segoe UI",system-ui,-apple-system,sans-serif';
async function ensureFonts() {
  const loads = ['500 40px "Bricolage Grotesque"', '800 40px "Bricolage Grotesque"', '400 24px Figtree', '500 24px Figtree', '600 24px Figtree', '700 24px Figtree'].map(f => document.fonts.load(f));
  try { await Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image")); i.src = src; }); }
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function paw(c, cx, cy, s, color) {
  c.fillStyle = color;
  c.beginPath(); c.ellipse(cx, cy + s * 0.18, s * 0.26, s * 0.21, 0, 0, Math.PI * 2); c.fill();
  [[-0.30, -0.12, 0.10, 0.13, -0.35], [-0.11, -0.30, 0.10, 0.14, -0.1], [0.11, -0.30, 0.10, 0.14, 0.1], [0.30, -0.12, 0.10, 0.13, 0.35]]
    .forEach(([dx, dy, rx, ry, rot]) => { c.beginPath(); c.ellipse(cx + dx * s, cy + dy * s, rx * s, ry * s, rot, 0, Math.PI * 2); c.fill(); });
}
function fit(c, text, mk, size, min, maxW) { let s = size; c.font = mk(s); while (s > min && c.measureText(text).width > maxW) { s -= 2; c.font = mk(s); } return s; }
function wrap(c, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (!line || c.measureText(t).width <= maxW) line = t; else { lines.push(line); line = w; } }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; let l = lines[maxLines - 1]; while (l.length && c.measureText(l + "...").width > maxW) l = l.slice(0, -1); lines[maxLines - 1] = l + "..."; }
  return lines;
}
let logoImg = null;
async function getLogo() { if (!logoImg) { try { logoImg = await loadImg("assets/logo.jpg"); } catch (e) { logoImg = null; } } return logoImg; }
async function drawReceipt(canvas, r, isStale, skipPhoto) {
  await ensureFonts();
  const logo = await getLogo();
  let photo = null, wantPhoto = false;
  if (!skipPhoto && r.photoPath) {
    wantPhoto = true;
    try { photo = await loadImg(await photoBlobUrl(r.photoPath)); } catch (e) { photo = null; }
  }
  if (isStale && isStale()) return false;
  const W = 1000, H = 1414, M = 64;
  const INK = "#252D40", MUTED = "#5B6066", LINE = "#DDE1EA", PEACH = "#F8D8AF", PEACH_DEEP = "#EBBB86", CREAM = "#FBF7EC", SOFT = "#C9CFDC";
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext("2d");
  c.textBaseline = "alphabetic";
  c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
  const spaced = (px, on) => { try { c.letterSpacing = on ? px + "px" : "0px"; } catch (e) {} };
  const label = (t, x, y, col) => { c.textAlign = "left"; c.fillStyle = col || MUTED; c.font = "700 18px " + BODY; spaced(2, true); c.fillText(t, x, y); spaced(0, false); };
  const dash = t => (t && String(t).trim()) ? String(t).trim() : "-";

  // header band: logo, club name, web address and UEN
  c.fillStyle = INK; c.fillRect(0, 0, W, 190);
  if (logo) { c.save(); c.beginPath(); c.arc(M + 63, 95, 63, 0, Math.PI * 2); c.clip(); c.drawImage(logo, M, 32, 126, 126); c.restore(); }
  else paw(c, M + 63, 95, 90, PEACH);
  const tx = M + 126 + 36;
  c.textAlign = "left"; c.fillStyle = CREAM; fit(c, "Meow Meow Club", s => "800 " + s + "px " + DISP, 54, 34, W - M - 250 - tx - 20); c.fillText("Meow Meow Club", tx, 92);
  c.fillStyle = PEACH; c.font = "600 16px " + BODY; spaced(2, true); c.fillText("LOVE · CARE · RESCUE · REHOME", tx, 126); spaced(0, false);
  c.fillStyle = SOFT; c.font = "500 20px " + BODY; c.fillText("meowmeowclub.org  ·  UEN " + CLUB_UEN, tx, 158);
  c.textAlign = "right";
  c.fillStyle = PEACH; c.font = "700 18px " + BODY; spaced(2, true); c.fillText("ADOPTION RECEIPT", W - M, 62); spaced(0, false);
  c.fillStyle = CREAM; c.font = "700 30px " + BODY; c.fillText(r.receiptNo || "", W - M, 106);
  c.fillStyle = SOFT; c.font = "500 20px " + BODY; c.fillText("Issued " + fmtDate(r.issuedOn), W - M, 140);

  // photo
  const PX = M, PY = 234, PS = 380;
  c.save(); rr(c, PX, PY, PS, PS, 28); c.clip();
  if (photo) {
    const iw = photo.naturalWidth, ih = photo.naturalHeight; let sw, sh, sx, sy;
    if (iw > ih) { sh = ih; sw = ih; sx = (iw - sw) / 2; sy = 0; } else { sw = iw; sh = iw; sx = 0; sy = (ih - sh) * 0.35; }
    c.drawImage(photo, sx, sy, sw, sh, PX, PY, PS, PS);
  } else { c.fillStyle = "#F5EDDB"; c.fillRect(PX, PY, PS, PS); paw(c, PX + PS / 2, PY + PS / 2 - 8, 170, "#DCCDAF"); }
  c.restore();
  rr(c, PX, PY, PS, PS, 28); c.lineWidth = 6; c.strokeStyle = PEACH_DEEP; c.stroke();

  // cat details
  const x0 = PX + PS + 48, cw = W - M - x0;
  label("ADOPTED CAT", x0, PY + 26);
  c.fillStyle = INK; fit(c, dash(r.catName), s => "800 " + s + "px " + DISP, 88, 38, cw); c.textAlign = "left"; c.fillText(dash(r.catName), x0, PY + 112);
  const det = [["SEX", r.sex], ["AGE", r.age], ["COLOUR / BREED", r.colour], ["STERILISED", r.sterilised], ["VACCINATED", r.vaccinated], ["MICROCHIP", r.microchip]];
  det.forEach(([k, v], i) => {
    const x = x0 + (i % 2) * 228, y = PY + 170 + Math.floor(i / 2) * 76;
    label(k, x, y);
    c.fillStyle = INK; c.textAlign = "left"; fit(c, dash(v), s => "500 " + s + "px " + BODY, 26, 15, 212); c.fillText(dash(v), x, y + 34);
  });
  c.fillStyle = LINE; c.fillRect(M, 654, W - 2 * M, 2);

  // adopter
  label("ADOPTER", M, 706);
  c.fillStyle = INK; c.textAlign = "left"; fit(c, dash(r.adopterName), s => "800 " + s + "px " + DISP, 46, 24, 500); c.fillText(dash(r.adopterName), M, 758);
  let y = 804; c.font = "500 25px " + BODY; c.fillStyle = INK;
  if (r.phone) { c.fillText(r.phone, M, y); y += 36; }
  if (r.email) { fit(c, r.email, s => "500 " + s + "px " + BODY, 25, 16, 500); c.fillText(r.email, M, y); y += 36; }
  if (r.address) { c.font = "400 23px " + BODY; c.fillStyle = MUTED; wrap(c, r.address.replace(/\s*\n\s*/g, ", "), 500, 2).forEach(l => { c.fillText(l, M, y); y += 32; }); }
  const rx = 620;
  label("ADOPTION DATE", rx, 706);
  c.fillStyle = INK; fit(c, fmtDate(r.adoptionDate), s => "600 " + s + "px " + BODY, 32, 20, W - M - rx); c.fillText(fmtDate(r.adoptionDate), rx, 752);
  label("HANDLED BY", rx, 812);
  c.fillStyle = INK; fit(c, dash(r.handledBy), s => "500 " + s + "px " + BODY, 28, 16, W - M - rx); c.fillText(dash(r.handledBy), rx, 850);

  // fee block
  const FY = 956, FH = 168;
  rr(c, M, FY, W - 2 * M, FH, 22); c.fillStyle = "#FDF0DC"; c.fill(); c.lineWidth = 2; c.strokeStyle = PEACH; c.stroke();
  label("ADOPTION FEE", M + 32, FY + 52);
  c.fillStyle = INK; c.font = "500 27px " + BODY; c.textAlign = "left";
  c.fillText(r.method === "Waived" ? "Fee waived" : "Paid by " + (r.method || "cash"), M + 32, FY + 104);
  c.textAlign = "right"; c.fillStyle = INK;
  const amt = feeText(r); fit(c, amt, s => "700 " + s + "px " + BODY, 58, 30, 470); c.fillText(amt, W - M - 32, FY + 106);

  // notes and terms
  c.textAlign = "left"; let ny = 1166;
  if (r.notes) {
    label("NOTES", M, ny); c.font = "400 23px " + BODY; c.fillStyle = INK; ny += 32;
    wrap(c, r.notes.replace(/\s*\n\s*/g, " "), W - 2 * M, 2).forEach(l => { c.fillText(l, M, ny); ny += 31; });
    ny += 8;
  }
  if (r.termsAgreed) {
    c.fillStyle = INK; c.beginPath(); c.arc(M + 14, ny + 4, 14, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#fff"; c.lineWidth = 3.5; c.lineCap = "round"; c.lineJoin = "round"; c.beginPath(); c.moveTo(M + 7, ny + 4); c.lineTo(M + 12, ny + 10); c.lineTo(M + 22, ny - 3); c.stroke();
    c.fillStyle = INK; c.font = "500 23px " + BODY; c.fillText("The adopter agreed to the adoption terms.", M + 40, ny + 12);
  }

  c.textAlign = "center"; c.fillStyle = INK; c.font = "800 30px " + DISP; c.fillText("Thank you for giving a cat a home.", W / 2, 1394);

  if (r.sample) {
    c.save(); c.translate(W / 2, H / 2); c.rotate(-0.5); c.globalAlpha = 0.12; c.fillStyle = INK; c.font = "800 220px " + DISP; c.textAlign = "center"; c.fillText("SAMPLE", 0, 70); c.restore();
  }
  return !wantPhoto || !!photo;
}

/* ---------- detail and receipt files ---------- */
const currentRec = () => S.records.find(r => r.id === S.currentId);
function showDetail(id) {
  const rec = S.records.find(r => r.id === id);
  if (!rec) { show("records"); renderRecords(); return; }
  S.currentId = id; show("detail"); paintDetail(rec);
}
function paintDetail(rec) {
  const token = ++drawToken;
  $("#dName").textContent = rec.catName;
  $("#dMeta").textContent = rec.receiptNo + " - adopted by " + rec.adopterName + " on " + fmtDate(rec.adoptionDate);
  let audit = "";
  if (rec.createdAt) audit = "Recorded" + (rec.createdByName ? " by " + rec.createdByName : "") + " on " + fmtStamp(rec.createdAt) + ".";
  if (rec.updatedByName) audit += " Last edited by " + rec.updatedByName + " on " + fmtStamp(rec.updatedAt) + ".";
  $("#dAudit").textContent = audit;
  $("#delBtn").hidden = !(S.staff && S.staff.role === "admin");
  $("#shareBtn").hidden = !canShareFiles();
  drawReceipt($("#receipt"), rec, () => token !== drawToken);
}
const safeName = (rec, ext) => (rec.receiptNo + " " + rec.catName).replace(/[\\\/:*?"<>|\r\n\t]+/g, "").trim().slice(0, 80) + "." + ext;
function blobOf(canvas, type, q) { return new Promise((res, rej) => { try { canvas.toBlob(b => b ? res(b) : rej(new Error("blob")), type, q); } catch (e) { rej(e); } }); }
async function exportBlob(rec, type, q) {
  const cv = $("#receipt");
  try { return await blobOf(cv, type, q); }
  catch (e) {
    await drawReceipt(cv, rec, null, true); toast("The photo could not be included in the saved copy.");
    return await blobOf(cv, type, q);
  }
}
function saveFile(name, blob) {
  const a = document.createElement("a"), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(["x"], { type: "application/pdf" })], "x.pdf", { type: "application/pdf" })] })); }
  catch (e) { return false; }
}
async function pdfBlob(rec) {
  if (!window.jspdf) throw new Error("pdf");
  const jpg = await exportBlob(rec, "image/jpeg", 0.92);
  const url = await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(jpg); });
  const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a5", orientation: "portrait" });
  pdf.setProperties({ title: "Adoption receipt " + rec.receiptNo, author: "Meow Meow Club" });
  pdf.addImage(url, "JPEG", 0, 0, 148, 148 * 1414 / 1000);
  return pdf.output("blob");
}
async function savePdf() {
  const rec = currentRec(); if (!rec) return;
  try { saveFile(safeName(rec, "pdf"), await pdfBlob(rec)); }
  catch (e) { toast(window.jspdf ? "The receipt could not be prepared. Try again." : "The PDF tool did not load. Use Save as image instead."); }
}
async function savePng() {
  const rec = currentRec(); if (!rec) return;
  try { saveFile(safeName(rec, "png"), await exportBlob(rec, "image/png")); }
  catch (e) { toast("The receipt could not be prepared. Try again."); }
}
async function shareReceipt() {
  const rec = currentRec(); if (!rec) return;
  try {
    const file = new File([await pdfBlob(rec)], safeName(rec, "pdf"), { type: "application/pdf" });
    await navigator.share({ files: [file], title: "Adoption receipt " + rec.receiptNo });
  } catch (e) { if (!e || e.name !== "AbortError") toast("The receipt could not be shared. Use Save as PDF instead."); }
}

/* ---------- CSV export (admin only) ---------- */
const CSV_COLS = [["Receipt no.", "receiptNo"], ["Adoption date", "adoptionDate"], ["Cat name", "catName"], ["Sex", "sex"], ["Age", "age"], ["Colour or breed", "colour"], ["Microchip", "microchip"], ["Sterilised", "sterilised"], ["Vaccinated", "vaccinated"], ["Currency", "currency"], ["Fee", "fee"], ["Payment method", "method"], ["Adopter name", "adopterName"], ["Phone", "phone"], ["Email", "email"], ["Address", "address"], ["Handled by", "handledBy"], ["Terms agreed", "termsAgreed"], ["Data consent given", "pdpaConsent"], ["Notes", "notes"], ["Issued on", "issuedOn"], ["Recorded by", "createdByName"], ["Recorded at", "createdAt"], ["Last edited by", "updatedByName"], ["Last edited at", "updatedAt"]];
function csvCell(v) {
  let s = v === true ? "Yes" : v === false ? "No" : String(v == null ? "" : v);
  if (/^[=@]/.test(s) || (/^[+\-]/.test(s) && !/^[+\-]?[\d\s()\-.]+$/.test(s))) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCsv() {
  if (!S.staff || S.staff.role !== "admin") return;
  const rows = [CSV_COLS.map(c => csvCell(c[0])).join(",")].concat(sortedRecords().map(r => CSV_COLS.map(c => csvCell(r[c[1]])).join(",")));
  saveFile("meow-meow-club-adoptions-" + todayStr() + ".csv", new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" }));
}

/* ---------- form ---------- */
const FIELDS = ["catName", "sex", "age", "colour", "microchip", "sterilised", "vaccinated", "adoptionDate", "currency", "method", "fee", "handledBy", "adopterName", "phone", "email", "address", "notes"];
function setPhotoBox(src) {
  const box = $("#photoBox");
  box.innerHTML = src ? '<img class="thumb" style="width:104px;height:104px" src="' + esc(src) + '" alt="Selected cat photo">' : PAW;
  $("#photoTxt").textContent = src ? "Change photo" : "Add a photo";
  const im = box.querySelector("img");
  if (im) im.addEventListener("error", () => { box.innerHTML = PAW; $("#photoTxt").textContent = "Add a photo"; });
}
function syncFee() {
  const waived = $("#method").value === "Waived";
  $("#fee").disabled = waived; if (waived) $("#fee").value = "";
}
function clearErrors() {
  document.querySelectorAll("#form .err").forEach(e => { e.hidden = true; e.textContent = ""; });
  document.querySelectorAll("#form [aria-invalid]").forEach(e => e.removeAttribute("aria-invalid"));
}
function fillForm(r) {
  r = r || {};
  for (const f of FIELDS) $("#" + f).value = r[f] != null ? (f === "fee" && r.method === "Waived" ? "" : r[f]) : "";
  $("#terms").checked = !!r.termsAgreed;
  $("#pdpa").checked = !!r.pdpaConsent;
  syncFee();
}
function lastUsed(k) { try { return localStorage.getItem("mmc." + k) || ""; } catch (e) { return ""; } }
function remember(k, v) { try { localStorage.setItem("mmc." + k, v); } catch (e) {} }
function openForm(rec) {
  if (!S.staff) return;
  if (S.photoDraft) { URL.revokeObjectURL(S.photoDraft.url); }
  S.editing = rec; S.photoDraft = null; clearErrors();
  $("#formTitle").textContent = rec ? "Edit " + rec.receiptNo : "New adoption";
  $("#saveBtn").textContent = rec ? "Save changes" : "Save and create receipt";
  $("#saveBtn").disabled = false;
  const pl = $("#privacyLink");
  if (cfg.privacyUrl) { pl.href = cfg.privacyUrl; pl.hidden = false; } else pl.hidden = true;
  if (rec) { fillForm(rec); setPhotoBox(thumbUrl(rec)); }
  else {
    fillForm({ adoptionDate: todayStr(), currency: lastUsed("currency") || "SGD", method: "Cash", handledBy: lastUsed("handledBy") || S.staff.name.replace(/ \(admin\)$/, "") });
    setPhotoBox("");
  }
  $("#photo").value = "";
  show("form");
}
function readForm() {
  const v = id => $("#" + id).value.trim();
  const method = v("method");
  const fee = method === "Waived" ? 0 : parseFloat(v("fee").replace(/,/g, ""));
  return { catName: v("catName"), sex: v("sex"), age: v("age"), colour: v("colour"), microchip: v("microchip"), sterilised: v("sterilised"), vaccinated: v("vaccinated"),
    adoptionDate: v("adoptionDate"), currency: v("currency"), method, fee: Number.isFinite(fee) ? Math.round(fee * 100) / 100 : NaN, handledBy: v("handledBy"),
    adopterName: v("adopterName"), phone: v("phone"), email: v("email"), address: v("address"), notes: v("notes"), termsAgreed: $("#terms").checked, pdpa: $("#pdpa").checked };
}
function validate(d) {
  const errs = {};
  if (!d.catName) errs.catName = "Enter the cat's name.";
  if (!d.adoptionDate) errs.adoptionDate = "Choose the date of adoption.";
  if (d.method !== "Waived" && !(d.fee >= 0 && d.fee < 1000000)) errs.fee = "Enter the fee, or choose Waived as the payment method.";
  if (!d.adopterName) errs.adopterName = "Enter the adopter's name.";
  if (!d.phone && !d.email) errs.phone = "Add a phone number or an email address.";
  if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) errs.email = "Check the email address.";
  const hadConsent = !!(S.editing && S.editing.pdpaConsent);
  if (!d.pdpa && (!S.editing || hadConsent)) errs.pdpa = S.editing ? "Consent was recorded for this adopter. Leave this ticked, or ask the admin." : "Tick this once the adopter has been told how their details are used.";
  clearErrors();
  const keys = Object.keys(errs);
  keys.forEach(k => { const e = $("#err-" + k); e.textContent = errs[k]; e.hidden = false; $("#" + k).setAttribute("aria-invalid", "true"); });
  if (keys.length) { const first = ["catName", "adoptionDate", "fee", "adopterName", "phone", "email", "pdpa"].find(k => errs[k]); $("#" + first).focus(); }
  return !keys.length;
}
function scaled(img, max) {
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(img.naturalWidth * r)); cv.height = Math.max(1, Math.round(img.naturalHeight * r));
  const x = cv.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}
async function onPhoto(ev) {
  const file = ev.target.files && ev.target.files[0];
  const err = $("#err-photo"); err.hidden = true;
  if (!file) return;
  const tmp = URL.createObjectURL(file);
  try {
    const img = await loadImg(tmp);
    const big = await blobOf(scaled(img, 1200), "image/jpeg", 0.85);
    if (S.photoDraft) URL.revokeObjectURL(S.photoDraft.url);
    S.photoDraft = { blob: big, url: URL.createObjectURL(big) };
    setPhotoBox(S.photoDraft.url);
  } catch (e) { err.textContent = "That photo could not be read. Choose a JPEG or PNG image."; err.hidden = false; }
  finally { URL.revokeObjectURL(tmp); }
}
async function saveRecord(ev) {
  ev.preventDefault();
  if (!S.staff) return;
  const d = readForm();
  if (!validate(d)) return;
  const editing = S.editing, draft = S.photoDraft;
  const btn = $("#saveBtn"); btn.disabled = true; btn.textContent = "Saving...";
  let newPath = null;
  try {
    let photoPath = editing ? editing.photoPath : null;
    if (draft) {
      newPath = t4(todayStr()) + "/" + uuid() + ".jpg";
      const up = await sb.storage.from(BUCKET).upload(newPath, draft.blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) { newPath = null; throw Object.assign(up.error, { photo: true }); }
      photoPath = newPath;
    }
    const row = toRow(d, photoPath);
    let res;
    if (editing) res = await sb.from("adoptions").update(row).eq("id", editing.id).select().single();
    else res = await sb.from("adoptions").insert(row).select().single();
    if (res.error) throw res.error;
    const rec = toRec(res.data);
    if (editing && draft && editing.photoPath && editing.photoPath !== photoPath) sb.storage.from(BUCKET).remove([editing.photoPath]).catch(() => {});
    if (d.handledBy) remember("handledBy", d.handledBy);
    remember("currency", d.currency);
    await signThumbs([rec]);
    S.records = S.records.filter(r => r.id !== rec.id).concat(rec);
    if (S.photoDraft) URL.revokeObjectURL(S.photoDraft.url);
    S.photoDraft = null; S.editing = null; newPath = null;
    toast("Saved. Receipt " + rec.receiptNo + " is ready.");
    showDetail(rec.id);
  } catch (e) {
    if (newPath) sb.storage.from(BUCKET).remove([newPath]).catch(() => {});
    if (expired(e)) { resetToLogin("Your sign-in has expired. Please sign in again. Your entry was not saved."); return; }
    toast(e && e.photo ? "The photo could not be uploaded, so nothing was saved. Try again." : friendlyError(e, "The adoption could not be saved. Check your connection and try again."));
  } finally { btn.disabled = false; btn.textContent = editing ? "Save changes" : "Save and create receipt"; }
}

/* ---------- delete (admin only; the database enforces this too) ---------- */
function confirmDelete(rec) {
  return new Promise(res => {
    $("#mTitle").textContent = "Delete " + rec.catName + "'s record?";
    $("#mBody").textContent = "This removes the adoption by " + rec.adopterName + " and its receipt (" + rec.receiptNo + "). You cannot undo it. Receipt numbers are not reused.";
    const m = $("#modal"); m.hidden = false; $("#mCancel").focus();
    const done = ok => { m.hidden = true; $("#mOk").onclick = $("#mCancel").onclick = null; document.removeEventListener("keydown", onKey); res(ok); };
    const onKey = e => { if (e.key === "Escape") done(false); };
    document.addEventListener("keydown", onKey);
    $("#mOk").onclick = () => done(true); $("#mCancel").onclick = () => done(false);
  });
}
async function deleteCurrent() {
  const rec = currentRec(); if (!rec || !S.staff || S.staff.role !== "admin") return;
  if (!(await confirmDelete(rec))) return;
  try {
    const { data, error } = await sb.from("adoptions").delete().eq("id", rec.id).select("id");
    if (error) throw error;
    if (!data || !data.length) { toast("The record was not deleted. Only the admin can delete records."); return; }
    if (rec.photoPath) sb.storage.from(BUCKET).remove([rec.photoPath]).catch(() => {});
    S.records = S.records.filter(r => r.id !== rec.id);
    S.currentId = null; show("records"); renderRecords(); toast("Record deleted.");
  } catch (e) { toast(friendlyError(e, "The record could not be deleted. Try again.")); }
}

/* ---------- wiring ---------- */
function bind() {
  $("#loginForm").addEventListener("submit", onLogin);
  $("#forgotBtn").addEventListener("click", onForgot);
  $("#recoverForm").addEventListener("submit", onRecover);
  $("#signOutBtn").addEventListener("click", signOut);
  $("#noaccessOut").addEventListener("click", signOut);
  $("#newBtn").addEventListener("click", () => openForm(null));
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#formBack").addEventListener("click", () => { show("records"); renderRecords(); });
  $("#cancelBtn").addEventListener("click", () => { if (S.editing) showDetail(S.editing.id); else { show("records"); renderRecords(); } });
  $("#detailBack").addEventListener("click", () => { show("records"); renderRecords(); });
  $("#form").addEventListener("submit", saveRecord);
  $("#photo").addEventListener("change", onPhoto);
  $("#method").addEventListener("change", syncFee);
  $("#form").addEventListener("input", ev => {
    const id = ev.target && ev.target.id; if (!id) return;
    const e = document.getElementById("err-" + id); if (e) { e.hidden = true; e.textContent = ""; }
    ev.target.removeAttribute("aria-invalid");
    if (id === "email" || id === "phone") { const p = $("#err-phone"); if (p && ($("#phone").value || $("#email").value)) { p.hidden = true; p.textContent = ""; $("#phone").removeAttribute("aria-invalid"); } }
  });
  $("#form").addEventListener("change", ev => { if (ev.target && ev.target.id === "pdpa") { $("#err-pdpa").hidden = true; ev.target.removeAttribute("aria-invalid"); } });
  $("#savePdf").addEventListener("click", savePdf);
  $("#savePng").addEventListener("click", savePng);
  $("#shareBtn").addEventListener("click", shareReceipt);
  $("#editBtn").addEventListener("click", () => { const r = currentRec(); if (r) openForm(r); });
  $("#delBtn").addEventListener("click", deleteCurrent);
  document.addEventListener("visibilitychange", refreshIfStale);
  window.addEventListener("focus", refreshIfStale);
}

function start() {
  bind();
  if (!sb) {
    show("login");
    setMsg("#loginErr", configured ? "The sign-in tool did not load. Check your internet and reload the page." : "This site is not connected to its database yet. Add the Supabase address and key to config.js (see the setup guide).");
    return;
  }
  if (linkError) { show("login"); setMsg("#loginErr", /expired|invalid/i.test(linkError) ? "That link has expired or was already used. Choose Forgot password to get a new one." : linkError); }
  sb.auth.onAuthStateChange((event, session) => { setTimeout(() => handleSession(session, event), 0); });
  // Fallback in case the first auth event is missed.
  sb.auth.getSession().then(({ data }) => {
    if (S.view === "loading") {
      if (S.recovering && data && data.session) { show("recover"); return; }
      if (data && data.session) enter(data.session); else show("login");
    }
  }).catch(() => { if (S.view === "loading") show("login"); });
}
start();
})();
