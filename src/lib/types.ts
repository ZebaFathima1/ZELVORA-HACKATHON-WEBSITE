import type { Track } from "@/lib/constants";

export type TeamMember = {
  full_name: string;
  email?: string | null;
  role?: string | null;
};

export type Team = {
  id: string;
  team_id: string;
  team_name: string;
  team_leader: string;
  college: string;
  branch: string;
  track: Track;
  members: TeamMember[];
  team_size: number;
};

export type Submission = {
  id: string;
  reference: string;
  team_id: string;
  project_title: string;
  track: Track;
  submitted_at: string;
  status: string;
  github_url: string;
  deployed_url: string | null;
  demo_video_url: string | null;
  manual_review: boolean;
  project_data: Record<string, string>;
};
