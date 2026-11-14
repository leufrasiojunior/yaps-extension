import { BATCH_DEBOUNCE_MS, EXTENSION_VERSION, MAX_BATCH_SIZE } from "../shared/constants";
import { extractMainDomain } from "../shared/domain-utils";
import type {
  DetectedTarget,
  ExtensionMetadata,
  PageContext,
  ReportExtensionPayload,
  ReportTargetItem,
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

  async flushSession(
    tabId?: number,
    pageDomain?: string,
  ): Promise<{ success: boolean; batchId?: string; message?: string }> {
    let session: TabSessionState | undefined;
    if (tabId && this.sessions.has(tabId)) {
      session = this.sessions.get(tabId);
    } else if (pageDomain) {
      const mainDomain = extractMainDomain(pageDomain.toLowerCase());
      session = this.domainFallbackMap.get(mainDomain);
    }

    if (!session || session.targets.size === 0) {
      return { success: false, message: "Não há dados ou rastreadores pendentes nesta página." };
    }

    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
      session.debounceTimer = null;
    }

    const state = await extensionStorage.getState();
    if (!state.paired || !state.extensionId) {
      return { success: false, message: "A extensão não está conectada ao YAPD." };
    }

    const metadata: ExtensionMetadata = {
      name: state.deviceName,
      extensionId: state.extensionId,
      version: EXTENSION_VERSION,
      browser: "Chrome",
      manifestVersion: 3,
    };

    const itemsToSend = Array.from(session.targets.values());

    const mappedTargets: ReportTargetItem[] = itemsToSend.map((target) => ({
      candidateId: target.candidateId,
      target: target.target.trim().toLowerCase(),
      category: target.category || "ads",
      score: Math.max(0, Math.min(100, Math.round(target.score))),
      riskLevel:
        target.riskLevel || (target.score >= 70 ? "high" : target.score >= 30 ? "medium" : "low"),
      reasons:
        target.reasons && target.reasons.length > 0 ? target.reasons : ["Rastreador detectado"],
      evidence: {
        url: target.evidence?.url ? target.evidence.url.slice(0, 2048) : undefined,
        source: (target.evidence?.source || "web_request").slice(0, 100),
        resourceType: (target.evidence?.resourceType || "unknown").slice(0, 100),
        isThirdParty: Boolean(target.evidence?.isThirdParty),
      },
    }));

    const cleanDomain = session.page.domain.trim().toLowerCase().slice(0, 253);
    const cleanUrl = session.page.url.slice(0, 2048);

    const payload: ReportExtensionPayload = {
      source: "browser_extension",
      extension: metadata,
      clientRequestId: `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      page: {
        url: cleanUrl,
        domain: cleanDomain,
        title:
          state.settings.sendPageTitle && session.page.title
            ? session.page.title.slice(0, 300)
            : undefined,
      },
      action: "report_detected_items",
      detectedTargets: mappedTargets,
    };

    try {
      const res = await yapdApiClient.sendReport(payload);
      if (res.success && res.batchId) {
        session.savedToYapd = true;
        return { success: true, batchId: res.batchId };
      }
      return { success: false, message: res.message || "Falha ao salvar no YAPD." };
    } catch (err) {
      console.error("[YAPD Sentinel] Erro ao despachar análise para o YAPD:", err);
      return { success: false, message: (err as Error).message };
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

    const tabSession = tabId ? this.sessions.get(tabId) : undefined;
    if (tabSession) {
      return {
        count: tabSession.targets.size,
        targets: mapItems(Array.from(tabSession.targets.values())),
        savedToYapd: tabSession.savedToYapd,
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
