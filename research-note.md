<!--
COMP8020 only. 600–800 words.

Takes a position on what good agentic software-development practice is, or
where the field is heading, argued from the scholarly and practitioner
literature. Build an evaluative argument, not a summary of sources — what
makes this scholarly is how you read them, not just that you cite them.

This argues something distinct from PROCESS.md and the crit reflections:
an argument that doesn't reach beyond this project belongs in one of those
other two documents instead.
-->

# The behaviour gap: Why developers remain the sensor in agentic software development

## Position

Most practitioner writing on agentic development like blogs and write-ups from teams building these tools, treat good practice as architectural questions. How many agents to run, how they share context, and what harness surrounds them. Although these are real questions, they leave the hardest problem untouched, behaviour.

Tests, type checkers, linters and reviewer agents can check whether agent-written code is written well. But, there is no reliable way to check whether that code does what a person needs or shows them what they need to see. Code can pass every check and still fail the person using it. Until the field can check this, good agentic practice means treating the developer as the system's behavioural sensor, and planning for that role rather than discovering it after a failure.

## An uneven harness

Bockeler (2026) gives the clearest explanation for this claim. She describes the harness as feedforward guides and feedback sensors that regulate three dimensions of a codebase. The dimensions being maintainability, architecture fitness and behaviour. Maintainability is the easiest to harness because linters, type checkers and structural tests already exist. Behaviour, on the other hand, she writes are "the elephant in the room", concluding that AI-generated test suites do not yet earn enough trust to reduce manual testing.

In addition, Yan (2026), revising his earlier warning against multi-agent systems (Yan 2025), reports that a clean-context reviewer agent catches about two bugs per pull request, more than half of them severe. But these are code-correctness bugs, logic errors, edge cases and security flaws. Yan also concedes that swarm demonstrations, such as an agent-built browser and C compiler, rely on a simple, verifiable success criterion that most real software lacks.

Lastly, Hadfield et al. (2025) found the same with Anthropic’s research system. Human testers caught what an LLM judge missed, and the authors conclude that “manual testing remains essential”.

## Evidence from building

Throughout the semester, my own builds showed this gap repeatedly. In my weather radar app, tapping the map to post a community report returned a 201 and wrote a database row, yet the pin never appeared and the agent reported the feature as working. The temperature heat map passed typechecking and the full spec suite while rendering at about 5% opacity. This meant the heat map was “there” but not visible at all. Every computational sensor passed, and the failure was found only by looking at the screen.

The same pattern appears outside the final project, and it matches the failures Bockeler says that no sensor reliably catches misunderstood instructions and misdiagnosis. In crit 4, a hardstyle instrument, I asked for a new detuned-sawtooth oscillator across all keys. The agent updated only 1 of my instruments (the melody voices), and left the other four groups unchanged, and nothing failed. I only found it by playing every key. In assignment 2, a satirical course website, `pnpm check` passed cleanly across typecheck, accessibility, link-checking and both spec files. Yet reading the created lectures showed me the agent had taken my "theology" framing literally, filling each week with metaphor rather than teachable content. The specs checked the brief but could not check whether a student would learn anything.

Across all different builds what failed was never whether the code ran, but whether a person could perceive and use the result. That consistency shows that the gap belongs to the practice, not to any one of the projects.

## The counter argument

The strongest argument against this is that behaviour can be automated too. An agent can drive a real browser. However, my build logs suggest otherwise. Playwright did find each of these bugs, but only after I reported that something looked wrong and said what to look for. Automation confirmed a hypothesis a human supplied, it did not supply the hypothesis. Bockeler makes the same point that correctness is outside any sensor’s reach if the developer never specified what they wanted.

## Explanation as a sensor

Acting as the behavioural sensor is not only clicking through screens. In Bockeler’s terms, writing up a design is an inferential sensor run by a person. To describe a change, a developer must state what it does and what it exposes, which is often when a flaw becomes visible. In crit 10, I wanted only a report's creator to see its delete button. Only while writing up the design did I notice my API was exposing an httpOnly cookie value to the browser, so I replaced it with a true-or-false ownership flag. No test could have caught this, because the code did exactly what it was told. The problem was in what it revealed, and explaining it was what pointed it out. Zechner (2025) builds his minimal agent on the same principle, that a developer can only check what they can see, warning that “we trust our agents too much”.

## What good practice therefore is

Good agentic practice has three parts. First, pushes computational sensors as far as they go. Second, treats the behavioural check as a scheduled step and drives the real interface before accepting that work is done. Third, converts each behavioural failure into a harness rule. The aim should be not to remove human input but rather to direct it where it matters most. As agents gain autonomy, every gain in throughput raises the volume of unchecked behaviour. My argument is drawn from single-developer prototypes, teams with dedicated testers may divide the role differently, but they do not remove it.

## References

- Bockeler, B. (2026) [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html). martinfowler.com, 2 April.
- Hadfield, J., Zhang, B., Lien, K., Scholz, F., Fox, J. and Ford, D. (2025) [How we built our multi-agent research system](https://www.anthropic.com/research/multi-agent-research-system). Anthropic, 13 June.
- Yan, W. (2025) [Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents). Cognition.
- Yan, W. (2026) [Multi-agents: what's actually working](https://cognition.com/blog/multi-agents-working). Cognition, 22 April.
- Zechner, M. (2025) [What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/). mariozechner.at, 30 November.
