# Scenario 05: A capability the user's role lacks (salary band), compared across roles

Expected behaviour: For the employee the capability is not exposed to any agent and the orchestrator explains it cannot be done; for the manager the same question is answered through the HR specialist.

Model: anthropic / claude-haiku-5-5. Date: 2026-11-09. Attempts made: 1; shown: attempt 1.

## Run

- User: `ana` (header `X-User: ana`)

Prompt:

```text
What is the salary band for a senior developer?
```

Delegations (offsets in ms from the first trace event):

None.

Tools per agent:

None.

Skills loaded: none
mcp_unavailable events: 0
Final statuses: orchestrator=ok; response status: ok

Final reply:

```text
I can't share salary band information for senior developer roles. Your role doesn't have access to salary bands, so this isn't something I can look up for you.
```

- User: `marko` (header `X-User: marko`)

Prompt:

```text
What is the salary band for a senior developer?
```

Delegations (offsets in ms from the first trace event):

| # | Agent | Start | End | Status | Task (as written by the orchestrator) |
|---|---|---|---|---|---|
| 1 | hr | 1202 | 4064 | ok | Look up the salary band for the position "senior developer" at Acme d.o.o. Report the band (minimum and maximum, currency, and any level or grade details) and cite the knowledge base article(s) used, if any. |

Specialist spans overlap: no

Tools per agent:

| Agent | Tool | Calls | ok | failed |
|---|---|---|---|---|
| orchestrator | ask_hr_specialist | 1 | 1 | 0 |
| hr | get_salary_band | 1 | 1 | 0 |
| hr | kb_search | 1 | 1 | 0 |

Skills loaded: none
mcp_unavailable events: 0
Final statuses: hr=ok, orchestrator=ok; response status: ok

Final reply:

```text
The salary band for a Senior Developer at Acme d.o.o. is **48,000 EUR to 68,000 EUR gross per year**.

The HR system does not give any level or grade breakdown for this role. I also could not find a knowledge base article describing the salary band structure, so this figure comes from the salary band lookup alone.
```

## Expectations

- PASS: ana: no get_salary_band call by any agent
- INFO: ana: HR delegations: 0; the reply must state that this is not possible (check the reply text)
- PASS: marko: a successful get_salary_band call by the HR specialist
