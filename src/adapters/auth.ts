import { AppError } from "../core/errors.js";

interface CdpPage {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export interface AuthResult {
  token: string;
  source: "environment" | "browser";
}

export async function resolveMyFansToken(cdpUrl = "http://127.0.0.1:9222"): Promise<AuthResult> {
  const environmentToken = process.env.MYFANS_TOKEN?.trim();
  if (environmentToken) {
    return { token: environmentToken, source: "environment" };
  }

  let pages: CdpPage[];
  try {
    const response = await fetch(new URL("/json/list", cdpUrl));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const value = await response.json();
    if (!Array.isArray(value)) {
      throw new Error("Unexpected CDP response");
    }
    pages = value as CdpPage[];
  } catch {
    throw new AppError(
      "AUTH_REQUIRED",
      "MYFANS_TOKEN is unset and no Chromium debugging endpoint is available.",
      { cdpUrl },
    );
  }

  const page = pages.find(
    (candidate) =>
      candidate.type === "page" &&
      candidate.url?.startsWith("https://myfans.jp/") &&
      candidate.webSocketDebuggerUrl,
  );
  if (!page?.webSocketDebuggerUrl) {
    throw new AppError("AUTH_REQUIRED", "No signed-in MyFans tab was found in the browser.");
  }

  return {
    token: await tokenFromPage(page.webSocketDebuggerUrl),
    source: "browser",
  };
}

function tokenFromPage(webSocketUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const requestId = 1;
    const timer = setTimeout(() => {
      socket.close();
      reject(new AppError("AUTH_REQUIRED", "Browser authentication lookup timed out."));
    }, 10_000);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: requestId,
          method: "Runtime.evaluate",
          params: {
            expression: `(() => { const p = "_mfans_token="; const e = document.cookie.split("; ").find((v) => v.startsWith(p)); return e ? decodeURIComponent(e.slice(p.length)) : null; })()`,
            returnByValue: true,
          },
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      let message: { id?: number; result?: { result?: { value?: unknown } } };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id !== requestId) {
        return;
      }
      clearTimeout(timer);
      socket.close();
      const token = message.result?.result?.value;
      if (typeof token !== "string" || token.length === 0) {
        reject(new AppError("AUTH_REQUIRED", "The MyFans browser session has no usable token."));
        return;
      }
      resolve(token);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new AppError("AUTH_REQUIRED", "Could not connect to the browser debugging session."));
    });
  });
}
