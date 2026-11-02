"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

import Dashboard from "./dashboard";

// Desktop builds are statically exported, so the session is resolved in the browser.
export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { data: customerState } = useQuery({
    queryKey: ["polar", "customer-state"],
    queryFn: async () => (await authClient.customer.state()).data,
    enabled: Boolean(session?.user),
  });

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.replace("/login");
    }
  }, [isPending, router, session]);

  if (isPending || !session?.user) {
    return null;
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session.user.name}</p>
      <Dashboard session={session} customerState={customerState} />
    </div>
  );
}
