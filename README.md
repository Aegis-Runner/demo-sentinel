# Sentinel Desk

A fictional demo application used as an AegisRunner testing target (no third-party IP).

## What it exercises

```
SENTINEL DESK — authorisation, not arithmetic.

The third shape. Meridian tests whether a form saves; Northwind tests whether
a total is right. Neither can express the failure that actually ends up in
breach reports: the app showed someone a record they had no business seeing,
or let them perform an action their role forbids.

What makes this hard to test, and therefore worth testing against:

  IDENTITY CHANGES THE ANSWER   the same URL returns different content per
                                role. A crawl logged in as one user cannot
                                discover, let alone verify, the others.
  NESTED OWNERSHIP              tickets belong to teams; agents belong to one
                                team. Correctness is "did the boundary hold",
                                which no amount of form-filling reveals.
  WORKFLOW GATES                a ticket may only be closed by a supervisor,
                                and only from `resolved`. The button's absence
                                is not the control — the server is.

Faults:
  crossteam    an agent can open another team's ticket by URL (IDOR)
  gatebypass   an agent can close a ticket their role must not close
  staleassign  reassigning appears to work but the old assignee is kept
```

## Run

```sh
docker build -t demo-sentinel .
docker run -p 3000:3000 -e DEMO_RESET_TOKEN=changeme demo-sentinel
```

Fault injection is env-gated via `DEMO_BUGS` (comma-separated); healthy when empty. Reset via `POST /api/reset` with header `X-Reset-Token`.
