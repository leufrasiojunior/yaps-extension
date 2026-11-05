import { calculateDomPathHash, extractHostname } from "../shared/domain-utils";
import type { PageContext } from "../shared/types";

export class ElementPicker {
  private active = false;
  private backdrop: HTMLDivElement | null = null;
  private highlightBox: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private reviewModal: HTMLDivElement | null = null;
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

    this.showToast("🎯 YAPD Sentinel: Clique no anúncio para revisar e bloquear (ESC para cancelar).");
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.removeDomElements();
  }

  private createDomElements(): void {
    if (this.backdrop) return;

    this.backdrop = document.createElement("div");
    this.backdrop.id = "yapd-sentinel-backdrop";
    Object.assign(this.backdrop.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "2147483640",
      cursor: "crosshair",
      pointerEvents: "auto",
      backgroundColor: "transparent",
    });

    this.highlightBox = document.createElement("div");
    this.highlightBox.id = "yapd-sentinel-highlight";
    Object.assign(this.highlightBox.style, {
      position: "fixed",
      zIndex: "2147483641",
      pointerEvents: "none",
      border: "2px dashed #ef4444",
      backgroundColor: "rgba(239, 68, 68, 0.18)",
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.15)",
      transition: "all 0.05s ease-out",
      display: "none",
    });

    this.tooltip = document.createElement("div");
    this.tooltip.id = "yapd-sentinel-tooltip";
    Object.assign(this.tooltip.style, {
      position: "fixed",
      zIndex: "2147483642",
      pointerEvents: "none",
      padding: "6px 12px",
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

    this.reviewModal?.remove();
    this.reviewModal = null;

    this.currentElement = null;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.active || !this.backdrop || !this.highlightBox || !this.tooltip) return;

    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    const target = elements.find(
      (el) =>
        el !== this.backdrop &&
        el !== this.highlightBox &&
        el !== this.tooltip &&
        el !== this.reviewModal &&
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
    this.tooltip.textContent = `🎯 <${tag}> ${dim} (Clique para revisar e bloquear)`;

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

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const element = this.currentElement;
    if (!element) return;

    // Desativa captura do mouse e remove tooltip/backdrop, mas MANTÉM o highlightBox destacando o elemento
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }

    // Extrai URLs do elemento clicado
    const extractedUrls = this.extractUrlsFromElement(element);
    const candidateDomains: string[] = [];

    for (const url of extractedUrls) {
      const host = extractHostname(url);
      if (host && !candidateDomains.includes(host)) {
        candidateDomains.push(host);
      }
    }

    // Se nenhuma URL direta foi achada, tenta o script de origem
    const origin = element.getAttribute("data-yaps-origin");
    if (origin) {
      const originHost = extractHostname(origin);
      if (originHost && !candidateDomains.includes(originHost)) {
        candidateDomains.push(originHost);
      }
    }

    if (candidateDomains.length === 0) {
      this.showToast("⚠️ Nenhum domínio terceiro identificado neste elemento.");
      this.stop();
      return;
    }

    // Abre o Modal de Revisão na tela para o usuário confirmar antes de aplicar
    this.openReviewModal(element, candidateDomains);
  }

  private openReviewModal(element: HTMLElement, candidateDomains: string[]): void {
    this.reviewModal?.remove();

    const tag = element.tagName.toLowerCase();
    const rect = element.getBoundingClientRect();
    const defaultDomain = candidateDomains[0];

    const modal = document.createElement("div");
    modal.id = "yapd-sentinel-review-modal";
    Object.assign(modal.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: "2147483647",
      width: "min(440px, calc(100vw - 32px))",
      backgroundColor: "#18181b",
      color: "#ffffff",
      borderRadius: "10px",
      boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
      border: "1px solid #3f3f46",
      padding: "20px",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "14px",
    });

    modal.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
        <div style="font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 6px;">
          <span>🎯</span>
          <span>YAPD Sentinel - Revisar Alvo</span>
        </div>
        <button id="yapd-btn-modal-close" style="background: none; border: none; color: #a1a1aa; cursor: pointer; font-size: 18px; padding: 2px 6px;">✕</button>
      </div>

      <div style="background-color: #27272a; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; font-size: 12px;">
        <div style="color: #a1a1aa; margin-bottom: 2px;">Elemento destacado na página:</div>
        <div style="font-family: monospace; color: #f43f5e; font-weight: 500;">
          &lt;${tag}&gt; (${Math.round(rect.width)}x${Math.round(rect.height)}px)
        </div>
        ${element.id ? `<div style="color: #71717a; font-family: monospace;">#${element.id}</div>` : ""}
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 12px; font-weight: 500; color: #d4d4d8; margin-bottom: 6px;">
          Domínio a ser bloqueado no Pi-hole:
        </label>
        ${
          candidateDomains.length > 1
            ? `
          <select id="yapd-select-domain" style="width: 100%; padding: 8px 10px; background-color: #09090b; border: 1px solid #3f3f46; color: #ffffff; border-radius: 6px; font-family: monospace; font-size: 13px;">
            ${candidateDomains.map((d) => `<option value="${d}">${d}</option>`).join("")}
          </select>
        `
            : `
          <input id="yapd-input-domain" type="text" value="${defaultDomain}" style="width: 100%; box-sizing: border-box; padding: 8px 10px; background-color: #09090b; border: 1px solid #3f3f46; color: #ffffff; border-radius: 6px; font-family: monospace; font-size: 13px;" />
        `
        }
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="yapd-btn-cancel" style="padding: 8px 14px; border-radius: 6px; background-color: transparent; border: 1px solid #3f3f46; color: #ffffff; cursor: pointer; font-size: 13px;">
          Cancelar
        </button>
        <button id="yapd-btn-block" style="padding: 8px 14px; border-radius: 6px; background-color: #dc2626; border: none; color: #ffffff; font-weight: 600; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 6px;">
          <span>🛡️</span>
          <span>Bloquear no Pi-hole</span>
        </button>
      </div>
    `;

    document.documentElement.appendChild(modal);
    this.reviewModal = modal;

    const btnClose = modal.querySelector("#yapd-btn-modal-close");
    const btnCancel = modal.querySelector("#yapd-btn-cancel");
    const btnBlock = modal.querySelector("#yapd-btn-block") as HTMLButtonElement;

    const closeHandler = () => {
      this.stop();
    };

    btnClose?.addEventListener("click", closeHandler);
    btnCancel?.addEventListener("click", closeHandler);

    btnBlock?.addEventListener("click", async () => {
      let targetDomain = defaultDomain;
      const select = modal.querySelector("#yapd-select-domain") as HTMLSelectElement | null;
      const input = modal.querySelector("#yapd-input-domain") as HTMLInputElement | null;

      if (select) {
        targetDomain = select.value;
      } else if (input) {
        targetDomain = input.value.trim();
      }

      if (!targetDomain) {
        return;
      }

      btnBlock.disabled = true;
      btnBlock.textContent = "Bloqueando no Pi-hole...";

      if (typeof chrome !== "undefined" && chrome.runtime) {
        chrome.runtime.sendMessage(
          {
            type: "QUICK_BLOCK_TARGET",
            target: targetDomain,
            kind: "exact",
            domPathHash: calculateDomPathHash(element),
            page: this.pageContext,
          },
          (res) => {
            this.stop();
            if (res?.success) {
              this.showToast(`🛡️ Domínio ${targetDomain} bloqueado no Pi-hole com sucesso!`);
            } else {
              this.showToast(`⚠️ Não foi possível bloquear: ${res?.message || "erro de conexão"}`);
            }
          },
        );
      } else {
        this.stop();
      }
    });
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
      sanitizeAndPush(node.getAttribute("src"));
      sanitizeAndPush(node.getAttribute("href"));
      sanitizeAndPush(node.getAttribute("data-src"));
      sanitizeAndPush(node.getAttribute("data-url"));
      sanitizeAndPush(node.getAttribute("data-target"));
      sanitizeAndPush(node.getAttribute("data-ad-client"));
      sanitizeAndPush(node.getAttribute("data-video-url"));
      sanitizeAndPush(node.getAttribute("data-yaps-origin"));

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

      try {
        const bg = window.getComputedStyle(node).backgroundImage;
        if (bg && bg !== "none") {
          const match = bg.match(/url\(['"]?((?:https?:|\/\/)[^'"]+)['"]?\)/i);
          if (match?.[1]) {
            sanitizeAndPush(match[1]);
          }
        }
      } catch {
        // Ignora
      }
    };

    checkNode(el);

    const children = el.querySelectorAll("a, img, iframe, script, source, video, audio, embed, object, div[data-src]");
    for (const child of children) {
      checkNode(child);
    }

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
      setTimeout(() => toast.remove(), 3000);
    }, 3500);
  }
}
