/** Simulated company data for the fictional "Acme d.o.o.". Fixed values keep tests deterministic. */

export const SERVICE_IDS = ["vpn", "email", "wiki", "hr_portal"] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export type ServiceState = "operational" | "degraded" | "outage";

export interface ServiceRecord {
  readonly status: ServiceState;
  /** ISO 8601, fixed (no Date.now()). */
  readonly updatedAt: string;
  readonly note: string;
}

export const SERVICE_STATUSES: Readonly<Record<ServiceId, ServiceRecord>> = {
  vpn: {
    status: "degraded",
    updatedAt: "2026-03-02T08:15:00.000Z",
    note: "Elevated latency and occasional disconnects on the Belgrade gateway; engineers are investigating.",
  },
  email: {
    status: "operational",
    updatedAt: "2026-03-02T07:00:00.000Z",
    note: "All mail systems are running normally.",
  },
  wiki: {
    status: "operational",
    updatedAt: "2026-03-01T22:30:00.000Z",
    note: "No known issues.",
  },
  hr_portal: {
    status: "outage",
    updatedAt: "2026-03-02T06:45:00.000Z",
    note: "The portal is unavailable due to a failed database upgrade; no ETA yet.",
  },
};

export interface SalaryBand {
  readonly position: string;
  readonly currency: "EUR";
  /** Gross yearly salary range, fictional figures. */
  readonly min: number;
  readonly max: number;
}

export const SALARY_BANDS: readonly SalaryBand[] = [
  { position: "Junior Developer", currency: "EUR", min: 24_000, max: 34_000 },
  { position: "Developer", currency: "EUR", min: 34_000, max: 48_000 },
  { position: "Senior Developer", currency: "EUR", min: 48_000, max: 68_000 },
  { position: "HR Specialist", currency: "EUR", min: 26_000, max: 38_000 },
  { position: "Engineering Manager", currency: "EUR", min: 66_000, max: 90_000 },
];
