# Scenario 04: IT recommendation that depends on an HR policy result

Expected behaviour: Sequential execution: HR identifies an equipment profile, its result is passed explicitly into the IT task, and IT uses it for setup guidance.

Model: anthropic / claude-haiku-5-5. Date: 2026-11-09. Attempts made: 1; shown: attempt 1.

## Run

- User: `ana` (header `X-User: ana`)

Prompt:

```text
A new backend developer joins my team next Monday. Check the HR policy to find out which equipment profile applies to engineers, and then tell me how IT will set that equipment up.
```

Delegations (offsets in ms from the first trace event):

| # | Agent | Start | End | Status | Task (as written by the orchestrator) |
|---|---|---|---|---|---|
| 1 | hr | 1398 | 6430 | ok | Look up the company HR policy on equipment profiles for new hires. Find which equipment profile applies to software engineers (backend developers). Report the profile name, its contents (hardware, software, accounts/access), and cite the policy or knowledge base article names used. |
| 2 | it | 7865 | 16671 | ok | A new backend developer starts next Monday. Their equipment profile is "Developer Workstation" (per the HR equipment profile article "Equipment profiles: Developer Workstation for engineers"). Hardware for this profile: 16-inch laptop, 32 GB RAM, two external monitors, a headset, a docking station. Explain how IT will set up this equipment: preparation and delivery steps, the software to install, and the account setup (email, VPN, HR portal access, and local admin rights only via approved IT request). Cite the knowledge base articles used. |

Specialist spans overlap: no

Tools per agent:

| Agent | Tool | Calls | ok | failed |
|---|---|---|---|---|
| orchestrator | ask_hr_specialist | 1 | 1 | 0 |
| hr | kb_search | 3 | 3 | 0 |
| orchestrator | ask_it_specialist | 1 | 1 | 0 |
| it | kb_search | 5 | 5 | 0 |

Skills loaded: none
mcp_unavailable events: 0
Final statuses: hr=ok, it=ok, orchestrator=ok; response status: ok

Final reply:

```text
Here is what I could confirm, and what I could not.

**Equipment profile (HR policy)**
Backend developers get the **Developer Workstation** profile. It includes:
- 16-inch laptop
- 32 GB RAM
- two external monitors
- a headset
- a docking station

HR's search results did not list any software for this profile. Local administrator rights are granted only through an approved IT request. HR could only see short excerpts, not the full article, so the software list and access details may be incomplete. The source is "Equipment profiles: Developer Workstation for engineers."

**IT setup**
IT could not confirm how this profile will be set up. The knowledge base has no article on preparing or delivering the Developer Workstation, the software to install for developers, or the account setup for a new hire. IT did find these general points:
- Laptops, monitors and headsets are requested through the IT service desk with the manager's approval ("Requesting new equipment").
- Standard equipment is delivered within 5 working days, according to the same article.
- Unapproved software must not be installed on company laptops.
- All Acme accounts require multi-factor authentication. On first sign-in, the user enrolls the Acme Authenticator app by scanning a QR code ("Multi-factor authentication (MFA)").

**What to do next**
- Submit the equipment request through the IT service desk with the manager's approval. Based on the 5-working-day lead time, it needs to go in by the end of this week to be ready for Monday. I don't know whether it has already been submitted.
- Ask IT directly for the onboarding steps for the Developer Workstation, including the developer software list and the account setup for email and the HR portal.
- If the new hire needs local admin rights, the request has to go through the approved IT channel. I could not find the process for that.
```

## Expectations

- PASS: Both specialists were delegated to
- PASS: The IT delegation started after the HR delegation ended (sequential)
- PASS: The IT task text contains the equipment profile found by HR ("Developer Workstation")
- INFO: HR retrieved knowledge successfully: yes
- PASS: The orchestrator finished with status ok and a non-empty reply
