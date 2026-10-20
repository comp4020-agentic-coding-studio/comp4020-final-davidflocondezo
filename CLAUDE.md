# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## Ask before implementing

Before writing code for anything that touches more than one file, changes the
DB schema, adds/changes an API route, or makes an architectural call (how
something is modeled, what gets exposed, what gets logged, which approach
among several reasonable ones) --- stop and present the plan first. Get
explicit go-ahead before implementing.

This holds even under deadline pressure and even in auto mode. Auto mode is
for small in-the-weeds judgment calls, not for skipping review on
multi-file or architectural work just because a crit/assignment is due soon.
A close deadline is a reason to confirm the plan faster, not a reason to skip
confirming it.
