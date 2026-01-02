# I Built a Local Code Review System Because AI Agents Need Adult Supervision

*And no, I don't trust GitHub with my messy first drafts*

---

Look, I'm gonna be honest with you. I've been using AI coding agents for a while now—Claude Code, Cursor, Copilot, you name it. And here's the dirty secret nobody talks about at tech conferences: **these things need babysitting**.

Not in a "AI is gonna take over the world" way. More in a "my 5-year-old just tried to make breakfast and now there's egg on the ceiling" way.

## The Problem Nobody's Solving

According to [MIT Technology Review](https://www.technologyreview.com/2025/12/15/1128352/rise-of-ai-coding-developers-2026/), 65% of developers are now using AI coding tools weekly. That's wild. But here's the kicker from the same research: a notable randomized trial found that **experienced open source maintainers were actually slowed down by 19%** when allowed to use AI.

Wait, what?

Yeah. And an agentic system deployed in an issue tracker saw only 8% of its invocations resulting in a merged pull request. Eight. Percent.

So we've got tools that are supposed to make us faster, but sometimes... don't? The issue isn't the AI. The issue is the **review workflow**.

## The "Just Trust It" Problem

[NVIDIA's technical blog](https://developer.nvidia.com/blog/how-code-execution-drives-key-risks-in-agentic-ai-systems/) puts it bluntly: "AI-generated code is inherently untrusted. Systems that execute LLM-generated code must treat that code with the same caution as user-supplied inputs."

But here's what actually happens in practice:

1. You ask Claude to refactor something
2. It spits out 47 files of changes
3. You skim it
4. LGTM, ship it
5. Production goes down at 3am

Sound familiar? Don't lie.

The thing is, most of us don't have time to review AI code properly. There's no "staging area" for AI work. No place to have a back-and-forth conversation about changes before they hit your main branch.

## Why I'm Not Using GitHub PRs for This

Here's where it gets spicy.

You *could* just push AI-generated code to a branch and make a real GitHub PR. But think about that for a second:

- **Your collaborators see everything.** Every dumb iteration. Every "oops wrong approach." Every "make it work then make it right" commit.
- **Your AI conversations are public.** "Hey Claude, I have no idea what I'm doing here, can you help?" is not something I want in my git history.
- **Rate limits and integrations.** GitHub Copilot's workspace agent requires GitHub integration. Cursor wants to hook into everything. Sometimes I just want to work locally.

According to [research from arxiv](https://arxiv.org/html/2512.14012), experienced developers "retain their agency in software design and implementation out of insistence on fundamental software quality attributes." Translation: good developers want to stay in control, not outsource their judgment to a bot.

A local review system means:
- **Private iteration.** Make mistakes in private. Ship polished code.
- **No cloud dependencies.** Works offline. Works on air-gapped systems. Works when GitHub is having "another one of those days."
- **You control the workflow.** Not some product manager at Microsoft.

## Enter: claude-reviewer

So I built a thing. It's called [claude-reviewer](https://github.com/bowlesb/claude-reviewer) and it's basically GitHub PRs but local, for AI agents.

Here's how it works:

```bash
# Create a PR for Claude's changes
claude-reviewer create --base main --head feature/new-thing

# Opens web UI at localhost:3456/prs/abc123
```

![Web UI showing code diff with inline comments](screenshot-diff-view.png)

The web UI looks like GitHub's PR interface. You can:
- View diffs with syntax highlighting
- Leave inline comments on specific lines
- Have threaded conversations
- Approve or request changes

But here's the cool part. From Claude's side:

```bash
# Claude watches for your review
claude-reviewer watch abc123 --until changes_requested

# When you request changes, Claude sees the comments
claude-reviewer comments abc123
# Output:
#  (xyz789) Please rename this function
#  (abc123) Add error handling here

# Claude replies and fixes
claude-reviewer reply abc123 xyz789 "Done! Renamed to calculate_user_age"
claude-reviewer update abc123
```

**Real conversation from my testing:**

```
User: Make all the words in this line as all caps please
  ↳ claude: Done! Changed line 8 to all caps.
  ↳ user: Now, please change them back. Im indecisive.
  ↳ claude: No problem! Changed it back to normal case.
  ↳ user: Add more facts
  ↳ claude: Added 5 more programming facts to the file!
```

This is what actual collaboration with an AI looks like. Not "generate and pray." Actual back-and-forth.

## Multiple Agents, Multiple Features

Here's where it gets really interesting.

Nothing stops you from running multiple agents on multiple features simultaneously. Each gets its own PR:

```bash
# Terminal 1: Claude working on auth
claude-reviewer create --base main --head feature/auth
claude-reviewer watch auth-pr-id

# Terminal 2: Another Claude instance on the API
claude-reviewer create --base main --head feature/api
claude-reviewer watch api-pr-id

# Terminal 3: You, reviewing both
# localhost:3456 shows all PRs
```

You become the **engineering manager for a team of AI agents**. Each agent works independently, you review their PRs, leave comments, they fix issues and resubmit.

This is the future of software development, folks. And it's not "AI replaces developers." It's "developers become reviewers and architects while AI handles implementation."

As the [JetBrains blog](https://blog.jetbrains.com/idea/2025/05/coding-guidelines-for-your-ai-agents/) puts it: "If we want AI agents to generate code that's idiomatic, secure, maintainable, and aligned with our standards, we should communicate our intent very clearly."

A local PR review system is exactly that—a structured way to communicate intent and review output.

## The Security Angle

I'm not gonna fear-monger, but [Legit Security's research](https://www.legitsecurity.com/blog/the-risks-of-ai-generated-software-development-1) makes a solid point: "AI means more code—a lot more code—and that code is not at the quality level of human-generated code. At the same time, while the number of lines of code has been exploding, the level of human capacity for oversight and review has stayed the same."

AI agents can:
- Introduce security vulnerabilities they learned from training data
- Use outdated or vulnerable dependencies
- Create logic errors that look correct but aren't

Having a structured review process—even a local one—forces you to actually look at the code before it becomes your problem at 3am.

## The "Vibe Coding" Reality

[Qodo's comparison](https://www.qodo.ai/blog/claude-code-vs-cursor/) describes Cursor as the tool for "vibe coding"—rapidly prototyping without getting bogged down in syntax.

That's great for prototypes. But production code isn't vibes. Production code needs review.

The workflow I've settled on:
1. **Vibe with Claude** to get the initial implementation
2. **Create local PR** with claude-reviewer
3. **Review like I would review a junior dev's code**
4. **Iterate via comments** until it's production-ready
5. **Merge locally** and push polished code to GitHub

My collaborators see the final, reviewed code. They don't see the 17 iterations where Claude kept putting the database connection in the wrong place.

## Is This Overkill?

Maybe? For a quick script, probably yes.

But for anything going to production? Anything that multiple people work on? Anything that needs to be maintained for more than a week?

Having a review checkpoint between "AI generated this" and "this is now in my codebase" has saved my bacon multiple times.

## How to Try It

```bash
pip install claude-reviewer
claude-reviewer serve  # starts web UI on :3456
```

Then from any git repo:

```bash
claude-reviewer create --base main --head my-feature
# Review at localhost:3000
```

It's [open source on GitHub](https://github.com/bowlesb/claude-reviewer). MIT licensed. Do whatever you want with it.

---

## The Bottom Line

We're in this weird transitional period where AI can write code but we haven't figured out the workflow yet. We're treating AI agents like senior developers who can be trusted implicitly, when really they're more like eager interns—capable of great work, but requiring supervision.

A local review system isn't about not trusting AI. It's about having a structured process for collaboration. The same reason we use PRs for human code—even code from senior developers we trust—is the same reason we should use review systems for AI code.

The tools are only as good as the workflow around them. And right now, that workflow is... vibes.

Let's fix that.

---

*Ben Bowles builds tools for developers. He's been writing code for [X] years and using AI assistants since GPT-3. He still reviews his own PRs, which he acknowledges is weird.*

**Try it:** `pip install claude-reviewer`
**Star it:** [github.com/bowlesb/claude-reviewer](https://github.com/bowlesb/claude-reviewer)
