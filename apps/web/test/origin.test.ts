import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../lib/origin";

describe("publicOrigin", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("uses the forwarded host behind a proxy", () => {
    const req = new Request("http://localhost:10000/auth/callback", {
      headers: { "x-forwarded-host": "inkcut-web.onrender.com", "x-forwarded-proto": "https" },
    });
    expect(publicOrigin(req)).toBe("https://inkcut-web.onrender.com");
  });

  it("falls back to NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://inkcut.example/";
    expect(publicOrigin(new Request("http://localhost:10000/x"))).toBe("https://inkcut.example");
  });

  it("falls back to the request address", () => {
    expect(publicOrigin(new Request("http://localhost:3000/x"))).toBe("http://localhost:3000");
  });
});
