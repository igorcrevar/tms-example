---
name: review
description: Run code-review and security-review on one commit, on demand. Usage: /review [commit] — defaults to HEAD. Reviews are never triggered automatically; this command is the only way they start.
---

# /review [commit]

Reviews one commit with both reviewer agents, in parallel, and relays their findings.

1. Resolve the target: `git rev-parse <arg or HEAD>`. If it does not resolve, or the argument
   is not a commit, stop and say so — never review the working tree.
2. Read the commit message (`git log -1 --format=%B <hash>`); it carries the intent and
   settled decisions the reviewers need. Get the touched paths from
   `git show --name-only --format= <hash>`.
3. Spawn `code-review` and `security-review` at the same time, each with: the full hash, the
   message, the path list, and the note that a root commit has no parent (use
   `git show --stat <hash>` instead of `git diff <hash>^ <hash>`).
4. When both report, relay per `review-protocol`: BLOCKERs first with file:line, then the
   MINORs worth acting on, then `PASSED: no blockers` lines verbatim. Do not fix anything —
   the user decides what happens next.
