import { yapdApiClient } from "../background/api-client";
import { extensionStorage } from "../background/storage";
import type { DetectedTarget } from "../shared/types";

const connectionBadge = document.getElementById("connection-badge") as HTMLElement;
const pairingSection = document.getElementById("pairing-section") as HTMLElement;
const activeSection = document.getElementById("active-section") as HTMLElement;

const yapdUrlInput = document.getElementById("yapd-url") as HTMLInputElement;
const pairingCodeInput = document.getElementById("pairing-code") as HTMLInputElement;
const btnPair = document.getElementById("btn-pair") as HTMLButtonElement;

// Abas
const tabBtnSentinel = document.getElementById("tab-btn-sentinel") as HTMLButtonElement;
const tabBtnSettings = document.getElementById("tab-btn-settings") as HTMLButtonElement;
const tabContentSentinel = document.getElementById("tab-content-sentinel") as HTMLElement;
const tabContentSettings = document.getElementById("tab-content-settings") as HTMLElement;

// Elementos da Aba Sentinela
const statCurrentDomain = document.getElementById("stat-current-domain") as HTMLElement;
const statDetectedCount = document.getElementById("stat-detected-count") as HTMLElement;
const btnStartPicker = document.getElementById("btn-start-picker") as HTMLButtonElement;
const btnSaveAnalysis = document.getElementById("btn-save-analysis") as HTMLButtonElement;
const btnOpenYapd = document.getElementById("btn-open-yapd") as HTMLButtonElement;
const labelScoreThreshold = document.getElementById("label-score-threshold") as HTMLElement;
const targetsListContainer = document.getElementById("targets-list") as HTMLElement;

// Elementos da Aba Configurações
const cfgYapdUrl = document.getElementById("cfg-yapd-url") as HTMLInputElement;
const cfgToken = document.getElementById("cfg-token") as HTMLInputElement;
const btnToggleToken = document.getElementById("btn-toggle-token") as HTMLButtonElement | null;
const cfgMinScore = document.getElementById("cfg-min-score") as HTMLInputElement;
const cfgAutoSend = document.getElementById("cfg-auto-send") as HTMLInputElement;
const btnSaveConfig = document.getElementById("btn-save-config") as HTMLButtonElement;
const btnDisconnect = document.getElementById("btn-disconnect") as HTMLButtonElement;

let currentActiveTabId: number | undefined;
let currentActiveTabUrl: string | undefined;
let currentActiveTabDomain: string | undefined;

function switchTab(tab: "sentinel" | "settings"): void {
  if (tab === "sentinel") {
    tabBtnSentinel.classList.add("active");
    tabBtnSettings.classList.remove("active");
    tabContentSentinel.style.display = "block";
    tabContentSettings.style.display = "none";
  } else {
    tabBtnSettings.classList.add("active");
    tabBtnSentinel.classList.remove("active");
    tabContentSettings.style.display = "block";
    tabContentSentinel.style.display = "none";
  }
}

tabBtnSentinel?.addEventListener("click", () => switchTab("sentinel"));
tabBtnSettings?.addEventListener("click", () => switchTab("settings"));

btnToggleToken?.addEventListener("click", () => {
  if (cfgToken.type === "password") {
    cfgToken.type = "text";
    btnToggleToken.textContent = "🙈";
  } else {
    cfgToken.type = "password";
    btnToggleToken.textContent = "👁️";
  }
});

async function render(): Promise<void> {
  const state = await extensionStorage.getState();

  if (state.paired && state.token) {
    connectionBadge.textContent = "Conectado";
    connectionBadge.className = "badge connected";
    pairingSection.style.display = "none";
    activeSection.style.display = "block";

    const threshold = state.settings.minScoreThreshold ?? 30;
    if (labelScoreThreshold) {
      labelScoreThreshold.textContent = String(threshold);
    }

    // Preenche campos de configurações
    cfgYapdUrl.value = state.yapdBaseUrl || "http://localhost:3000";
    cfgToken.value = state.token;
    cfgToken.type = "password";
    if (btnToggleToken) btnToggleToken.textContent = "👁️";
    cfgMinScore.value = String(threshold);
    cfgAutoSend.checked = Boolean(state.settings.autoSendToYapd);

    // Obtém dados da aba ativa
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        currentActiveTabId = tab?.id;
        let pageDomain = "";

        if (tab?.url) {
          currentActiveTabUrl = tab.url;
          try {
            const parsed = new URL(tab.url);
            pageDomain = parsed.hostname;
            currentActiveTabDomain = pageDomain;
            statCurrentDomain.textContent = pageDomain;
          } catch {
            statCurrentDomain.textContent = "-";
          }
        }

        // Pede resumo de detecções para o background informando a aba ativa
        chrome.runtime.sendMessage(
          { type: "GET_PAGE_SUMMARY", pageDomain, tabId: currentActiveTabId },
          (summary) => {
            const count = summary?.count ?? 0;
            statDetectedCount.textContent = String(count);

            if (summary?.savedToYapd) {
              btnSaveAnalysis.textContent = "✓ Análise Salva no YAPD";
              btnSaveAnalysis.classList.remove("btn-success");
              btnSaveAnalysis.classList.add("btn-outline");
            } else {
              btnSaveAnalysis.textContent = "📤 Salvar Análise no YAPD";
              btnSaveAnalysis.classList.remove("btn-outline");
              btnSaveAnalysis.classList.add("btn-success");
            }

            renderTargetsList(summary?.targets || [], threshold);
          },
        );
      });
    }
  } else {
    connectionBadge.textContent = "Desconectado";
    connectionBadge.className = "badge disconnected";
    pairingSection.style.display = "block";
    activeSection.style.display = "none";
    yapdUrlInput.value = state.yapdBaseUrl || "http://localhost:3000";
  }
}

function renderTargetsList(targets: DetectedTarget[], minScore: number): void {
  if (!targetsListContainer) return;

  const filtered = targets.filter((t) => t.score >= minScore);

  if (filtered.length === 0) {
    targetsListContainer.innerHTML =
      '<p class="empty-targets">Nenhum alvo de anúncio detectado nesta aba.</p>';
    return;
  }

  targetsListContainer.innerHTML = "";

  for (const item of filtered) {
    const row = document.createElement("div");
    row.className = "target-row";

    const info = document.createElement("div");
    info.className = "target-info";

    const domain = document.createElement("span");
    domain.className = "target-domain";
    domain.textContent = item.target;

    const meta = document.createElement("div");
    meta.className = "target-meta";
    meta.innerHTML = `
      <span style="color: ${item.score >= 70 ? "#ef4444" : "#f59e0b"}; font-weight: 600;">${item.score} pts</span>
      <span style="color: #a1a1aa;">${item.category}</span>
    `;

    info.appendChild(domain);
    info.appendChild(meta);

    const btnBlock = document.createElement("button");
    btnBlock.className = "btn-quick-block";

    if (item.isBlocked) {
      btnBlock.textContent = "✓ Bloqueado";
      btnBlock.disabled = true;
      btnBlock.classList.add("blocked");
    } else {
      btnBlock.textContent = "Bloquear";
      btnBlock.addEventListener("click", () => {
        btnBlock.disabled = true;
        btnBlock.textContent = "Bloqueando...";

        chrome.runtime.sendMessage(
          {
            type: "QUICK_BLOCK_TARGET",
            target: item.target,
            tabId: currentActiveTabId,
            page: {
              url: currentActiveTabUrl || `https://${currentActiveTabDomain || "sentinel.local"}`,
              domain: currentActiveTabDomain || "sentinel.local",
            },
          },
          (res) => {
            if (res?.success) {
              item.isBlocked = true;
              btnBlock.textContent = "✓ Bloqueado";
              btnBlock.classList.add("blocked");
            } else {
              btnBlock.disabled = false;
              btnBlock.textContent = "Bloquear";
              alert(`Falha ao bloquear: ${res?.message || "erro de rede"}`);
            }
          },
        );
      });
    }

    row.appendChild(info);
    row.appendChild(btnBlock);
    targetsListContainer.appendChild(row);
  }
}

btnPair?.addEventListener("click", async () => {
  const baseUrl = yapdUrlInput.value.trim();
  const code = pairingCodeInput.value.trim();

  if (!baseUrl || !code) {
    alert("Por favor, preencha a URL do YAPD e o código de pareamento.");
    return;
  }

  btnPair.disabled = true;
  btnPair.textContent = "Conectando...";

  try {
    await yapdApiClient.pair(baseUrl, code);
    await render();
  } catch (err) {
    alert((err as Error).message);
  } finally {
    btnPair.disabled = false;
    btnPair.textContent = "Conectar ao YAPD";
  }
});

btnStartPicker?.addEventListener("click", () => {
  if (typeof chrome !== "undefined" && chrome.tabs) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: "START_ELEMENT_PICKER" }, () => {
          window.close(); // Fecha popup para o usuário interagir com o site
        });
      }
    });
  }
});

btnSaveAnalysis?.addEventListener("click", () => {
  if (!currentActiveTabId) return;

  btnSaveAnalysis.disabled = true;
  btnSaveAnalysis.textContent = "Salvando...";

  chrome.runtime.sendMessage(
    { type: "SAVE_PAGE_ANALYSIS_TO_YAPD", tabId: currentActiveTabId },
    (res) => {
      btnSaveAnalysis.disabled = false;
      if (res?.success) {
        btnSaveAnalysis.textContent = "✓ Análise Salva no YAPD";
        btnSaveAnalysis.classList.remove("btn-success");
        btnSaveAnalysis.classList.add("btn-outline");
      } else {
        btnSaveAnalysis.textContent = "📤 Salvar Análise no YAPD";
        alert("Não há dados pendentes ou falha ao salvar no YAPD.");
      }
    },
  );
});

btnOpenYapd?.addEventListener("click", async () => {
  const state = await extensionStorage.getState();
  const rootUrl = state.yapdBaseUrl.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const url = `${rootUrl}/browser-extension`;
  if (typeof chrome !== "undefined" && chrome.tabs) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
});

btnSaveConfig?.addEventListener("click", async () => {
  const token = cfgToken.value.trim();
  const baseUrl = cfgYapdUrl.value.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const minScore = Number.parseInt(cfgMinScore.value, 10) || 30;
  const autoSend = cfgAutoSend.checked;

  // Se o token for apagado e deixado vazio, remove a integração!
  if (!token) {
    if (confirm("O token está vazio. Deseja remover a integração com o YAPD?")) {
      await extensionStorage.disconnect();
      await render();
    }
    return;
  }

  const state = await extensionStorage.getState();
  await extensionStorage.setState({
    yapdBaseUrl: baseUrl || state.yapdBaseUrl,
    token,
    paired: true,
    settings: {
      ...state.settings,
      minScoreThreshold: minScore,
      autoSendToYapd: autoSend,
    },
  });

  alert("Configurações salvas com sucesso!");
  switchTab("sentinel");
  await render();
});

btnDisconnect?.addEventListener("click", async () => {
  if (confirm("Deseja realmente desconectar esta extensão do YAPD?")) {
    await extensionStorage.disconnect();
    await render();
  }
});

// Inicialização
render().catch(console.error);
