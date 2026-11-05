import { evaluateCandidate } from "../shared/domain-utils";
import type { PageContext } from "../shared/types";

export class ElementPicker {
  private active = false;
  private overlay: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private currentElement: HTMLElement | null = null;
  private pageContext: PageContext;

  constructor(pageContext: PageContext) {
    this.pageContext = pageContext;
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.createOverlay();

    document.addEventListener("mousemove", this.onMouseMove, true);
    document.addEventListener("click", this.onClick, true);
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;

    document.removeEventListener("mousemove", this.onMouseMove, true);
    document.removeEventListener("click", this.onClick, true);
    document.removeEventListener("keydown", this.onKeyDown, true);

    this.removeOverlay();
  }

  private createOverlay(): void {
    if (this.overlay) return;

    this.overlay = document.createElement("div");
    this.overlay.id = "yaps-picker-overlay";
    Object.assign(this.overlay.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483647",
      border: "2px dashed #ef4444",
      backgroundColor: "rgba(239, 68, 68, 0.15)",
      transition: "all 0.05s ease-out",
      display: "none",
    });

    this.tooltip = document.createElement("div");
    this.tooltip.id = "yaps-picker-tooltip";
    Object.assign(this.tooltip.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      padding: "4px 8px",
      background: "#18181b",
      color: "#ffffff",
      fontSize: "11px",
      fontFamily: "monospace",
      borderRadius: "4px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      display: "none",
    });

    document.documentElement.appendChild(this.overlay);
    document.documentElement.appendChild(this.tooltip);
  }

  private removeOverlay(): void {
    this.overlay?.remove();
    this.tooltip?.remove();
    this.overlay = null;
    this.tooltip = null;
    this.currentElement = null;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.active || !this.overlay || !this.tooltip) return;

    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
    if (!target || target === this.overlay || target === this.tooltip) return;

    this.currentElement = target;
    const rect = target.getBoundingClientRect();

    Object.assign(this.overlay.style, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    const tag = target.tagName.toLowerCase();
    this.tooltip.textContent = `<${tag}> ${Math.round(rect.width)}x${Math.round(rect.height)} (Clique para capturar ad)`;
    Object.assign(this.tooltip.style, {
      display: "block",
      top: `${Math.max(4, rect.top - 26)}px`,
      left: `${Math.max(4, rect.left)}px`,
    });
  }

  private onClick(e: MouseEvent): void {
    if (!this.active || !this.currentElement) return;

    e.preventDefault();
    e.stopPropagation();

    const element = this.currentElement;
    this.stop();

    // Extrai evidências e URLs do elemento clicado
    const extractedUrls = this.extractUrlsFromElement(element);
    const rect = element.getBoundingClientRect();
    const classOrId = `${element.className || ""} ${element.id || ""}`;

    for (const url of extractedUrls) {
      const candidate = evaluateCandidate(url, this.pageContext.domain, "user_inspector_click", {
        elementTag: element.tagName.toLowerCase(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        classOrId,
      });

      if (candidate) {
        if (typeof chrome !== "undefined" && chrome.runtime) {
          chrome.runtime.sendMessage({
            type: "PICKER_DETECTED",
            page: this.pageContext,
            candidate,
          });
        }
        this.showToast(`🎯 Ad capturado e agendado no YAPD: ${candidate.target}`);
        return;
      }
    }

    // Se nenhuma URL externa direta foi achada, usa o domínio de script de origem se houver
    const origin = element.getAttribute("data-yaps-origin");
    if (origin) {
      const candidate = evaluateCandidate(origin, this.pageContext.domain, "user_inspector_click", {
        elementTag: "script_origin",
        classOrId,
      });
      if (candidate) {
        if (typeof chrome !== "undefined" && chrome.runtime) {
          chrome.runtime.sendMessage({
            type: "PICKER_DETECTED",
            page: this.pageContext,
            candidate,
          });
        }
        this.showToast(`🎯 Script de origem capturado no YAPD: ${candidate.target}`);
        return;
      }
    }

    this.showToast("⚠️ Nenhum domínio de anúncio terceiro identificado neste elemento.");
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.stop();
      this.showToast("Inspetor cancelado.");
    }
  }

  private extractUrlsFromElement(el: HTMLElement): string[] {
    const urls: string[] = [];

    const checkAttr = (node: Element, attr: string) => {
      const val = node.getAttribute(attr);
      if (val && (val.startsWith("http://") || val.startsWith("https://"))) {
        urls.push(val);
      }
    };

    // Checa o proprio elemento
    checkAttr(el, "src");
    checkAttr(el, "href");
    checkAttr(el, "data-src");
    checkAttr(el, "data-ad-client");
    checkAttr(el, "data-yaps-origin");

    // Procura em sub-elementos (links, imgs, iframes)
    const children = el.querySelectorAll("a, img, iframe, script, source");
    for (const child of children) {
      checkAttr(child, "src");
      checkAttr(child, "href");
      checkAttr(child, "data-src");
      checkAttr(child, "data-yaps-origin");
    }

    // Sobe ate 4 pais para achar containers de anuncios com links
    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 4) {
      checkAttr(parent, "data-yaps-origin");
      const parentLink = parent.querySelector("a[href^='http']");
      if (parentLink) {
        checkAttr(parentLink, "href");
      }
      parent = parent.parentElement;
      depth++;
    }

    return Array.from(new Set(urls));
  }

  private showToast(message: string): void {
    const toast = document.createElement("div");
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      zIndex: "2147483647",
      padding: "10px 16px",
      backgroundColor: "#18181b",
      color: "#ffffff",
      fontSize: "13px",
      fontFamily: "system-ui, -apple-system, sans-serif",
      borderRadius: "8px",
      boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
      border: "1px solid #3f3f46",
      transition: "opacity 0.3s ease",
    });
    toast.textContent = message;
    document.documentElement.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}
