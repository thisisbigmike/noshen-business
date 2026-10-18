import { describe, expect, it } from "vitest";
import { PCM } from "@noshen/shared/i18n-pcm";
import { fill, langFromRequest, loadCatalog, markersOf, richParts, translate } from "@noshen/shared/i18n";
import { liteFromRequest } from "@noshen/shared/data-saver";
import { allStrings } from "./i18n-strings";

describe("Pidgin", () => {
  const used = allStrings();

  it("has words for every English string on the customer site", () => {
    expect([...used].filter((k) => !(k in PCM))).toEqual([]);
  });

  it("keeps every {value} and <tag> of the English in each line", () => {
    const wrong = Object.entries(PCM).filter(([en, pcm]) => markersOf(en).join() !== markersOf(pcm).join());
    expect(wrong).toEqual([]);
  });

  it("has nothing left over from English the site no longer shows", () => {
    expect(Object.keys(PCM).filter((k) => !used.has(k))).toEqual([]);
  });

  it("isn't left empty or as English by mistake, apart from words that are the same", () => {
    expect(Object.entries(PCM).filter(([, pcm]) => !pcm.trim())).toEqual([]);
  });
});

describe("translation", () => {
  it("translates, fills values, and falls back to English", async () => {
    await loadCatalog("pcm");
    expect(translate("en", "Pay by {time}", { time: "6pm" })).toBe("Pay by 6pm");
    expect(translate("pcm", "Pay by {time}", { time: "6pm" })).toBe(fill(PCM["Pay by {time}"], { time: "6pm" }));
    expect(translate("pcm", "Something no catalog has")).toBe("Something no catalog has");
    expect(fill("Hi {name}, {missing}", { name: "Ada" })).toBe("Hi Ada, {missing}");
  });

  it("splits rich text into plain and tagged parts", () => {
    expect(richParts("Agree to the <a>terms</a> and <b>rules</b>.")).toEqual(["Agree to the ", { tag: "a", text: "terms" }, " and ", { tag: "b", text: "rules" }, "."]);
  });

  it("picks the language from the cookie, then the browser, then English", () => {
    expect(langFromRequest("noshen-lang=pcm", "en-GB")).toBe("pcm");
    expect(langFromRequest("a=1; noshen-lang=en", "pcm")).toBe("en");
    expect(langFromRequest(null, "pcm, en;q=0.8")).toBe("pcm");
    expect(langFromRequest("noshen-lang=fr", "en-NG")).toBe("en");
  });

  it("turns data saver on from the cookie, or the browser's Save-Data", () => {
    expect(liteFromRequest("noshen-data=lite", null)).toBe(true);
    expect(liteFromRequest("noshen-data=full", "on")).toBe(false);
    expect(liteFromRequest(null, "on")).toBe(true);
    expect(liteFromRequest(null, null)).toBe(false);
  });
});
