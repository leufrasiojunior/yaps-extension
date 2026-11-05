// Script executado no contexto MAIN da pagina (world: "MAIN")
// Instrumenta APIs nativas de forma puramente observadora e 100% compativel com Trusted Types e CSP restrita

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
        if (match && !match[1].includes("yaps") && !match[1].includes("content-main")) {
          return match[1];
        }
      }
    }
    return undefined;
  }

  function notifyInjection(url: string, type: "script" | "iframe", initiator?: string) {
    if (
      !url ||
      typeof url !== "string" ||
      url.startsWith("javascript:") ||
      url.startsWith("about:") ||
      url.startsWith("blob:")
    ) {
      return;
    }

    try {
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
    } catch {
      // Ignora em caso de isolamento extremo
    }
  }

  // Intercepta document.createElement para anotar caller origin sem modificar propriedades nativas
  const originalCreateElement = document.createElement.bind(document);

  document.createElement = (<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: ElementCreationOptions,
  ): HTMLElementTagNameMap[K] => {
    const element = originalCreateElement(tagName, options);
    const tagLower = String(tagName).toLowerCase();

    if (tagLower === "script" || tagLower === "iframe") {
      try {
        const stack = new Error().stack;
        const caller = extractCallerScript(stack);
        if (caller && element.dataset) {
          element.dataset.yapsOrigin = caller;
        }
      } catch {
        // Ignora silenciosamente para nunca quebrar a aplicacao
      }
    }

    return element;
  }) as typeof document.createElement;

  // Intercepta Node.prototype.appendChild de forma puramente passiva (sem mutar argumentos)
  const originalAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function <T extends Node>(node: T): T {
    try {
      if (node instanceof HTMLElement) {
        const tag = node.tagName.toLowerCase();
        if (tag === "script" || tag === "iframe") {
          const src = node.getAttribute("src") || (node as unknown as HTMLScriptElement).src;
          const origin = node.dataset?.yapsOrigin;
          if (src && typeof src === "string") {
            notifyInjection(src, tag as "script" | "iframe", origin || undefined);
          }
        }
      }
    } catch {
      // Nunca quebra a aplicacao que chamou appendChild
    }
    return originalAppendChild.call(this, node) as T;
  };

  console.debug("[YAPS] Main World DOM hooks ativos (Trusted Types safe).");
})();
