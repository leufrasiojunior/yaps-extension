import type { ExtensionSettings, ExtensionStorageState } from "./types";

export const DEFAULT_MIN_SCORE_THRESHOLD = 30;

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  sendPageTitle: true,
  hardBlockedUrlPatterns: [],
  sensitiveUrlPatterns: ["*://*.bank*", "*://*.gov.br*", "*://login.*", "*://auth.*"],
  minScoreThreshold: DEFAULT_MIN_SCORE_THRESHOLD,
  autoSendToYapd: false, // Por padrão, mantém na memória local da aba; envia sob demanda ou ao bloquear
};

export const DEFAULT_STORAGE_STATE: ExtensionStorageState = {
  yapdBaseUrl: "http://localhost:3000",
  paired: false,
  token: null,
  extensionId: null,
  deviceName: "YAPD Sentinel Browser",
  settings: DEFAULT_EXTENSION_SETTINGS,
  activeInspectionEnabled: true,
};

export const KNOWN_AD_DOMAINS_PATTERNS = [
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /googleadservices\.com/i,
  /criteo\.(com|net)/i,
  /taboola\.com/i,
  /outbrain\.com/i,
  /teads\.tv/i,
  /onetag-sys\.com/i,
  /2mdn\.net/i,
  /adnxs\.com/i,
  /rubiconproject\.com/i,
  /pubmatic\.com/i,
  /openx\.net/i,
  /casalemedia\.com/i,
  /smartadserver\.com/i,
  /adform\.net/i,
  /scorecardresearch\.com/i,
  /advertising\.com/i,
  /amazon-adsystem\.com/i,
  /adservice/i,
  /adsystem/i,
  /adserver/i,
  /tracking/i,
  /telemetry/i,
  /pixel/i,
  /beacon/i,
  /analytics/i,
  /sponsor/i,
];

export const KNOWN_AD_CONTAINER_CLASSES_OR_IDS = [
  "adsbygoogle",
  "ad-slot",
  "ad-container",
  "advertisement",
  "banner-ad",
  "sponsor-slot",
  "taboola-container",
  "outbrain-widget",
  "dfp-ad",
  "publicidade",
  "patrocinado",
  "anuncio",
  "propaganda",
  "adserver",
  "banner",
  "ad-wrapper",
  "ad-unit",
  "native-ad",
];

export const IAB_AD_DIMENSIONS = [
  { width: 300, height: 250 }, // Medium Rectangle
  { width: 728, height: 90 }, // Leaderboard
  { width: 160, height: 600 }, // Wide Skyscraper
  { width: 300, height: 600 }, // Half Page
  { width: 970, height: 250 }, // Billboard
  { width: 320, height: 50 }, // Mobile Leaderboard
  { width: 320, height: 100 }, // Large Mobile
];

export const BATCH_DEBOUNCE_MS = 3000;
export const MAX_BATCH_SIZE = 50;
