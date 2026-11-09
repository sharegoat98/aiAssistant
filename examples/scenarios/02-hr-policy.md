# Scenario 02: HR policy question

Expected behaviour: HR delegation, MCP-backed retrieval.

Model: anthropic / claude-haiku-5-5. Date: 2026-11-09. Attempts made: 1; shown: attempt 1.

## Run

- User: `ana` (header `X-User: ana`)

Prompt:

```text
What is the company policy on working remotely, and how do I request it?
```

Delegations (offsets in ms from the first trace event):

| # | Agent | Start | End | Status | Task (as written by the orchestrator) |
|---|---|---|---|---|---|
| 1 | hr | 1304 | 7215 | ok | Find the company policy on remote work (working remotely / working from home) at Acme d.o.o. Summarize the policy rules (eligibility, limits on days per week, approval requirements) and explain the step-by-step process an employee follows to request remote work, including which channel or form to use. Cite the knowledge base articles or policy documents used by name. |
| 2 | hr | 8894 | 11894 | ok | Open the full text of the knowledge base article "Remote work policy" (article id hr-remote-work) at Acme d.o.o. Report the complete content, especially: who is eligible for remote work, the exact steps to request remote work, the form or HR portal section to use for the request, who approves it, and the process for full-time remote work approval by HR. Cite the article by name. |

Specialist spans overlap: no

Tools per agent:

| Agent | Tool | Calls | ok | failed |
|---|---|---|---|---|
| orchestrator | ask_hr_specialist | 2 | 2 | 0 |
| hr | kb_search | 5 | 5 | 0 |

Skills loaded: none
mcp_unavailable events: 0
Final statuses: hr=ok, orchestrator=ok; response status: ok

Final reply:

```text
Here is what the company's remote work policy says, based on the "Remote work policy" knowledge base article (hr-remote-work). I could only see a summary of that article, not its full text.

**The policy:**
- You may work remotely up to 2 days per week.
- The remote days are agreed with your manager.
- Remote work requires a company laptop, a connection to the company VPN, and a quiet workspace.
- Your remote days are recorded in the HR portal.
- Working fully remote requires written approval from HR.

**How to request it:** The summary says remote days are agreed with your manager and recorded in the HR portal. I could not confirm the exact steps, whether there is a specific request form, or who is eligible. Your best next step is to talk to your manager about the days you want. If you need the full policy, the eligibility rules, or the process for fully remote work, ask HR directly or check the full "Remote work policy" article in the knowledge base.
```

## Expectations

- PASS: The HR specialist was delegated to
- PASS: The HR specialist retrieved knowledge through the MCP tool kb_search (at least one successful result)
- PASS: No mcp_unavailable event
- INFO: IT specialist delegations: 0
- PASS: The orchestrator finished with status ok and a non-empty reply
