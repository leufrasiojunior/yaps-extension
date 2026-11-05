import type { PageContext, RuntimeMessage } from "../shared/types";
import { ElementPicker } from "./element-picker";
import { MutationTracker } from "./mutation-tracker";

(() => {
  const pageContext: PageContext = {
    url: window.location.href,
    domain: window.location.hostname,
    title: document.title,
  };

  // Garante que o Main Injector seja inserido se a flag nativa do manifest nao o executou
  function ensureMainInjector(): void {
    if (document.getElementById("yaps-main-injector-tag")) {
      return;
    }
    try {
      const script = document.createElement("script");
      script.id = "yaps-main-injector-tag";
      script.src = chrome.runtime.getURL("content-main.js");
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch {
      // Ignora restricoes de CSP estrita se o manifest world MAIN ja cuidou disso
    }
  }

  ensureMainInjector();

  const tracker = new MutationTracker(pageContext);
  tracker.start();

  const picker = new ElementPicker(pageContext);

  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
      if (message.type === "START_ELEMENT_PICKER") {
        picker.start();
        sendResponse({ status: "picker_started" });
        return true;
      }
      if (message.type === "STOP_ELEMENT_PICKER") {
        picker.stop();
        sendResponse({ status: "picker_stopped" });
        return true;
      }
      return false;
    });
  }

  console.debug("[YAPS] Isolated Content Script carregado em", pageContext.domain);
})();
