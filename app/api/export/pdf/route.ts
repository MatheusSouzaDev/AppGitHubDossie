import { existsSync } from "node:fs";
import MarkdownIt from "markdown-it";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { markdown, title = "dossie" } = (await req.json()) as {
      markdown: string;
      title?: string;
    };
    if (!markdown) return new Response("markdown required", { status: 400 });

    // 1) MD -> HTML (sem recursos externos)
    const md = new MarkdownIt({ html: true, linkify: false, breaks: false });
    const body = md.render(markdown);

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  *,*::before,*::after { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial; color:#111; }
  h1,h2,h3 { color:#0f172a; margin: 18px 0 10px; }
  pre { background:#0b1220; color:#e5e7eb; padding:12px; border-radius:8px;
  white-space:pre; overflow-x:auto; overflow-wrap:normal; word-break:normal; }
  code { white-space:inherit; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
  a { color:#0369a1; text-decoration:none; } a:hover { text-decoration:underline; }
  blockquote { border-left:4px solid #e5e7eb; padding-left:10px; color:#374151; }
  hr { border:none; border-top:1px solid #e5e7eb; margin:24px 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 12px; }
  th { background: #f8fafc; text-align: left; }
</style>
</head>
<body>${body}</body>
</html>`;

    const { executablePath, args, puppeteer } = await getBrowserLauncher();

    const browser = await puppeteer.launch({
      args,
      executablePath,
      headless: true, // NÃO usar chromium.headless
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMediaType("screen");

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    await browser.close();

    const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
    return new Response(blob, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${sanitizeFileName(title)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/export/pdf] ERROR:", msg);
    return new Response(`PDF error: ${msg}`, { status: 500 });
  }
}

async function getBrowserLauncher() {
  const localPuppeteer = await resolveLocalPuppeteer();
  if (localPuppeteer) return localPuppeteer;

  const envExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envExecutable && existsSync(envExecutable)) {
    const puppeteer = (await import("puppeteer-core")).default;
    return { puppeteer, executablePath: envExecutable, args: [] };
  }

  if (!shouldUseLambdaChromium()) {
    throw new Error(
      "Nenhum navegador foi encontrado. Instale o Chrome ou defina PUPPETEER_EXECUTABLE_PATH.",
    );
  }

  const chromiumModule = await import("@sparticuz/chromium");
  const chromium = chromiumModule.default ?? chromiumModule;

  const chromiumTuner = chromium as unknown as {
    setHeadlessMode?: (v: boolean) => void;
    setGraphicsMode?: (v: boolean) => void;
    setBrotliPath?: (p: string) => void;
  };
  if (typeof chromiumTuner.setHeadlessMode === "function")
    chromiumTuner.setHeadlessMode(true);
  if (typeof chromiumTuner.setGraphicsMode === "function")
    chromiumTuner.setGraphicsMode(false);

  const executablePath = await chromium.executablePath();
  if (!executablePath || !existsSync(executablePath)) {
    throw new Error(
      "Nenhum executável do Chromium foi encontrado para gerar o PDF.",
    );
  }

  const puppeteer = (await import("puppeteer-core")).default;
  return { puppeteer, executablePath, args: chromium.args };
}

async function resolveLocalPuppeteer() {
  try {
    const puppeteer = (await import("puppeteer")).default;
    const executablePath = puppeteer.executablePath();
    if (executablePath && existsSync(executablePath)) {
      return { puppeteer, executablePath, args: [] };
    }
  } catch (error) {
    console.warn("[pdf] Puppeteer padrão não disponível:", error);
  }

  return null;
}

function shouldUseLambdaChromium() {
  if (process.platform !== "linux") return false;

  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_REGION ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.LAMBDA_TASK_ROOT,
  );
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function sanitizeFileName(s: string) {
  return s.replace(/[^a-z0-9_\-\.]+/gi, "_");
}
