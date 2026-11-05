import type { RuntimeMessage } from "../shared/types";
import { yapdApiClient } from "./api-client";
import { batchQueue } from "./batch-queue";
import { initRequestListener } from "./request-listener";
import { extensionStorage } from "./storage";

console.log("[YAPS] Sentinel Background Service Worker iniciado.");

initRequestListener();

if (typeof chrome !== "undefined" && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(() => {
    console.log("[YAPS] Extensão instalada/atualizada.");
    chrome.alarms.create("yaps_sync_config", { periodInMinutes: 30 });
    yapdApiClient.fetchConfig().catch(console.error);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "yaps_sync_config") {
      yapdApiClient.fetchConfig().catch(console.error);
    }
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    if (message.type === "CANDIDATE_DETECTED") {
      extensionStorage.getState().then((state) => {
        if (state.activeInspectionEnabled && state.paired) {
          batchQueue.enqueue(message.page, message.candidate, tabId);
        }
      });
      sendResponse({ status: "queued" });
      return true;
    }

    if (message.type === "PICKER_DETECTED") {
      // Detecção manual via Element Picker - despacha de imediato
      extensionStorage.getState().then((state) => {
        if (state.paired) {
          batchQueue.enqueue(message.page, message.candidate, tabId, true);
        }
      });
      sendResponse({ status: "queued_immediate" });
      return true;
    }

    if (message.type === "GET_PAGE_SUMMARY") {
      const pageDomain = sender.tab?.url ? new URL(sender.tab.url).hostname : "";
      const summary = batchQueue.getPageSummary(pageDomain);
      sendResponse(summary);
      return true;
    }

    return false;
  });
}
