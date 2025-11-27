import MarkdownIt from "markdown-it";
import puppeteer from "puppeteer";

export const runtime = "nodejs";

const PDF_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS ?? 45000);

export async function POST(req: Request) {
  try {
    const { markdown, title = "dossie" } = (await req.json()) as {
      markdown: string;
      title?: string;
    };
    if (!markdown) {
      return new Response("markdown required", { status: 400 });
    }

    // 1) MD -> HTML (sem recursos externos)
    const md = new MarkdownIt({ html: true, linkify: false, breaks: false});
    const body = md.render(markdown);
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  *, *::before, *::after { box-sizing: border-box; }
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

    // 2) Lança Chromium de forma compatível (local/CI)
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--font-render-hinting=medium",
      ],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(PDF_TIMEOUT_MS);
    page.setDefaultTimeout(PDF_TIMEOUT_MS);

    // Evita travar esperando "networkidle0" quando não há requests
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMediaType("screen");

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    await browser.close();

    // Retorna como Blob para agradar o BodyInit do fetch
    const blob = new Blob([new Uint8Array(pdfBuffer)], {
      type: "application/pdf",
    });

    return new Response(blob, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${sanitizeFileName(title)}.pdf"`,
        // Evita cache em dev
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Log detalhado no server para debug
    console.error("[/api/export/pdf] ERROR:", msg);
    return new Response(`PDF error: ${msg}`, { status: 500 });
  }
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
