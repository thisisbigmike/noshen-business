import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { DEFAULTS, legalVars } from "@noshen/engine/settings";
import { config } from "./config.js";

/**
 * NosHen's own rules and help pages, searchable by meaning, so the agent answers questions about NosHen
 * from what NosHen actually says instead of from memory (retrieval augmented generation).
 *
 * The pages are cut into chunks along their headings, each chunk is turned into an embedding once and
 * cached on disk, and a question is answered with the few chunks whose embeddings sit closest to it.
 * Without a Gemini key, or if embedding fails, the search falls back to matching words.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const CACHE_FILE = path.resolve(__dirname, "../.cache/knowledge.json");

const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
const DIMENSIONS = 768;
// Chunks are packed from whole paragraphs up to about this many characters.
const CHUNK_CHARS = 1000;
// Below this similarity a chunk is about something else, and is left out. Relevant passages score about
// 0.65 to 0.8 with gemini-embedding-001; unrelated questions still reach about 0.63, so the agent's prompt,
// not this number, is what makes it admit when the pages don't say.
const MIN_SCORE = 0.6;

const SOURCES = [
  { title: "How NosHen works", file: "README.md", sections: ["The problem", "How a deal works", "Paying with stablecoins", "Try the demo", "What's built", "Not built yet"] },
  { title: "Protected deal terms", file: "apps/web/app/legal/deal-terms.md" },
  { title: "Safety tips", file: "apps/web/app/legal/safety.md" },
  { title: "Prohibited items", file: "apps/web/app/legal/prohibited-items.md" },
  { title: "Terms of use", file: "apps/web/app/legal/terms.md" },
  { title: "Privacy policy", file: "apps/web/app/legal/privacy.md" },
];

export interface KnowledgeHit {
  source: string;
  text: string;
  score: number;
}

interface Chunk {
  source: string;
  text: string;
  vector?: number[];
}

const ai = new GoogleGenAI({
  apiKey: config.geminiApiKey || "demo_key",
  httpOptions: { timeout: 20_000, retryOptions: { attempts: 3, initialDelay: 1, maxDelay: 6 } },
});
const hasKey = () => Boolean(config.geminiApiKey) && !config.geminiApiKey.startsWith("your_");

let index: Promise<Chunk[]> | null = null;

/** Builds the index in the background, so the first question doesn't wait for it. */
export function warmKnowledge() {
  loadIndex().catch(() => {});
}

export async function searchKnowledge(query: string, k = 4): Promise<KnowledgeHit[]> {
  const chunks = await loadIndex();
  if (chunks.length === 0) return [];

  if (chunks[0].vector) {
    try {
      const [q] = await embed([query], "RETRIEVAL_QUERY");
      return chunks
        .map((c) => ({ source: c.source, text: c.text, score: cosine(q, c.vector!) }))
        .filter((h) => h.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    } catch (err: any) {
      console.warn("[Knowledge]: query embedding failed, matching words instead:", err?.message ?? err);
    }
  }
  return keywordSearch(chunks, query, k);
}

function loadIndex(): Promise<Chunk[]> {
  index ??= buildIndex().catch((err) => {
    index = null;
    throw err;
  });
  return index;
}

async function buildIndex(): Promise<Chunk[]> {
  const chunks = await readChunks();
  if (!hasKey()) return chunks;

  const hash = createHash("sha256").update(EMBED_MODEL).update(JSON.stringify(chunks)).digest("hex");
  try {
    const cached = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    if (cached.hash === hash) return cached.chunks;
  } catch {
    // No cache yet, or an unreadable one: build it.
  }

  try {
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += 100) {
      vectors.push(...(await embed(chunks.slice(i, i + 100).map((c) => `${c.source}\n${c.text}`), "RETRIEVAL_DOCUMENT")));
    }
    const embedded = chunks.map((c, i) => ({ ...c, vector: vectors[i] }));
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ hash, chunks: embedded }));
    return embedded;
  } catch (err: any) {
    console.warn("[Knowledge]: embedding failed, matching words instead:", err?.message ?? err);
    return chunks;
  }
}

async function embed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][]> {
  const res = await ai.models.embedContent({
    model: EMBED_MODEL,
    contents: texts,
    config: { taskType, outputDimensionality: DIMENSIONS },
  });
  const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
  if (vectors.length !== texts.length) throw new Error(`expected ${texts.length} embeddings, got ${vectors.length}`);
  return vectors;
}

/** The help pages as chunks, with the deal rules' real numbers filled in and drafting notes taken out. */
async function readChunks(): Promise<Chunk[]> {
  const vars = legalVars(DEFAULTS);
  const chunks: Chunk[] = [];
  for (const src of SOURCES) {
    const md = (await readFile(path.join(ROOT, src.file), "utf8"))
      .replace(/\{\{(\w+)\}\}/g, (m, key: string) => vars[key] ?? m)
      // Notes to the lawyer aren't part of the rules.
      .replace(/\s*<mark>\[(?:Lawyer|Proposed)[^\]]*\]<\/mark>/g, "")
      // Blanks still to be filled in, such as the support email, stay visible as unknowns.
      .replace(/<mark>\[([^\]]*)\]<\/mark>/g, "[$1, not final yet]")
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]+)\]\((?:\/|#|https?:)[^)]*\)/g, "$1")
      .replace(/\*\*/g, "");

    for (const section of md.split(/^(?=## )/m)) {
      const heading = section.match(/^## (.+)/)?.[1]?.trim();
      if (src.sections && (!heading || !src.sections.includes(heading))) continue;
      const body = section.replace(/^#{1,2} .*\n/gm, "").trim();
      if (!body) continue;
      const source = heading ? `${src.title} › ${heading}` : src.title;
      for (const text of packParagraphs(body)) chunks.push({ source, text });
    }
  }
  return chunks;
}

function packParagraphs(body: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const para of body.split(/\n\s*\n/)) {
    if (current && current.length + para.length > CHUNK_CHARS) {
      out.push(current.trim());
      current = "";
    }
    current += `${para}\n\n`;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const STOPWORDS = new Set("the and for are you your can how what when who why with does from that this have will not but our any all its about into was there their".split(" "));
const words = (s: string) => s.toLowerCase().match(/[a-z0-9₦]+/g)?.filter((w) => w.length > 2 && !STOPWORDS.has(w)) ?? [];

function keywordSearch(chunks: Chunk[], query: string, k: number): KnowledgeHit[] {
  const terms = [...new Set(words(query))];
  if (terms.length === 0) return [];
  const docs = chunks.map((c) => words(`${c.source} ${c.text}`));
  const idf = (t: string) => Math.log(1 + chunks.length / (1 + docs.filter((d) => d.includes(t)).length));
  return chunks
    .map((c, i) => ({
      source: c.source,
      text: c.text,
      score: terms.reduce((sum, t) => sum + (docs[i].filter((w) => w === t).length > 0 ? idf(t) : 0), 0),
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
