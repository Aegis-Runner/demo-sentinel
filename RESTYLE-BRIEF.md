# Restyle brief — Sentinel Desk

> **New look, same behaviour.** This app is an automated-testing **target** for AegisRunner's
> crawler, which grounds real assertions against its DOM and URLs. You may freely replace the CSS,
> the HTML structure, the templating, and even the framework — but every **contract** in
> "Preserve exactly" below must survive unchanged, or the tests that run against this app break silently.

## What this app is (verbatim from `server.js`)
> SENTINEL DESK — authorisation, not arithmetic.
> 
> The third shape. Meridian tests whether a form saves; Northwind tests whether
> a total is right. Neither can express the failure that actually ends up in
> breach reports: the app showed someone a record they had no business seeing,
> or let them perform an action their role forbids.
> 
> What makes this hard to test, and therefore worth testing against:
> 
>   IDENTITY CHANGES THE ANSWER   the same URL returns different content per
>                                 role. A crawl logged in as one user cannot
>                                 discover, let alone verify, the others.
>   NESTED OWNERSHIP              tickets belong to teams; agents belong to one
>                                 team. Correctness is "did the boundary hold",
>                                 which no amount of form-filling reveals.
>   WORKFLOW GATES                a ticket may only be closed by a supervisor,
>                                 and only from `resolved`. The button's absence
>                                 is not the control — the server is.
> 
> Faults:
>   crossteam    an agent can open another team's ticket by URL (IDOR)
>   gatebypass   an agent can close a ticket their role must not close
>   staleassign  reassigning appears to work but the old assignee is kept

## Preserve EXACTLY (load-bearing for the crawler)

**Routes** — keep every path + method (paths and `:id` shape are part of the contract):
```
GET  /login
POST /login
GET  /logout
GET  /
GET  /teams
GET  /tickets
POST /tickets
GET  /tickets/:id
POST /tickets/:id/assign
POST /tickets/:id/resolve
POST /tickets/:id/close
POST /tickets/:id/delete
POST /api/reset
```

**Create → detail flow**
- Create form field `name=` attributes (keep these names): `title`, `priority`, `assignee`
- On a successful create the server **redirects to the new record's detail URL** (e.g. `/tickets/${t.id}`) — keep the redirect, not an inline success page.
- The **listing** must render each record's **visible identity** (its ref/name) as a **link to its detail page**.
- A detail URL for a record that does not exist must return **HTTP 404** (not a generic 200).

**Auth** — login form `POST /login` with fields `email` + `password`; session cookie **`desk_session_v1`**; demo creds `amy@sentinel.test / amy12345`. Everything except `/login`, `/healthz`, `/api/reset` requires the session.

**Reset + fault injection** — DO NOT remove or rename:
- `POST /api/reset` guarded by request header **`X-Reset-Token`** (default `desk-reset`) → restores seed data.
- `GET /healthz` → `ok`.
- `DEMO_BUGS` env toggles faults: `crossteam`, `gatebypass`, `staleassign`. Healthy when empty. Keep **every** `BUGS.has("…")` branch and its exact flag name.

## Free to change
The stylesheet / design system, HTML markup + class names, the templating engine, the framework
(Express → Next / Fastify / Astro / Remix / …), and any client-side interactivity — provided the server
still serves the routes above with the **same field names, redirect targets, visible record identities,
404s, auth, `/api/reset`, `/healthz`, and `DEMO_BUGS` toggles**.

## Ship
- Keep a `Dockerfile` that builds a container listening on `PORT` and serving `/healthz`.
- Push to this repo's own remote: `https://github.com/Aegis-Runner/demo-sentinel.git`.

---
_Auto-generated from `server.js`; if anything here disagrees with the code, the code wins — re-read it._
