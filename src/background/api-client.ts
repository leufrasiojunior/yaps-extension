import type { ExtensionSettings, PairingResponse, ReportExtensionPayload } from "../shared/types";
import { extensionStorage } from "./storage";

export class YapdApiClient {
  private getApiEndpoint(baseUrl: string, relativePath: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    const baseWithApi = trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
    const cleanPath = relativePath.replace(/^\/+/, "");
    return `${baseWithApi}/${cleanPath}`;
  }

  async pair(
    yapdBaseUrl: string,
    pairingCode: string,
    deviceName = "YAPS Chrome Sentinel",
  ): Promise<PairingResponse> {
    const endpoint = this.getApiEndpoint(yapdBaseUrl, "browser-extension/pair");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pairingCode: pairingCode.trim().toUpperCase(),
        device: {
          name: deviceName,
          browser: "Chrome",
          manifestVersion: 3,
          extensionVersion: "0.1.0",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Falha no pareamento com YAPD (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as PairingResponse;
    const cleanBaseUrl = yapdBaseUrl.trim().replace(/\/+$/, "").replace(/\/api$/, "");
    await extensionStorage.setState({ yapdBaseUrl: cleanBaseUrl });
    await extensionStorage.setPaired(data.token, data.id, data.settings);
    return data;
  }

  async sendReport(payload: ReportExtensionPayload): Promise<{ batchId: string } | null> {
    const state = await extensionStorage.getState();
    if (!state.paired || !state.token) {
      console.warn("[YAPS] Extensão não está pareada. Relatório ignorado.");
      return null;
    }

    const endpoint = this.getApiEndpoint(state.yapdBaseUrl, "browser-extension/detections/report");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[YAPS] Falha ao enviar relatório (${response.status}): ${errorText}`);
      if (response.status === 401 || response.status === 403) {
        // Token revogado ou inválido
        await extensionStorage.disconnect();
      }
      return null;
    }

    return (await response.json()) as { batchId: string };
  }

  async fetchConfig(): Promise<{ settings: ExtensionSettings } | null> {
    const state = await extensionStorage.getState();
    if (!state.paired || !state.token) {
      return null;
    }

    const endpoint = this.getApiEndpoint(state.yapdBaseUrl, "browser-extension/config");

    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${state.token}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { settings: ExtensionSettings };
      if (data.settings) {
        await extensionStorage.setState({ settings: data.settings });
      }
      return data;
    } catch (err) {
      console.warn("[YAPS] Erro ao sincronizar configurações do YAPD:", err);
      return null;
    }
  }
}

export const yapdApiClient = new YapdApiClient();
