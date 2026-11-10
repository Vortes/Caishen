"use client";

import type { PlaidLinkMetadata } from "~/lib/plaid-link-metadata";

import { useAuth } from "@clerk/nextjs";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type RouterOutputs } from "~/trpc/react";
import { loadPlaid, type PlaidHandler } from "./plaid-link-sdk";
import {
  clearPlaidLinkSession,
  plaidCanonicalOrigin,
  plaidReceivedRedirectUri,
  readPlaidLinkSession,
  savePlaidLinkSession,
  type PlaidLinkSession,
} from "./plaid-link-session";

// Each step of connecting a bank, carrying only what that step needs. The
// connection id is the one being reconnected until a save names the result.
type FlowState =
  | { step: "idle" }
  // Ended without saving anything, for the reason the member is told.
  | { step: "failed"; error: string }
  // Plaid returns only to `origin`, so the flow has to start there.
  | { step: "elsewhere"; origin: string; error: string }
  | { step: "loading"; connectionId?: string }
  | { step: "link"; connectionId?: string }
  // Plaid finished on accounts an existing connection may already cover.
  | {
      step: "review";
      review: RouterOutputs["budget"]["plaidLinkReview"];
      error?: string;
    }
  | { step: "saving"; connectionId?: string }
  | { step: "syncing"; connectionId: string }
  | { step: "connected"; connectionId: string }
  // Saved, but its first update failed; the member can retry.
  | { step: "syncFailed"; connectionId: string; error: string };
const initial: FlowState = { step: "idle" };
// Ending without a reason to give is ending idle.
const failed = (error: string): FlowState =>
  error ? { step: "failed", error } : initial;
const failureMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export function usePlaidLink() {
  const { isLoaded, userId } = useAuth();
  const utils = api.useUtils();
  const token = api.budget.plaidLinkToken.useMutation();
  const exchange = api.budget.plaidExchange.useMutation();
  const review = api.budget.plaidLinkReview.useMutation();
  const reconnect = api.budget.plaidReconnect.useMutation();
  const linkExit = api.budget.plaidLinkExit.useMutation();
  const sync = api.budget.sync.useMutation();
  const [state, setState] = useState<FlowState>(initial);
  const generation = useRef(0);
  const busy = useRef(false);
  const handler = useRef<PlaidHandler | null>(null);
  const pendingReview = useRef<((reviewId: string) => Promise<void>) | null>(
    null,
  );
  const operations = useRef({
    token,
    review,
    exchange,
    reconnect,
    linkExit,
    sync,
    utils,
  });
  operations.current = {
    token,
    review,
    exchange,
    reconnect,
    linkExit,
    sync,
    utils,
  };

  const cancel = useCallback(() => {
    generation.current += 1;
    pendingReview.current = null;
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
        reviewId?: string,
      ) => {
        // The saved connection: the one reconnecting, or the exchange's.
        let saved = session.connectionId;
        try {
          setState({ step: "saving", connectionId: session.connectionId });
          if (!session.connectionId && !reviewId) {
            const checked = await operations.current.review.mutateAsync({
              metadata,
            });
            if (generation.current !== current) return;
            if (checked.connections.length) {
              pendingReview.current = (confirmed) =>
                finish(publicToken, metadata, confirmed);
              setState({ step: "review", review: checked });
              return;
            }
            reviewId = checked.reviewId;
          }
          const result = session.connectionId
            ? await operations.current.reconnect.mutateAsync({
                connectionId: session.connectionId,
                metadata,
              })
            : await operations.current.exchange.mutateAsync({
                publicToken,
                metadata,
                reviewId,
              });
          saved = result.id;
          pendingReview.current = null;
          if (generation.current !== current) return;
          setState({ step: "syncing", connectionId: result.id });
          await operations.current.sync.mutateAsync();
          await operations.current.utils.budget.invalidate();
          if (generation.current === current)
            setState({ step: "connected", connectionId: result.id });
        } catch (error) {
          if (
            !saved &&
            reviewId &&
            error instanceof TRPCClientError &&
            (error.data as { code?: unknown } | undefined)?.code === "CONFLICT"
          ) {
            try {
              const checked = await operations.current.review.mutateAsync({
                metadata,
                recordCompletion: false,
              });
              if (generation.current !== current) return;
              pendingReview.current = (confirmed) =>
                finish(publicToken, metadata, confirmed);
              setState({
                step: "review",
                review: checked,
                error: failureMessage(
                  error,
                  "Review the updated bank accounts before continuing.",
                ),
              });
              return;
            } catch (reviewFailure) {
              error = reviewFailure;
            }
          }
          pendingReview.current = null;
          if (saved) {
            await operations.current.utils.budget
              .invalidate()
              .catch(() => undefined);
          }
          if (generation.current === current)
            setState(
              saved
                ? {
                    step: "syncFailed",
                    connectionId: saved,
                    error: `Your bank connection is saved, but its activity isn’t available yet. ${failureMessage(error, "We’ll retry automatically.")}`,
                  }
                : failed(
                    failureMessage(
                      error,
                      "The bank connection could not be saved. Try connecting again.",
                    ),
                  ),
            );
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
        onExit: (error, metadata) => {
          if (finished || generation.current !== current) return;
          finished = true;
          clearPlaidLinkSession(storage, session.linkToken);
          release();
          busy.current = false;
          // The exit is in the audit trail for support; the user already
          // sees the outcome, so a failed record changes nothing here.
          operations.current.linkExit
            .mutateAsync({
              connectionId: session.connectionId,
              institutionId: metadata?.institution?.institution_id ?? null,
              errorCode: error?.error_code ?? null,
              requestId: metadata?.request_id ?? null,
            })
            .catch((failure: unknown) =>
              console.error("Link exit could not be recorded", failure),
            );
          setState(
            failed(
              error
                ? (error.display_message ??
                    error.error_message ??
                    "Your bank connection ended before completion. Try again.")
                : "",
            ),
          );
        },
      });
      setState({ step: "link", connectionId: session.connectionId });
      handler.current.open();
    },
    [],
  );

  const start = useCallback(
    async (connectionId?: string) => {
      if (!userId || busy.current) return;
      busy.current = true;
      pendingReview.current = null;
      const current = ++generation.current;
      setState({ step: "loading", connectionId });
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
            step: "elsewhere",
            origin: canonicalOrigin,
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
        setState(
          failed(
            failureMessage(
              error,
              "Your bank connection could not start. Try again.",
            ),
          ),
        );
      }
    },
    [cancel, open, userId],
  );

  const resume = useCallback(async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    const current = ++generation.current;
    setState({ step: "loading" });
    try {
      // Allow effect cleanup to cancel an initial Strict Mode resume before it clears storage.
      await Promise.resolve();
      if (generation.current !== current) return;
      const storage = window.localStorage;
      const stored = readPlaidLinkSession(storage, userId);
      if (!stored.session) throw new Error(stored.error);
      const redirectUri = plaidReceivedRedirectUri(window.location.href);
      setState({ step: "loading", connectionId: stored.session.connectionId });
      await open(stored.session, storage, current, redirectUri);
    } catch (error) {
      if (generation.current !== current) return;
      cancel();
      setState(
        failed(
          failureMessage(
            error,
            "Your bank connection could not resume. Return to your budget and connect again.",
          ),
        ),
      );
    }
  }, [cancel, open, userId]);

  const retrySync = useCallback(async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    const current = ++generation.current;
    // Only a saved connection whose update failed is retried.
    setState((value) =>
      value.step === "syncFailed"
        ? { step: "syncing", connectionId: value.connectionId }
        : value,
    );
    try {
      await operations.current.sync.mutateAsync();
      await operations.current.utils.budget.invalidate();
      if (generation.current === current)
        setState((value) =>
          value.step === "syncing"
            ? { step: "connected", connectionId: value.connectionId }
            : value,
        );
    } catch (error) {
      if (generation.current === current)
        setState((value) =>
          value.step === "syncing"
            ? {
                step: "syncFailed",
                connectionId: value.connectionId,
                error: failureMessage(
                  error,
                  "Bank activity isn’t available yet. We’ll retry automatically.",
                ),
              }
            : value,
        );
    } finally {
      if (generation.current === current) busy.current = false;
    }
  }, [userId]);

  return {
    flow: state,
    isLoaded,
    userId,
    // A flow is underway, from asking for its Link token to its first update.
    busy: ["loading", "link", "review", "saving", "syncing"].includes(
      state.step,
    ),
    start,
    resume,
    retrySync,
    confirmReview: () => {
      if (
        busy.current ||
        state.step !== "review" ||
        state.review.verdict === "all" ||
        !pendingReview.current
      )
        return;
      busy.current = true;
      void pendingReview.current(state.review.reviewId);
    },
    dismissReview: () => {
      cancel();
      setState(initial);
    },
    cancel,
  };
}
