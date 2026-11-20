// Marketplace listing rules (https://paseo.sh/docs/plugins/publishing.md) checked before a release:
// manifest icon/media point at real package files, translations are well formed, and the overviews
// contain no install commands (the registry validator rejects them anywhere in an overview).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "paseo-plugin.json"), "utf8")) as {
  icon?: string;
  media?: string[];
  translations?: Record<string, Record<string, unknown>>;
};
const files = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { files: string[] }).files;

const IMAGES = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const VIDEOS = [".mp4", ".webm"];

/** A canonical language tag with a 2-3 letter language code, other than en. */
function isTranslationTag(tag: string): boolean {
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(tag)[0];
  } catch {
    return false;
  }
  return canonical === tag && /^[a-z]{2,3}(?:-|$)/.test(tag) && tag !== "en";
}

/** Package-relative, forward slashes, inside the plugin directory, existing, and shipped. */
function checkPackagePath(path: string, allowed: string[]): string[] {
  const problems: string[] = [];
  if (isAbsolute(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) problems.push(`${path}: not package-relative`);
  if (path.includes("\\")) problems.push(`${path}: backslash`);
  const rel = relative(root, resolve(root, path));
  if (rel.startsWith("..") || isAbsolute(rel)) problems.push(`${path}: outside the plugin directory`);
  if (!allowed.includes(extname(path).toLowerCase())) problems.push(`${path}: extension not allowed`);
  if (!existsSync(join(root, path))) problems.push(`${path}: missing`);
  if (!files.some((entry) => entry === path || (entry.endsWith("/") && path.startsWith(entry)))) problems.push(`${path}: not in package.json files`);
  return problems;
}

test("icon is a shipped PNG inside the package", () => {
  assert.ok(manifest.icon, "icon is set");
  assert.deepEqual(checkPackagePath(manifest.icon, [".png"]), []);
  const magic = readFileSync(join(root, manifest.icon)).subarray(0, 8).toString("hex");
  assert.equal(magic, "89504e470d0a1a0a", "icon file is really a PNG");
});

test("media entries are shipped images or videos, the first one an image", () => {
  const media = manifest.media ?? [];
  assert.ok(media.length > 0, "a visual plugin needs at least one interface image");
  assert.deepEqual(media.flatMap((path) => checkPackagePath(path, [...IMAGES, ...VIDEOS])), []);
  assert.ok(IMAGES.includes(extname(media[0]).toLowerCase()), "the first media item is the card thumbnail and must be an image");
});

test("translations: canonical non-en tags, only non-empty name/description", () => {
  const problems: string[] = [];
  for (const [tag, value] of Object.entries(manifest.translations ?? {})) {
    if (!isTranslationTag(tag)) problems.push(`${tag}: not a canonical non-en language tag`);
    for (const [field, text] of Object.entries(value)) {
      if (field !== "name" && field !== "description") problems.push(`${tag}.${field}: only name and description are allowed`);
      else if (typeof text !== "string" || !text.trim()) problems.push(`${tag}.${field}: must be a non-empty string`);
    }
  }
  assert.deepEqual(problems, []);
});

const overviews = readdirSync(root).filter((name) => /^OVERVIEW(?:\.[^.]+)?\.md$/.test(name));

test("localized overview files use canonical language tags", () => {
  assert.ok(overviews.includes("OVERVIEW.md"));
  const bad = overviews.filter((name) => name !== "OVERVIEW.md" && !isTranslationTag(name.slice("OVERVIEW.".length, -".md".length)));
  assert.deepEqual(bad, [], "the registry ignores (or misreads) these names");
});

test("overviews contain no install commands, even inside code or emphasis", () => {
  const problems: string[] = [];
  for (const name of overviews) {
    const text = readFileSync(join(root, name), "utf8").replace(/[`*_]/g, "");
    for (const [i, line] of text.split("\n").entries()) {
      if (/paseo\s+plugin\s+add|npm\s+install\b|npm\s+i\b/i.test(line)) problems.push(`${name}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("relative links and images in the docs point at existing files", () => {
  const problems: string[] = [];
  for (const name of ["README.md", ...overviews]) {
    const text = readFileSync(join(root, name), "utf8");
    const targets = [...text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g), ...text.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((target) => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target));
    for (const target of targets) {
      const path = decodeURI(target.split("#")[0]);
      if (!existsSync(join(root, path))) problems.push(`${name}: ${target}`);
    }
  }
  assert.deepEqual(problems, []);
});
