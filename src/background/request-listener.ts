import { evaluateCandidate, extractHostname } from "../shared/domain-utils";
import { batchQueue } from "./batch-queue";
import { extensionStorage } from "./storage";

export function initRequestListener(): void {
  if (typeof chrome === "undefined" || !chrome.webRequest?.onBeforeRequest) {
    return;
  }

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      // Ignora requisições internas do browser ou da própria extensão
      if (details.tabId <= 0 || details.url.startsWith("chrome-extension://")) {
        return;
      }

      extensionStorage.getState().then((state) => {
        if (!state.activeInspectionEnabled || !state.paired) {
          return;
        }

        chrome.tabs.get(details.tabId, (tab) => {
          if (chrome.runtime.lastError || !tab || !tab.url) {
            return;
          }

          const pageHostname = extractHostname(tab.url);
          if (!pageHostname) {
            return;
          }

          const candidate = evaluateCandidate(details.url, pageHostname, "web_request", {
            elementTag: details.type,
            initiatorScript: details.initiator,
          });

          if (candidate) {
            batchQueue.enqueue(
              {
                url: tab.url,
                domain: pageHostname,
                title: tab.title,
              },
              candidate,
              details.tabId,
            );
          }
        });
      });
    },
    { urls: ["<all_urls>"] },
  );
}
