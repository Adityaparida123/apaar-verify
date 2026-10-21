"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(user ? (user.role === "verifier" ? "/verification" : "/dashboard") : "/login");
  }, [loading, user, router]);
  return <main className="page-content"><p className="lede">Opening your workspace…</p></main>;
}
