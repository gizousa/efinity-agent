import { html, type TemplateResult } from "lit";
import type {
  DMPairingChannelEntry,
  DMPairingRequest,
  DMPairingState,
} from "../controllers/dm-pairing.js";

const CHANNEL_ICONS: Record<string, string> = {
  imessage: "📱",
  telegram: "✈️",
  signal: "🔵",
  whatsapp: "💬",
  discord: "🎮",
  slack: "💼",
};

function getChannelIcon(channel: string): string {
  return CHANNEL_ICONS[channel.toLowerCase()] ?? "📨";
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString();
  } catch {
    return isoString;
  }
}

function renderRequest(
  request: DMPairingRequest,
  channel: string,
  onApprove: (channel: string, code: string) => void,
  onReject: (channel: string, code: string) => void,
): TemplateResult {
  const meta = request.meta ?? {};
  const displayName = meta.name || meta.username || request.id;

  return html`
    <div class="dm-pairing-request" style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--bg-secondary, #f5f5f5);
      border-radius: 6px;
      margin-bottom: 8px;
    ">
      <div style="flex: 1;">
        <div style="font-weight: 500;">${displayName}</div>
        <div style="font-size: 0.85em; color: var(--text-muted, #666);">
          Code: <code style="
            background: var(--bg-tertiary, #e0e0e0);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
          ">${request.code}</code>
        </div>
        <div style="font-size: 0.75em; color: var(--text-muted, #888);">
          ${formatTimestamp(request.createdAt)}
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button
          @click=${() => onApprove(channel, request.code)}
          style="
            background: var(--success, #22c55e);
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
          "
        >
          ✓ Approve
        </button>
        <button
          @click=${() => onReject(channel, request.code)}
          style="
            background: var(--danger, #ef4444);
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
          "
        >
          ✗ Reject
        </button>
      </div>
    </div>
  `;
}

function renderChannelEntry(
  entry: DMPairingChannelEntry,
  onApprove: (channel: string, code: string) => void,
  onReject: (channel: string, code: string) => void,
): TemplateResult {
  const icon = getChannelIcon(entry.channel);

  return html`
    <div class="dm-pairing-channel" style="margin-bottom: 16px;">
      <div style="
        font-weight: 600;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      ">
        <span>${icon}</span>
        <span style="text-transform: capitalize;">${entry.channel}</span>
        <span style="
          background: var(--bg-tertiary, #e0e0e0);
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 0.75em;
          font-weight: normal;
        ">${entry.requests.length}</span>
      </div>
      <div class="dm-pairing-requests">
        ${entry.requests.map((req) => renderRequest(req, entry.channel, onApprove, onReject))}
      </div>
    </div>
  `;
}

export function renderDMPairing(
  state: DMPairingState,
  onApprove: (channel: string, code: string) => void,
  onReject: (channel: string, code: string) => void,
  onRefresh: () => void,
): TemplateResult {
  if (state.loading) {
    return html`
      <div style="padding: 16px; text-align: center; color: var(--text-muted, #666);">
        Loading DM pairing requests...
      </div>
    `;
  }

  if (state.error) {
    return html`
      <div style="padding: 16px; color: var(--danger, #ef4444);">
        Error: ${state.error}
        <button
          @click=${onRefresh}
          style="
            margin-left: 8px;
            background: var(--bg-secondary, #f5f5f5);
            border: 1px solid var(--border, #ddd);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
          "
        >
          Retry
        </button>
      </div>
    `;
  }

  const channels = state.list?.channels ?? [];
  const totalRequests = channels.reduce((sum, ch) => sum + ch.requests.length, 0);

  if (totalRequests === 0) {
    return html`
      <div style="padding: 16px; text-align: center; color: var(--text-muted, #666);">
        No pending DM pairing requests
      </div>
    `;
  }

  return html`
    <div class="dm-pairing-list">
      ${channels.map((entry) => renderChannelEntry(entry, onApprove, onReject))}
    </div>
  `;
}
