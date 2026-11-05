import type {
  DetectedTarget,
  ExtensionSettings,
  PageContext,
  PairingResponse,
  ReportExtensionPayload,
} from "../shared/types";
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
    deviceName = "YAPD Sentinel Browser",
  ): Promise<PairingResponse> {
    const endpoint = this.getApiEndpoint(yapdBaseUrl, "browser-extension/pair");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pairingCode: pairingCode.trim(),
        extensionName: deviceName,
        browser: "Chrome",
        manifestVersion: 3,
        extensionVersion: "0.2.0",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Falha no pareamento com YAPD (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as PairingResponse;
    const cleanBaseUrl = yapdBaseUrl.trim().replace(/\/+$/, "").replace(/\/api$/, "");
    await extensionStorage.setState({ yapdBaseUrl: cleanBaseUrl });
    await extensionStorage.setPaired(data.accessToken, data.extensionId, data.settings);
    return data;
  }

  async sendReport(payload: ReportExtensionPayload): Promise<{ batchId: string } | null> {
    const state = await extensionStorage.getState();
    if (!state.paired || !state.token) {
      console.warn("[YAPD Sentinel] Extensão não está pareada. Relatório ignorado.");
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
      console.error(`[YAPD Sentinel] Falha ao enviar relatório (${response.status}): ${errorText}`);
      if (response.status === 401 || response.status === 403) {
        // Token revogado ou inválido
        await extensionStorage.disconnect();
      }
      return null;
    }

    return (await response.json()) as { batchId: string };
  }

  async applyBlockTarget(
    target: string,
    page: PageContext,
    targetItem?: DetectedTarget,
    kind: "exact" | "regex" = "exact",
  ): Promise<{ success: boolean; message?: string }> {
    const state = await extensionStorage.getState();
    if (!state.paired || !state.token || !state.extensionId) {
      return { success: false, message: "Extensão não conectada ao YAPD." };
    }

    const endpoint = this.getApiEndpoint(state.yapdBaseUrl, "browser-extension/detections/apply");

    const normalizedTarget = target.toLowerCase().trim();
    const payload = {
      source: "browser_extension",
      extension: {
        name: state.deviceName,
        extensionId: state.extensionId,
        version: "0.2.0",
        browser: "Chrome",
        manifestVersion: 3,
      },
      clientRequestId: `req-block-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      page: {
        url: page.url,
        domain: page.domain,
        title: state.settings.sendPageTitle ? page.title : undefined,
      },
      action: "apply_user_approved_detections",
      approvedTargets: [
        {
          candidateId: targetItem?.candidateId || `cand-manual-${Date.now()}`,
          target: normalizedTarget,
          type: "deny",
          kind,
          category: targetItem?.category || "ads",
          score: targetItem?.score || 95,
          riskLevel: targetItem?.riskLevel || "high",
          reasons: targetItem?.reasons || ["Bloqueado diretamente pelo usuário no YAPD Sentinel"],
          evidence: {
            url: targetItem?.evidence.url || page.url,
            source: targetItem?.evidence.source || "user_inspector_click",
            isThirdParty: true,
            resourceType: targetItem?.evidence.resourceType || "script",
          },
        },
      ],
    };

    try {
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
        return { success: false, message: `Erro ao aplicar bloqueio (${response.status}): ${errorText}` };
      }

      return { success: true };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
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
        if (response.status === 401 || response.status === 403) {
          console.warn(
            "[YAPD Sentinel] Token de pareamento rejeitado pelo YAPD (banco resetado ou dispositivo revogado). Desconectando.",
          );
          await extensionStorage.disconnect();
        }
        return null;
      }

      const data = (await response.json()) as { settings: ExtensionSettings };
      if (data.settings) {
        await extensionStorage.setState({ settings: { ...state.settings, ...data.settings } });
      }
      return data;
    } catch (err) {
      console.warn("[YAPD Sentinel] Erro ao sincronizar configurações do YAPD:", err);
      return null;
    }
  }
}

export const yapdApiClient = new YapdApiClient();
