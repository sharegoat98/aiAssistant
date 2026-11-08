/** Fictional Acme d.o.o. knowledge base. Must never contain salary data (restricted by role). */

export type KbDomain = "it" | "hr";

export interface KbArticle {
  readonly id: string;
  readonly domain: KbDomain;
  readonly title: string;
  readonly body: string;
}

export const KB_ARTICLES: readonly KbArticle[] = [
  {
    id: "hr-annual-leave",
    domain: "hr",
    title: "Annual leave",
    body:
      "Every Acme d.o.o. employee is entitled to 22 working days of annual leave per calendar year, " +
      "plus public holidays. Request leave in the HR portal at least 5 working days in advance; your " +
      "manager approves or declines it. Up to 5 unused days can be carried over until 30 June of the " +
      "following year.",
  },
  {
    id: "hr-onboarding",
    domain: "hr",
    title: "Onboarding checklist for new employees",
    body:
      "Before the first day HR prepares four things: the employment contract (signed on day one), " +
      "your user account (email, VPN and HR portal access), your equipment (laptop and headset, see " +
      "the new equipment article), and a mentor from your team who guides you through the first " +
      "three months.",
  },
  {
    id: "hr-parental-leave",
    domain: "hr",
    title: "Parental leave",
    body:
      "Employees who become parents can take parental leave under the applicable law. Notify HR at " +
      "least 30 days before the planned start and submit the supporting documents through the HR " +
      "portal. Your manager and HR agree on a handover plan, and you keep access to company news " +
      "while you are away.",
  },
  {
    id: "hr-remote-work",
    domain: "hr",
    title: "Remote work policy",
    body:
      "Employees may work remotely up to 2 days per week, agreed with their manager. Remote work " +
      "requires a company laptop, a connection to the company VPN and a quiet workspace. Remote days " +
      "are recorded in the HR portal. Full-time remote work needs written approval from HR.",
  },
  {
    id: "hr-sick-leave",
    domain: "hr",
    title: "Sick leave",
    body:
      "If you are ill, inform your manager before the start of your working day. For an absence " +
      "longer than 3 days, submit a medical certificate through the HR portal. Sick leave does not " +
      "reduce your annual leave. HR keeps your medical information confidential.",
  },
  {
    id: "it-mfa",
    domain: "it",
    title: "Multi-factor authentication (MFA)",
    body:
      "All Acme accounts require MFA. Enroll the Acme Authenticator app by scanning the QR code on " +
      "first sign-in. If you lose your phone, ask the IT service desk to reset your MFA enrollment; " +
      "you will be asked to verify your identity with your manager before the reset.",
  },
  {
    id: "it-new-equipment",
    domain: "it",
    title: "Requesting new equipment",
    body:
      "New laptops, monitors and headsets are requested through the IT service desk with your " +
      "manager's approval. Standard equipment is delivered within 5 working days. Broken equipment " +
      "is replaced after you return the old device. Do not install unapproved software on company " +
      "laptops.",
  },
  {
    id: "it-password-reset",
    domain: "it",
    title: "Password reset",
    body:
      "To reset your password, open the Acme sign-in page and choose 'Forgot password'. Confirm " +
      "your identity with the MFA app and set a new password of at least 14 characters. Passwords " +
      "expire every 180 days. If the self-service reset fails, contact the IT service desk.",
  },
  {
    id: "it-printer",
    domain: "it",
    title: "Printer setup and problems",
    body:
      "Office printers are available as 'Acme-Print' in the print dialog after you sign in. If a " +
      "job is stuck, cancel it and print again. If the printer shows an error or is offline, note " +
      "the label on the device and report it to the IT service desk.",
  },
  {
    id: "it-vpn",
    domain: "it",
    title: "VPN connection problems",
    body:
      "If the VPN does not connect, first check your internet connection and restart the VPN " +
      "client. If that fails, the VPN client must be reinstalled: uninstall it, download the latest " +
      "version from the company software portal and sign in again with MFA. If it still fails, " +
      "escalate: open a ticket with the IT service desk and attach the client log; for an outage " +
      "affecting many people, call the on-call network engineer.",
  },
];
