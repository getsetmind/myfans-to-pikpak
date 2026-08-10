const credentialPatterns = [
  /Token\s+token=[^\s"']+/gi,
  /Bearer\s+[^\s"']+/gi,
  /_mfans_token=[^;\s"']+/gi,
];

export function redactText(value: string, secrets: string[] = []): string {
  let result = value;
  for (const secret of secrets.filter((candidate) => candidate.length > 0)) {
    result = result.replaceAll(secret, "[REDACTED]");
  }
  for (const pattern of credentialPatterns) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function redactValue(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") {
    return redactText(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        /token|authorization|cookie|password|secret/i.test(key)
          ? "[REDACTED]"
          : redactValue(item, secrets),
      ]),
    );
  }
  return value;
}
