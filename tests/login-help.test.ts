import { describe, it, expect } from "vitest";
import { codeHelp } from "../src/lib/sync";

/* Owner, 10 Nov: the second computer asked for a password nobody remembered. The emailed code is the way in, and
   every refusal from the cloud says what to do next instead of an English error. */
describe("sign-in code help", () => {
  it("says what to do when the cloud may not send email yet", () => {
    expect(codeHelp("Email address not authorized")).toMatch(/Change password/);
  });
  it("never makes a new login for an unknown email", () => {
    expect(codeHelp("Signups not allowed for otp")).toMatch(/no shop login with this email/);
  });
  it("asks to wait when an email was just sent", () => {
    expect(codeHelp("For security purposes, you can only request this after 52 seconds.")).toMatch(/wait a minute/);
  });
  it("explains a wrong or old code", () => {
    expect(codeHelp("Token has expired or is invalid")).toMatch(/newest email/);
  });
});
