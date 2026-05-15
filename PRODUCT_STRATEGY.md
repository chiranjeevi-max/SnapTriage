# SnapTriage: Product Strategy & Deep Research in the AI Era

## 1. Problem Statement Validation: Does SnapTriage Have a Usecase?

**The short answer: Yes, and the problem is actively getting worse.**

The core premise of SnapTriage is that **"Issue triage is slow, and GitHub/GitLab give you browsing UIs, not processing UIs."** This was true 5 years ago, but in the modern development era, it is a critical pain point.

### Why the Problem is Magnifying: The "AI Era" Context
We are not necessarily talking about building LLMs into SnapTriage, but rather acknowledging how AI tools (Cursor, GitHub Copilot, ChatGPT, Claude) have changed *how software is written*.

1. **The Velocity of Code has Exploded:** Developers are writing code faster than ever. Features that took weeks now take days. This means more PRs, more edge cases discovered by users, and consequently, **a massive spike in issue volume.**
2. **The "Juniorization" of Bug Reports:** AI empowers non-technical or junior users to build things, but when things break, they file issues. The quality of issue reports is often lower (missing context, unclear reproduction steps, or just pasting an AI hallucination). Maintainers and Eng Leads are drowning in noise.
3. **Context Switching is the Enemy:** Developers want to stay in their flow state (often an IDE like Cursor). Forcing them to click through 4 pages of a slow GitHub web interface to tag an issue as `wontfix` or assign it to the right team breaks that flow.

**The Real Problem Statement:**
> "The volume of issues, bug reports, and PRs has outpaced the efficiency of traditional web interfaces. Engineering leads and maintainers need a high-speed, keyboard-driven triage engine to rapidly separate signal from noise without breaking their flow state."

---

## 2. Competitor Analysis

Where does SnapTriage fit in the current market?

### 1. Linear
* **Strengths:** Blazing fast, keyboard-first, beautiful UI, incredible for internal team task management.
* **Weaknesses:** It is an island. While you can sync it with GitHub, it forces you to adopt Linear's entire project management philosophy. It is not designed to be an "inbox" for external, public-facing GitHub/GitLab issues across multiple disconnected repos.
* **SnapTriage Advantage:** SnapTriage sits *on top* of where the issues actually live (GitHub/GitLab) rather than trying to migrate users to a new project management tool.

### 2. GitHub/GitLab Native UIs
* **Strengths:** It's where the code lives. Zero setup.
* **Weaknesses:** Click-heavy, slow page loads, poor multi-repo visibility. No true "inbox zero" workflow.
* **SnapTriage Advantage:** Speed. Optimistic UI, bulk actions, and pure keyboard navigation (J/K to move, 1-4 to prioritize).

### 3. Superhuman (Email) / Texts.com (Messages)
* **Strengths:** Proven the "keyboard-driven inbox" model works and people will pay for it.
* **Weaknesses:** They don't do developer issues.
* **SnapTriage Advantage:** Bringing this exact, proven UX paradigm to GitHub/GitLab issues.

---

## 3. Long-Term Roadmap & Feature Recommendations

To make SnapTriage truly indispensable in a world where developers use tools like Cursor and Copilot, the app must evolve from a "fast reader" to an "intelligent router."

Here are the high-value features that solve real problems, without necessarily requiring complex native LLM integrations:

### Phase 1: The Ultimate "Signal vs. Noise" Engine (Next 3-6 Months)

1. **"Smart Mute" & Aggressive Filtering Rules**
   * *The Problem:* Open-source repos get flooded with low-effort issues (e.g., "how do I install this?" or issues lacking templates).
   * *The Feature:* Allow users to set up client-side rules: "If issue length < 50 characters AND no template used -> Auto-label `needs-info` and Snooze for 7 days."

2. **Cross-Repo Universal Search & Command Palette (Cmd+K)**
   * *The Problem:* "I know I saw an issue about the auth bug, but I don't remember which of the 5 microservice repos it was in."
   * *The Feature:* A blazingly fast, local-first search that spans across all connected GitHub/GitLab repositories instantly.

3. **Triage Templates / Quick Replies**
   * *The Problem:* Maintainers type the same responses repeatedly ("Please provide a minimal reproducible example").
   * *The Feature:* Keyboard shortcuts mapped to templated markdown responses. (e.g., press `R` to reply, type `/mre` to insert the boilerplate, `Cmd+Enter` to send).

### Phase 2: Collaborative Triage & Team Scale (6-12 Months)

1. **Shared Triage Queues ("Who is looking at what?")**
   * *The Problem:* In a team, two devs might read the same issue, wasting time, or both might reply.
   * *The Feature:* Real-time presence indicators ("Alice is viewing this issue") and a shared "Team Inbox" state. If Alice archives an issue, it disappears from Bob's inbox too.

2. **Integration with the Modern Dev Stack (Linear, Jira, Notion)**
   * *The Problem:* Triage is just step one. Step two is actually doing the work in a sprint board.
   * *The Feature:* A keyboard shortcut (`Shift+L`) that takes a GitHub issue, creates a Linear ticket, links them, assigns the Linear ticket to the user, and closes the GitHub issue in one atomic action.

### Phase 3: The "Context-Rich" App (Visionary / 12+ Months)

1. **Code-Context Pre-fetching**
   * *The Problem:* A user reports a bug in `auth.ts`. To triage it, the dev has to open their IDE, find the file, and look at it.
   * *The Feature:* SnapTriage detects file paths mentioned in issues and fetches the latest `master` version of that file from GitHub, displaying it in a side-pane so the dev can evaluate the bug report without leaving the triage app.

2. **Terminal / CLI Companion (`snaptriage-cli`)**
   * *The Problem:* Devs live in the terminal.
   * *The Feature:* A lightweight CLI. A developer finishes a feature in Cursor, types `st pop` in their terminal, and the highest priority triaged issue is printed to the console with its branch name ready to be checked out.

## Conclusion
SnapTriage has a very strong use case. As AI tools accelerate code creation, the bottleneck shifts from *writing code* to *managing the operational overhead of software*. A tool that strictly optimizes the speed of reading, routing, and dismissing operational noise (issues/PRs) is highly valuable. The focus should remain relentlessly on **speed, keyboard navigation, and bridging the gap between external noise and internal task management.**
