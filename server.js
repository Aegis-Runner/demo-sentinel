// SENTINEL DESK — authorisation, not arithmetic.
//
// The third shape. Meridian tests whether a form saves; Northwind tests whether
// a total is right. Neither can express the failure that actually ends up in
// breach reports: the app showed someone a record they had no business seeing,
// or let them perform an action their role forbids.
//
// What makes this hard to test, and therefore worth testing against:
//
//   IDENTITY CHANGES THE ANSWER   the same URL returns different content per
//                                 role. A crawl logged in as one user cannot
//                                 discover, let alone verify, the others.
//   NESTED OWNERSHIP              tickets belong to teams; agents belong to one
//                                 team. Correctness is "did the boundary hold",
//                                 which no amount of form-filling reveals.
//   WORKFLOW GATES                a ticket may only be closed by a supervisor,
//                                 and only from `resolved`. The button's absence
//                                 is not the control — the server is.
//
// Faults:
//   crossteam    an agent can open another team's ticket by URL (IDOR)
//   gatebypass   an agent can close a ticket their role must not close
//   staleassign  reassigning appears to work but the old assignee is kept
import express from "express";
import cookieParser from "cookie-parser";
import { DatabaseSync } from "node:sqlite";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

const BUGS = new Set(String(process.env.DEMO_BUGS || "").split(",").map((s) => s.trim()).filter(Boolean));
const RESET_TOKEN = process.env.DEMO_RESET_TOKEN || "desk-reset";
const SESSION = "desk_session_v1";

const USERS = {
  "amy@sentinel.test": { password: "amy12345", name: "Amy Agent", role: "agent", team: "T1" },
  "ben@sentinel.test": { password: "ben12345", name: "Ben Agent", role: "agent", team: "T2" },
  "sara@sentinel.test": { password: "sara12345", name: "Sara Super", role: "supervisor", team: "T1" },
  "admin@sentinel.test": { password: "admin12345", name: "Ada Admin", role: "admin", team: "*" },
};
const TEAMS = { T1: "Payments", T2: "Identity" };

const b64 = (s) => Buffer.from(String(s)).toString("base64url");
const unb64 = (s) => { try { return Buffer.from(String(s || ""), "base64url").toString(); } catch { return ""; } };
function currentUser(req) {
  const email = unb64(req.cookies?.[SESSION]);
  return USERS[email] ? { email, ...USERS[email] } : null;
}

// The counter must start ABOVE the seeded rows, not at their first id. Starting
// at 700 meant the first ticket anyone created was "701" — the id of a seeded
// ticket — and `tickets.find` returns the seeded one. A probe then created its
// own record, was handed back somebody else's, and got a perfectly correct 403
// for reading another team's ticket. Two rows with one id is not a scenario any
// test should have to reason about.
const FRESH = () => [
  { id: "701", team: "T1", title: "Card declined at checkout", priority: "high", status: "open", assignee: "amy@sentinel.test", notes: [] },
  { id: "702", team: "T1", title: "Refund not received", priority: "normal", status: "resolved", assignee: "amy@sentinel.test", notes: [] },
  { id: "703", team: "T2", title: "SSO loop on login", priority: "high", status: "open", assignee: "ben@sentinel.test", notes: [] },
  { id: "704", team: "T2", title: "MFA code never arrives", priority: "urgent", status: "open", assignee: "ben@sentinel.test", notes: [] },
];
// Derived from the seed, so adding a seeded row can never silently collide.
const firstFreeId = (rows) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 700);
let tickets = FRESH();
let seq = firstFreeId(tickets);
const id = () => String(++seq);

const DB_PATH = process.env.DESK_DB || "/data/desk.db";
let db = null;
try { db = new DatabaseSync(DB_PATH); db.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`); } catch { db = null; }
const persist = () => { if (db) try { db.prepare(`INSERT INTO kv(k,v) VALUES('t',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run(JSON.stringify({ seq, tickets })); } catch {} };
(() => { if (!db) return; try { const r = db.prepare(`SELECT v FROM kv WHERE k='t'`).get(); if (r?.v) { const s = JSON.parse(r.v); tickets = s.tickets; seq = Math.max(Number(s.seq) || 0, firstFreeId(tickets)); } } catch {} })();

// ── the authorisation rules, stated once ─────────────────────────────────────
// An agent sees only their own team. A supervisor sees their team. An admin
// sees everything. Every read goes through this; a bug here is a data breach,
// not a rendering glitch.
function visibleTo(u) {
  if (!u) return [];
  if (u.role === "admin") return tickets;
  return tickets.filter((t) => t.team === u.team);
}
function canView(u, t) {
  if (!u || !t) return false;
  if (u.role === "admin") return true;
  // CROSSTEAM: the list is still filtered correctly, so the UI looks right —
  // but a direct URL to another team's ticket is served anyway. This is the
  // shape of almost every real IDOR: the link is hidden, the door is not locked.
  if (BUGS.has("crossteam")) return true;
  return t.team === u.team;
}
function canClose(u, t) {
  if (!u || !t) return false;
  if (t.status !== "resolved") return false;
  if (u.role === "admin" || u.role === "supervisor") return u.role === "admin" || t.team === u.team;
  // GATEBYPASS: closing is a supervisor action. Granting it to agents changes
  // who is accountable for a ticket being shut, and nothing on the page says so.
  return BUGS.has("gatebypass");
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STYLE = `body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f7f8fa;color:#1b2430}
header{background:#2b2d42;color:#fff;padding:12px 20px;display:flex;gap:18px;align-items:center}
header a{color:#c9cbe0;text-decoration:none}header a.on{color:#fff;text-decoration:underline}
main{max-width:920px;margin:22px auto;padding:0 16px}
.card{background:#fff;border:1px solid #e0e3ea;border-radius:8px;padding:18px;margin-bottom:18px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eef0f4}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#606b7d}
label{display:block;margin:10px 0 4px;font-size:13px;color:#44506120}
input,select{padding:8px 10px;border:1px solid #ccd2dc;border-radius:6px;min-width:220px}
button,.btn{background:#2b2d42;color:#fff;border:0;border-radius:6px;padding:9px 16px;cursor:pointer;text-decoration:none;display:inline-block}
.pill{display:inline-block;padding:2px 10px;border-radius:12px;background:#eef0f4;font-size:12px}
.err{background:#fdecea;border:1px solid #f5b3ab;color:#8a1c10;padding:9px 12px;border-radius:6px;margin-bottom:12px}
.who{margin-left:auto;font-size:13px;color:#c9cbe0}`;
function layout(u, active, title, body) {
  const nav = [["/", "Dashboard"], ["/tickets", "Tickets"], ["/teams", "Teams"]];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} · Sentinel Desk</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body>
<header><strong>Sentinel Desk</strong>${nav.map(([h, l]) => `<a href="${h}" class="${active === h ? "on" : ""}">${l}</a>`).join("")}
<span class="who">${u ? esc(u.name) + " — " + esc(u.role) + (u.team !== "*" ? " (" + esc(TEAMS[u.team] || u.team) + ")" : "") : ""} · <a href="/logout">Sign out</a></span></header>
<main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

app.get("/healthz", (_q, r) => r.type("text").send("ok"));
app.use((req, res, next) => {
  if (["/login", "/healthz", "/api/reset"].includes(req.path)) return next();
  if (!currentUser(req)) return res.redirect("/login");
  next();
});
app.get("/login", (_q, res) => res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Sign in · Sentinel Desk</title><style>${STYLE}</style></head><body>
<main><div class="card" style="max-width:400px;margin:60px auto"><h1>Sign in</h1>
<form method="post" action="/login">
<label for="email">Email</label><input id="email" name="email" type="email" value="amy@sentinel.test">
<label for="password">Password</label><input id="password" name="password" type="password" value="amy12345">
<p><button type="submit">Sign in</button></p></form>
<p style="font-size:13px;color:#606b7d">Agents see one team. Supervisors close tickets. Admin sees everything.</p></div></main></body></html>`));
app.post("/login", (req, res) => {
  const u = USERS[String(req.body.email || "").toLowerCase()];
  if (!u || u.password !== req.body.password) return res.status(401).send(`<p class="err">Wrong email or password.</p><a href="/login">Back</a>`);
  res.cookie(SESSION, b64(String(req.body.email).toLowerCase()), { httpOnly: true });
  res.redirect("/");
});
app.get("/logout", (_q, res) => { res.clearCookie(SESSION); res.redirect("/login"); });

app.get("/", (req, res) => {
  const u = currentUser(req);
  const mine = visibleTo(u);
  res.send(layout(u, "/", "Dashboard", `<div class="card"><table>
<tr><th>Visible tickets</th><td>${mine.length}</td></tr>
<tr><th>Open</th><td>${mine.filter((t) => t.status === "open").length}</td></tr>
<tr><th>Resolved</th><td>${mine.filter((t) => t.status === "resolved").length}</td></tr>
<tr><th>Closed</th><td>${mine.filter((t) => t.status === "closed").length}</td></tr></table></div>`));
});
app.get("/teams", (req, res) => {
  const u = currentUser(req);
  res.send(layout(u, "/teams", "Teams", `<div class="card"><table><tr><th>Team</th><th>Tickets you can see</th></tr>
${Object.entries(TEAMS).map(([k, n]) => `<tr><td>${esc(n)}</td><td>${visibleTo(u).filter((t) => t.team === k).length}</td></tr>`).join("")}</table></div>`));
});
app.get("/tickets", (req, res) => {
  const u = currentUser(req);
  const list = visibleTo(u);
  res.send(layout(u, "/tickets", "Tickets", `<div class="card"><table>
<tr><th>Ref</th><th>Title</th><th>Team</th><th>Priority</th><th>Status</th><th>Assignee</th></tr>
${list.map((t) => `<tr><td><a href="/tickets/${t.id}">#${t.id}</a></td><td>${esc(t.title)}</td>
<td>${esc(TEAMS[t.team] || t.team)}</td><td><span class="pill">${esc(t.priority)}</span></td>
<td>${esc(t.status)}</td><td>${esc(USERS[t.assignee]?.name || t.assignee)}</td></tr>`).join("")
  || `<tr><td colspan="6">Nothing assigned to your team.</td></tr>`}</table></div>
<div class="card"><h3>Raise a ticket</h3><form method="post" action="/tickets">
<label for="title">Title</label><input id="title" name="title" placeholder="Short summary">
<label for="priority">Priority</label><select id="priority" name="priority"><option>normal</option><option>high</option><option>urgent</option></select>
<p><button type="submit">Create ticket</button></p></form></div>`));
});
app.post("/tickets", (req, res) => {
  const u = currentUser(req);
  const title = String(req.body.title || "").trim();
  if (!title) return res.status(400).send(layout(u, "/tickets", "Tickets", `<div class="err">Title is required.</div><p><a class="btn" href="/tickets">Back</a></p>`));
  const t = { id: id(), team: u.team === "*" ? "T1" : u.team, title, priority: String(req.body.priority || "normal"), status: "open", assignee: u.email, notes: [] };
  tickets.push(t); persist();
  res.redirect(`/tickets/${t.id}`);
});
app.get("/tickets/:id", (req, res) => {
  const u = currentUser(req);
  const t = tickets.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).send(layout(u, "/tickets", "Not found", `<div class="card">No such ticket.</div>`));
  if (!canView(u, t)) return res.status(403).send(layout(u, "/tickets", "Not permitted", `<div class="card"><p>This ticket belongs to another team.</p><p><a class="btn" href="/tickets">Back to your tickets</a></p></div>`));
  const others = Object.entries(USERS).filter(([, x]) => x.role !== "admin");
  res.send(layout(u, "/tickets", `Ticket #${t.id}`, `<div class="card"><table>
<tr><th>Title</th><td>${esc(t.title)}</td></tr>
<tr><th>Team</th><td>${esc(TEAMS[t.team] || t.team)}</td></tr>
<tr><th>Priority</th><td>${esc(t.priority)}</td></tr>
<tr><th>Status</th><td>${esc(t.status)}</td></tr>
<tr><th>Assignee</th><td>${esc(USERS[t.assignee]?.name || t.assignee)}</td></tr></table></div>
<div class="card"><h3>Reassign</h3><form method="post" action="/tickets/${t.id}/assign">
<label for="assignee">Assign to</label><select id="assignee" name="assignee">
${others.map(([e, x]) => `<option value="${esc(e)}" ${t.assignee === e ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
<p><button type="submit">Save assignee</button></p></form></div>
<div class="card"><h3>Workflow</h3>
<form method="post" action="/tickets/${t.id}/resolve" style="display:inline"><button type="submit">Mark resolved</button></form>
<form method="post" action="/tickets/${t.id}/close" style="display:inline;margin-left:8px"><button type="submit">Close ticket</button></form>
<p style="font-size:13px;color:#606b7d">Only a supervisor may close, and only once resolved.</p></div>`));
});
app.post("/tickets/:id/assign", (req, res) => {
  const u = currentUser(req);
  const t = tickets.find((x) => x.id === req.params.id);
  if (!t || !canView(u, t)) return res.status(403).send(layout(u, "/tickets", "Not permitted", `<div class="card">Not your ticket.</div>`));
  const next = String(req.body.assignee || "");
  if (!USERS[next]) return res.status(400).send(layout(u, "/tickets", "Ticket", `<div class="err">Unknown assignee.</div>`));
  // STALEASSIGN: the redirect and the flash both say it saved. The field does
  // not change. Only re-reading the record afterwards disagrees with the app.
  if (!BUGS.has("staleassign")) { t.assignee = next; persist(); }
  res.redirect(`/tickets/${t.id}`);
});
app.post("/tickets/:id/resolve", (req, res) => {
  const u = currentUser(req);
  const t = tickets.find((x) => x.id === req.params.id);
  if (!t || !canView(u, t)) return res.status(403).send(layout(u, "/tickets", "Not permitted", `<div class="card">Not your ticket.</div>`));
  if (t.status === "closed") return res.status(400).send(layout(u, "/tickets", "Ticket", `<div class="err">A closed ticket cannot be reopened here.</div><p><a class="btn" href="/tickets/${t.id}">Back</a></p>`));
  t.status = "resolved"; persist();
  res.redirect(`/tickets/${t.id}`);
});
app.post("/tickets/:id/close", (req, res) => {
  const u = currentUser(req);
  const t = tickets.find((x) => x.id === req.params.id);
  if (!t || !canView(u, t)) return res.status(403).send(layout(u, "/tickets", "Not permitted", `<div class="card">Not your ticket.</div>`));
  if (!canClose(u, t)) {
    const why = t.status !== "resolved" ? "A ticket must be resolved before it can be closed." : "Only a supervisor may close a ticket.";
    return res.status(403).send(layout(u, "/tickets", "Not permitted", `<div class="err">${esc(why)}</div><p><a class="btn" href="/tickets/${t.id}">Back</a></p>`));
  }
  t.status = "closed"; persist();
  res.redirect(`/tickets/${t.id}`);
});

// Deleting a ticket. Present because a probe that CREATES a disposable record
// must be able to remove it again — without this, "cleanup verified" could
// never be true for any mutation probe, and the safety rule would permanently
// refuse to test enforcement. Scoped like everything else: your team only.
app.post("/tickets/:id/delete", (req, res) => {
  const u = currentUser(req);
  const t = tickets.find((x) => x.id === req.params.id);
  if (!t || !canView(u, t)) return res.status(403).send(layout(u, "/tickets", "Not permitted", `<div class="card">Not your ticket.</div>`));
  tickets = tickets.filter((x) => x.id !== t.id);
  persist();
  res.redirect("/tickets");
});

app.post("/api/reset", (req, res) => {
  if (req.get("X-Reset-Token") !== RESET_TOKEN) return res.status(403).json({ error: "bad token" });
  tickets = FRESH(); seq = firstFreeId(tickets); persist();
  res.json({ ok: true, counts: { tickets: tickets.length } });
});
app.listen(Number(process.env.PORT || 3000), () => console.log(`sentinel-desk on ${process.env.PORT || 3000}; bugs=${[...BUGS].join(",") || "none"}`));
