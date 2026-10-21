import { describe, expect, it } from "vitest";

import { describeError } from "./commands";

describe("describeError", () => {
  it("returns the code of a rejected command", () => {
    expect(describeError({ code: "not_allowed" })).toBe("not_allowed");
  });

  it("returns the message of an Error", () => {
    expect(describeError(new Error("ipc unavailable"))).toBe("ipc unavailable");
  });

  it("falls back to the string form", () => {
    expect(describeError("timeout")).toBe("timeout");
    expect(describeError({ code: 7 })).toBe("[object Object]");
  });
});
