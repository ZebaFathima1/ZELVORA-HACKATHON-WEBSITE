import { corsHeaders, clientIp, isOptions, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";

const maxBytes = 20 * 1024 * 1024;
const allowedTypes = new Set([
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg"
]);

async function isValidFile(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (file.type === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (file.type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (file.type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (file.type === "application/vnd.ms-powerpoint") return [208, 207, 17, 224, 161, 177, 26, 225].every((value, index) => bytes[index] === value);
  if (file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4;
  return false;
}

function validGithubUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabase = serviceClient();
  const uploadedPaths: string[] = [];
  try {
    const { data: ipAllowed, error: ipLimitError } = await supabase.rpc("consume_public_rate_limit", {
      p_key: `submit-ip:${clientIp(request)}`,
      p_limit: 120,
      p_window_seconds: 300
    });
    if (ipLimitError) throw ipLimitError;
    if (!ipAllowed) return json({ error: "Too many submission attempts. Please try again later." }, 429);

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 64 * 1024 * 1024) return json({ error: "The total upload exceeds the 64 MB request limit." }, 413);
    const form = await request.formData();
    const teamId = String(form.get("team_id") ?? "").trim().toUpperCase();
    const projectTitle = String(form.get("project_title") ?? "").trim();
    const githubUrl = String(form.get("github_url") ?? "").trim();
    const confirmed = form.get("confirmed") === "true";
    if (!/^ZYL\d{3,}$/.test(teamId) || projectTitle.length < 3 || projectTitle.length > 160 || !validGithubUrl(githubUrl) || !confirmed) {
      return json({ error: "Submission details are invalid. Review the required fields and try again." }, 400);
    }
    const { data: teamAllowed, error: teamLimitError } = await supabase.rpc("consume_public_rate_limit", {
      p_key: `submit-team:${teamId}`,
      p_limit: 5,
      p_window_seconds: 3600
    });
    if (teamLimitError) throw teamLimitError;
    if (!teamAllowed) return json({ error: "Too many submission attempts. Please try again later." }, 429);

    const fields: Record<string, { min: number; max: number }> = {
      problem_statement: { min: 20, max: 3000 },
      problem_description: { min: 40, max: 8000 },
      proposed_solution: { min: 40, max: 8000 },
      objectives: { min: 20, max: 3000 },
      innovation: { min: 20, max: 3000 },
      technical_implementation: { min: 20, max: 5000 },
      technologies: { min: 2, max: 1000 },
      real_world_applications: { min: 20, max: 3000 },
      expected_impact: { min: 20, max: 3000 }
    };
    const projectData: Record<string, string> = {};
    for (const [field, constraints] of Object.entries(fields)) {
      const value = String(form.get(field) ?? "").trim();
      if (value.length < constraints.min || value.length > constraints.max) {
        return json({ error: `Please check the ${field.replaceAll("_", " ")} field; it must contain ${constraints.min} to ${constraints.max} characters.` }, 400);
      }
      projectData[field] = value;
    }

    const deployedUrl = String(form.get("deployed_url") ?? "").trim();
    const demoVideoUrl = String(form.get("demo_video_url") ?? "").trim();
    const deploymentException = String(form.get("deployment_exception") ?? "").trim();
    const isHttpsUrl = (value: string) => {
      if (!value) return true;
      try { return new URL(value).protocol === "https:"; } catch { return false; }
    };
    if (!isHttpsUrl(deployedUrl) || !isHttpsUrl(demoVideoUrl) || (!deployedUrl && deploymentException.length < 20)) {
      return json({ error: "Enter valid HTTPS links, or explain why deployment is not feasible." }, 400);
    }

    const fileFields = [
      ["presentation", "presentation"],
      ["architecture", "architecture"],
      ["documentation", "documentation"]
    ] as const;
    const fileRows = [];
    for (const [field, kind] of fileFields) {
      const entry = form.get(field);
      if (!(entry instanceof File) || entry.size === 0) {
        if (kind === "presentation") return json({ error: "A project presentation is required." }, 400);
        continue;
      }
      if (entry.size > maxBytes || !allowedTypes.has(entry.type) || !(await isValidFile(entry))) {
        return json({ error: `${entry.name} is not an allowed file type or exceeds the 20 MB limit.` }, 400);
      }
      const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
      const storagePath = `${crypto.randomUUID()}/${kind}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("submission-files")
        .upload(storagePath, entry, { contentType: entry.type, upsert: false });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
      fileRows.push({
        kind,
        path: storagePath,
        name: safeName,
        content_type: entry.type,
        size: entry.size
      });
    }

    const { data, error } = await supabase.rpc("submit_project", {
      p_team_id: teamId,
      p_project_title: projectTitle,
      p_project_data: projectData,
      p_github_url: githubUrl,
      p_deployed_url: deployedUrl,
      p_demo_video_url: demoVideoUrl,
      p_deployment_exception: deploymentException,
      p_files: fileRows
    });
    if (error) {
      await supabase.storage.from("submission-files").remove(uploadedPaths);
      if (error.message.includes("ALREADY_SUBMITTED")) {
        const { data: existing, error: teamLookupError } = await supabase.from("teams")
          .select("id").eq("team_id", teamId).eq("is_demo", false).single();
        if (teamLookupError) throw teamLookupError;
        const { data: saved, error: submissionLookupError } = await supabase.from("submissions")
          .select("reference,project_title,submitted_at").eq("team_uuid", existing.id).eq("is_demo", false).maybeSingle();
        if (submissionLookupError) throw submissionLookupError;
        return json({
          error: "Your team has already submitted its project. Multiple submissions are not allowed.",
          submission: saved
        }, 409);
      }
      if (error.message.includes("SUBMISSIONS_CLOSED")) return json({ error: "Submissions are currently closed." }, 403);
      if (error.message.includes("TEAM_NOT_FOUND")) return json({ error: "We couldn't find that Team ID." }, 404);
      throw error;
    }
    const result = Array.isArray(data) ? data[0] : data;
    return json({
      submission_id: result.submission_id,
      reference: result.submission_reference,
      submitted_at: result.submitted_at
    });
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from("submission-files").remove(uploadedPaths);
    console.error("Project submission failed:", error);
    return json({ error: "We couldn't save your submission. Your team has not been charged or registered again; please retry." }, 500);
  }
});
