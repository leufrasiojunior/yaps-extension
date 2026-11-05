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

interface PageBatchState {
  page: PageContext;
  items: Map<string, DetectedTarget>;
  reportedTargets: Map<string, DetectedTarget>;
  timer: ReturnType<typeof setTimeout> | null;
  tabId?: number;
}

export class BatchQueueManager {
  private batches = new Map<string, PageBatchState>();

  private getBatchKey(page: PageContext): string {
    return extractMainDomain(page.domain);
  }

  enqueue(page: PageContext, target: DetectedTarget, tabId?: number, immediate = false): void {
    const key = this.getBatchKey(page);
    let batch = this.batches.get(key);

    if (!batch) {
      batch = {
        page,
        items: new Map<string, DetectedTarget>(),
        reportedTargets: new Map<string, DetectedTarget>(),
        timer: null,
        tabId,
      };
      this.batches.set(key, batch);
    } else {
      // Atualiza o contexto se a nova pagina tiver título ou url mais canônica
      if (page.title && !batch.page.title) {
        batch.page.title = page.title;
      }
    }

    if (tabId) {
      batch.tabId = tabId;
    }

    // Se o alvo já foi reportado nesta sessão de página com score igual ou maior, ignora
    const alreadyReported = batch.reportedTargets.get(target.target);
    if (alreadyReported && alreadyReported.score >= target.score) {
      return;
    }

    // Deduplica nos itens pendentes mantendo o de maior score
    const existing = batch.items.get(target.target);
    if (existing && existing.score >= target.score) {
      return;
    }

    batch.items.set(target.target, target);

    const totalUniqueCount = batch.reportedTargets.size + batch.items.size;

    if (batch.tabId && typeof chrome !== "undefined" && chrome.action) {
      chrome.action.setBadgeText({
        tabId: batch.tabId,
        text: String(totalUniqueCount),
      });
      chrome.action.setBadgeBackgroundColor({
        tabId: batch.tabId,
        color: "#dc2626",
      });
    }

    if (immediate || batch.items.size >= MAX_BATCH_SIZE) {
      this.flush(key);
      return;
    }

    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    batch.timer = setTimeout(() => {
      this.flush(key);
    }, BATCH_DEBOUNCE_MS);
  }

  async flush(batchKey: string): Promise<void> {
    const batch = this.batches.get(batchKey);
    if (!batch || batch.items.size === 0) {
      return;
    }

    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }

    const state = await extensionStorage.getState();
    if (!state.paired || !state.extensionId) {
      return;
    }

    const metadata: ExtensionMetadata = {
      name: state.deviceName,
      extensionId: state.extensionId,
      version: "0.1.0",
      browser: "Chrome",
      manifestVersion: 3,
    };

    const itemsToSend = Array.from(batch.items.values());

    // Marca como reportados e limpa a fila de pendentes para não re-enviar repetidamente
    for (const item of itemsToSend) {
      batch.reportedTargets.set(item.target, item);
    }
    batch.items.clear();

    const payload: ReportExtensionPayload = {
      source: "browser_extension",
      extension: metadata,
      clientRequestId: `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      page: {
        url: batch.page.url,
        domain: batch.page.domain,
        title: state.settings.sendPageTitle ? batch.page.title : undefined,
      },
      action: "report_detected_items",
      detectedTargets: itemsToSend,
    };

    try {
      await yapdApiClient.sendReport(payload);
    } catch (err) {
      console.error("[YAPS] Erro ao despachar lote:", err);
    }
  }

  getPageSummary(pageDomain?: string, tabId?: number): { count: number; targets: DetectedTarget[] } {
    if (tabId) {
      for (const batch of this.batches.values()) {
        if (batch.tabId === tabId) {
          const allTargets = new Map([...batch.reportedTargets, ...batch.items]);
          return {
            count: allTargets.size,
            targets: Array.from(allTargets.values()),
          };
        }
      }
    }

    if (pageDomain) {
      const normalizedDomain = pageDomain.toLowerCase();
      const mainDomain = extractMainDomain(normalizedDomain);

      for (const [key, batch] of this.batches.entries()) {
        if (
          key === mainDomain ||
          key === normalizedDomain ||
          extractMainDomain(batch.page.domain) === mainDomain ||
          batch.page.domain.toLowerCase() === normalizedDomain
        ) {
          const allTargets = new Map([...batch.reportedTargets, ...batch.items]);
          return {
            count: allTargets.size,
            targets: Array.from(allTargets.values()),
          };
        }
      }
    }

    return { count: 0, targets: [] };
  }
}

export const batchQueue = new BatchQueueManager();
