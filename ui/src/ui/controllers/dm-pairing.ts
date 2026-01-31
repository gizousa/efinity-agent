import type { GatewayBrowserClient } from "../gateway-browser-client.js";

export type DMPairingRequest = {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
};

export type DMPairingChannelEntry = {
  channel: string;
  requests: DMPairingRequest[];
};

export type DMPairingList = {
  channels: DMPairingChannelEntry[];
};

export type DMPairingState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  list: DMPairingList | null;
};

export function createDMPairingState(): DMPairingState {
  return {
    client: null,
    connected: false,
    loading: false,
    error: null,
    list: null,
  };
}

export async function loadDMPairing(
  state: DMPairingState,
  opts?: { quiet?: boolean },
): Promise<void> {
  if (!state.client || !state.connected) {
    state.error = "Not connected";
    return;
  }

  if (!opts?.quiet) {
    state.loading = true;
    state.error = null;
  }

  try {
    const result = await state.client.request("dm.pair.list", {});
    if (result.ok && result.result) {
      state.list = result.result as DMPairingList;
      state.error = null;
    } else {
      state.error = result.error?.message ?? "Failed to load DM pairing requests";
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
  }
}

export async function approveDMPairing(
  state: DMPairingState,
  channel: string,
  code: string,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    state.error = "Not connected";
    return false;
  }

  try {
    const result = await state.client.request("dm.pair.approve", { channel, code });
    if (result.ok) {
      await loadDMPairing(state, { quiet: true });
      return true;
    }
    state.error = result.error?.message ?? "Failed to approve pairing";
    return false;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    return false;
  }
}

export async function rejectDMPairing(
  state: DMPairingState,
  channel: string,
  code: string,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    state.error = "Not connected";
    return false;
  }

  try {
    const result = await state.client.request("dm.pair.reject", { channel, code });
    if (result.ok) {
      await loadDMPairing(state, { quiet: true });
      return true;
    }
    state.error = result.error?.message ?? "Failed to reject pairing";
    return false;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    return false;
  }
}
