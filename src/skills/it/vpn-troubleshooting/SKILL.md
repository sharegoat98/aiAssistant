---
name: vpn-troubleshooting
description: Step-by-step procedure for diagnosing and fixing Acme d.o.o. VPN connection problems.
agents: [it]
---
# VPN troubleshooting

SKILL-BODY-MARKER-VPN: follow these steps in order and do not skip any.

1. Call `get_service_status` with service "vpn". Note the status (operational, degraded or outage) and its note.
2. Call `kb_search` with a query about VPN connection problems and read the matching article.
3. Give the user the practical steps from the article: check the internet connection, restart the VPN client, and if it still fails uninstall and reinstall the client, then reconnect.
4. If the status is degraded or outage, or the steps above did not help, tell the user that the problem needs escalation to the IT support team and list what to include in the ticket: the status and note from step 1, the steps already tried, and the exact error message.
5. Report back: the current VPN status, the steps you recommend, and whether escalation is needed.

If a tool fails or is unavailable, say so plainly, state which step could not be completed, and do not guess its result.
