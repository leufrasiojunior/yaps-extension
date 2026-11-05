import type { PageContext, RuntimeMessage } from "../shared/types";
import { ElementPicker } from "./element-picker";
import { MutationTracker } from "./mutation-tracker";

(() => {
  const isTopFrame = window === window.top;

  const pageContext: PageContext = {
    url: window.location.href,
    domain: window.location.hostname,
    title: document.title,
  };

  const tracker = new MutationTracker(pageContext);
  tracker.start();

  // O Element Picker deve operar apenas no top frame para cobrir a viewport inteira sem conflitos
  const picker = isTopFrame ? new ElementPicker(pageContext) : null;

  if (typeof chrome !== "undefined" && chrome.runtime && isTopFrame) {
    chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
      if (message.type === "START_ELEMENT_PICKER") {
        picker?.start();
        sendResponse({ status: "picker_started" });
        return true;
      }
      if (message.type === "STOP_ELEMENT_PICKER") {
        picker?.stop();
        sendResponse({ status: "picker_stopped" });
        return true;
      }
      return false;
    });
  }

  console.debug("[YAPS] Isolated Content Script ativo em", pageContext.domain, isTopFrame ? "(top)" : "(frame)");
})();
