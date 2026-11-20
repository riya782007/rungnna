import { describe, expect, it } from "vitest";
import { whereAmI } from "../src/components/InstallApp";

/* Owner, 20 Nov: no home-screen icon on the phone; the link was opened from WhatsApp each time. */
const WA = "Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36 WhatsApp/2.23";
const CHROME = "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("installing the app from the website", () => {
  it("knows where it is opened", () => {
    expect(whereAmI(WA)).toBe("inapp");
    expect(whereAmI(CHROME)).toBe("android");
    expect(whereAmI(CHROME, false, false, true)).toBe("prompt");
    expect(whereAmI(IPHONE)).toBe("ios");
    expect(whereAmI(CHROME, true)).toBe("installed");
    expect(whereAmI("Mozilla/5.0 (Windows NT 10.0) Chrome/120", false, true)).toBe("installed");
  });
});
