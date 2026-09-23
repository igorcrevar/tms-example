---
name: review-protocol
description: The contract for reviewing code in this repo — how a change is handed to a reviewer, how findings are classified as BLOCKER or MINOR, the exact output format, and the rule that stops the review loop. Load before requesting a review, before performing one, or before acting on review findings.
---

# Review protocol

Reviewers start with no context. Everything they know about a change, the author gives them.

**Review runs on commits only, and only when a human asks.** The author verifies the change
and hands back; a developer commits; `/review [commit]` starts the reviewers. No agent commits
or calls a reviewer on its own, and a reviewer given an uncommitted working tree declines.
Fixes from a round are handed back the same way and reviewed when `/review` is run again.

## Handing over a change

The reviewer receives, from `/review` and the commit message:

1. **The commit.** Its hash, plus the paths it touches from `git show --name-only <hash>`.
   Reviewers read the commit with read-only git; a change that is not committed cannot be
   reviewed.
2. **Intent.** Two or three sentences on what the change is for and why it is shaped this
   way. It travels in the commit message: the author hands it to the developer, who puts
   it in the commit, and the reviewer reads it there.
3. **Settled decisions.** Anything already decided that should not be relitigated, each with
   its reason. A reviewer will otherwise rediscover and re-argue them every round.

## Classifying a finding

Every finding is **BLOCKER** or **MINOR**. There is no third level and no unlabelled prose.

**BLOCKER** — the change is wrong or unsafe. A correctness defect, a security defect, or a
breach of a rule stated in `CLAUDE.md`. If you cannot say what breaks, or how it is
exploited, it is not a blocker.

**MINOR** — everything else. Naming, ordering, a structure you would have chosen
differently, a future improvement, a test worth adding that is not covering a defect.

Taste is a MINOR. "I would have written this differently" is a MINOR.

## Output format

```
BLOCKERS:
- path/to/file.ts:42 — what is wrong, and what to do instead.

MINORS:
- path/to/file.ts:17 — one sentence.
```

When there are no blockers, the first line of the reply is exactly:

```
PASSED: no blockers
```

followed by any MINORs. **"No blockers" is the bar, not perfection.** Withholding PASSED
because an improvement is still imaginable is the failure mode this protocol exists to
prevent — there is always another improvement.

Never rewrite the change in the reply. Say what is wrong and what to do.

## Acting on findings

- Fix every BLOCKER, re-verify, then hand back; the next `/review` is the next round.
- **Stop after three rounds.** If blockers remain, report them to the user with your own
  assessment rather than continuing. An unbounded loop rewrites working code for hours.
- MINORs never start another round. Apply the ones you agree with in the round you are
  already doing; list the rest for the user.
- You may reject a finding. Say why in one sentence and leave the code alone. A reviewer
  asking you to break a documented constraint is simply wrong — see the `tms-guardrails`
  skill.
