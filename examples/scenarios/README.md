# Scenario examples

Each scenario was run once per prompt (unless noted) against the real application with anthropic / claude-haiku-5-5 on 2026-11-09.
The reviewer-relevant evidence is the trace (delegation, skills, tools, permissions), not the wording of the replies.
Expectations are reported as they happened; none were adjusted to pass.

| # | Scenario | Outcome | Details |
|---|---|---|---|
| 01 | IT support question | PASS (5 PASS, 0 FAIL, 0 INFO) | [md](01-it-support.md), [json](01-it-support.json) |
| 02 | HR policy question | PASS (4 PASS, 0 FAIL, 1 INFO) | [md](02-hr-policy.md), [json](02-hr-policy.json) |
| 03 | Independent IT and HR questions in one request | PASS (3 PASS, 0 FAIL, 0 INFO) | [md](03-parallel-it-hr.md), [json](03-parallel-it-hr.json) |
| 04 | IT recommendation that depends on an HR policy result | PASS (4 PASS, 0 FAIL, 1 INFO) | [md](04-sequential-hr-then-it.md), [json](04-sequential-hr-then-it.json) |
| 05 | A capability the user's role lacks (salary band), compared across roles | PASS (2 PASS, 0 FAIL, 1 INFO) | [md](05-role-permissions.md), [json](05-role-permissions.json) |
| 06 | A specialist is delegated a task that needs a capability it lacks | Not implemented | [md](06-specialist-missing-capability.md) |
| 07 | Integration failure (MCP server in failure mode) | Not implemented | [md](07-mcp-failure.md) |

## 01 IT support question

- PASS: The IT specialist was delegated to
- PASS: The HR specialist was not delegated to
- PASS: The IT specialist loaded a skill (vpn-troubleshooting)
- PASS: The IT specialist called the native tool get_service_status
- PASS: The orchestrator finished with status ok and a non-empty reply

## 02 HR policy question

- PASS: The HR specialist was delegated to
- PASS: The HR specialist retrieved knowledge through the MCP tool kb_search (at least one successful result)
- PASS: No mcp_unavailable event
- INFO: IT specialist delegations: 0
- PASS: The orchestrator finished with status ok and a non-empty reply

## 03 Independent IT and HR questions in one request

- PASS: Both specialists were delegated to
- PASS: Both specialists started before either finished (spans overlap)
- PASS: One combined reply: the orchestrator finished with status ok and a non-empty reply

## 04 IT recommendation that depends on an HR policy result

- PASS: Both specialists were delegated to
- PASS: The IT delegation started after the HR delegation ended (sequential)
- PASS: The IT task text contains the equipment profile found by HR ("Developer Workstation")
- INFO: HR retrieved knowledge successfully: yes
- PASS: The orchestrator finished with status ok and a non-empty reply

## 05 A capability the user's role lacks (salary band), compared across roles

- PASS: ana: no get_salary_band call by any agent
- INFO: ana: HR delegations: 0; the reply must state that this is not possible (check the reply text)
- PASS: marko: a successful get_salary_band call by the HR specialist
