import type { Role } from "./types";

export interface User {
  readonly userId: string;
  /** Human-readable name for the user switcher. */
  readonly label: string;
  readonly role: Role;
}

/** The two predefined users of the demo. The "user switcher" is the X-User request header. */
const USERS: Readonly<Record<string, User>> = {
  ana: { userId: "ana", label: "Ana (employee)", role: "employee" },
  marko: { userId: "marko", label: "Marko (manager)", role: "manager" },
};

/** The predefined users for the switcher dropdown. Contains no secrets. */
export function listUsers(): User[] {
  return Object.values(USERS);
}

export const USER_HEADER = "X-User";

/** Thrown for a missing or unknown user; the HTTP layer maps it to a 401 response. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function resolveUser(request: Request): User {
  const raw = request.headers.get(USER_HEADER);
  if (raw === null || raw.trim() === "") {
    throw new UnauthorizedError(`Missing ${USER_HEADER} header.`);
  }
  const key = raw.trim().toLowerCase();
  // Object.hasOwn: keys like "constructor" or "__proto__" must not resolve to anything.
  const user = Object.hasOwn(USERS, key) ? USERS[key] : undefined;
  if (user === undefined) {
    throw new UnauthorizedError(`Unknown user in ${USER_HEADER} header.`);
  }
  return user;
}
