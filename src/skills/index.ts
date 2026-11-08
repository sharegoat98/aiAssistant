/**
 * Explicit skill index. Workers have no filesystem at runtime, so every SKILL.md is bundled at
 * build time as Text (wrangler `rules`: **\/*.md). Add new skills here; the folder name must
 * equal the `name` in the file's frontmatter.
 */
import onboardingChecklist from "./hr/onboarding-checklist/SKILL.md";
import vpnTroubleshooting from "./it/vpn-troubleshooting/SKILL.md";

export interface SkillSource {
  readonly folder: string;
  readonly raw: string;
}

export const SKILL_SOURCES: readonly SkillSource[] = [
  { folder: "vpn-troubleshooting", raw: vpnTroubleshooting },
  { folder: "onboarding-checklist", raw: onboardingChecklist },
];
