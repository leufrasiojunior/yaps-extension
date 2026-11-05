import { yapdApiClient } from "../background/api-client";
import { extensionStorage } from "../background/storage";

const connectionBadge = document.getElementById("connection-badge") as HTMLElement;
const pairingSection = document.getElementById("pairing-section") as HTMLElement;
const activeSection = document.getElementById("active-section") as HTMLElement;

const yapdUrlInput = document.getElementById("yapd-url") as HTMLInputElement;
const pairingCodeInput = document.getElementById("pairing-code") as HTMLInputElement;
const btnPair = document.getElementById("btn-pair") as HTMLButtonElement;

const statCurrentDomain = document.getElementById("stat-current-domain") as HTMLElement;
const statDetectedCount = document.getElementById("stat-detected-count") as HTMLElement;

const btnStartPicker = document.getElementById("btn-start-picker") as HTMLButtonElement;
const btnOpenYapd = document.getElementById("btn-open-yapd") as HTMLButtonElement;
const toggleActiveInspection = document.getElementById(
  "toggle-active-inspection",
) as HTMLInputElement;
const btnDisconnect = document.getElementById("btn-disconnect") as HTMLButtonElement;

async function render(): Promise<void> {
  const state = await extensionStorage.getState();

  if (state.paired && state.token) {
    connectionBadge.textContent = "Conectado";
    connectionBadge.className = "badge connected";
    pairingSection.style.display = "none";
    activeSection.style.display = "block";
    toggleActiveInspection.checked = state.activeInspectionEnabled;

    // Obtem dados da aba ativa
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        let pageDomain = "";
        if (tab?.url) {
          try {
            const parsed = new URL(tab.url);
            pageDomain = parsed.hostname;
            statCurrentDomain.textContent = pageDomain;
          } catch {
            statCurrentDomain.textContent = "-";
          }
        }

        // Pede resumo de deteccoes para o background informando o dominio da aba ativa
        chrome.runtime.sendMessage({ type: "GET_PAGE_SUMMARY", pageDomain }, (summary) => {
          if (summary?.count !== undefined) {
            statDetectedCount.textContent = String(summary.count);
          }
        });
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
          window.close(); // Fecha popup para o usuario interagir com a pagina
        });
      }
    });
  }
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

toggleActiveInspection?.addEventListener("change", async () => {
  await extensionStorage.setState({ activeInspectionEnabled: toggleActiveInspection.checked });
});

btnDisconnect?.addEventListener("click", async () => {
  if (confirm("Deseja realmente desconectar esta extensão do YAPD?")) {
    await extensionStorage.disconnect();
    await render();
  }
});

// Inicializacao
render().catch(console.error);
