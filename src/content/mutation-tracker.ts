import { evaluateCandidate } from "../shared/domain-utils";
import type { PageContext } from "../shared/types";

export class MutationTracker {
  private observer: MutationObserver | null = null;
  private pageContext: PageContext;
  private seenUrls = new Set<string>();

  constructor(pageContext: PageContext) {
    this.pageContext = pageContext;
    this.handleWindowMessage = this.handleWindowMessage.bind(this);
  }

  start(): void {
    // 1. Escuta notificacoes do Main World Injector (hooks nativos)
    window.addEventListener("message", this.handleWindowMessage);

    // 2. Observa insercoes de nós e atributos na arvore DOM
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              this.inspectNode(node);
            }
          }
        } else if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
          this.inspectNode(mutation.target);
        }
      }
    });

    if (document.documentElement) {
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "data-src"],
      });
      // Inspeciona nos que ja existiam ao carregar
      this.inspectInitialDom();
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        if (this.observer && document.documentElement) {
          this.observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "data-src"],
          });
          this.inspectInitialDom();
        }
      });
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener("message", this.handleWindowMessage);
  }

  private inspectInitialDom(): void {
    const scriptsAndFrames = document.querySelectorAll("script[src], iframe[src], ins.adsbygoogle");
    for (const el of scriptsAndFrames) {
      if (el instanceof HTMLElement) {
        this.inspectNode(el);
      }
    }
  }

  private inspectNode(el: HTMLElement): void {
    const tag = el.tagName.toLowerCase();
    const src =
      el.getAttribute("src") ||
      el.getAttribute("data-src") ||
      (el as unknown as HTMLScriptElement).src;
    const origin = el.dataset?.yapsOrigin || el.getAttribute("data-yaps-origin");
    const classOrId = `${el.className || ""} ${el.id || ""}`;
    let width = 0;
    let height = 0;
    try {
      const rect = el.getBoundingClientRect();
      width = Math.round(rect.width);
      height = Math.round(rect.height);
    } catch {
      // Elemento pode estar desconectado
    }

    if (src && typeof src === "string" && !this.seenUrls.has(src)) {
      this.seenUrls.add(src);
      const candidate = evaluateCandidate(src, this.pageContext.domain, "main_world_dom_mutation", {
        elementTag: tag,
        initiatorScript: origin || undefined,
        classOrId,
        width,
        height,
      });

      if (candidate) {
        this.sendCandidate(candidate);
      }
    }

    // Procura tags filhas criadas juntas
    const childScripts = el.querySelectorAll("script[src], iframe[src]");
    for (const child of childScripts) {
      if (child instanceof HTMLElement) {
        const childSrc = child.getAttribute("src");
        if (childSrc && !this.seenUrls.has(childSrc)) {
          this.seenUrls.add(childSrc);
          const candidate = evaluateCandidate(
            childSrc,
            this.pageContext.domain,
            "main_world_dom_mutation",
            {
              elementTag: child.tagName.toLowerCase(),
              initiatorScript: origin || undefined,
            },
          );
          if (candidate) {
            this.sendCandidate(candidate);
          }
        }
      }
    }
  }

  private handleWindowMessage(event: MessageEvent): void {
    if (event.source !== window || !event.data || event.data.source !== "YAPS_MAIN_INJECTOR") {
      return;
    }

    const { url, resourceType, initiator } = event.data;
    if (url && !this.seenUrls.has(url)) {
      this.seenUrls.add(url);
      const candidate = evaluateCandidate(url, this.pageContext.domain, "main_world_dom_mutation", {
        elementTag: resourceType,
        initiatorScript: initiator,
      });

      if (candidate) {
        this.sendCandidate(candidate);
      }
    }
  }

  private sendCandidate(candidate: ReturnType<typeof evaluateCandidate>): void {
    if (!candidate) return;
    if (typeof chrome !== "undefined" && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: "CANDIDATE_DETECTED",
        page: this.pageContext,
        candidate,
      });
    }
  }
}
