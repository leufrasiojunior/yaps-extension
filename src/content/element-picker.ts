import { calculateDomPathHash, extractHostname, extractMainDomain } from "../shared/domain-utils";
import type { PageContext } from "../shared/types";

export class ElementPicker {
  private active = false;
  private backdrop: HTMLDivElement | null = null;
  private highlightBox: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private reviewModal: HTMLDivElement | null = null;
  private pageContext: PageContext;
  private originalWindowOpen: typeof window.open | null = null;

  constructor(pageContext: PageContext) {
    this.pageContext = pageContext;
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onCapturePointerEvent = this.onCapturePointerEvent.bind(this);
    this.onCaptureClick = this.onCaptureClick.bind(this);
  }

  start(): void {
    if (this.active) return;
    this.active = true;

    // 1. Desarma temporariamente window.open para impedir popunders/popups invasivos
    this.originalWindowOpen = window.open;
    try {
      window.open = () => {
        console.warn("[YAPD Sentinel] Popup bloqueado preventivamente durante o modo de inspeção.");
        return null;
      };
    } catch {
      // Ignora se não for sobrescritível
    }

    // 2. Cria elementos visuais
    this.createDomElements();

    // 3. Registra interceptadores globais na fase de captura (topo absoluto do DOM)
    // Impede que scripts de anúncios capturem mousedown, pointerdown, click e abram novas abas
    window.addEventListener("pointerdown", this.onCapturePointerEvent, true);
    window.addEventListener("mousedown", this.onCapturePointerEvent, true);
    window.addEventListener("pointerup", this.onCapturePointerEvent, true);
    window.addEventListener("mouseup", this.onCapturePointerEvent, true);
    window.addEventListener("auxclick", this.onCapturePointerEvent, true);
    window.addEventListener("dblclick", this.onCapturePointerEvent, true);
    window.addEventListener("click", this.onCaptureClick, true);
    window.addEventListener("contextmenu", this.onContextMenu, true);
    document.addEventListener("keydown", this.onKeyDown, true);

    this.showToast("🎯 YAPD Sentinel: Clique no anúncio para revisar e bloquear (ESC para cancelar).");
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;

    // 1. Restaura window.open original
    if (this.originalWindowOpen) {
      try {
        window.open = this.originalWindowOpen;
      } catch {
        // Ignora
      }
      this.originalWindowOpen = null;
    }

    // 2. Remove interceptadores globais de captura
    window.removeEventListener("pointerdown", this.onCapturePointerEvent, true);
    window.removeEventListener("mousedown", this.onCapturePointerEvent, true);
    window.removeEventListener("pointerup", this.onCapturePointerEvent, true);
    window.removeEventListener("mouseup", this.onCapturePointerEvent, true);
    window.removeEventListener("auxclick", this.onCapturePointerEvent, true);
    window.removeEventListener("dblclick", this.onCapturePointerEvent, true);
    window.removeEventListener("click", this.onCaptureClick, true);
    window.removeEventListener("contextmenu", this.onContextMenu, true);
    document.removeEventListener("keydown", this.onKeyDown, true);

    // 3. Remove elementos visuais
    this.removeDomElements();
  }

  private onCapturePointerEvent(e: Event): void {
    if (!this.active) return;

    // Se o evento for dentro do reviewModal ou de um toast do YAPD, permite interação normal
    const target = e.target as HTMLElement | null;
    if (target && (target.closest("#yapd-sentinel-review-modal") || target.closest(".yapd-sentinel-toast"))) {
      return;
    }

    // Neutraliza qualquer tentativa do site/anúncio de disparar popup no pointerdown/mousedown
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  private onCaptureClick(e: MouseEvent): void {
    if (!this.active) return;

    // Se o clique for dentro do reviewModal ou de um toast, permite
    const target = e.target as HTMLElement | null;
    if (target && (target.closest("#yapd-sentinel-review-modal") || target.closest(".yapd-sentinel-toast"))) {
      return;
    }

    // Bloqueia a navegação e propagação do clique
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Apenas clique esquerdo seleciona o elemento
    if (e.button !== 0) return;

    const element = this.pickElementFromPoint(e.clientX, e.clientY);
    if (!element) return;

    this.selectAndReviewElement(element);
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
      zIndex: "2147483645",
      cursor: "crosshair",
      pointerEvents: "auto",
      backgroundColor: "transparent",
    });

    this.highlightBox = document.createElement("div");
    this.highlightBox.id = "yapd-sentinel-highlight";
    Object.assign(this.highlightBox.style, {
      position: "fixed",
      zIndex: "2147483646",
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
      zIndex: "2147483647",
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

    document.documentElement.appendChild(this.backdrop);
    document.documentElement.appendChild(this.highlightBox);
    document.documentElement.appendChild(this.tooltip);
  }

  private removeDomElements(): void {
    if (this.backdrop) {
      this.backdrop.removeEventListener("mousemove", this.onMouseMove);
      this.backdrop.remove();
      this.backdrop = null;
    }

    this.highlightBox?.remove();
    this.highlightBox = null;

    this.tooltip?.remove();
    this.tooltip = null;

    this.reviewModal?.remove();
    this.reviewModal = null;
  }

  private pickElementFromPoint(clientX: number, clientY: number): HTMLElement | null {
    const elements = document.elementsFromPoint(clientX, clientY);
    const target = elements.find(
      (el) =>
        el !== this.backdrop &&
        el !== this.highlightBox &&
        el !== this.tooltip &&
        el !== this.reviewModal &&
        !el.classList.contains("yapd-sentinel-toast") &&
        el !== document.documentElement &&
        el !== document.body,
    ) as HTMLElement | undefined;

    return target || null;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.active || !this.backdrop || !this.highlightBox || !this.tooltip) return;

    const target = this.pickElementFromPoint(e.clientX, e.clientY);

    if (!target) {
      this.highlightBox.style.display = "none";
      this.tooltip.style.display = "none";
      return;
    }

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

    // Identifica se é um overlay invasivo cobrindo a maior parte da tela
    const isFullScreenOverlay =
      rect.width >= window.innerWidth * 0.75 &&
      rect.height >= window.innerHeight * 0.75 &&
      (window.getComputedStyle(target).position === "fixed" ||
        window.getComputedStyle(target).position === "absolute");

    if (isFullScreenOverlay) {
      this.tooltip.textContent = `🚨 [Overlay / Popunder Invasivo Detectado] <${tag}> ${dim} (Clique para bloquear ou remover)`;
      this.highlightBox.style.borderColor = "#f59e0b";
      this.highlightBox.style.backgroundColor = "rgba(245, 158, 11, 0.25)";
    } else {
      this.tooltip.textContent = `🎯 <${tag}> ${dim} (Clique para revisar e bloquear)`;
      this.highlightBox.style.borderColor = "#ef4444";
      this.highlightBox.style.backgroundColor = "rgba(239, 68, 68, 0.18)";
    }

    const tooltipTop = rect.top >= 36 ? rect.top - 32 : rect.bottom + 8;
    const tooltipLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 300));

    Object.assign(this.tooltip.style, {
      display: "block",
      top: `${tooltipTop}px`,
      left: `${tooltipLeft}px`,
    });
  }

  private selectAndReviewElement(element: HTMLElement): void {
    // Remove backdrop interativo e tooltip de hover para liberar a tela para o modal
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
      if (host) {
        const main = extractMainDomain(host);
        if (main && !candidateDomains.includes(main)) {
          candidateDomains.push(main);
        }
      }
    }

    // Se nenhuma URL direta foi achada, tenta o script de origem data-yaps-origin
    const origin = element.getAttribute("data-yaps-origin");
    if (origin) {
      const originHost = extractHostname(origin);
      if (originHost) {
        const originMain = extractMainDomain(originHost);
        if (originMain && !candidateDomains.includes(originMain)) {
          candidateDomains.push(originMain);
        }
      }
    }

    // Abre o Modal de Revisão na tela
    this.openReviewModal(element, candidateDomains);
  }

  private openReviewModal(element: HTMLElement, candidateDomains: string[]): void {
    this.reviewModal?.remove();

    const tag = element.tagName.toLowerCase();
    const rect = element.getBoundingClientRect();
    const defaultDomain = candidateDomains[0] || "";

    const isFullScreenOverlay =
      rect.width >= window.innerWidth * 0.75 &&
      rect.height >= window.innerHeight * 0.75 &&
      (window.getComputedStyle(element).position === "fixed" ||
        window.getComputedStyle(element).position === "absolute");

    const modal = document.createElement("div");
    modal.id = "yapd-sentinel-review-modal";
    Object.assign(modal.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: "2147483647",
      width: "min(460px, calc(100vw - 32px))",
      backgroundColor: "#18181b",
      color: "#ffffff",
      borderRadius: "10px",
      boxShadow: "0 20px 40px rgba(0, 0, 0, 0.7)",
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

      ${
        isFullScreenOverlay
          ? `
        <div style="background-color: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; font-size: 12px; color: #fbbf24;">
          ⚠️ <strong>Overlay Invasivo Detectado:</strong> Este elemento cobre a maior parte da tela e intercepta cliques. Você pode bloqueá-lo no Pi-hole ou removê-lo da página imediatamente.
        </div>
      `
          : ""
      }

      <div style="background-color: #27272a; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; font-size: 12px;">
        <div style="color: #a1a1aa; margin-bottom: 2px;">Elemento inspecionado:</div>
        <div style="font-family: monospace; color: #f43f5e; font-weight: 500;">
          &lt;${tag}&gt; (${Math.round(rect.width)}x${Math.round(rect.height)}px)
        </div>
        ${element.id ? `<div style="color: #71717a; font-family: monospace;">#${element.id}</div>` : ""}
        ${element.className && typeof element.className === "string" ? `<div style="color: #71717a; font-family: monospace; font-size: 11px; max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">.${element.className.trim().split(/\s+/).join(".")}</div>` : ""}
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
          <input id="yapd-input-domain" type="text" value="${defaultDomain}" placeholder="ex: adnetwork.com" style="width: 100%; box-sizing: border-box; padding: 8px 10px; background-color: #09090b; border: 1px solid #3f3f46; color: #ffffff; border-radius: 6px; font-family: monospace; font-size: 13px;" />
        `
        }
        ${
          candidateDomains.length === 0
            ? `<div style="color: #a1a1aa; font-size: 11px; margin-top: 4px;">Nenhum domínio explícito encontrado nos atributos. Digite o domínio acima ou remova o elemento.</div>`
            : ""
        }
      </div>

      <div style="display: flex; gap: 8px; justify-content: space-between; align-items: center;">
        <button id="yapd-btn-remove-elem" style="padding: 8px 12px; border-radius: 6px; background-color: #27272a; border: 1px solid #3f3f46; color: #f43f5e; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 4px;" title="Remove este elemento do HTML para destravar a navegação imediatamente">
          <span>🗑️</span>
          <span>Remover da tela</span>
        </button>

        <div style="display: flex; gap: 8px;">
          <button id="yapd-btn-cancel" style="padding: 8px 14px; border-radius: 6px; background-color: transparent; border: 1px solid #3f3f46; color: #ffffff; cursor: pointer; font-size: 13px;">
            Cancelar
          </button>
          <button id="yapd-btn-block" style="padding: 8px 14px; border-radius: 6px; background-color: #dc2626; border: none; color: #ffffff; font-weight: 600; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 6px;">
            <span>🛡️</span>
            <span>Bloquear no Pi-hole</span>
          </button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(modal);
    this.reviewModal = modal;

    const btnClose = modal.querySelector("#yapd-btn-modal-close");
    const btnCancel = modal.querySelector("#yapd-btn-cancel");
    const btnRemoveElem = modal.querySelector("#yapd-btn-remove-elem");
    const btnBlock = modal.querySelector("#yapd-btn-block") as HTMLButtonElement;

    const closeHandler = () => {
      this.stop();
    };

    btnClose?.addEventListener("click", closeHandler);
    btnCancel?.addEventListener("click", closeHandler);

    // Botão para remover o elemento invasivo da tela
    btnRemoveElem?.addEventListener("click", () => {
      try {
        element.remove();
        this.showToast("🗑️ Elemento removido da página com sucesso!");
      } catch {
        element.style.display = "none";
        this.showToast("🗑️ Elemento ocultado com sucesso!");
      }
      this.stop();
    });

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
        alert("Por favor, informe um domínio para bloquear.");
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
    e.stopImmediatePropagation();
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
      } else if (trimmed.includes("://") || trimmed.includes(".")) {
        // Tenta regex de URL se tiver código inline ou texto com URL
        const matches = trimmed.match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/[^\s'"\)\]<>]*)?/gi);
        if (matches) {
          for (const m of matches) {
            urls.push(m.startsWith("//") ? `https:${m}` : m);
          }
        }
      }
    };

    const checkNode = (node: Element) => {
      // Atributos de mídia e links
      sanitizeAndPush(node.getAttribute("src"));
      sanitizeAndPush(node.getAttribute("href"));
      sanitizeAndPush(node.getAttribute("data-src"));
      sanitizeAndPush(node.getAttribute("data-url"));
      sanitizeAndPush(node.getAttribute("data-target"));
      sanitizeAndPush(node.getAttribute("data-href"));
      sanitizeAndPush(node.getAttribute("data-link"));
      sanitizeAndPush(node.getAttribute("data-target-url"));
      sanitizeAndPush(node.getAttribute("data-popup"));
      sanitizeAndPush(node.getAttribute("data-click"));
      sanitizeAndPush(node.getAttribute("data-redirect"));
      sanitizeAndPush(node.getAttribute("data-ad-client"));
      sanitizeAndPush(node.getAttribute("data-video-url"));
      sanitizeAndPush(node.getAttribute("data-yaps-origin"));

      // Atributos de evento inline (onde popunders frequentemente colocam window.open)
      sanitizeAndPush(node.getAttribute("onclick"));
      sanitizeAndPush(node.getAttribute("onmousedown"));
      sanitizeAndPush(node.getAttribute("onpointerdown"));

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
      if (node instanceof HTMLAnchorElement && node.href) {
        sanitizeAndPush(node.href);
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

    const children = el.querySelectorAll("a, img, iframe, script, source, video, audio, embed, object, div[data-src], div[data-url], div[data-href]");
    for (const child of children) {
      checkNode(child);
    }

    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 6) {
      checkNode(parent);
      const parentMedia = parent.querySelector("iframe, video, source, a[href^='http'], a[href^='//'], a[href*='.']");
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
    toast.className = "yapd-sentinel-toast";
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
      pointerEvents: "none",
    });
    toast.textContent = message;
    document.documentElement.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 3000);
    }, 3500);
  }
}
