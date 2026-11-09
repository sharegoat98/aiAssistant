# Scenario 03: Independent IT and HR questions in one request

Expected behaviour: Concurrent execution of both specialists and one combined response.

Model: anthropic / claude-haiku-5-5. Date: 2026-11-09. Attempts made: 1; shown: attempt 1.

## Run

- User: `ana` (header `X-User: ana`)

Prompt:

```text
Two things: my laptop will not turn on at all, and how many days of annual leave am I entitled to?
```

Delegations (offsets in ms from the first trace event):

| # | Agent | Start | End | Status | Task (as written by the orchestrator) |
|---|---|---|---|---|---|
| 1 | it | 2137 | 7461 | ok | An employee of Acme d.o.o. reports that their company laptop will not turn on at all. Please provide troubleshooting steps from the company knowledge base (wiki) for a laptop that does not power on, and say which knowledge base articles you used. Also state when the employee should contact IT support or escalate. |
| 2 | hr | 2137 | 6437 | ok | An employee of Acme d.o.o. asks how many days of annual leave they are entitled to. Please provide the annual leave entitlement according to company policy, including any factors that change the number (such as length of service, age, or part-time status), and say which policy or knowledge base articles you used. |

Specialist spans overlap: yes

Tools per agent:

| Agent | Tool | Calls | ok | failed |
|---|---|---|---|---|
| orchestrator | ask_it_specialist | 1 | 1 | 0 |
| orchestrator | ask_hr_specialist | 1 | 1 | 0 |
| it | kb_search | 3 | 3 | 0 |
| hr | kb_search | 2 | 2 | 0 |

Skills loaded: none
mcp_unavailable events: 0
Final statuses: hr=ok, it=ok, orchestrator=ok; response status: ok

Final reply:

```text
**Laptop that won't turn on:** I couldn't find troubleshooting steps for this in the knowledge base, so I can't give you power-on checks from company documentation. Please contact the IT service desk and report that the laptop does not power on. If the laptop needs replacing, the "Requesting new equipment" article says the request goes through the IT service desk with your manager's approval, and you return the broken device.

**Annual leave:** You are entitled to **22 working days of annual leave per calendar year**, plus public holidays (source: "Annual leave").
- Request leave in the HR portal at least 5 working days in advance. Your manager approves or declines it.
- Up to 5 unused days can be carried over until 30 June of the following year.
- Sick leave does not reduce your annual leave (source: "Sick leave").

The search results did not mention any factor, such as length of service, age, or part-time status, that changes this number. I could only see part of the "Annual leave" article, though, so if your situation is unusual, check the full article or ask HR to confirm.
```

## Expectations

- PASS: Both specialists were delegated to
- PASS: Both specialists started before either finished (spans overlap)
- PASS: One combined reply: the orchestrator finished with status ok and a non-empty reply
