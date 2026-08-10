export function hasAsciiControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

export function replaceAsciiControlCharacters(value: string, replacement = " "): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? replacement : character;
    })
    .join("");
}

export function isSafeIdentifier(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}

export function isSafeFileName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !hasAsciiControlCharacters(value)
  );
}

export function isSafeRemoteTarget(value: string): boolean {
  return /^[^:\s/\\]+:.*$/.test(value) && !hasAsciiControlCharacters(value);
}
