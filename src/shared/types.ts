export type RiskLevel = "low" | "medium" | "high";

export type DetectionEvidence = {
  url?: string;
  source:
    | "main_world_dom_mutation"
    | "performance_resource"
    | "user_inspector_click"
    | "web_request";
  resourceType?: string;
  isThirdParty: boolean;
  frameUrl?: string;
  elementTag?: string;
  initiatorScript?: string;
  timestamp?: number;
  domPathHash?: string;
  elementId?: string;
  elementClasses?: string[];
  dimensions?: { width: number; height: number };
};

export type DetectedTarget = {
  candidateId: string;
  target: string;
  category: string;
  score: number;
  riskLevel: RiskLevel;
  reasons: string[];
  evidence: DetectionEvidence;
  isBlocked?: boolean;
};

export type PageContext = {
  url: string;
  domain: string;
  title?: string;
};

export type ExtensionMetadata = {
  name: string;
  extensionId: string;
  version: string;
  browser: string;
  manifestVersion: number;
};

export type ReportExtensionPayload = {
  source: "browser_extension";
  extension: ExtensionMetadata;
  clientRequestId: string;
  page: PageContext;
  action: "report_detected_items";
  detectedTargets: DetectedTarget[];
};

export type ExtensionSettings = {
  sendPageTitle: boolean;
  hardBlockedUrlPatterns: string[];
  sensitiveUrlPatterns: string[];
  minScoreThreshold: number;
  autoSendToYapd: boolean;
};

export type ExtensionStorageState = {
  yapdBaseUrl: string;
  paired: boolean;
  token: string | null;
  extensionId: string | null;
  deviceName: string;
  settings: ExtensionSettings;
  activeInspectionEnabled: boolean;
};

export type RuleCacheItem = {
  target: string;
  kind: "exact" | "regex";
  source: "browser_extension_decision" | "managed_domain";
};

export type PairingResponse = {
  accessToken: string;
  extensionId: string;
  settings: ExtensionSettings;
  allowlist: RuleCacheItem[];
  blockedItems: RuleCacheItem[];
};

export type RuntimeMessage =
  | { type: "PAGE_LOADED"; page: PageContext }
  | { type: "CANDIDATE_DETECTED"; page: PageContext; candidate: DetectedTarget }
  | { type: "PICKER_DETECTED"; page: PageContext; candidate: DetectedTarget }
  | { type: "START_ELEMENT_PICKER" }
  | { type: "STOP_ELEMENT_PICKER" }
  | { type: "GET_PAGE_SUMMARY"; pageDomain?: string; tabId?: number }
  | { type: "SAVE_PAGE_ANALYSIS_TO_YAPD"; tabId: number; pageDomain?: string }
  | {
      type: "QUICK_BLOCK_TARGET";
      target: string;
      kind?: "exact" | "regex";
      tabId?: number;
      page?: PageContext;
      domPathHash?: string;
    }
  | { type: "QUICK_ALLOW_TARGET"; target: string; tabId?: number }
  | {
      type: "MAIN_WORLD_INJECTION_DETECTED";
      scriptUrl?: string;
      iframeUrl?: string;
      initiator?: string;
    };
