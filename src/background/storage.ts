import { DEFAULT_STORAGE_STATE } from "../shared/constants";
import type { ExtensionSettings, ExtensionStorageState } from "../shared/types";

const STORAGE_KEY = "yaps_extension_state";

export class ExtensionStorage {
  private inMemoryFallback: ExtensionStorageState = { ...DEFAULT_STORAGE_STATE };

  async getState(): Promise<ExtensionStorageState> {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      if (data?.[STORAGE_KEY]) {
        return {
          ...DEFAULT_STORAGE_STATE,
          ...data[STORAGE_KEY],
          settings: {
            ...DEFAULT_STORAGE_STATE.settings,
            ...data[STORAGE_KEY].settings,
          },
        };
      }
    }
    return this.inMemoryFallback;
  }

  async setState(partial: Partial<ExtensionStorageState>): Promise<ExtensionStorageState> {
    const current = await this.getState();
    const updated: ExtensionStorageState = {
      ...current,
      ...partial,
      settings: {
        ...current.settings,
        ...(partial.settings || {}),
      },
    };

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: updated });
    } else {
      this.inMemoryFallback = updated;
    }

    return updated;
  }

  async setPaired(token: string, extensionId: string, settings?: ExtensionSettings): Promise<void> {
    await this.setState({
      paired: true,
      token,
      extensionId,
      settings: settings || DEFAULT_STORAGE_STATE.settings,
    });
  }

  async disconnect(): Promise<void> {
    await this.setState({
      paired: false,
      token: null,
      extensionId: null,
    });
  }
}

export const extensionStorage = new ExtensionStorage();
