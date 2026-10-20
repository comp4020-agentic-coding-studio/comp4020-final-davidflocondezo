# Crit 10 reflection

**What was the breakthrough that moved the work forward?**

The breakthrough for this crit was that mainly building on the previous's crit functionality so it came about thinking about how the weather report functionality could be extended to work with user sessions and limit functionality based on sessions. The first functionaity i thought about was getting the user to be able to edit their own descriptions. However when I entered in the agent to review the week's crit specs it actually started to implement a delete button instead. This was an error on the ai agent's part but it gave me the idea to combine both ideas and to use the per-browser `visitor_id` cookie from crit 8. Once I saw that, the fix wasn't a new auth layer, it was one column (`visitor_id` on `reports`) and one SQL statement that checks it in the same query that deletes the row, so there's
no gap between checking and acting that a race could slip through. Building
out from there — owner-only edit, and a confirm/upvote capped at once per
visitor via a database primary key rather than an app-level `if` — gave the
crit three distinct enforcement stories instead of one bare example: "only
your own," "only your own" again on a second mutation, and "at most once,
regardless of whose."

**What did this work change about who I want to be as a software developer?**

This week was a little different and I think from the past weeks I have realised how reliable the agent is and this week was a huge reveal on how not to over rely on the agent. To explain why i came about this, I actually prompted the agent go straight to "read the brief" and it somehow started editing files too without ever showing me a plan, on the reasoning that the deadline justified moving fast. I had to stop it and say so explicitly. In hindsight the deadline was the reason to confirm the approach *faster*, not skip confirming it. A DB schema change and a new permissions model are exactly the kind of decisions I want to have seen before they're made, not after. That's now a standing rule in this repo's CLAUDE.md, not just something I
said once.

Second, inside the access-control design itself: I almost shipped a version
that returned each report's raw `visitor_id` to the browser so the client
could decide locally whether to show a delete button. It worked in a quick
test and looked done. Writing it up is what made me stop: I'd be sending an
httpOnly cookie's value back out over JSON, which means any client could
read it and replay it as its own `Cookie` header — exactly the thing
`httpOnly` exists to prevent, defeated by my own API. I replaced it with a
server-computed `ownedByMe` boolean instead. The lesson wasn't "remember to
check ownership" — I did check it, correctly, on delete. It's that *what you
expose*, not just what you enforce, is part of access control, and the place
I catch that kind of mistake is explaining the design on paper, not glancing
at a passing test. So I think moving forward I want to be a developer that doesn't overly rely on an Ai agent and someone who puts my ideas first as the starting ground before even asking AI to come up with ideas.
