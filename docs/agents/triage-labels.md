# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in this repo's issue tracker.

This repo uses the **defaults unchanged** — no existing label vocabulary to reconcile with, so the
role name and the label string are identical.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label
string from this table.

## How to apply a label here

This repo has no external tracker, so a label is recorded as a `Status:` line near the top of the
file — or, for a spec, as `status:` in the frontmatter. Example:

```markdown
---
title: 慈善捐赠
status: ready-for-agent
---
```
