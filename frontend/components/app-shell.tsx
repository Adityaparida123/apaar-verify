"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, ClipboardCheck, FileClock, FileSearch, LayoutDashboard, Menu, Moon,
  ShieldCheck, UsersRound, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Role } from "@/lib/types";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, roles: ["institution_admin", "aicte_official"] },
  { href: "/students", label: "Student records", icon: UsersRound, roles: ["institution_admin", "aicte_official"] },
  { href: "/impact", label: "Impact detector", icon: FileSearch, roles: ["institution_admin", "aicte_official"] },
  { href: "/review", label: "Review queue", icon: ClipboardCheck, roles: ["institution_admin", "aicte_official"] },
  { href: "/verification", label: "Verification", icon: ShieldCheck, roles: ["institution_admin", "aicte_official", "verifier"] },
  { href: "/analytics", label: "Intake analytics", icon: Activity, roles: ["institution_admin", "aicte_official"] },
  { href: "/audit", label: "Audit log", icon: FileClock, roles: ["institution_admin", "aicte_official"] },
] satisfies Array<{ href: string; label: string; icon: typeof Moon; roles: Role[] }>;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) window.location.replace("/login");
  }, [loading, user]);

  if (loading || !user) return <main className="page-content"><p className="lede">Checking your session…</p></main>;
  const visibleLinks = links.filter((item) => item.roles.includes(user.role));

  return (
    <div className="app-shell">
      {menuOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Main navigation">
        <Link href="/dashboard" className="brand" aria-label="APAAR Verify home">
          <span className="brand-mark"><ShieldCheck size={21} /></span>
          <span><span className="brand-name">APAAR Verify</span><span className="brand-sub">Academic records</span></span>
        </Link>
        <div className="nav-label">Workspace</div>
        <nav className="nav-list">
          {visibleLinks.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={`nav-link ${pathname === href || (href === "/students" && pathname.startsWith("/students/")) ? "active" : ""}`}>
              <Icon size={17} strokeWidth={1.7} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-note"><strong>Prototype service</strong>Records are managed in APAAR Verify. No official registry is queried.</div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="row" style={{ justifyContent: "flex-start" }}>
            <button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
            <div className="topbar-kicker">Academic record governance · workspace</div>
          </div>
          <div className="topbar-user">
            <div className="user-meta">{user.email}<small>{user.role.replaceAll("_", " ")}{user.institution_id ? ` · ${user.institution_id}` : ""}</small></div>
            <ThemeToggle />
            <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={signOut}><X size={16} /></button>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
