"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, BarChart3, ClipboardList, Eye, FileSearch, FileText, Flag, Github, LayoutDashboard, LogOut, Settings2, ShieldCheck, Trophy, UsersRound, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/app/theme-toggle";
import { useState } from "react";

const links = [
  { path: "", label: "Overview", icon: LayoutDashboard },
  { path: "/demo", label: "Demo Preview", icon: Eye },
  { path: "/teams", label: "Registered Teams", icon: UsersRound },
  { path: "/submissions", label: "Project Submissions", icon: ClipboardList },
  { path: "/evaluation", label: "AI Evaluation", icon: Activity },
  { path: "/reports", label: "Evaluation Reports", icon: FileText },
  { path: "/leaderboards", label: "Leaderboards", icon: BarChart3 },
  { path: "/shortlist", label: "Shortlisting", icon: Flag },
  { path: "/settings", label: "Event Settings", icon: Settings2 },
  { path: "/presentation-analysis", label: "Presentation Analysis", icon: FileSearch },
  { path: "/github-analysis", label: "GitHub Analysis", icon: Github },
  { path: "/evidence-verification", label: "Evidence Verification", icon: ShieldCheck },
  { path: "/final-rankings", label: "Final Rankings", icon: Trophy }
];

export function AdminShell({ children, email, role, basePath = "/admin" }: { children: React.ReactNode; email: string; role: string; basePath?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");

  async function signOut() {
    const { error } = await createClient().auth.signOut();
    if (error) {
      setErrorMessage(`Could not sign out: ${error.message}`);
      return;
    }
    router.replace(basePath === "/organizer" ? "/organizer" : "/admin/login");
    router.refresh();
  }

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Link className="brand" href={basePath}><span className="brand-mark">Z</span><span>ZELVORA<small>TECHNOLOGIES PVT. LTD.</small></span></Link>
        <div className="sidebar-section">Workspace</div>
        {links.map(({ path, label, icon: Icon }) => {
          const href = `${basePath}${path}`;
          const active = path === "" ? pathname === basePath : pathname === href || pathname.startsWith(`${href}/`);
          return (
          <Link className={`side-link ${active ? "active" : ""}`} href={href} key={href}><Icon size={15} />{label}</Link>
          );
        })}
        <div className="sidebar-section">Portal</div>
        <Link className="side-link" href="/"><Users size={15} />Participant portal</Link>
        <button className="side-link side-logout" type="button" onClick={() => void signOut()}><LogOut size={15} />Logout</button>
        <div className="sidebar-bottom">
          <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{email}</div>
          <div style={{ textTransform: "capitalize", marginTop: 8 }}>{role}</div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-top"><div><strong style={{ fontFamily: "Manrope", fontSize: 13 }}>ZELVORA TECHNOLOGIES PVT. LTD.</strong><span className="organizer-top-caption">Hackathon organizer portal</span></div><div className="inline-actions"><span>Organizer workspace</span><ThemeToggle /></div></header>
        <main className="admin-content">{errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}{children}</main>
      </div>
    </div>
  );
}
