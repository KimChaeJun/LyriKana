type ElectronRelayResponse = {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
};

function canUseExtensionElectronRelay(): boolean {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.id && chrome.runtime.sendMessage)
  );
}

export async function postElectronRequest(
  path: string,
  payload: unknown
): Promise<unknown | null> {
  try {
    if (!canUseExtensionElectronRelay()) return null;
    const response = (await chrome.runtime.sendMessage({
      type: "LYRIKANA_ELECTRON_REQUEST",
      path,
      body: JSON.stringify(payload),
    })) as ElectronRelayResponse | undefined;
    return response?.ok ? response.payload ?? null : null;
  } catch {
    return null;
  }
}

export async function requestElectronData<T>(
  path: string,
  payload: unknown
): Promise<T | null> {
  const response = (await postElectronRequest(path, payload)) as
    | { ok?: boolean; data?: T }
    | null;
  return response?.ok ? response.data ?? null : null;
}
