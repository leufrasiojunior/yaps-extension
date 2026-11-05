// Script executado no contexto MAIN da pagina (world: "MAIN")
// Instrumenta APIs nativas para detectar criacao e insercao dinamica de scripts e iframes via JS

(() => {
  if ((window as unknown as { __yaps_main_injected?: boolean }).__yaps_main_injected) {
    return;
  }
  (window as unknown as { __yaps_main_injected?: boolean }).__yaps_main_injected = true;

  function extractCallerScript(stack: string | undefined): string | undefined {
    if (!stack) return undefined;
    const lines = stack.split("\n");
    for (const line of lines) {
      if (line.includes("http://") || line.includes("https://")) {
        const match = line.match(/(https?:\/\/[^\s:)]+)/);
        if (match && !match[1].includes("yaps") && !match[1].includes("main-injector")) {
          return match[1];
        }
      }
    }
    return undefined;
  }

  function notifyInjection(url: string, type: "script" | "iframe", initiator?: string) {
    if (!url || url.startsWith("javascript:") || url.startsWith("about:")) {
      return;
    }

    window.postMessage(
      {
        source: "YAPS_MAIN_INJECTOR",
        type: "DYNAMIC_INJECTION",
        url,
        resourceType: type,
        initiator,
        timestamp: Date.now(),
      },
      "*",
    );
  }

  // Intercepta document.createElement
  const originalCreateElement = document.createElement.bind(document);

  document.createElement = (<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: ElementCreationOptions,
  ): HTMLElementTagNameMap[K] => {
    const element = originalCreateElement(tagName, options);
    const tagLower = String(tagName).toLowerCase();

    if (tagLower === "script" || tagLower === "iframe") {
      const stack = new Error().stack;
      const caller = extractCallerScript(stack);
      if (caller) {
        element.setAttribute("data-yaps-origin", caller);
      }

      // Intercepta atribuicao da propriedade .src
      let currentSrc = "";
      Object.defineProperty(element, "src", {
        get() {
          return currentSrc;
        },
        set(val: string) {
          currentSrc = String(val);
          element.setAttribute("src", currentSrc);
          notifyInjection(currentSrc, tagLower as "script" | "iframe", caller);
        },
        configurable: true,
      });
    }

    return element;
  }) as typeof document.createElement;

  // Intercepta Node.prototype.appendChild e insertBefore para capturar tags anexadas
  const originalAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function <T extends Node>(node: T): T {
    if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();
      if (tag === "script" || tag === "iframe") {
        const src = node.getAttribute("src");
        const origin = node.getAttribute("data-yaps-origin");
        if (src) {
          notifyInjection(src, tag as "script" | "iframe", origin || undefined);
        }
      }
    }
    return originalAppendChild.call(this, node) as T;
  };

  console.debug("[YAPS] Main World DOM hooks ativados.");
})();
