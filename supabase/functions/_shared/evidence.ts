import { unzipSync } from "npm:fflate@0.8.2";

const decoder = new TextDecoder();
const maxExtractedCharacters = 50000;

export type EvidenceExcerpt = {
  id: string;
  source: string;
  file_path: string;
  evidence_kind: string;
  excerpt: string;
};

export type PresentationEvidence = {
  extraction_status: "completed" | "unavailable" | "failed";
  parser: string | null;
  extracted_text: string;
  slide_count: number | null;
  evidence: Array<{ slide_number: number | null; category: string; excerpt: string }>;
  images: Array<{ mime_type: string; data: Uint8Array }>;
  missing_sections: string[];
  manual_review: boolean;
  note?: string;
};

export type GithubEvidence = {
  repository_url: string;
  accessible: boolean;
  commit_sha: string | null;
  languages: Record<string, number>;
  frameworks: string[];
  architecture_observations: string[];
  code_quality_score: number | null;
  implementation_completeness: number | null;
  strengths: string[];
  weaknesses: string[];
  security_observations: string[];
  missing_functionality: string[];
  evidence: Array<{ file_path: string; evidence_kind: string; excerpt: string }>;
  manual_review: boolean;
  note: string;
};

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hexadecimal: string) => String.fromCodePoint(parseInt(hexadecimal, 16)));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function extractLegacyPowerPoint(bytes: Uint8Array) {
  const text = decoder.decode(bytes);
  const utf16 = new TextDecoder("utf-16le").decode(bytes);
  const printableRuns = (value: string) => value.match(/[ -~]{5,}/g) ?? [];
  return [...printableRuns(text), ...printableRuns(utf16)]
    .filter((run) => !/^(?:\x00|\s)*$/.test(run))
    .slice(0, 400)
    .join("\n");
}

export async function extractPresentation(
  supabase: ReturnType<typeof import("./supabase.ts").serviceClient>,
  files: Array<Record<string, unknown>>
): Promise<PresentationEvidence> {
  const file = files.find((item) => item.file_kind === "presentation");
  if (!file || typeof file.storage_path !== "string") {
    return {
      extraction_status: "unavailable",
      parser: null,
      extracted_text: "",
      slide_count: null,
      evidence: [],
      images: [],
      missing_sections: ["Presentation file was not submitted."],
      manual_review: true,
      note: "No presentation file metadata exists for this submission."
    };
  }

  const { data: blob, error } = await supabase.storage
    .from("submission-files")
    .download(file.storage_path);
  if (error || !blob) {
    return {
      extraction_status: "unavailable",
      parser: null,
      extracted_text: "",
      slide_count: null,
      evidence: [],
      images: [],
      missing_sections: ["Presentation content could not be read from private storage."],
      manual_review: true,
      note: error?.message ?? "The presentation could not be downloaded."
    };
  }
  if (blob.size > 20 * 1024 * 1024) {
    return {
      extraction_status: "failed",
      parser: null,
      extracted_text: "",
      slide_count: null,
      evidence: [],
      images: [],
      missing_sections: ["Presentation exceeded the configured 20 MB processing limit."],
      manual_review: true,
      note: "Presentation exceeds the supported processing size."
    };
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const name = String(file.original_name ?? "").toLowerCase();
  const contentType = String(file.content_type ?? "").toLowerCase();

  if (name.endsWith(".pptx") || contentType.includes("presentationml")) {
    try {
      const archive = unzipSync(bytes, { filter: (entry) => !entry.name.startsWith("ppt/embeddings/") });
      const slidePaths = Object.keys(archive)
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
      const evidence: PresentationEvidence["evidence"] = [];
      const slideTexts: string[] = [];
      for (const [index, path] of slidePaths.entries()) {
        const xml = decoder.decode(archive[path]);
        const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
          .map((match) => decodeXml(match[1]))
          .join(" ")
          .trim();
        if (!text) continue;
        const excerpt = text.slice(0, 3000);
        slideTexts.push(`Slide ${index + 1}: ${excerpt}`);
        evidence.push({ slide_number: index + 1, category: "slide_text", excerpt });
      }

      const images = Object.entries(archive)
        .filter(([path, value]) => /^ppt\/media\/[^/]+\.(png|jpe?g|webp)$/i.test(path) && value.length <= 1_000_000)
        .slice(0, 4)
        .map(([path, data]) => ({
          mime_type: path.toLowerCase().endsWith(".png") ? "image/png"
            : path.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg",
          data
        }));
      const extractedText = slideTexts.join("\n").slice(0, maxExtractedCharacters);
      const missingSections = extractedText.length < 100
        ? ["Readable slide text was not found; presentation images may require human OCR review."]
        : [];
      return {
        extraction_status: extractedText.length >= 100 || images.length > 0 ? "completed" : "unavailable",
        parser: "fflate-pptx-xml",
        extracted_text: extractedText,
        slide_count: slidePaths.length,
        evidence,
        images,
        missing_sections: missingSections,
        manual_review: extractedText.length < 100,
        note: images.length ? "Embedded slide images are included for model-based visual review." : undefined
      };
    } catch (error) {
      return {
        extraction_status: "failed",
        parser: "fflate-pptx-xml",
        extracted_text: "",
        slide_count: null,
        evidence: [],
        images: [],
        missing_sections: ["PowerPoint file could not be parsed."],
        manual_review: true,
        note: error instanceof Error ? error.message : "The PowerPoint archive is invalid."
      };
    }
  }

  if (name.endsWith(".pdf") || contentType.includes("pdf")) {
    try {
      const pdfjs = await import("npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs");
      const document = await pdfjs.getDocument({
        data: bytes,
        isEvalSupported: false,
        useSystemFonts: true,
        disableFontFace: true
      }).promise;
      const evidence: PresentationEvidence["evidence"] = [];
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item: { str?: string }) => item.str ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) {
          const excerpt = text.slice(0, 3000);
          pages.push(`Page ${pageNumber}: ${excerpt}`);
          evidence.push({ slide_number: pageNumber, category: "page_text", excerpt });
        }
      }
      const extractedText = pages.join("\n").slice(0, maxExtractedCharacters);
      const needsOcr = extractedText.length < 100;
      return {
        extraction_status: needsOcr ? "unavailable" : "completed",
        parser: "pdfjs-text",
        extracted_text: extractedText,
        slide_count: document.numPages,
        evidence,
        images: [],
        missing_sections: needsOcr
          ? ["No meaningful text was extracted. This image-based PDF needs OCR and human review."]
          : [],
        manual_review: needsOcr,
        note: needsOcr ? "Image-based PDF OCR is not available in the Edge runtime; no OCR result was fabricated." : undefined
      };
    } catch (error) {
      return {
        extraction_status: "failed",
        parser: "pdfjs-text",
        extracted_text: "",
        slide_count: null,
        evidence: [],
        images: [],
        missing_sections: ["PDF text extraction failed; human review is required."],
        manual_review: true,
        note: error instanceof Error ? error.message : "The PDF could not be parsed."
      };
    }
  }

  if (name.endsWith(".ppt") || contentType.includes("ms-powerpoint")) {
    const extractedText = extractLegacyPowerPoint(bytes).slice(0, maxExtractedCharacters);
    const available = extractedText.length >= 100;
    return {
      extraction_status: available ? "completed" : "unavailable",
      parser: "legacy-ppt-printable-text",
      extracted_text: extractedText,
      slide_count: null,
      evidence: available ? [{ slide_number: null, category: "legacy_ppt_text", excerpt: extractedText.slice(0, 3000) }] : [],
      images: [],
      missing_sections: available ? [] : ["Legacy .ppt binary content could not be reliably extracted; human review is required."],
      manual_review: true,
      note: "Legacy .ppt parsing is best-effort; slide count and embedded image OCR are unavailable."
    };
  }

  return {
    extraction_status: "unavailable",
    parser: null,
    extracted_text: "",
    slide_count: null,
    evidence: [],
    images: [],
    missing_sections: ["The submitted presentation format is not supported for automated extraction."],
    manual_review: true
  };
}

const ignoredPath = /(^|\/)(?:\.git|node_modules|vendor|dist|build|coverage|\.next|target)(\/|$)|(^|\/)\.env(?:\.|$)|(?:secret|credential|private[-_]?key|service[-_]?account)/i;
const codeExtensions = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rs|cs|php|rb|swift|dart|vue|svelte|sql|html|css|json|ya?ml|toml|md)$/i;

function scrubSecrets(value: string) {
  return value
    .replace(/(api[_-]?key|secret|token|password)\s*[:=]\s*(['"])[^'"\r\n]{6,}\2/gi, "$1=$2[REDACTED]$2")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/g, "[REDACTED_TOKEN]");
}

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Zelvora-Hackathon-Evaluator"
  };
  const token = Deno.env.get("GITHUB_TOKEN");
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function inspectGithub(
  supabase: ReturnType<typeof import("./supabase.ts").serviceClient>,
  repositoryUrl: string
): Promise<GithubEvidence> {
  const unavailable = (note: string): GithubEvidence => ({
    repository_url: repositoryUrl,
    accessible: false,
    commit_sha: null,
    languages: {},
    frameworks: [],
    architecture_observations: [],
    code_quality_score: null,
    implementation_completeness: null,
    strengths: [],
    weaknesses: [],
    security_observations: [],
    missing_functionality: [],
    evidence: [],
    manual_review: true,
    note
  });
  let url: URL;
  try {
    url = new URL(repositoryUrl);
  } catch {
    return unavailable("The submitted repository URL is invalid.");
  }
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" ||
    pathParts.length < 2 || !/^[A-Za-z0-9_.-]+$/.test(pathParts[0]) ||
    !/^[A-Za-z0-9_.-]+$/.test(pathParts[1].replace(/\.git$/i, ""))) {
    return unavailable("Only direct public GitHub owner/repository URLs are supported.");
  }
  const owner = pathParts[0];
  const repo = pathParts[1].replace(/\.git$/i, "");
  const canonicalUrl = `https://github.com/${owner}/${repo}`;
  const rateKey = `github-analysis:${owner.toLowerCase()}/${repo.toLowerCase()}`;

  const { data: cached } = await supabase.from("github_analyses")
    .select("id,repository_url,accessible,commit_sha,languages,frameworks,architecture_observations,code_quality_score,implementation_completeness,strengths,weaknesses,security_observations,missing_functionality,analysis,manual_review,analyzed_at")
    .eq("repository_url", canonicalUrl)
    .eq("is_demo", false)
    .order("analyzed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cached?.accessible && Date.now() - new Date(cached.analyzed_at).getTime() < 24 * 60 * 60 * 1000) {
    const { data: cachedEvidence, error: cachedEvidenceError } = await supabase.from("repository_evidence")
      .select("file_path,evidence_kind,excerpt")
      .eq("analysis_uuid", cached.id)
      .eq("is_demo", false)
      .order("evidence_order", { ascending: true });
    if (cachedEvidenceError) return unavailable(`Cached repository evidence could not be loaded: ${cachedEvidenceError.message}`);
    return {
      ...cached,
      evidence: (cachedEvidence ?? []).map((item) => ({
        file_path: item.file_path,
        evidence_kind: item.evidence_kind,
        excerpt: item.excerpt
      })),
      note: "Reused recent analysis cache."
    } as GithubEvidence;
  }

  const { data: allowed, error: rateError } = await supabase.rpc("consume_public_rate_limit", {
    p_key: rateKey,
    p_limit: 4,
    p_window_seconds: 3600
  });
  if (rateError || allowed !== true) return unavailable("Repository inspection is rate-limited; retry later or review it manually.");

  const headers = githubHeaders();
  try {
    const repositoryResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers,
      signal: AbortSignal.timeout(8000)
    });
    if (!repositoryResponse.ok) return unavailable(`GitHub repository could not be fetched (HTTP ${repositoryResponse.status}).`);
    const repository = await repositoryResponse.json();
    const defaultBranch = String(repository.default_branch ?? "");
    if (!defaultBranch) return unavailable("GitHub did not provide a default branch.");

    const [languagesResponse, treeResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`, {
        headers, signal: AbortSignal.timeout(8000)
      }),
      fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`, {
        headers, signal: AbortSignal.timeout(10000)
      })
    ]);
    const languages = languagesResponse.ok ? await languagesResponse.json() as Record<string, number> : {};
    if (!treeResponse.ok) return unavailable(`Repository structure could not be fetched (HTTP ${treeResponse.status}).`);
    const tree = await treeResponse.json();
    const blobs = (tree.tree ?? [])
      .filter((item: { type?: string; path?: string; size?: number }) =>
        item.type === "blob" && typeof item.path === "string" &&
        !ignoredPath.test(item.path) && codeExtensions.test(item.path) &&
        (item.size ?? 0) <= 30000)
      .sort((left: { path: string }, right: { path: string }) => {
        const priority = (path: string) =>
          /(^|\/)(readme\.md|package\.json|pyproject\.toml|requirements\.txt|pom\.xml|build\.gradle|go\.mod|cargo\.toml|composer\.json|pubspec\.yaml)$/i.test(path) ? 0
            : /(^|\/)(src|app|pages|api|server|lib)\//i.test(path) ? 1 : 2;
        return priority(left.path) - priority(right.path);
      })
      .slice(0, 12);
    const evidence: GithubEvidence["evidence"] = [];
    let remainingChars = 45000;
    for (const item of blobs) {
      if (remainingChars <= 0) break;
      const filePath = String(item.path);
      const rawPath = filePath.split("/").map(encodeURIComponent).join("/");
      const encodedBranch = defaultBranch.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodedBranch}/${rawPath}`, {
        headers: { "User-Agent": "Zelvora-Hackathon-Evaluator" },
        redirect: "error",
        signal: AbortSignal.timeout(6000)
      });
      if (!response.ok) continue;
      const source = scrubSecrets((await response.text()).slice(0, Math.min(8000, remainingChars)));
      const excerpt = source.slice(0, Math.min(3000, source.length));
      if (excerpt.trim()) {
        evidence.push({
          file_path: filePath,
          evidence_kind: /readme\.md$/i.test(filePath) ? "documentation"
            : /package\.json|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle|go\.mod|cargo\.toml/i.test(filePath) ? "dependency_manifest"
              : "source_code",
          excerpt
        });
        remainingChars -= excerpt.length;
      }
    }

    const allPaths = (tree.tree ?? [])
      .filter((item: { path?: string; type?: string }) => item.type === "blob" && typeof item.path === "string")
      .map((item: { path: string }) => item.path);
    const rootPaths = allPaths.filter((path: string) => !ignoredPath.test(path)).slice(0, 150);
    const frameworkNames = ["Next.js", "React", "Vue", "Angular", "Svelte", "Django", "Flask", "FastAPI", "Express", "NestJS", "Spring Boot", "Laravel", "ASP.NET", "Flutter", "React Native", "Supabase", "Firebase", "PostgreSQL", "MongoDB", "Prisma", "SQLAlchemy"];
    const evidenceText = evidence.map((item) => `${item.file_path}\n${item.excerpt}`).join("\n");
    const frameworks = frameworkNames.filter((name) =>
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(evidenceText));
    const observations = [
      `${Object.keys(languages).length} languages were reported by GitHub.`,
      `${rootPaths.length} safe repository paths were sampled; code was not executed.`,
      evidence.some((item) => item.evidence_kind === "dependency_manifest") ? "Dependency/configuration manifests were inspected." : "No supported dependency manifest was found in the inspected paths.",
      evidence.some((item) => item.evidence_kind === "documentation") ? "A README was available for static review." : "A README was not available in the inspected sample."
    ];
    const secrets = allPaths.some((path: string) => /(^|\/)\.env(?:\.|$)|(?:^|\/)(?:id_rsa|credentials\.json|service-account\.json)$/i.test(path))
      ? ["Potential secret-bearing file names were found in the repository tree; contents were not fetched."]
      : [];
    const placeholders = evidence.some((item) => /\bTODO\b|\bFIXME\b|placeholder|coming soon/i.test(item.excerpt))
      ? ["Sampled source contains TODO, FIXME, or placeholder markers."]
      : [];
    return {
      repository_url: canonicalUrl,
      accessible: true,
      commit_sha: typeof tree.sha === "string" ? tree.sha : null,
      languages,
      frameworks,
      architecture_observations: observations,
      code_quality_score: null,
      implementation_completeness: null,
      strengths: [],
      weaknesses: [],
      security_observations: secrets,
      missing_functionality: placeholders,
      evidence,
      manual_review: !evidence.some((item) => item.evidence_kind === "source_code"),
      note: tree.truncated ? "GitHub marked the repository tree as truncated; analysis is partial." : ""
    };
  } catch (error) {
    return unavailable(`Repository inspection failed: ${error instanceof Error ? error.message : "request failed"}.`);
  }
}

export function evidenceReferences(
  presentation: PresentationEvidence,
  github: GithubEvidence,
  project: Record<string, unknown>
) {
  const excerpts: EvidenceExcerpt[] = [];
  const projectText = Object.entries(project)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n")
    .slice(0, 12000);
  if (projectText) excerpts.push({
    id: "SUB-001",
    source: "submission",
    file_path: "project submission",
    evidence_kind: "project_description",
    excerpt: projectText
  });
  presentation.evidence.forEach((item, index) => excerpts.push({
    id: `PPT-${String(index + 1).padStart(3, "0")}`,
    source: "presentation",
    file_path: item.slide_number ? `slide ${item.slide_number}` : "presentation file",
    evidence_kind: item.category,
    excerpt: item.excerpt
  }));
  github.evidence.forEach((item, index) => excerpts.push({
    id: `GH-${String(index + 1).padStart(3, "0")}`,
    source: "github",
    file_path: item.file_path,
    evidence_kind: item.evidence_kind,
    excerpt: item.excerpt
  }));
  return excerpts;
}

export function encodeImage(bytes: Uint8Array) {
  return bytesToBase64(bytes);
}
