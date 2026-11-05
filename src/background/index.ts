import { extractHostname } from "../shared/domain-utils";
import type { PageContext, RuntimeMessage } from "../shared/types";
import { yapdApiClient } from "./api-client";
import { batchQueue } from "./batch-queue";
import { initRequestListener } from "./request-listener";
import { extensionStorage } from "./storage";

console.log("[YAPD Sentinel] Service Worker iniciado.");

initRequestListener();

function resolveCanonicalPage(
  sender: chrome.runtime.MessageSender,
  fallbackPage: PageContext,
  callback: (page: PageContext) => void,
): void {
  const tab = sender.tab;
  if (tab?.url) {
    const host = extractHostname(tab.url);
    if (host) {
      callback({
        url: tab.url,
        domain: host,
        title: tab.title || fallbackPage?.title,
      });
      return;
    }
  }

  if (tab?.id && typeof chrome !== "undefined" && chrome.tabs?.get) {
    chrome.tabs.get(tab.id, (freshTab) => {
      if (!chrome.runtime.lastError && freshTab?.url) {
        const host = extractHostname(freshTab.url);
        if (host) {
          callback({
            url: freshTab.url,
            domain: host,
            title: freshTab.title || fallbackPage?.title,
          });
          return;
        }
      }
      callback(fallbackPage);
    });
    return;
  }

  callback(fallbackPage);
}

if (typeof chrome !== "undefined" && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(() => {
    console.log("[YAPD Sentinel] Extensão instalada/atualizada.");
    chrome.alarms.create("yapd_sentinel_sync_config", { periodInMinutes: 30 });
    yapdApiClient.fetchConfig().catch(console.error);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "yapd_sentinel_sync_config") {
      yapdApiClient.fetchConfig().catch(console.error);
    }
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    if (message.type === "CANDIDATE_DETECTED" || message.type === "PICKER_DETECTED") {
      const isManualPicker = message.type === "PICKER_DETECTED";

      extensionStorage.getState().then((state) => {
        if (!state.paired) {
          return;
        }
        if (!isManualPicker && !state.activeInspectionEnabled) {
          return;
        }

        resolveCanonicalPage(sender, message.page, (canonicalPage) => {
          if (sender.frameId && sender.frameId !== 0) {
            message.candidate.evidence = {
              ...message.candidate.evidence,
              frameUrl: sender.url || message.page?.url,
            };
          }

          batchQueue.enqueue(canonicalPage, message.candidate, tabId, isManualPicker);
        });
      });

      sendResponse({ status: isManualPicker ? "queued_immediate" : "queued" });
      return true;
    }

    if (message.type === "GET_PAGE_SUMMARY") {
      const effectiveTabId = message.tabId || tabId;
      const effectivePageDomain =
        message.pageDomain ||
        (sender.tab?.url ? extractHostname(sender.tab.url) ?? undefined : undefined);

      const summary = batchQueue.getPageSummary(effectivePageDomain, effectiveTabId);
      sendResponse(summary);
      return true;
    }

    if (message.type === "SAVE_PAGE_ANALYSIS_TO_YAPD") {
      const targetTabId = message.tabId || tabId;
      if (!targetTabId) {
        sendResponse({ success: false, message: "Aba não identificada." });
        return true;
      }

      batchQueue.flushSession(targetTabId).then((result) => {
        sendResponse(result);
      });
      return true;
    }

    if (message.type === "QUICK_BLOCK_TARGET") {
      const targetTabId = message.tabId || tabId;
      extensionStorage.getState().then(async (state) => {
        if (!state.paired) {
          sendResponse({ success: false, message: "Extensão desconectada." });
          return;
        }

        const summary = batchQueue.getPageSummary(undefined, targetTabId);
        const matchingItem = summary.targets.find(
          (t) => t.target.toLowerCase() === message.target.toLowerCase(),
        );

        const pageContext: PageContext = {
          url: sender.tab?.url || "https://unknown.local",
          domain: sender.tab?.url ? extractHostname(sender.tab.url) || "unknown" : "unknown",
        };

        const result = await yapdApiClient.applyBlockTarget(
          message.target,
          pageContext,
          matchingItem,
          message.kind || "exact",
        );

        sendResponse(result);
      });
      return true;
    }

    return false;
  });
}
