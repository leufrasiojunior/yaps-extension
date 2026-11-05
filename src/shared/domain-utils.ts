import {
  IAB_AD_DIMENSIONS,
  KNOWN_AD_CONTAINER_CLASSES_OR_IDS,
  KNOWN_AD_DOMAINS_PATTERNS,
} from "./constants";
import type { DetectedTarget, DetectionEvidence, RiskLevel } from "./types";

const MULTI_PART_TLDS = new Set([
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "edu.br",
  "co.uk",
  "org.uk",
  "me.uk",
  "com.au",
  "net.au",
  "co.nz",
  "co.jp",
]);

export function extractHostname(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname || url.protocol === "javascript:" || url.protocol === "about:") {
      return null;
    }
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function extractMainDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".");
  if (parts.length <= 2) {
    return hostname.toLowerCase();
  }

  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return `${parts[parts.length - 3]}.${lastTwo}`;
  }

  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

export function isThirdParty(targetHostname: string, pageHostname: string): boolean {
  const targetMain = extractMainDomain(targetHostname);
  const pageMain = extractMainDomain(pageHostname);
  return targetMain !== pageMain;
}

export function matchesKnownAdPattern(urlOrDomain: string): boolean {
  return KNOWN_AD_DOMAINS_PATTERNS.some((pattern) => pattern.test(urlOrDomain));
}

export function matchesAdDimension(width: number, height: number): boolean {
  return IAB_AD_DIMENSIONS.some(
    (dim) => Math.abs(dim.width - width) <= 5 && Math.abs(dim.height - height) <= 5,
  );
}

export function matchesAdClassOrId(identifier: string): boolean {
  const lower = identifier.toLowerCase();
  return KNOWN_AD_CONTAINER_CLASSES_OR_IDS.some((token) => lower.includes(token));
}

export function evaluateCandidate(
  rawUrl: string,
  pageHostname: string,
  source: DetectionEvidence["source"],
  extra?: {
    elementTag?: string;
    initiatorScript?: string;
    width?: number;
    height?: number;
    classOrId?: string;
  },
): DetectedTarget | null {
  const hostname = extractHostname(rawUrl);
  if (!hostname) {
    return null;
  }

  const mainDomain = extractMainDomain(hostname);
  const thirdParty = isThirdParty(hostname, pageHostname);

  // Se for o mesmo domínio e não for claramente um ad container/script, ignora
  if (!thirdParty && source !== "user_inspector_click") {
    return null;
  }

  const reasons: string[] = [];
  let score = 10;
  let category = thirdParty ? "third_party" : "site_asset";

  if (thirdParty) {
    reasons.push("Third-party resource outside main page domain");
    score += 20;
  }

  if (matchesKnownAdPattern(rawUrl) || matchesKnownAdPattern(hostname)) {
    reasons.push("Matches known ad-network or tracking pattern");
    score += 45;
    category = "ads";
  }

  if (source === "main_world_dom_mutation") {
    reasons.push("Dynamically injected into DOM via JavaScript");
    score += 20;
    category = "ads";
  }

  if (extra?.initiatorScript) {
    reasons.push(`Injected by script: ${extra.initiatorScript}`);
    score += 15;
  }

  if (extra?.classOrId && matchesAdClassOrId(extra.classOrId)) {
    reasons.push(`Container attributes indicate advertisement (${extra.classOrId})`);
    score += 25;
    category = "ads";
  }

  if (extra?.width && extra?.height && matchesAdDimension(extra.width, extra.height)) {
    reasons.push(
      `Element dimensions match standard IAB ad banner (${extra.width}x${extra.height})`,
    );
    score += 20;
    category = "ads";
  }

  if (source === "user_inspector_click") {
    reasons.push("Explicitly flagged by user via interactive element picker");
    score = Math.max(score, 90);
    category = "ads";
  }

  score = Math.min(100, score);

  let riskLevel: RiskLevel = "low";
  if (score >= 70) {
    riskLevel = "high";
  } else if (score >= 40) {
    riskLevel = "medium";
  }

  const candidateId = `cand-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  return {
    candidateId,
    target: mainDomain,
    category,
    score,
    riskLevel,
    reasons,
    evidence: {
      url: rawUrl,
      source,
      resourceType: extra?.elementTag || "unknown",
      isThirdParty: thirdParty,
      elementTag: extra?.elementTag,
      initiatorScript: extra?.initiatorScript,
      timestamp: Date.now(),
    },
  };
}
