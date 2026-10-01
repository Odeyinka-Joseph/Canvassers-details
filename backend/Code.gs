/**
 * Canvasser Data Capture - shared backend (Google Apps Script + Google Sheets).
 * Bound to a Google Sheet. Tabs Users, Directory and Responses are created automatically.
 * Deploy: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
 */
const HEAD = { Users: ["username", "name", "role", "salt", "hash"], Directory: ["phone", "name", "lga"],
  Responses: ["phone", "name", "lga", "option", "vin", "bankName", "accountNumber", "accountName", "capturedBy", "submittedAt"] };
const TEXTCOLS = { Directory: ["A"], Responses: ["A", "G"] };
const ORDER = HEAD.Responses;

const norm = p => { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("234") && d.length === 13) d = "0" + d.slice(3); else if (d.length === 10) d = "0" + d; return d; };
const bad = m => { throw new Error(m); };
function mergeDir(people, rows, replace, subs) {
  const map = replace ? new Map() : new Map(people.map(x => [x.p, x])); let added = 0, updated = 0;
  rows.forEach(r => { const p = norm(r.p); if (p.length !== 11) return; const n = String(r.n || "").trim(), l = String(r.l || "").trim(), o = map.get(p);
    if (o) { updated++; map.set(p, { p, n: n || o.n, l: l || o.l }); } else { added++; map.set(p, { p, n, l }); } });
  let filled = 0;
  Object.values(subs).forEach(s => { const r = map.get(s.phone); if (r && (r.n !== s.name || r.l !== s.lga)) { s.name = r.n || s.name; s.lga = r.l || s.lga; filled++; } });
  return { list: [...map.values()], added, updated, filled };
}
function lookup(people, subs, q) {
  const d = String(q || "").replace(/\D/g, "");
  if (d.length === 11) { const r = people.find(x => x.p === d); return r ? [{ p: r.p, n: r.n, l: r.l, captured: !!subs[d] }] : []; }
  if (d.length < 5) return [];
  return people.filter(x => x.p.includes(d)).slice(0, 8).map(x => ({ p: x.p }));
}
function buildRec(people, subs, input, by) {
  const phone = norm(input.phone);
  if (phone.length !== 11) bad("Please enter a valid 11-digit phone number.");
  const dr = people.find(x => x.p === phone);
  if (people.length && !dr) bad("This number is not in the directory. Please check it and try again.");
  const opt = input.option;
  if (!["VIN", "Bank Details", "VIN & Bank Details"].includes(opt)) bad("Please choose what you are submitting.");
  const rec = { phone, name: dr ? dr.n : "", lga: dr ? dr.l : "", option: opt, vin: "", bankName: "", accountNumber: "", accountName: "", capturedBy: by, submittedAt: new Date().toISOString() };
  if (opt !== "Bank Details") { rec.vin = String(input.vin || "").replace(/\s+/g, "").toUpperCase(); if (!rec.vin) bad("Please enter the VIN."); }
  if (opt !== "VIN") {
    rec.bankName = String(input.bankName || "").trim(); rec.accountNumber = String(input.accountNumber || "").replace(/\D/g, ""); rec.accountName = String(input.accountName || "").trim();
    if (!rec.bankName) bad("Please enter the bank name.");
    if (rec.accountNumber.length !== 10) bad("Account number must be 10 digits.");
    if (!rec.accountName) bad("Please enter the account name.");
  }
  return rec;
}
function mergeSubs(subs, recs) {
  let n = 0;
  recs.forEach(r => { const p = norm(r.phone); if (p.length !== 11) return;
    const rec = { phone: p, name: String(r.name || ""), lga: String(r.lga || ""), option: String(r.option || ""), vin: String(r.vin || ""), bankName: String(r.bankName || ""), accountNumber: String(r.accountNumber || ""), accountName: String(r.accountName || ""), capturedBy: String(r.capturedBy || ""), submittedAt: String(r.submittedAt || "") };
    if (!subs[p] || rec.submittedAt > String(subs[p].submittedAt)) { subs[p] = rec; n++; } });
  return n;
}

function fail(m, c) { const e = new Error(m); e.code = c || 400; throw e; }
function S(n) {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); let s = ss.getSheetByName(n);
  if (!s) { s = ss.insertSheet(n); s.getRange(1, 1, 1, HEAD[n].length).setValues([HEAD[n]]); s.setFrozenRows(1); (TEXTCOLS[n] || []).forEach(c => s.getRange(c + ":" + c).setNumberFormat("@")); }
  return s;
}
function rowsOf(s) { const n = s.getLastRow() - 1; return n < 1 ? [] : s.getRange(2, 1, n, s.getLastColumn()).getValues(); }
function clearData(s) { const n = s.getLastRow() - 1; if (n > 0) s.deleteRows(2, n); }
function withLock(fn) { const l = LockService.getScriptLock(); l.waitLock(25000); try { return fn(); } finally { l.releaseLock(); } }
function secret() { const p = PropertiesService.getScriptProperties(); let s = p.getProperty("SECRET"); if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty("SECRET", s); } return s; }
function hashPw(p, salt) {
  const sb = Utilities.newBlob(salt).getBytes(); let h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + "|" + p);
  for (let i = 0; i < 1500; i++) h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h.concat(sb));
  return Utilities.base64Encode(h);
}
function sign(o) { const b = Utilities.base64EncodeWebSafe(JSON.stringify(o)); return b + "." + Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(b, secret())); }
function unsign(t) { try { const a = String(t).split("."); if (a.length !== 2) return null; if (a[1] !== Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(a[0], secret()))) return null;
  const o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(a[0])).getDataAsString()); return o.exp > Date.now() ? o : null; } catch (e) { return null; } }
function users() { return rowsOf(S("Users")).map((r, i) => ({ u: String(r[0]), name: String(r[1]), role: String(r[2]), salt: String(r[3]), h: String(r[4]), row: i + 2 })); }
function auth(b, adminOnly) { const o = unsign(b.token); if (!o) fail("Not signed in", 401); const u = users().find(x => x.u === o.u); if (!u) fail("Account no longer exists", 401); if (adminOnly && u.role !== "admin") fail("Admin only", 403); return u; }
function checkNew(us, u, p) { if (!/^[a-z0-9._-]{3,}$/.test(u)) bad("Username: at least 3 characters (a-z, 0-9, . _ -)."); if (String(p || "").length < 6) bad("Password must be at least 6 characters."); if (us.some(x => x.u === u)) bad("Username already exists."); }
function addUserRow(u, name, role, p) { const salt = Utilities.getUuid(); S("Users").appendRow([u, name || u, role === "admin" ? "admin" : "user", salt, hashPw(p, salt)]); }
function colIndex(s, col, phone) { const n = s.getLastRow() - 1; if (n < 1) return -1; const v = s.getRange(2, col, n, 1).getValues(); for (let i = 0; i < n; i++) if (norm(v[i][0]) === phone) return i; return -1; }
function dirRow(D, i) { const r = D.getRange(i + 2, 1, 1, 3).getValues()[0]; return { p: norm(r[0]), n: String(r[1]), l: String(r[2]) }; }
function subsObj(R) { const o = {}; rowsOf(R).forEach(r => { const x = {}; ORDER.forEach((k, i) => x[k] = k === "phone" ? norm(r[i]) : String(r[i] === undefined ? "" : r[i])); o[x.phone] = x; }); return o; }
function writeSubs(R, o) { clearData(R); const v = Object.values(o).map(x => ORDER.map(k => x[k])); if (v.length) R.getRange(2, 1, v.length, ORDER.length).setValues(v); }

function route(b) {
  const a = b.action;
  if (a === "status") return { ok: true, setup: !users().some(x => x.role === "admin") };
  if (a === "setup") return withLock(() => { const us = users(); if (us.some(x => x.role === "admin")) fail("Setup already completed", 403);
    const u = String(b.username || "").trim().toLowerCase(); checkNew(us, u, b.password); addUserRow(u, String(b.name || "").trim(), "admin", String(b.password)); return { ok: true }; });
  if (a === "login") {
    const u = String(b.username || "").trim().toLowerCase(), cache = CacheService.getScriptCache(), key = "f_" + u, n = +cache.get(key) || 0;
    if (n >= 5) fail("Too many attempts. Try again in a few minutes.", 429);
    const x = users().find(y => y.u === u);
    if (!x || x.h !== hashPw(String(b.password || ""), x.salt)) { cache.put(key, String(n + 1), 300); fail("Invalid username or password.", 401); }
    cache.remove(key); return { token: sign({ u: x.u, exp: Date.now() + 12 * 3600e3 }), user: { username: x.u, name: x.name, role: x.role } };
  }
  if (a === "lookup") {
    auth(b); const q = String(b.q || "").replace(/\D/g, ""), D = S("Directory"), n = D.getLastRow() - 1; if (n < 1 || q.length < 5) return { hits: [] };
    if (q.length === 11) { const i = colIndex(D, 1, q); if (i < 0) return { hits: [] }; const r = dirRow(D, i); return { hits: [{ p: r.p, n: r.n, l: r.l, captured: colIndex(S("Responses"), 1, q) >= 0 }] }; }
    const v = D.getRange(2, 1, n, 1).getValues(), hits = [];
    for (let i = 0; i < n && hits.length < 8; i++) { const p = norm(v[i][0]); if (p.includes(q)) hits.push({ p }); }
    return { hits };
  }
  if (a === "submit") { const u = auth(b); return withLock(() => {
    const D = S("Directory"), R = S("Responses"), input = b.input || {}, phone = norm(input.phone), dn = D.getLastRow() - 1; let people = [];
    if (dn > 0) { const i = phone.length === 11 ? colIndex(D, 1, phone) : -1; people = i >= 0 ? [dirRow(D, i)] : [{ p: "" }]; }
    const rec = buildRec(people, {}, input, u.u), row = ORDER.map(k => rec[k]), i = colIndex(R, 1, rec.phone);
    if (i >= 0) R.getRange(i + 2, 1, 1, ORDER.length).setValues([row]); else R.getRange(R.getLastRow() + 1, 1, 1, ORDER.length).setValues([row]);
    return { rec }; }); }
  if (a === "summary") { auth(b, true); return { subs: Math.max(0, S("Responses").getLastRow() - 1), dir: Math.max(0, S("Directory").getLastRow() - 1) }; }
  if (a === "subsAll") { auth(b, true); return { rows: Object.values(subsObj(S("Responses"))) }; }
  if (a === "saveDir") { auth(b, true); return withLock(() => {
    const D = S("Directory"), R = S("Responses"), people = rowsOf(D).map(r => ({ p: norm(r[0]), n: String(r[1]), l: String(r[2]) })), subs = subsObj(R);
    const r = mergeDir(people, Array.isArray(b.rows) ? b.rows : [], !!b.replace, subs);
    if (!r.added && !r.updated) bad("No valid phone numbers found. Check the Phone column.");
    clearData(D); if (r.list.length) D.getRange(2, 1, r.list.length, 3).setValues(r.list.map(x => [x.p, x.n, x.l]));
    if (r.filled) writeSubs(R, subs);
    return { added: r.added, updated: r.updated, filled: r.filled }; }); }
  if (a === "mergeSubs") { auth(b, true); return withLock(() => { const R = S("Responses"), subs = subsObj(R), n = mergeSubs(subs, Array.isArray(b.rows) ? b.rows : []); writeSubs(R, subs); return { merged: n }; }); }
  if (a === "wipe") { auth(b, true); return withLock(() => { clearData(S("Responses")); return { ok: true }; }); }
  if (a === "listUsers") { auth(b, true); return { users: users().map(x => ({ u: x.u, name: x.name, role: x.role })) }; }
  if (a === "addUser") { auth(b, true); return withLock(() => { const u = String(b.username || "").trim().toLowerCase(); checkNew(users(), u, b.password); addUserRow(u, String(b.name || "").trim(), b.role, String(b.password)); return { ok: true }; }); }
  if (a === "resetPw") { auth(b, true); return withLock(() => { const x = users().find(y => y.u === String(b.username || "").toLowerCase()); if (!x) fail("User not found.", 404);
    if (String(b.password || "").length < 6) bad("Password must be at least 6 characters."); const salt = Utilities.getUuid(); S("Users").getRange(x.row, 4, 1, 2).setValues([[salt, hashPw(String(b.password), salt)]]); return { ok: true }; }); }
  if (a === "delUser") { const me = auth(b, true); return withLock(() => { const us = users(), x = us.find(y => y.u === String(b.username || "").toLowerCase()); if (!x) fail("User not found.", 404);
    if (x.role === "admin" && us.filter(y => y.role === "admin").length < 2) bad("Cannot delete the last admin.");
    if (x.u === me.u) bad("You cannot delete your own account while signed in."); S("Users").deleteRow(x.row); return { ok: true }; }); }
  fail("Unknown action", 404);
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) { try { return out(route(JSON.parse(e.postData.contents))); } catch (err) { return out({ error: err.message, code: err.code || 400 }); } }
function doGet(e) { try { return out(route({ action: (e && e.parameter && e.parameter.action) || "status" })); } catch (err) { return out({ error: err.message, code: err.code || 400 }); } }
