import { evaluateCandidate } from "../shared/domain-utils";
import type { PageContext } from "../shared/types";

export class ElementPicker {
  private active = false;
  private backdrop: HTMLDivElement | null = null;
  private highlightBox: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private currentElement: HTMLElement | null = null;
  private pageContext: PageContext;

  constructor(pageContext: PageContext) {
    this.pageContext = pageContext;
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.createDomElements();

    this.showToast("🎯 Inspetor ativado! Passe o mouse sobre o anúncio e clique para capturar (ESC para sair).");
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.removeDomElements();
  }

  private createDomElements(): void {
    if (this.backdrop) return;

    // 1. Backdrop transparente de tela cheia que intercepta 100% dos cliques reais
    // e impede redirecionamentos acidentais para páginas de anúncios
    this.backdrop = document.createElement("div");
    this.backdrop.id = "yaps-picker-backdrop";
    Object.assign(this.backdrop.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "2147483645",
      cursor: "crosshair",
      pointerEvents: "auto",
      backgroundColor: "transparent",
    });

    // 2. Caixa delimitadora de destaque visual sobre o elemento sob o mouse
    this.highlightBox = document.createElement("div");
    this.highlightBox.id = "yaps-picker-highlight";
    Object.assign(this.highlightBox.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      border: "2px dashed #ef4444",
      backgroundColor: "rgba(239, 68, 68, 0.2)",
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.15)",
      transition: "all 0.05s ease-out",
      display: "none",
    });

    // 3. Tooltip informativo fixo perto do cursor
    this.tooltip = document.createElement("div");
    this.tooltip.id = "yaps-picker-tooltip";
    Object.assign(this.tooltip.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      padding: "6px 10px",
      background: "#18181b",
      color: "#ffffff",
      fontSize: "12px",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontWeight: "500",
      borderRadius: "6px",
      boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
      border: "1px solid #3f3f46",
      display: "none",
    });

    this.backdrop.addEventListener("mousemove", this.onMouseMove);
    this.backdrop.addEventListener("click", this.onClick);
    this.backdrop.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("keydown", this.onKeyDown, true);

    document.documentElement.appendChild(this.backdrop);
    document.documentElement.appendChild(this.highlightBox);
    document.documentElement.appendChild(this.tooltip);
  }

  private removeDomElements(): void {
    if (this.backdrop) {
      this.backdrop.removeEventListener("mousemove", this.onMouseMove);
      this.backdrop.removeEventListener("click", this.onClick);
      this.backdrop.removeEventListener("contextmenu", this.onContextMenu);
      this.backdrop.remove();
      this.backdrop = null;
    }

    document.removeEventListener("keydown", this.onKeyDown, true);

    this.highlightBox?.remove();
    this.highlightBox = null;

    this.tooltip?.remove();
    this.tooltip = null;

    this.currentElement = null;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.active || !this.backdrop || !this.highlightBox || !this.tooltip) return;

    // Como o backdrop captura o cursor, busca elementos abaixo da coordenada via elementsFromPoint
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    const target = elements.find(
      (el) =>
        el !== this.backdrop &&
        el !== this.highlightBox &&
        el !== this.tooltip &&
        el !== document.documentElement &&
        el !== document.body,
    ) as HTMLElement | undefined;

    if (!target) {
      this.highlightBox.style.display = "none";
      this.tooltip.style.display = "none";
      this.currentElement = null;
      return;
    }

    this.currentElement = target;
    const rect = target.getBoundingClientRect();

    Object.assign(this.highlightBox.style, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    const tag = target.tagName.toLowerCase();
    const dim = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    this.tooltip.textContent = `🎯 <${tag}> ${dim} (Clique para capturar ad | ESC para sair)`;

    const tooltipTop = rect.top >= 36 ? rect.top - 32 : rect.bottom + 8;
    const tooltipLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 300));

    Object.assign(this.tooltip.style, {
      display: "block",
      top: `${tooltipTop}px`,
      left: `${tooltipLeft}px`,
    });
  }

  private onClick(e: MouseEvent): void {
    if (!this.active) return;

    // Interrompe 100% da propagação do clique para a página e iframes
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const element = this.currentElement;
    this.stop();

    if (!element) {
      this.showToast("Nenhum elemento selecionado.");
      return;
    }

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

    // Se nenhuma URL externa direta foi achada, tenta o script de origem atribuído
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

  private onContextMenu(e: MouseEvent): void {
    if (!this.active) return;
    e.preventDefault();
    e.stopPropagation();
    this.stop();
    this.showToast("Inspetor cancelado.");
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.stop();
      this.showToast("Inspetor cancelado.");
    }
  }

  private extractUrlsFromElement(el: HTMLElement): string[] {
    const urls: string[] = [];

    const sanitizeAndPush = (val: string | null | undefined) => {
      if (!val || typeof val !== "string") return;
      const trimmed = val.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        urls.push(trimmed);
      } else if (trimmed.startsWith("//")) {
        urls.push(`https:${trimmed}`);
      }
    };

    const checkNode = (node: Element) => {
      // 1. Atributos comuns
      sanitizeAndPush(node.getAttribute("src"));
      sanitizeAndPush(node.getAttribute("href"));
      sanitizeAndPush(node.getAttribute("data-src"));
      sanitizeAndPush(node.getAttribute("data-url"));
      sanitizeAndPush(node.getAttribute("data-target"));
      sanitizeAndPush(node.getAttribute("data-ad-client"));
      sanitizeAndPush(node.getAttribute("data-original"));
      sanitizeAndPush(node.getAttribute("data-lazy-src"));
      sanitizeAndPush(node.getAttribute("data-video-url"));
      sanitizeAndPush(node.getAttribute("data-stream-url"));
      sanitizeAndPush(node.getAttribute("data-yaps-origin"));

      // 2. Propriedades nativas de elementos específicos
      if (node instanceof HTMLIFrameElement && node.src) {
        sanitizeAndPush(node.src);
      }
      if (node instanceof HTMLVideoElement) {
        sanitizeAndPush(node.currentSrc);
        sanitizeAndPush(node.src);
      }
      if (node instanceof HTMLAudioElement) {
        sanitizeAndPush(node.currentSrc);
        sanitizeAndPush(node.src);
      }
      if (node instanceof HTMLSourceElement && node.src) {
        sanitizeAndPush(node.src);
      }
      if (node instanceof HTMLImageElement && node.currentSrc) {
        sanitizeAndPush(node.currentSrc);
      }

      // 3. Estilos computados (background-image de banners)
      try {
        const bg = window.getComputedStyle(node).backgroundImage;
        if (bg && bg !== "none") {
          const match = bg.match(/url\(['"]?((?:https?:|\/\/)[^'"]+)['"]?\)/i);
          if (match?.[1]) {
            sanitizeAndPush(match[1]);
          }
        }
      } catch {
        // Ignora erros de estilo em nós isolados
      }
    };

    // Avalia o próprio nó
    checkNode(el);

    // Avalia nós filhos (links, iframes, videos, sources, imagens)
    const children = el.querySelectorAll("a, img, iframe, script, source, video, audio, embed, object, div[data-src]");
    for (const child of children) {
      checkNode(child);
    }

    // Sobe até 6 níveis de pais para capturar links externos ou containers de ads que envolvem o elemento clicado
    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 6) {
      checkNode(parent);
      const parentMedia = parent.querySelector("iframe, video, source, a[href^='http'], a[href^='//']");
      if (parentMedia) {
        checkNode(parentMedia);
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
