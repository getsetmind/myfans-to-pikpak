import { AppError } from "../core/errors.js";
import type { MyFansPlan, MyFansPost, VideoSource } from "../core/types.js";
import type { SourcePort } from "../ports.js";

const API_ROOT = "https://api.myfans.jp/api";
const USER_AGENT = "Mozilla/5.0 (compatible; myfans-to-pikpak/1.0)";

interface PostPayload {
  id?: unknown;
  body?: unknown;
  publish_start_at?: unknown;
  published_at?: unknown;
  thumbnail_url?: unknown;
  thumbnailUrl?: unknown;
  thumbnail?: { url?: unknown };
  metadata?: { thumbnail_url?: unknown; thumbnailUrl?: unknown };
}

interface VideoPayload {
  url?: unknown;
  width?: unknown;
}

interface SubscriptionPayload {
  id?: unknown;
  created_at?: unknown;
  active_until?: unknown;
  will_cancel?: unknown;
  plan?: {
    id?: unknown;
    product_name?: unknown;
    posts_count?: unknown;
    user?: {
      username?: unknown;
      name?: unknown;
    };
  };
}

export class MyFansClient implements SourcePort {
  private readonly fetchImplementation: typeof fetch;
  private readonly minimumIntervalMs: number;
  private readonly retryDelayMs: number;
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(
    private readonly token: string,
    options: {
      fetch?: typeof fetch;
      minimumIntervalMs?: number;
      retryDelayMs?: number;
    } = {},
  ) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.minimumIntervalMs = options.minimumIntervalMs ?? 250;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  async listPlans(): Promise<MyFansPlan[]> {
    const payload = await this.get(new URL(`${API_ROOT}/v1/account/subscriptions`));
    const subscriptions = Array.isArray(payload)
      ? payload
      : payload !== null &&
          typeof payload === "object" &&
          Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : null;
    if (!subscriptions) {
      throw new AppError("SOURCE_ERROR", "MyFans returned an unexpected subscriptions response.");
    }
    return subscriptions.map((raw) => mapSubscription(raw));
  }

  async listPosts(planId: string): Promise<MyFansPost[]> {
    const posts: MyFansPost[] = [];
    const seenPages = new Set<number>();
    let page: number | null = 1;
    while (page !== null) {
      if (seenPages.has(page)) {
        throw new AppError("SOURCE_ERROR", "MyFans returned a pagination cycle.");
      }
      seenPages.add(page);
      const url = new URL(`${API_ROOT}/v2/plans/${encodeURIComponent(planId)}/posts`);
      url.searchParams.set("sort_key", "publish_start_at");
      url.searchParams.set("per_page", "20");
      url.searchParams.set("page", String(page));
      const payload = (await this.get(url)) as {
        data?: unknown;
        pagination?: { next?: unknown };
      };
      if (!Array.isArray(payload.data)) {
        throw new AppError("SOURCE_ERROR", "MyFans returned an unexpected posts response.");
      }
      for (const raw of payload.data as PostPayload[]) {
        const id = typeof raw.id === "string" ? raw.id.trim() : "";
        if (!id) {
          throw new AppError("SOURCE_ERROR", "A MyFans post is missing its ID.");
        }
        posts.push({
          id,
          body: typeof raw.body === "string" ? raw.body : "",
          publishedAt: stringOrNull(raw.publish_start_at) ?? stringOrNull(raw.published_at),
          thumbnailUrl: thumbnailUrl(raw),
        });
      }
      const next = payload.pagination?.next;
      page = typeof next === "number" && Number.isInteger(next) ? next : null;
    }
    return posts;
  }

  async getVideoSource(postId: string): Promise<VideoSource> {
    const payload = (await this.get(
      new URL(`${API_ROOT}/v2/posts/${encodeURIComponent(postId)}/videos`),
    )) as {
      main?: unknown;
    };
    const videos = Array.isArray(payload.main) ? (payload.main as VideoPayload[]) : [];
    const best = videos
      .filter((video): video is { url: string; width?: unknown } => typeof video.url === "string")
      .sort((left, right) => numericWidth(right.width) - numericWidth(left.width))[0];
    if (!best) {
      throw new AppError("SOURCE_ERROR", `No downloadable video was found for post ${postId}.`);
    }
    return { url: best.url, kind: /\.m3u8(?:$|\?)/i.test(best.url) ? "hls" : "mp4" };
  }

  private async get(url: URL): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await this.waitForRequestTurn();
      let response: Response;
      try {
        response = await this.fetchImplementation(url, {
          headers: {
            Authorization: `Token token=${this.token}`,
            "User-Agent": USER_AGENT,
            "google-ga-data": "event328",
          },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (attempt < 3) {
          await wait(this.retryDelayMs * 2 ** attempt);
          continue;
        }
        throw new AppError("SOURCE_ERROR", "The MyFans API request failed after retries.", {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          await response.body?.cancel().catch(() => undefined);
          await wait(retryDelay(response, this.retryDelayMs * 2 ** attempt));
          continue;
        }
        throw new AppError("SOURCE_ERROR", `The MyFans API returned HTTP ${response.status}.`);
      }
      try {
        return await response.json();
      } catch {
        throw new AppError("SOURCE_ERROR", "The MyFans API returned invalid JSON.");
      }
    }
    throw new AppError("SOURCE_ERROR", "The MyFans API retry loop ended unexpectedly.");
  }

  private async waitForRequestTurn(): Promise<void> {
    const previous = this.requestQueue;
    let release: () => void = () => undefined;
    this.requestQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    await wait(Math.max(0, this.nextRequestAt - Date.now()));
    this.nextRequestAt = Date.now() + this.minimumIntervalMs;
    release();
  }
}

function mapSubscription(value: unknown): MyFansPlan {
  if (value === null || typeof value !== "object") {
    throw new AppError("SOURCE_ERROR", "MyFans returned an invalid subscription entry.");
  }
  const subscription = value as SubscriptionPayload;
  const subscriptionId = requiredString(subscription.id);
  const planId = requiredString(subscription.plan?.id);
  const creatorUsername = requiredString(subscription.plan?.user?.username);
  if (!subscriptionId || !planId || !creatorUsername) {
    throw new AppError("SOURCE_ERROR", "A MyFans subscription is missing its identity fields.");
  }
  const name = stringOrNull(subscription.plan?.product_name) ?? "(untitled plan)";
  const creatorName = stringOrNull(subscription.plan?.user?.name) ?? creatorUsername;
  const postsCount = subscription.plan?.posts_count;
  return {
    id: planId,
    name,
    postsCount:
      typeof postsCount === "number" && Number.isInteger(postsCount) && postsCount >= 0
        ? postsCount
        : null,
    creatorUsername,
    creatorName,
    url: `https://myfans.jp/${encodeURIComponent(creatorUsername)}/plans/${encodeURIComponent(planId)}`,
    subscriptionId,
    subscribedAt: stringOrNull(subscription.created_at),
    activeUntil: stringOrNull(subscription.active_until),
    willCancel: subscription.will_cancel === true,
  };
}

function retryDelay(response: Response, fallback: number): number {
  const value = response.headers.get("Retry-After");
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(30_000, Math.max(0, date - Date.now())) : fallback;
}

function wait(milliseconds: number): Promise<void> {
  return milliseconds <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numericWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function thumbnailUrl(post: PostPayload): string | null {
  return (
    stringOrNull(post.thumbnail_url) ??
    stringOrNull(post.thumbnailUrl) ??
    stringOrNull(post.thumbnail?.url) ??
    stringOrNull(post.metadata?.thumbnail_url) ??
    stringOrNull(post.metadata?.thumbnailUrl)
  );
}
