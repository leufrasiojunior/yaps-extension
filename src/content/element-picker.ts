import { calculateDomPathHash, extractHostname, extractMainDomain } from "../shared/domain-utils";
import type { PageContext } from "../shared/types";

export class ElementPicker {
  private active = false;
  private modalOpen = false;
  private backdrop: HTMLDivElement | null = null;
  private highlightBox: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private modalHost: HTMLElement | null = null;
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
    this.modalOpen = false;

    // 1. Desarma temporariamente window.open para impedir que popunders/anúncios invasivos abram abas
    this.originalWindowOpen = window.open;
    try {
      window.open = () => {
        console.warn("[YAPD Sentinel] Popup bloqueado preventivamente durante o modo de inspeção.");
        return null;
      };
    } catch {
      // Ignora se não for sobrescritível
    }

    // 2. Cria elementos visuais de seleção (backdrop, highlightBox, tooltip)
    this.createDomElements();

    // 3. Registra interceptadores globais na fase de captura (topo absoluto da árvore do DOM)
    // Isso garante que NENHUM script de anúncio da página capture o ponteiro antes da extensão
    this.attachCaptureListeners();

    this.showToast("🎯 YAPD Sentinel: Clique no anúncio para revisar e bloquear (ESC para cancelar).");
  }

  stop(): void {
    if (!this.active && !this.modalOpen) return;
    this.active = false;
    this.modalOpen = false;

    // 1. Restaura window.open original
    if (this.originalWindowOpen) {
      try {
        window.open = this.originalWindowOpen;
      } catch {
        // Ignora
      }
      this.originalWindowOpen = null;
    }

    // 2. Remove todos os listeners
    this.detachCaptureListeners();
    document.removeEventListener("keydown", this.onKeyDown, true);

    // 3. Remove todos os elementos da UI
    this.removeDomElements();
  }

  private attachCaptureListeners(): void {
    window.addEventListener("pointerdown", this.onCapturePointerEvent, true);
    window.addEventListener("mousedown", this.onCapturePointerEvent, true);
    window.addEventListener("pointerup", this.onCapturePointerEvent, true);
    window.addEventListener("mouseup", this.onCapturePointerEvent, true);
    window.addEventListener("auxclick", this.onCapturePointerEvent, true);
    window.addEventListener("dblclick", this.onCapturePointerEvent, true);
    window.addEventListener("click", this.onCaptureClick, true);
    window.addEventListener("contextmenu", this.onContextMenu, true);
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  private detachCaptureListeners(): void {
    window.removeEventListener("pointerdown", this.onCapturePointerEvent, true);
    window.removeEventListener("mousedown", this.onCapturePointerEvent, true);
    window.removeEventListener("pointerup", this.onCapturePointerEvent, true);
    window.removeEventListener("mouseup", this.onCapturePointerEvent, true);
    window.removeEventListener("auxclick", this.onCapturePointerEvent, true);
    window.removeEventListener("dblclick", this.onCapturePointerEvent, true);
    window.removeEventListener("click", this.onCaptureClick, true);
    window.removeEventListener("contextmenu", this.onContextMenu, true);
  }

  private onCapturePointerEvent(e: Event): void {
    if (!this.active || this.modalOpen) return;

    // Neutraliza qualquer tentativa do site/anúncio de disparar popup no pointerdown/mousedown
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  private onCaptureClick(e: MouseEvent): void {
    if (!this.active || this.modalOpen) return;

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

    this.modalHost?.remove();
    this.modalHost = null;
  }

  private pickElementFromPoint(clientX: number, clientY: number): HTMLElement | null {
    const elements = document.elementsFromPoint(clientX, clientY);
    const target = elements.find(
      (el) =>
        el !== this.backdrop &&
        el !== this.highlightBox &&
        el !== this.tooltip &&
        el !== this.modalHost &&
        !el.classList.contains("yapd-sentinel-toast") &&
        el !== document.documentElement &&
        el !== document.body,
    ) as HTMLElement | undefined;

    return target || null;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.active || this.modalOpen || !this.backdrop || !this.highlightBox || !this.tooltip) return;

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
      this.tooltip.textContent = `🚨 [Overlay Invasivo Detectado] <${tag}> ${dim} (Clique para bloquear ou remover)`;
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
    // Transiciona para o modo de modal: pausa a captura de hover na página
    this.modalOpen = true;
    this.detachCaptureListeners();

    // Mantém o keydown para ESC fechar o modal
    document.addEventListener("keydown", this.onKeyDown, true);

    // Remove backdrop interativo de hover e tooltip
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }

    // Se o elemento for um overlay cobrindo a tela inteira, desativa temporariamente seus pointer-events
    // para que ele não capture cliques direcionados ao modal
    try {
      element.style.setProperty("pointer-events", "none", "important");
    } catch {
      // Ignora
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

    // Abre o Modal com Shadow DOM Isolado na frente de qualquer elemento da página
    this.openReviewModalWithShadowDom(element, candidateDomains);
  }

  private openReviewModalWithShadowDom(element: HTMLElement, candidateDomains: string[]): void {
    this.modalHost?.remove();

    const tag = element.tagName.toLowerCase();
    const rect = element.getBoundingClientRect();
    const defaultDomain = candidateDomains[0] || "";

    const isFullScreenOverlay =
      rect.width >= window.innerWidth * 0.75 &&
      rect.height >= window.innerHeight * 0.75 &&
      (window.getComputedStyle(element).position === "fixed" ||
        window.getComputedStyle(element).position === "absolute");

    // Cria o Host com Shadow DOM isolado
    const host = document.createElement("yapd-sentinel-host");
    host.id = "yapd-sentinel-host";
    Object.assign(host.style, {
      all: "initial",
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "2147483647",
      pointerEvents: "auto",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const shadow = host.attachShadow({ mode: "open" });

    // CSS e HTML encapsulados e imunes aos estilos e scripts da página
    shadow.innerHTML = `
      <style>
        :host {
          all: initial !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
          box-sizing: border-box !important;
        }
        *, *::before, *::after {
          box-sizing: border-box !important;
          margin: 0;
          padding: 0;
        }
        .backdrop-overlay {
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          background: rgba(0, 0, 0, 0.75) !important;
          backdrop-filter: blur(4px) !important;
          z-index: 1 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .modal-card {
          position: relative !important;
          z-index: 2 !important;
          width: min(480px, calc(100vw - 32px)) !important;
          background: #18181b !important;
          color: #f4f4f5 !important;
          border-radius: 12px !important;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px #3f3f46 !important;
          padding: 22px !important;
          font-size: 14px !important;
          line-height: 1.5 !important;
        }
        .header {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          margin-bottom: 16px !important;
        }
        .title {
          font-size: 16px !important;
          font-weight: 600 !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          color: #ffffff !important;
        }
        .btn-close {
          background: transparent !important;
          border: none !important;
          color: #a1a1aa !important;
          cursor: pointer !important;
          font-size: 18px !important;
          padding: 4px 8px !important;
          border-radius: 6px !important;
          transition: background 0.15s !important;
        }
        .btn-close:hover {
          background: #27272a !important;
          color: #ffffff !important;
        }
        .overlay-banner {
          background: rgba(245, 158, 11, 0.15) !important;
          border: 1px solid rgba(245, 158, 11, 0.4) !important;
          border-radius: 8px !important;
          padding: 10px 12px !important;
          margin-bottom: 14px !important;
          font-size: 12px !important;
          color: #fbbf24 !important;
        }
        .element-preview {
          background: #27272a !important;
          border-radius: 8px !important;
          padding: 12px !important;
          margin-bottom: 16px !important;
          font-size: 12px !important;
          border: 1px solid #3f3f46 !important;
        }
        .element-label {
          color: #a1a1aa !important;
          font-size: 11px !important;
          text-transform: uppercase !important;
          letter-spacing: 0.05em !important;
          margin-bottom: 4px !important;
        }
        .element-tag {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
          color: #f43f5e !important;
          font-weight: 600 !important;
        }
        .element-id-class {
          color: #a1a1aa !important;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
          font-size: 11px !important;
          margin-top: 2px !important;
          word-break: break-all !important;
        }
        .form-group {
          margin-bottom: 18px !important;
        }
        .form-label {
          display: block !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          color: #d4d4d8 !important;
          margin-bottom: 6px !important;
        }
        .input-text, .select-domain {
          width: 100% !important;
          background: #09090b !important;
          border: 1px solid #3f3f46 !important;
          color: #ffffff !important;
          border-radius: 8px !important;
          padding: 9px 12px !important;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
          font-size: 13px !important;
          outline: none !important;
          transition: border-color 0.15s !important;
        }
        .input-text:focus, .select-domain:focus {
          border-color: #ef4444 !important;
        }
        .actions-bar {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 10px !important;
          margin-top: 20px !important;
        }
        .btn {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 6px !important;
          padding: 9px 16px !important;
          border-radius: 8px !important;
          font-size: 13px !important;
          font-weight: 500 !important;
          cursor: pointer !important;
          border: none !important;
          transition: all 0.15s !important;
        }
        .btn-cancel {
          background: transparent !important;
          border: 1px solid #3f3f46 !important;
          color: #d4d4d8 !important;
        }
        .btn-cancel:hover {
          background: #27272a !important;
          color: #ffffff !important;
        }
        .btn-remove {
          background: #27272a !important;
          border: 1px solid #ef4444 !important;
          color: #f87171 !important;
        }
        .btn-remove:hover {
          background: rgba(239, 68, 68, 0.2) !important;
          color: #ffffff !important;
        }
        .btn-block {
          background: #dc2626 !important;
          color: #ffffff !important;
          font-weight: 600 !important;
        }
        .btn-block:hover {
          background: #b91c1c !important;
        }
        .btn:disabled {
          opacity: 0.6 !important;
          cursor: not-allowed !important;
        }
      </style>

      <div class="backdrop-overlay" id="yapd-backdrop-click">
        <div class="modal-card" id="yapd-modal-card">
          <div class="header">
            <div class="title">
              <span>🎯</span>
              <span>YAPD Sentinel - Revisar Alvo</span>
            </div>
            <button class="btn-close" id="yapd-btn-close" title="Fechar">✕</button>
          </div>

          ${
            isFullScreenOverlay
              ? `
            <div class="overlay-banner">
              🚨 <strong>Overlay Invasivo Detectado:</strong> Este elemento cobre a maior parte da tela e intercepta cliques. Você pode bloqueá-lo no Pi-hole ou removê-lo da página imediatamente.
            </div>
          `
              : ""
          }

          <div class="element-preview">
            <div class="element-label">Elemento Inspecionado</div>
            <div class="element-tag">&lt;${tag}&gt; (${Math.round(rect.width)}x${Math.round(rect.height)}px)</div>
            ${element.id ? `<div class="element-id-class">#${element.id}</div>` : ""}
            ${
              element.className && typeof element.className === "string"
                ? `<div class="element-id-class">.${element.className.trim().split(/\s+/).slice(0, 5).join(".")}</div>`
                : ""
            }
          </div>

          <div class="form-group">
            <label class="form-label">Domínio para Bloquear no Pi-hole:</label>
            ${
              candidateDomains.length > 1
                ? `
              <select class="select-domain" id="yapd-select-domain">
                ${candidateDomains.map((d) => `<option value="${d}">${d}</option>`).join("")}
              </select>
            `
                : `
              <input class="input-text" id="yapd-input-domain" type="text" value="${defaultDomain}" placeholder="ex: adnetwork.com" />
            `
            }
            ${
              candidateDomains.length === 0
                ? `<div style="color: #a1a1aa; font-size: 11px; margin-top: 6px;">Nenhum domínio explícito encontrado nos atributos. Digite o domínio acima ou remova o elemento invasivo da tela.</div>`
                : ""
            }
          </div>

          <div class="actions-bar">
            <button class="btn btn-remove" id="yapd-btn-remove" title="Remove este elemento do HTML para destravar a navegação imediatamente">
              <span>🗑️</span>
              <span>Remover da tela</span>
            </button>

            <div style="display: flex; gap: 8px;">
              <button class="btn btn-cancel" id="yapd-btn-cancel">Cancelar</button>
              <button class="btn btn-block" id="yapd-btn-block">
                <span>🛡️</span>
                <span>Bloquear no Pi-hole</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Anexa no topo absoluto do documento HTML
    (document.documentElement || document.body).appendChild(host);
    this.modalHost = host;

    // Configura manipuladores de eventos dentro da Shadow Root
    const btnClose = shadow.getElementById("yapd-btn-close");
    const btnCancel = shadow.getElementById("yapd-btn-cancel");
    const btnRemove = shadow.getElementById("yapd-btn-remove");
    const btnBlock = shadow.getElementById("yapd-btn-block") as HTMLButtonElement | null;
    const modalCard = shadow.getElementById("yapd-modal-card");

    const closeHandler = () => {
      this.stop();
    };

    btnClose?.addEventListener("click", closeHandler);
    btnCancel?.addEventListener("click", closeHandler);

    // Impede que cliques dentro do card do modal fechem o modal
    modalCard?.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Botão de remoção do elemento invasivo
    btnRemove?.addEventListener("click", () => {
      try {
        element.remove();
        this.showToast("🗑️ Elemento removido da página com sucesso!");
      } catch {
        element.style.display = "none";
        this.showToast("🗑️ Elemento ocultado com sucesso!");
      }
      this.stop();
    });

    // Botão de bloqueio direto no Pi-hole
    btnBlock?.addEventListener("click", async () => {
      let targetDomain = defaultDomain;
      const select = shadow.getElementById("yapd-select-domain") as HTMLSelectElement | null;
      const input = shadow.getElementById("yapd-input-domain") as HTMLInputElement | null;

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
    if (!this.active || this.modalOpen) return;
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
    (document.documentElement || document.body).appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 3000);
    }, 3500);
  }
}
