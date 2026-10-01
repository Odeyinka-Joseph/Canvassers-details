#!/usr/bin/env node
/* Canvasser Data Capture backend. Node 16+, no dependencies.
   Run:  node server.js        (optional env: PORT=3000 HOST=0.0.0.0)
   Put index.html next to this file; open http://<this-computer>:3000/ on any device on the network. */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = +process.env.PORT || 3000, HOST = process.env.HOST || "0.0.0.0", FILE = path.join(__dirname, "data.json");
let db = { users: [], directory: [], subs: {}, secret: crypto.randomBytes(32).toString("hex") };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(FILE, "utf8"))); } catch (e) {}
const save = () => { fs.writeFileSync(FILE + ".tmp", JSON.stringify(db)); fs.renameSync(FILE + ".tmp", FILE); }; save();
class HttpErr extends Error { constructor(s, m) { super(m); this.s = s; } }

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

const hashPw = (p, s) => crypto.scryptSync(p, s, 32).toString("hex");
const newUser = (u, name, role, p) => { const salt = crypto.randomBytes(16).toString("hex"); return { u, name: name || u, role: role === "admin" ? "admin" : "user", salt, h: hashPw(p, salt) }; };
const sign = o => { const b = Buffer.from(JSON.stringify(o)).toString("base64url"); return b + "." + crypto.createHmac("sha256", db.secret).update(b).digest("base64url"); };
const unsign = t => { try { const [b, s] = String(t).split("."); const e = crypto.createHmac("sha256", db.secret).update(b).digest("base64url");
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  const o = JSON.parse(Buffer.from(b, "base64url").toString()); return o.exp > Date.now() ? o : null; } catch (e) { return null; } };
const validUser = u => /^[a-z0-9._-]{3,}$/.test(u);
const checkNew = (u, p) => { if (!validUser(u)) bad("Username: at least 3 characters (a-z, 0-9, . _ -)."); if (String(p || "").length < 6) bad("Password must be at least 6 characters."); if (db.users.some(x => x.u === u)) bad("Username already exists."); };
const fails = {};
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS" }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => { let n = 0; const c = [];
  req.on("data", d => { n += d.length; if (n > 25e6) { no(new Error("Body too large")); req.destroy(); } else c.push(d); });
  req.on("end", () => { try { ok(c.length ? JSON.parse(Buffer.concat(c)) : {}); } catch (e) { no(new Error("Invalid JSON")); } });
  req.on("error", no); });

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x"), p = url.pathname, m = req.method;
    if (m === "OPTIONS") return send(res, 204, {});
    if (!p.startsWith("/api/")) {
      const f = path.join(__dirname, "index.html");
      if (m === "GET" && (p === "/" || p === "/index.html") && fs.existsSync(f)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return fs.createReadStream(f).pipe(res); }
      res.writeHead(404); return res.end("Not found");
    }
    const auth = () => { const o = unsign((req.headers.authorization || "").replace(/^Bearer /, "")); if (!o) throw new HttpErr(401, "Not signed in"); const u = db.users.find(x => x.u === o.u); if (!u) throw new HttpErr(401, "Account no longer exists"); return u; };
    const admin = () => { const u = auth(); if (u.role !== "admin") throw new HttpErr(403, "Admin only"); return u; };
    const body = (m === "POST" || m === "DELETE") ? await readBody(req) : {};
    const hasAdmin = () => db.users.some(x => x.role === "admin");

    if (p === "/api/status" && m === "GET") return send(res, 200, { ok: true, setup: !hasAdmin() });
    if (p === "/api/setup" && m === "POST") {
      if (hasAdmin()) throw new HttpErr(403, "Setup already completed");
      const u = String(body.username || "").trim().toLowerCase(); checkNew(u, body.password);
      db.users.push(newUser(u, String(body.name || "").trim(), "admin", String(body.password))); save(); return send(res, 200, { ok: true });
    }
    if (p === "/api/login" && m === "POST") {
      const u = String(body.username || "").trim().toLowerCase(), key = req.socket.remoteAddress + "|" + u, f = fails[key];
      if (f && f.n >= 5 && Date.now() < f.until) throw new HttpErr(429, "Too many attempts. Try again in a few minutes.");
      const x = db.users.find(y => y.u === u);
      const ok = x && crypto.timingSafeEqual(Buffer.from(hashPw(String(body.password || ""), x.salt)), Buffer.from(x.h));
      if (!ok) { const e = fails[key] || { n: 0 }; e.n++; e.until = Date.now() + 5 * 60e3; fails[key] = e; throw new HttpErr(401, "Invalid username or password."); }
      delete fails[key];
      return send(res, 200, { token: sign({ u: x.u, exp: Date.now() + 12 * 3600e3 }), user: { username: x.u, name: x.name, role: x.role } });
    }
    if (p === "/api/lookup" && m === "GET") { auth(); return send(res, 200, { hits: lookup(db.directory, db.subs, url.searchParams.get("q")) }); }
    if (p === "/api/submit" && m === "POST") { const u = auth(); const rec = buildRec(db.directory, db.subs, body, u.u); db.subs[rec.phone] = rec; save(); return send(res, 200, { rec }); }

    if (p === "/api/admin/summary" && m === "GET") { admin(); return send(res, 200, { subs: Object.keys(db.subs).length, dir: db.directory.length }); }
    if (p === "/api/admin/submissions" && m === "GET") { admin(); return send(res, 200, { rows: Object.values(db.subs) }); }
    if (p === "/api/admin/directory" && m === "POST") {
      admin(); const r = mergeDir(db.directory, Array.isArray(body.rows) ? body.rows : [], !!body.replace, db.subs);
      if (!r.added && !r.updated) bad("No valid phone numbers found. Check the Phone column.");
      db.directory = r.list; save(); return send(res, 200, { added: r.added, updated: r.updated, filled: r.filled });
    }
    if (p === "/api/admin/merge" && m === "POST") { admin(); const n = mergeSubs(db.subs, Array.isArray(body.rows) ? body.rows : []); save(); return send(res, 200, { merged: n }); }
    if (p === "/api/admin/wipe" && m === "POST") { admin(); db.subs = {}; save(); return send(res, 200, { ok: true }); }
    if (p === "/api/admin/users" && m === "GET") { admin(); return send(res, 200, db.users.map(x => ({ u: x.u, name: x.name, role: x.role }))); }
    if (p === "/api/admin/users" && m === "POST") {
      admin(); const u = String(body.username || "").trim().toLowerCase(); checkNew(u, body.password);
      db.users.push(newUser(u, String(body.name || "").trim(), body.role, String(body.password))); save(); return send(res, 200, { ok: true });
    }
    const mm = p.match(/^\/api\/admin\/users\/([^/]+)(\/password)?$/);
    if (mm) {
      const me = admin(), u = decodeURIComponent(mm[1]).toLowerCase(), x = db.users.find(y => y.u === u); if (!x) throw new HttpErr(404, "User not found.");
      if (mm[2] && m === "POST") { if (String(body.password || "").length < 6) bad("Password must be at least 6 characters."); const n = newUser(u, x.name, x.role, String(body.password)); x.salt = n.salt; x.h = n.h; save(); return send(res, 200, { ok: true }); }
      if (!mm[2] && m === "DELETE") {
        if (x.role === "admin" && db.users.filter(y => y.role === "admin").length < 2) bad("Cannot delete the last admin.");
        if (x.u === me.u) bad("You cannot delete your own account while signed in.");
        db.users = db.users.filter(y => y !== x); save(); return send(res, 200, { ok: true });
      }
    }
    throw new HttpErr(404, "Not found");
  } catch (e) { send(res, e.s || 400, { error: e.message }); }
}).listen(PORT, HOST, () => {
  console.log("Canvasser Data Capture server running on port " + PORT);
  console.log("Open  http://localhost:" + PORT + "/  (or http://<this-computer-IP>:" + PORT + "/ from other devices)");
  console.log("Data file: " + FILE);
});
