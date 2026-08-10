import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMyFansToken } from "../src/adapters/auth.js";
import { MyFansClient } from "../src/adapters/myfans.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.MYFANS_TOKEN;
});

describe("MyFans adapters", () => {
  it("uses environment authentication without opening the browser", async () => {
    process.env.MYFANS_TOKEN = "fixture-token";
    await expect(resolveMyFansToken()).resolves.toEqual({
      token: "fixture-token",
      source: "environment",
    });
  });

  it("reads authentication from a fake Chromium debugging endpoint", async () => {
    const webSocketServer = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(webSocketServer, "listening");
    const webSocketPort = (webSocketServer.address() as AddressInfo).port;
    webSocketServer.on("connection", (socket) => {
      socket.once("message", (data) => {
        const request = JSON.parse(String(data));
        socket.send(
          JSON.stringify({
            id: request.id,
            result: { result: { value: "fake-cdp-token" } },
          }),
        );
      });
    });

    const httpServer = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify([
          {
            type: "page",
            url: "https://myfans.jp/",
            webSocketDebuggerUrl: `ws://127.0.0.1:${webSocketPort}`,
          },
        ]),
      );
    });
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const httpPort = (httpServer.address() as AddressInfo).port;
    try {
      await expect(resolveMyFansToken(`http://127.0.0.1:${httpPort}`)).resolves.toEqual({
        token: "fake-cdp-token",
        source: "browser",
      });
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => httpServer.close(() => resolve())),
        new Promise<void>((resolve) => webSocketServer.close(() => resolve())),
      ]);
    }
  });

  it("maps post fixtures and selects the widest video without exposing auth", async () => {
    const postsPage = JSON.parse(await readFile("tests/fixtures/myfans-posts-page.json", "utf8"));
    const requests: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);
        requests.push({
          url,
          authorization: new Headers(init?.headers).get("Authorization"),
        });
        if (url.includes("/videos")) {
          return Response.json({
            main: [
              { url: "https://example.invalid/low.m3u8", width: 640 },
              { url: "https://example.invalid/high.mp4", width: 1920 },
            ],
          });
        }
        return Response.json(postsPage);
      }),
    );

    const client = new MyFansClient("fixture-token", { minimumIntervalMs: 0, retryDelayMs: 0 });
    await expect(client.listPosts("fixture-plan")).resolves.toEqual([
      {
        id: "fixture-post-0001",
        body: "Fixture title",
        publishedAt: "2026-01-01T00:00:00Z",
        thumbnailUrl: "https://example.invalid/thumbnail.jpg",
      },
    ]);
    await expect(client.getVideoSource("fixture-post-0001")).resolves.toEqual({
      url: "https://example.invalid/high.mp4",
      kind: "mp4",
    });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.authorization === "Token token=fixture-token")).toBe(
      true,
    );
    expect(JSON.stringify(await client.listPosts("fixture-plan"))).not.toContain("fixture-token");
  });

  it("lists active subscriptions as importable plans", async () => {
    const subscriptions = [
      {
        id: "fixture-subscription-0001",
        created_at: "2026-01-01T00:00:00Z",
        active_until: "2026-02-01T00:00:00Z",
        will_cancel: false,
        plan: {
          id: "fixture-plan-0001",
          product_name: "Fixture Gold",
          posts_count: 12,
          user: {
            username: "fixture_creator",
            name: "Fixture Creator",
          },
        },
      },
    ];
    const requests: string[] = [];
    const client = new MyFansClient("fixture-token", {
      minimumIntervalMs: 0,
      retryDelayMs: 0,
      fetch: async (input) => {
        requests.push(String(input));
        return Response.json(subscriptions);
      },
    });

    await expect(client.listPlans()).resolves.toEqual([
      {
        id: "fixture-plan-0001",
        name: "Fixture Gold",
        postsCount: 12,
        creatorUsername: "fixture_creator",
        creatorName: "Fixture Creator",
        url: "https://myfans.jp/fixture_creator/plans/fixture-plan-0001",
        subscriptionId: "fixture-subscription-0001",
        subscribedAt: "2026-01-01T00:00:00Z",
        activeUntil: "2026-02-01T00:00:00Z",
        willCancel: false,
      },
    ]);
    expect(requests).toEqual(["https://api.myfans.jp/api/v1/account/subscriptions"]);
    expect(JSON.stringify(await client.listPlans())).not.toContain("fixture-token");
  });

  it("retries rate limits and server failures with bounded attempts", async () => {
    let calls = 0;
    const client = new MyFansClient("fixture-token", {
      minimumIntervalMs: 0,
      retryDelayMs: 0,
      fetch: async () => {
        calls += 1;
        if (calls === 1)
          return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
        if (calls === 2) return new Response(null, { status: 503 });
        return Response.json({ data: [], pagination: { next: null } });
      },
    });
    await expect(client.listPosts("fixture-plan")).resolves.toEqual([]);
    expect(calls).toBe(3);
  });
});
