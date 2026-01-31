import { listPairingChannels, notifyPairingApproved } from "../../channels/plugins/pairing.js";
import { loadConfig } from "../../config/config.js";
import {
  approveChannelPairingCode,
  listChannelPairingRequests,
  rejectChannelPairingCode,
  type PairingRequest,
} from "../../pairing/pairing-store.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateDmPairApproveParams,
  validateDmPairListParams,
  validateDmPairRejectParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

type ChannelPairingEntry = {
  channel: string;
  requests: Array<{
    id: string;
    code: string;
    createdAt: string;
    lastSeenAt: string;
    meta?: Record<string, string>;
  }>;
};

export const dmPairingHandlers: GatewayRequestHandlers = {
  /**
   * List all pending DM pairing requests from all channels that support pairing.
   * Returns grouped by channel with their pending requests.
   */
  "dm.pair.list": async ({ params, respond }) => {
    if (!validateDmPairListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid dm.pair.list params: ${formatValidationErrors(validateDmPairListParams.errors)}`,
        ),
      );
      return;
    }

    const channels = listPairingChannels();
    const result: ChannelPairingEntry[] = [];

    for (const channel of channels) {
      try {
        const requests = await listChannelPairingRequests(channel);
        if (requests.length > 0) {
          result.push({
            channel,
            requests: requests.map((req: PairingRequest) => ({
              id: req.id,
              code: req.code,
              createdAt: req.createdAt,
              lastSeenAt: req.lastSeenAt,
              ...(req.meta ? { meta: req.meta } : {}),
            })),
          });
        }
      } catch {
        // Skip channels that fail to load - they may not have any pending requests
      }
    }

    respond(true, { channels: result }, undefined);
  },

  /**
   * Approve a DM pairing request by channel and code.
   * Broadcasts "dm.pair.resolved" event on success.
   */
  "dm.pair.approve": async ({ params, respond, context }) => {
    if (!validateDmPairApproveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid dm.pair.approve params: ${formatValidationErrors(validateDmPairApproveParams.errors)}`,
        ),
      );
      return;
    }

    const { channel, code } = params as { channel: string; code: string };

    // Verify channel supports pairing
    const channels = listPairingChannels();
    if (!channels.includes(channel as (typeof channels)[number])) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `channel does not support pairing: ${channel}`),
      );
      return;
    }

    // Approve the pairing code
    const result = await approveChannelPairingCode({
      channel: channel as (typeof channels)[number],
      code,
    });

    if (!result) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired pairing code"),
      );
      return;
    }

    context.logGateway.info(`dm pairing approved channel=${channel} id=${result.id} code=${code}`);

    // Notify the channel adapter that pairing was approved
    try {
      const cfg = loadConfig();
      await notifyPairingApproved({
        channelId: channel as (typeof channels)[number],
        id: result.id,
        cfg,
      });
    } catch (err) {
      context.logGateway.warn(
        `failed to notify pairing approved: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Broadcast the resolved event
    context.broadcast(
      "dm.pair.resolved",
      {
        channel,
        code,
        id: result.id,
        decision: "approved",
        ts: Date.now(),
      },
      { dropIfSlow: true },
    );

    respond(
      true,
      {
        channel,
        code,
        id: result.id,
        entry: result.entry,
      },
      undefined,
    );
  },

  /**
   * Reject a DM pairing request by channel and code.
   * Removes the request from the pending list and broadcasts "dm.pair.resolved" event.
   */
  "dm.pair.reject": async ({ params, respond, context }) => {
    if (!validateDmPairRejectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid dm.pair.reject params: ${formatValidationErrors(validateDmPairRejectParams.errors)}`,
        ),
      );
      return;
    }

    const { channel, code } = params as { channel: string; code: string };

    // Verify channel supports pairing
    const channels = listPairingChannels();
    if (!channels.includes(channel as (typeof channels)[number])) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `channel does not support pairing: ${channel}`),
      );
      return;
    }

    // Reject the pairing code (removes from pending list, does NOT add to allowFrom)
    const result = await rejectChannelPairingCode({
      channel: channel as (typeof channels)[number],
      code,
    });

    if (!result) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired pairing code"),
      );
      return;
    }

    context.logGateway.info(`dm pairing rejected channel=${channel} id=${result.id} code=${code}`);

    // Broadcast the resolved event
    context.broadcast(
      "dm.pair.resolved",
      {
        channel,
        code,
        id: result.id,
        decision: "rejected",
        ts: Date.now(),
      },
      { dropIfSlow: true },
    );

    respond(
      true,
      {
        channel,
        code,
        id: result.id,
      },
      undefined,
    );
  },
};
