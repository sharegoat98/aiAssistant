# Scenario 01: IT support question

Expected behaviour: IT delegation, skill loading, native tool use.

Model: anthropic / claude-haiku-5-5. Date: 2026-11-09. Attempts made: 1; shown: attempt 1.

## Run

- User: `ana` (header `X-User: ana`)

Prompt:

```text
My VPN keeps disconnecting every few minutes when I work from home. Can you help me fix it?
```

Delegations (offsets in ms from the first trace event):

| # | Agent | Start | End | Status | Task (as written by the orchestrator) |
|---|---|---|---|---|---|
| 1 | it | 1519 | 7971 | ok | An employee working from home reports that their company VPN keeps disconnecting every few minutes. Please find relevant troubleshooting steps from the knowledge base (wiki / IT how-to articles) for VPN disconnects or instability on home networks, and check whether there is any known service outage affecting VPN. Return the steps and the names of the knowledge base articles used. |

Specialist spans overlap: no

Tools per agent:

| Agent | Tool | Calls | ok | failed |
|---|---|---|---|---|
| orchestrator | ask_it_specialist | 1 | 1 | 0 |
| it | load_skill | 1 | 1 | 0 |
| it | get_service_status | 1 | 1 | 0 |
| it | kb_search | 1 | 1 | 0 |

Skills loaded: vpn-troubleshooting (by it, at 3123 ms)
mcp_unavailable events: 0
Final statuses: it=ok, orchestrator=ok; response status: ok

Final reply:

```text
The VPN service is currently reporting a degraded status. The IT status page notes elevated latency and occasional disconnects on the Belgrade gateway, last updated 2026-03-02 08:15 UTC, and engineers are investigating. Your drops may be caused by this, not only by your home connection.

**What you can try now (from the "VPN connection problems" knowledge base article):**

1. **Check your home connection.** Load a few websites or run a speed test. If you're on Wi-Fi, move closer to the router or switch to a cable.
2. **Restart the VPN client** and reconnect.
3. **Reinstall the client if it still fails.** Uninstall it, download the latest version from the company software portal, sign in again, and complete MFA.
4. **Check whether the drops continue.**

Because of the gateway issue, I'd recommend opening a ticket with the IT service desk soon rather than spending a long time on local fixes. To speed things up, include:

- The status note above (degraded, Belgrade gateway, updated 2026-03-02 08:15 UTC).
- Which steps you've already tried and what happened.
- The exact error message and the times the disconnects occur.
- The VPN client log, which the article requires.

It would also help to know whether you're on Wi-Fi or a cable, and how often the drops happen. If other colleagues are affected too, the article says to call the on-call network engineer.
```

## Expectations

- PASS: The IT specialist was delegated to
- PASS: The HR specialist was not delegated to
- PASS: The IT specialist loaded a skill (vpn-troubleshooting)
- PASS: The IT specialist called the native tool get_service_status
- PASS: The orchestrator finished with status ok and a non-empty reply
