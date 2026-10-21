"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { SessionProvider, signOut } from "next-auth/react";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "react-hot-toast";

// The server decides (22/10/2026): "PIN_REQUIRED" locks the screen again (PinGate listens), "SESSION_ENDED" (signed out elsewhere,
// disabled, PIN-less session after an account change) goes back to the sign-in page.
let ending = false;
function onServerError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("PIN_REQUIRED") && typeof window !== "undefined") window.dispatchEvent(new Event("mth:pin-required"));
  if (message.startsWith("SESSION_ENDED") && !ending) { ending = true; void signOut({ callbackUrl: "/login" }); }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ queryCache: new QueryCache({ onError: onServerError }), mutationCache: new MutationCache({ onError: onServerError }) }));
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
        }),
      ],
      transformer: superjson,
    })
  );

  return (
    <SessionProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>{children}<Toaster position="bottom-right" toastOptions={{ duration: 3000, className: "mth-toast", style: { fontSize: "13px", maxWidth: "520px" } }} /></ThemeProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  );
}
