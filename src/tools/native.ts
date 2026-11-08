import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  SALARY_BANDS,
  SERVICE_IDS,
  SERVICE_STATUSES,
  type SalaryBand,
  type ServiceState,
} from "../data/mock";
import type { CapabilityId } from "../permissions/registry";
import type { RequestContext } from "../types";

export const ServiceStatusInput = z.object({
  service: z.enum(SERVICE_IDS).describe("Identifier of the company service to check."),
});
export type ServiceStatusInput = z.infer<typeof ServiceStatusInput>;

export const SalaryBandInput = z.object({
  position: z
    .string()
    .trim()
    .min(2, "position must be at least 2 characters")
    .max(80, "position must be at most 80 characters")
    .describe('Job title, e.g. "Senior Developer".'),
});
export type SalaryBandInput = z.infer<typeof SalaryBandInput>;

export type ServiceStatusResult =
  | {
      readonly ok: true;
      readonly service: string;
      readonly status: ServiceState;
      readonly updatedAt: string;
      readonly note: string;
    }
  | {
      readonly ok: false;
      readonly error: "unknown_service";
      readonly knownServices: readonly string[];
    };

export type SalaryBandResult =
  | { readonly ok: true; readonly band: SalaryBand }
  | { readonly ok: false; readonly error: "not_found" };

/** Total over any string: the enum guards the model-facing input, this guards direct callers. */
export function lookupServiceStatus(service: string): ServiceStatusResult {
  const record = Object.hasOwn(SERVICE_STATUSES, service)
    ? SERVICE_STATUSES[service as keyof typeof SERVICE_STATUSES]
    : undefined;
  if (record === undefined) {
    return { ok: false, error: "unknown_service", knownServices: SERVICE_IDS };
  }
  return {
    ok: true,
    service,
    status: record.status,
    updatedAt: record.updatedAt,
    note: record.note,
  };
}

/** Case-insensitive, whitespace-trimmed exact match on the position title. */
export function lookupSalaryBand(position: string): SalaryBandResult {
  const wanted = position.trim().toLowerCase();
  const band = SALARY_BANDS.find((b) => b.position.toLowerCase() === wanted);
  return band === undefined ? { ok: false, error: "not_found" } : { ok: true, band };
}

/**
 * Returns the native tools keyed by capability id. Deliberately unfiltered and untraced:
 * permission filtering/guarding and trace events are applied by runAgent.
 */
export function buildNativeTools(
  _ctx: RequestContext,
): Record<Extract<CapabilityId, "get_service_status" | "get_salary_band">, Tool> {
  return {
    get_service_status: tool({
      description:
        "Check the current status of a company service (vpn, email, wiki, hr_portal). " +
        "Use it when someone reports a problem with, or asks about the availability of, one of these services. " +
        "Returns { ok: true, service, status: operational | degraded | outage, updatedAt (ISO 8601), note }, " +
        "or { ok: false, error: 'unknown_service', knownServices } for an unrecognised service.",
      inputSchema: ServiceStatusInput,
      execute: ({ service }): ServiceStatusResult => lookupServiceStatus(service),
    }),
    get_salary_band: tool({
      description:
        "Look up the salary band for a job position by its title, e.g. 'Senior Developer'. " +
        "Use it when asked what a position pays. " +
        "Returns { ok: true, band: { position, currency, min, max } } with gross yearly EUR figures, " +
        "or { ok: false, error: 'not_found' } when the position is not known.",
      inputSchema: SalaryBandInput,
      execute: ({ position }): SalaryBandResult => lookupSalaryBand(position),
    }),
  };
}
