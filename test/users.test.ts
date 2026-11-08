import { describe, expect, it } from "vitest";
import { resolveUser, UnauthorizedError } from "../src/users";

const req = (headers?: Record<string, string>) =>
  new Request("https://example.com/api/chat", { headers: headers ?? {} });

describe("resolveUser", () => {
  it("resolves ana as employee and marko as manager", () => {
    expect(resolveUser(req({ "X-User": "ana" }))).toEqual({ userId: "ana", role: "employee" });
    expect(resolveUser(req({ "X-User": "marko" }))).toEqual({ userId: "marko", role: "manager" });
  });

  it("tolerates case and surrounding whitespace", () => {
    expect(resolveUser(req({ "x-user": "  Marko " })).role).toBe("manager");
  });

  it("rejects an unknown user with 401", () => {
    expect.assertions(2);
    try {
      resolveUser(req({ "X-User": "eve" }));
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedError);
      expect((err as UnauthorizedError).status).toBe(401);
    }
  });

  it("rejects a missing or empty header with 401", () => {
    expect(() => resolveUser(req())).toThrow(UnauthorizedError);
    expect(() => resolveUser(req({ "X-User": "  " }))).toThrow(UnauthorizedError);
  });

  it("does not resolve prototype keys", () => {
    expect(() => resolveUser(req({ "X-User": "constructor" }))).toThrow(UnauthorizedError);
    expect(() => resolveUser(req({ "X-User": "__proto__" }))).toThrow(UnauthorizedError);
  });
});
