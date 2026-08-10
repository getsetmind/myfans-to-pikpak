import { resolveMyFansToken } from "../adapters/auth.js";
import { MyFansClient } from "../adapters/myfans.js";
import type { GlobalOptions } from "../cli/options.js";

export async function plans(global: GlobalOptions) {
  const auth = await resolveMyFansToken(global.cdpUrl);
  const source = new MyFansClient(auth.token);
  const subscriptions = await source.listPlans();
  return { count: subscriptions.length, plans: subscriptions };
}
