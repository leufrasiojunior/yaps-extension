import { BATCH_DEBOUNCE_MS, MAX_BATCH_SIZE } from "../shared/constants";
import { extractMainDomain } from "../shared/domain-utils";
import type {
  DetectedTarget,
  ExtensionMetadata,
  PageContext,
  ReportExtensionPayload,
} from "../shared/types";
import { yapdApiClient } from "./api-client";
import { extensionStorage } from "./storage";

interface TabSessionState {
  tabId: number;
  page: PageContext;
  targets: Map<string, DetectedTarget>;
  savedToYapd: boolean;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export class BatchQueueManager {
  private sessions = new Map<number, TabSessionState>();
  private domainFallbackMap = new Map<string, TabSessionState>();
  private blockedTargets = new Set<string>();

  constructor() {
    if (typeof chrome !== "undefined" && chrome.tabs?.onRemoved) {
      chrome.tabs.onRemoved.addListener((closedTabId) => {
        this.clearSession(closedTabId);
      });
    }
  }

  private clearSession(tabId: number): void {
    const session = this.sessions.get(tabId);
    if (session?.debounceTimer) {
      clearTimeout(session.debounceTimer);
    }
    this.sessions.delete(tabId);
  }

  enqueue(page: PageContext, target: DetectedTarget, tabId?: number, immediate = false): void {
    if (!tabId || tabId <= 0) {
      return;
    }

    let session = this.sessions.get(tabId);

    if (!session) {
      session = {
        tabId,
        page,
        targets: new Map<string, DetectedTarget>(),
        savedToYapd: false,
        debounceTimer: null,
      };
      this.sessions.set(tabId, session);
    } else {
      // Se o domínio da página mudou na mesma aba (usuário navegou para outro site), reseta a sessão da aba
      const currentMain = extractMainDomain(session.page.domain);
      const newMain = extractMainDomain(page.domain);
      if (currentMain !== newMain) {
        if (session.debounceTimer) {
          clearTimeout(session.debounceTimer);
        }
        session.page = page;
        session.targets.clear();
        session.savedToYapd = false;
        session.debounceTimer = null;
      } else if (page.title && !session.page.title) {
        session.page.title = page.title;
      }
    }

    // Deduplica o alvo mantendo o de maior pontuação
    const existing = session.targets.get(target.target);
    if (existing && existing.score >= target.score) {
      return;
    }

    if (
      this.blockedTargets.has(target.target.toLowerCase()) ||
      this.blockedTargets.has(extractMainDomain(target.target))
    ) {
      target.isBlocked = true;
    }

    session.targets.set(target.target, target);
    this.domainFallbackMap.set(extractMainDomain(session.page.domain), session);

    // Atualiza o badge do Chrome para a aba com a contagem real
    const totalCount = session.targets.size;
    if (typeof chrome !== "undefined" && chrome.action) {
      chrome.action.setBadgeText({
        tabId,
        text: String(totalCount),
      });
      chrome.action.setBadgeBackgroundColor({
        tabId,
        color: "#dc2626",
      });
    }

    // Se o envio automático contínuo estiver ativado nas configurações ou for imediato
    extensionStorage.getState().then((state) => {
      if (state.settings.autoSendToYapd || immediate) {
        if (immediate || session.targets.size >= MAX_BATCH_SIZE) {
          this.flushSession(tabId);
          return;
        }

        if (session.debounceTimer) {
          clearTimeout(session.debounceTimer);
        }

        session.debounceTimer = setTimeout(() => {
          this.flushSession(tabId);
        }, BATCH_DEBOUNCE_MS);
      }
    });
  }

  async flushSession(tabId: number): Promise<{ success: boolean; batchId?: string }> {
    const session = this.sessions.get(tabId);
    if (!session || session.targets.size === 0) {
      return { success: false };
    }

    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
      session.debounceTimer = null;
    }

    const state = await extensionStorage.getState();
    if (!state.paired || !state.extensionId) {
      return { success: false };
    }

    const metadata: ExtensionMetadata = {
      name: state.deviceName,
      extensionId: state.extensionId,
      version: "0.2.0",
      browser: "Chrome",
      manifestVersion: 3,
    };

    const itemsToSend = Array.from(session.targets.values());

    const payload: ReportExtensionPayload = {
      source: "browser_extension",
      extension: metadata,
      clientRequestId: `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      page: {
        url: session.page.url,
        domain: session.page.domain,
        title: state.settings.sendPageTitle ? session.page.title : undefined,
      },
      action: "report_detected_items",
      detectedTargets: itemsToSend,
    };

    try {
      const res = await yapdApiClient.sendReport(payload);
      if (res?.batchId) {
        session.savedToYapd = true;
        return { success: true, batchId: res.batchId };
      }
      return { success: false };
    } catch (err) {
      console.error("[YAPD Sentinel] Erro ao despachar análise para o YAPD:", err);
      return { success: false };
    }
  }

  markTargetAsBlocked(target: string, _tabId?: number): void {
    const normalized = target.toLowerCase().trim();
    const main = extractMainDomain(normalized);
    this.blockedTargets.add(normalized);
    if (main) {
      this.blockedTargets.add(main);
    }

    // Marca imediatamente nas sessões ativas
    for (const session of this.sessions.values()) {
      for (const [, item] of session.targets.entries()) {
        const itemTarget = item.target.toLowerCase();
        const itemMain = extractMainDomain(itemTarget);
        if (
          itemTarget === normalized ||
          itemTarget === main ||
          itemMain === normalized ||
          itemMain === main
        ) {
          item.isBlocked = true;
        }
      }
    }
  }

  getPageSummary(
    pageDomain?: string,
    tabId?: number,
  ): { count: number; targets: DetectedTarget[]; savedToYapd: boolean } {
    const mapItems = (items: DetectedTarget[]) =>
      items
        .map((item) => ({
          ...item,
          isBlocked:
            item.isBlocked ||
            this.blockedTargets.has(item.target.toLowerCase()) ||
            this.blockedTargets.has(extractMainDomain(item.target)),
        }))
        .sort((a, b) => b.score - a.score);

    if (tabId && this.sessions.has(tabId)) {
      const session = this.sessions.get(tabId)!;
      return {
        count: session.targets.size,
        targets: mapItems(Array.from(session.targets.values())),
        savedToYapd: session.savedToYapd,
      };
    }

    if (pageDomain) {
      const mainDomain = extractMainDomain(pageDomain.toLowerCase());
      const session = this.domainFallbackMap.get(mainDomain);
      if (session) {
        return {
          count: session.targets.size,
          targets: mapItems(Array.from(session.targets.values())),
          savedToYapd: session.savedToYapd,
        };
      }
    }

    return { count: 0, targets: [], savedToYapd: false };
  }
}

export const batchQueue = new BatchQueueManager();
