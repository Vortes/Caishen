"use client";

import type { PlaidLinkMetadata } from "~/lib/plaid-link-metadata";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { loadPlaid, type PlaidHandler } from "./plaid-link-sdk";
import {
  clearPlaidLinkSession,
  plaidCanonicalOrigin,
  plaidReceivedRedirectUri,
  readPlaidLinkSession,
  savePlaidLinkSession,
  type PlaidLinkSession,
} from "./plaid-link-session";

type Phase = "idle" | "loading" | "link" | "saving" | "syncing" | "complete";
type FlowState = {
  phase: Phase;
  error: string;
  message: string;
  saved: boolean;
  needsSync: boolean;
  connectionId?: string;
  canonicalOrigin?: string;
};
const initial: FlowState = {
  phase: "idle",
  error: "",
  message: "",
  saved: false,
  needsSync: false,
};
const failureMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export function usePlaidLink() {
  const { isLoaded, userId } = useAuth();
  const utils = api.useUtils();
  const token = api.budget.plaidLinkToken.useMutation();
  const exchange = api.budget.plaidExchange.useMutation();
  const reconnect = api.budget.plaidReconnect.useMutation();
  const sync = api.budget.sync.useMutation();
  const [state, setState] = useState<FlowState>(initial);
  const generation = useRef(0);
  const busy = useRef(false);
  const handler = useRef<PlaidHandler | null>(null);
  const operations = useRef({ token, exchange, reconnect, sync, utils });
  operations.current = { token, exchange, reconnect, sync, utils };

  const cancel = useCallback(() => {
    generation.current += 1;
    busy.current = false;
    const previous = handler.current;
    handler.current = null;
    previous?.destroy();
  }, []);

  useEffect(() => cancel, [cancel, userId]);

  const open = useCallback(
    async (
      session: PlaidLinkSession,
      storage: Storage,
      current: number,
      receivedRedirectUri?: string,
    ) => {
      const sdk = await loadPlaid();
      if (generation.current !== current) return;
      let finished = false;
      const release = () => {
        const previous = handler.current;
        handler.current = null;
        previous?.destroy();
      };
      const finish = async (
        publicToken: string,
        metadata: PlaidLinkMetadata,
      ) => {
        let saved = Boolean(session.connectionId);
        try {
          setState((value) => ({ ...value, phase: "saving" }));
          const result = session.connectionId
            ? await operations.current.reconnect.mutateAsync({
                connectionId: session.connectionId,
              })
            : await operations.current.exchange.mutateAsync({
                publicToken,
                metadata,
              });
          saved = true;
          if (generation.current !== current) return;
          setState((value) => ({
            ...value,
            saved: true,
            phase: "syncing",
            connectionId: result.id,
          }));
          await operations.current.sync.mutateAsync();
          await operations.current.utils.budget.invalidate();
          if (generation.current === current)
            setState((value) => ({
              ...value,
              phase: "complete",
              needsSync: false,
              message: result.warning
                ? `Bank connection saved. ${result.warning}`
                : "Bank connected. Name your accounts to add them to Cash or Credit. Transactions can take a few minutes to become available.",
            }));
        } catch (error) {
          if (saved) {
            await operations.current.utils.budget
              .invalidate()
              .catch(() => undefined);
          }
          if (generation.current === current)
            setState((value) => ({
              ...value,
              phase: saved ? "complete" : "idle",
              saved,
              needsSync: saved,
              error: saved
                ? `Your bank connection is saved, but its activity could not update. ${failureMessage(error, "Try updating again.")}`
                : failureMessage(
                    error,
                    "The bank connection could not be saved. Try connecting again.",
                  ),
            }));
        } finally {
          if (generation.current === current) busy.current = false;
        }
      };
      handler.current = sdk.create({
        token: session.linkToken,
        ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
        onSuccess: (publicToken, metadata) => {
          if (finished || generation.current !== current) return;
          finished = true;
          clearPlaidLinkSession(storage, session.linkToken);
          release();
          void finish(publicToken, metadata);
        },
        onExit: (error) => {
          if (finished || generation.current !== current) return;
          finished = true;
          clearPlaidLinkSession(storage, session.linkToken);
          release();
          busy.current = false;
          setState((value) => ({
            ...value,
            phase: "idle",
            error: error
              ? (error.display_message ??
                error.error_message ??
                "Your bank connection ended before completion. Try again.")
              : "",
            message: error
              ? ""
              : "Bank connection canceled. You can connect again when you’re ready.",
          }));
        },
      });
      setState((value) => ({ ...value, phase: "link" }));
      handler.current.open();
    },
    [],
  );

  const start = useCallback(
    async (connectionId?: string) => {
      if (!userId || busy.current) return;
      busy.current = true;
      const current = ++generation.current;
      setState({ ...initial, phase: "loading", connectionId });
      let pendingSession: { storage: Storage; linkToken: string } | undefined;
      try {
        const storage = window.localStorage;
        const result = await operations.current.token.mutateAsync(
          connectionId ? { connectionId } : undefined,
        );
        if (generation.current !== current) return;
        const canonicalOrigin = plaidCanonicalOrigin(
          result.redirectUri,
          window.location.origin,
        );
        if (canonicalOrigin) {
          busy.current = false;
          setState({
            ...initial,
            canonicalOrigin,
            error:
              "Open Caishen at its bank connection address before connecting. Your bank needs to return to the same site where you started.",
          });
          return;
        }
        const session: PlaidLinkSession = {
          version: 1,
          linkToken: result.linkToken,
          expiration: result.expiration,
          userId,
          ...(connectionId ? { connectionId } : {}),
        };
        savePlaidLinkSession(storage, session);
        pendingSession = { storage, linkToken: session.linkToken };
        await open(session, storage, current);
      } catch (error) {
        if (generation.current !== current) return;
        if (pendingSession)
          clearPlaidLinkSession(
            pendingSession.storage,
            pendingSession.linkToken,
          );
        cancel();
        setState({
          ...initial,
          error: failureMessage(
            error,
            "Your bank connection could not start. Try again.",
          ),
        });
      }
    },
    [cancel, open, userId],
  );

  const resume = useCallback(async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    const current = ++generation.current;
    setState({ ...initial, phase: "loading" });
    try {
      // Allow effect cleanup to cancel an initial Strict Mode resume before it clears storage.
      await Promise.resolve();
      if (generation.current !== current) return;
      const storage = window.localStorage;
      const stored = readPlaidLinkSession(storage, userId);
      if (!stored.session) throw new Error(stored.error);
      const redirectUri = plaidReceivedRedirectUri(window.location.href);
      setState((value) => ({
        ...value,
        connectionId: stored.session.connectionId,
      }));
      await open(stored.session, storage, current, redirectUri);
    } catch (error) {
      if (generation.current !== current) return;
      cancel();
      setState({
        ...initial,
        error: failureMessage(
          error,
          "Your bank connection could not resume. Return to your budget and connect again.",
        ),
      });
    }
  }, [cancel, open, userId]);

  const retrySync = useCallback(async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    const current = ++generation.current;
    setState((value) => ({
      ...value,
      phase: "syncing",
      error: "",
      message: "",
    }));
    try {
      await operations.current.sync.mutateAsync();
      await operations.current.utils.budget.invalidate();
      if (generation.current === current)
        setState((value) => ({
          ...value,
          phase: "complete",
          needsSync: false,
          message:
            "Bank activity updated. Check your review inbox. New transactions may take a few minutes to become available.",
        }));
    } catch (error) {
      if (generation.current === current)
        setState((value) => ({
          ...value,
          phase: "complete",
          needsSync: true,
          error: failureMessage(
            error,
            "Bank activity could not update. Try again.",
          ),
        }));
    } finally {
      if (generation.current === current) busy.current = false;
    }
  }, [userId]);

  return {
    ...state,
    isLoaded,
    userId,
    busy: !["idle", "complete"].includes(state.phase),
    start,
    resume,
    retrySync,
    cancel,
  };
}
