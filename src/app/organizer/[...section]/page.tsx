import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/admin-shell";
import AdminDashboard from "@/app/admin/(workspace)/page";
import EvaluationPage from "@/app/admin/(workspace)/evaluation/page";
import LeaderboardsPage from "@/app/admin/(workspace)/leaderboards/page";
import SubmissionsPage from "@/app/admin/(workspace)/submissions/page";
import SubmissionDetailPage from "@/app/admin/(workspace)/submissions/[id]/page";
import SettingsPage from "@/app/admin/(workspace)/settings/page";
import ShortlistPage from "@/app/admin/(workspace)/shortlist/page";
import ReportsPage from "@/app/admin/(workspace)/reports/page";
import { createClient } from "@/lib/supabase/server";
import RegisteredTeamsPage from "../registered-teams";
import {
  EvidenceVerificationPage,
  FinalRankingsPage,
  GithubAnalysisPage,
  PresentationAnalysisPage
} from "../analysis-pages";
import OrganizerDemoPreview from "../demo-preview";

const pages = {
  teams: RegisteredTeamsPage,
  demo: OrganizerDemoPreview,
  submissions: SubmissionsPage,
  evaluation: EvaluationPage,
  reports: ReportsPage,
  leaderboards: LeaderboardsPage,
  shortlist: ShortlistPage,
  settings: SettingsPage,
  "presentation-analysis": PresentationAnalysisPage,
  "github-analysis": GithubAnalysisPage,
  "evidence-verification": EvidenceVerificationPage,
  "final-rankings": FinalRankingsPage
} as const;

export default async function OrganizerSectionPage({ params }: { params: { section: string[] } }) {
  const section = params.section;
  const Component = section.length === 1
    ? pages[section[0] as keyof typeof pages]
    : section.length === 2 && section[0] === "submissions"
      ? SubmissionDetailPage
      : undefined;

  if (!Component) notFound();

  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/organizer");

  const { data: organizer, error: roleError } = await supabase
    .from("admin_users")
    .select("role")
    .eq("user_uuid", user.id)
    .maybeSingle();
  if (roleError || !organizer) redirect("/organizer");

  return (
    <AdminShell email={user.email ?? "Organizer"} role={organizer.role} basePath="/organizer">
      <Component />
    </AdminShell>
  );
}
