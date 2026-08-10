import type { MyFansPost } from "./types.js";
import { replaceAsciiControlCharacters } from "./safety.js";

const replacements = new Map([
  ["<", "＜"],
  [">", "＞"],
  [":", "："],
  ['"', "＂"],
  ["/", "／"],
  ["\\", "＼"],
  ["|", "｜"],
  ["?", "？"],
  ["*", "＊"],
]);

export function extractTitle(body: string): string {
  const text = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, value: string) => safeCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => safeCodePoint(Number.parseInt(value, 16)));

  return (
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/[\t\u00a0]+/g, " ").trim())
      .find(Boolean) ?? ""
  );
}

function safeCodePoint(value: number): string {
  try {
    return String.fromCodePoint(value);
  } catch {
    return "�";
  }
}

export function sanitizeFileStem(rawTitle: string, postId: string): string {
  let title = replaceAsciiControlCharacters(
    rawTitle
      .normalize("NFC")
      .replace(/[<>:"/\\|?*]/g, (character) => replacements.get(character) ?? "＿"),
  )
    .replace(/\s+/g, " ")
    .trim();

  while (title.endsWith(".") || title.endsWith(" ")) {
    title = title.endsWith(".") ? `${title.slice(0, -1)}．` : title.trimEnd();
  }

  if (!title) {
    title = `Untitled [${postId.slice(0, 8)}]`;
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)) {
    title = `_${title}`;
  }

  if (title.length > 180) {
    const suffix = `… [${postId.slice(0, 8)}]`;
    title = `${truncateUtf16(title, 180 - suffix.length)}${suffix}`;
  }

  return title;
}

export function assignFinalNames(posts: MyFansPost[]): Map<string, string> {
  const provisional = posts.map((post) => {
    const stem = sanitizeFileStem(extractTitle(post.body), post.id);
    return { postId: post.id, stem, name: `${stem}.mp4` };
  });

  const groups = new Map<string, typeof provisional>();
  for (const item of provisional) {
    const key = item.name.normalize("NFC").toLocaleLowerCase("ja-JP");
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const result = new Map<string, string>();
  for (const group of groups.values()) {
    const prefixLength =
      group.length > 1 ? uniquePrefixLength(group.map((item) => item.postId)) : 8;
    for (const item of group) {
      const suffix = group.length > 1 ? ` [${item.postId.slice(0, prefixLength)}]` : "";
      const stem = truncateUtf16(item.stem, 240 - suffix.length - ".mp4".length);
      const name = `${stem}${suffix}.mp4`;
      result.set(item.postId, name);
    }
  }
  return result;
}

function truncateUtf16(value: string, maximumUnits: number): string {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maximumUnits) {
      break;
    }
    result += character;
  }
  return result;
}

function uniquePrefixLength(values: string[]): number {
  const maximum = Math.max(...values.map((value) => value.length));
  for (let length = 8; length <= maximum; length += 1) {
    if (new Set(values.map((value) => value.slice(0, length))).size === values.length) {
      return length;
    }
  }
  return maximum;
}
