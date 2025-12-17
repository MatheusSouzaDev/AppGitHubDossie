/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/repos/[owner]/[name]/tree/route.ts
import { NextResponse } from "next/server";
import { getErrorMessage } from "@/app/_ utils/errors";
import { getOctokitForUser } from "@/app/_lib/server/github";

type Node = { path: string; type: "file" | "dir"; size?: number };

export const runtime = "nodejs";

// opcional: limite de profundidade para evitar requests infinitas em grandes repositórios
const MAX_DEPTH = 6;

async function walk(owner: string, repo: string, path = "", depth = 0): Promise<Node[]> {
  if (depth > MAX_DEPTH) return []; // protecao simples

  const octokit = await getOctokitForUser();

  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    const entries = Array.isArray(data) ? data : [data];

    const out: Node[] = [];
    for (const e of entries) {
      if (e.type === "dir") {
        out.push({ path: e.path, type: "dir" });
        out.push(...(await walk(owner, repo, e.path, depth + 1)));
      } else if (e.type === "file") {
        out.push({ path: e.path, type: "file", size: (e as any).size });
      }
    }
    return out;
  } catch (err: unknown) {
    // Se for 404 (conteúdo não encontrado) devolvemos array vazio para não quebrar a página
    const message = (err as any)?.status === 404 ? "Not Found" : getErrorMessage(err);
    // Re-lançar para ser tratado no handler se for erro crítico
    throw new Error(message);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: { owner: string; name: string } },
) {
  try {
    const owner = params.owner;
    const repo = params.name;

    // logs úteis em dev — remova em produção
    console.log("[tree] owner:", owner, "repo:", repo);

    const nodes = await walk(owner, repo, "");
    return NextResponse.json(nodes);
  } catch (e: unknown) {
    const msg = getErrorMessage(e);
    const status =
      msg === "Unauthorized" || msg === "No GitHub token" ? 401 : msg === "Not Found" ? 404 : 502;
    return new NextResponse(msg, { status });
  }
}
