import { BATCH_DEBOUNCE_MS, MAX_BATCH_SIZE } from "../shared/constants";
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
  timer: ReturnType<typeof setTimeout> | null;
  tabId?: number;
}

export class BatchQueueManager {
  private batches = new Map<string, PageBatchState>();

  private getBatchKey(page: PageContext): string {
    return page.domain.toLowerCase();
  }

  enqueue(page: PageContext, target: DetectedTarget, tabId?: number, immediate = false): void {
    const key = this.getBatchKey(page);
    let batch = this.batches.get(key);

    if (!batch) {
      batch = {
        page,
        items: new Map<string, DetectedTarget>(),
        timer: null,
        tabId,
      };
      this.batches.set(key, batch);
    }

    // Deduplica por domínio do alvo (target) mantendo o de maior score
    const existing = batch.items.get(target.target);
    if (!existing || target.score > existing.score) {
      batch.items.set(target.target, target);
    }

    if (tabId && typeof chrome !== "undefined" && chrome.action) {
      chrome.action.setBadgeText({
        tabId,
        text: String(batch.items.size),
      });
      chrome.action.setBadgeBackgroundColor({
        tabId,
        color: "#dc2626", // vermelho para indicar detecções ativas
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

  getPageSummary(pageDomain: string): { count: number; targets: DetectedTarget[] } {
    const batch = this.batches.get(pageDomain.toLowerCase());
    if (!batch) {
      return { count: 0, targets: [] };
    }
    return {
      count: batch.items.size,
      targets: Array.from(batch.items.values()),
    };
  }
}

export const batchQueue = new BatchQueueManager();
