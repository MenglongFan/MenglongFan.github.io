# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: single-context

This is a single-context repo. There is no `CONTEXT-MAP.md` and no per-package `CONTEXT.md`.

```
/
├── CONTEXT.md          ← the glossary: one entry per domain term
├── docs/
│   ├── adr/            ← numbered architectural decision records
│   ├── agents/         ← this file and its siblings
│   └── spec-*.md       ← feature specs
├── worker/             ← Cloudflare Worker + D1 (backend)
└── react-app/          ← React SPA (frontend); built output is committed to scoring/
```

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary. Every domain term the project uses is defined
  there (奖池 / 奖池贡献 / 奖池流水 / 慈善捐赠 / 捐赠称谓 / 赛季 / 末位罚金 …).
- **`docs/adr/`** — read the ADRs that touch the area you're about to work in. They are numbered and
  the ones most often relevant are:

  | ADR | Topic |
  | --- | --- |
  | 0001 | Cloudflare D1 + Workers as the backend |
  | 0002 | Scoring formula |
  | 0003 | Season end is immutable |
  | 0004 | Prize-pool tie split |
  | 0005 | Display rank convention (`match_results.rank` is entry order, not placement) |
  | 0006 | Season status (active / paused / ended) |
  | 0007 | Bottom-three fine boundary tie |
  | 0008 | Mobile drag via Pointer Events |
  | 0009 | Page-transition GSAP choreography |
  | 0010 | Charity donation shares the prize pool |

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest
creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and
`/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a
test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly
avoids.

Two places where drift is easy and costly here:

- **奖池贡献** means *fines only*. It deliberately excludes 慈善捐赠 — the glossary says so, and
  ADR 0010 explains why. Don't use it as a synonym for "money this person put in".
- **名次 / 排名** has two distinct meanings: `match_results.rank` is the *entry order* recorded by
  the drag-and-drop UI, while the API's derived rank is the *displayed placement*. ADR 0005 covers
  this. Say which one you mean.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language
the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0010 (charity donation shares the prize pool), but worth reopening because…_

## Watch for documented trade-offs that look like bugs

Several ADRs end with a 代价 / 后果 section listing behaviour that a fresh reader will read as a
defect. Those are deliberate. Check the ADR before "fixing" them — e.g. charity money being
withdrawable as prize money (ADR 0010), or `.rank-2` never appearing when ranks skip (ADR 0005/0006).
