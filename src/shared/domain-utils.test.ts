import { describe, expect, it } from "vitest";
import {
  evaluateCandidate,
  extractHostname,
  extractMainDomain,
  isThirdParty,
  matchesAdDimension,
  matchesKnownAdPattern,
} from "./domain-utils";

describe("domain-utils", () => {
  it("extracts hostname accurately", () => {
    expect(extractHostname("https://ads.doubleclick.net/pagead/id=123")).toBe(
      "ads.doubleclick.net",
    );
    expect(extractHostname("http://sub.dominio.com.br/path")).toBe("sub.dominio.com.br");
    expect(extractHostname("invalid-url")).toBeNull();
  });

  it("handles multi-level TLDs like com.br and co.uk", () => {
    expect(extractMainDomain("g1.globo.com")).toBe("globo.com");
    expect(extractMainDomain("anuncios.uol.com.br")).toBe("uol.com.br");
    expect(extractMainDomain("sub.bbc.co.uk")).toBe("bbc.co.uk");
  });

  it("identifies third-party domains correctly", () => {
    expect(isThirdParty("anuncios.globo.com", "g1.globo.com")).toBe(false);
    expect(isThirdParty("securepubads.g.doubleclick.net", "g1.globo.com")).toBe(true);
  });

  it("detects known ad patterns", () => {
    expect(matchesKnownAdPattern("https://securepubads.g.doubleclick.net/tag.js")).toBe(true);
    expect(matchesKnownAdPattern("https://cdn.criteo.com/event.js")).toBe(true);
    expect(matchesKnownAdPattern("https://api.github.com/users")).toBe(false);
  });

  it("identifies IAB ad dimensions", () => {
    expect(matchesAdDimension(300, 250)).toBe(true);
    expect(matchesAdDimension(728, 90)).toBe(true);
    expect(matchesAdDimension(500, 500)).toBe(false);
  });

  it("evaluates ad candidates with high score for ad networks and dynamic JS", () => {
    const candidate = evaluateCandidate(
      "https://adservice.google.com/adsid/integrator.js",
      "noticias.com.br",
      "main_world_dom_mutation",
      {
        elementTag: "script",
        initiatorScript: "https://noticias.com.br/assets/prebid.js",
      },
    );

    expect(candidate).not.toBeNull();
    expect(candidate?.target).toBe("google.com");
    expect(candidate?.category).toBe("ads");
    expect(candidate?.riskLevel).toBe("high");
    expect(candidate?.score).toBeGreaterThanOrEqual(80);
    expect(candidate?.reasons).toContain("Dynamically injected into DOM via JavaScript");
  });

  it("gives maximum score to user inspector clicks", () => {
    const candidate = evaluateCandidate(
      "https://random-sponsor-network.xyz/click?id=99",
      "blog.com",
      "user_inspector_click",
    );

    expect(candidate).not.toBeNull();
    expect(candidate?.score).toBeGreaterThanOrEqual(90);
    expect(candidate?.reasons).toContain(
      "Explicitly flagged by user via interactive element picker",
    );
  });
});
