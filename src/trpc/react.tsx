"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

import { type AppRouter } from "~/server/api/root";
import { deleteStoredBudgets } from "~/components/sync/indexed-db";
import { appLinks } from "./links";
import { createQueryClient } from "./query-client";

export const api = createTRPCReact<AppRouter>();

export type RouterInputs = inferRouterInputs<AppRouter>;

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const { isLoaded, userId } = useAuth();
  // However the user signed out, the budget this browser kept goes too.
  useEffect(() => {
    if (isLoaded && !userId) void deleteStoredBudgets();
  }, [isLoaded, userId]);
  return (
    <IdentityTRPCProvider key={userId ?? "signed-out"}>
      {props.children}
    </IdentityTRPCProvider>
  );
}

function IdentityTRPCProvider(props: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  const [trpcClient] = useState(() =>
    api.createClient({
      links: appLinks({ url: getBaseUrl() + "/api/trpc" }),
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  );
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
