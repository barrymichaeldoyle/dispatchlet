/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as alerts from "../alerts.js";
import type * as api_auth from "../api/auth.js";
import type * as api_fns from "../api/fns.js";
import type * as api_http from "../api/http.js";
import type * as api_openapi from "../api/openapi.js";
import type * as api_rate from "../api/rate.js";
import type * as api_reference from "../api/reference.js";
import type * as api_router from "../api/router.js";
import type * as approvals from "../approvals.js";
import type * as auth from "../auth.js";
import type * as automations from "../automations.js";
import type * as benchmark from "../benchmark.js";
import type * as buffer from "../buffer.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as evals_setupAnswers from "../evals/setupAnswers.js";
import type * as hooks from "../hooks.js";
import type * as http from "../http.js";
import type * as lib_ai_client from "../lib/ai/client.js";
import type * as lib_ai_generate from "../lib/ai/generate.js";
import type * as lib_ai_pricing from "../lib/ai/pricing.js";
import type * as lib_ai_research from "../lib/ai/research.js";
import type * as lib_ai_setup from "../lib/ai/setup.js";
import type * as lib_ai_write from "../lib/ai/write.js";
import type * as lib_allowlist from "../lib/allowlist.js";
import type * as lib_apiToken from "../lib/apiToken.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_buffer from "../lib/buffer.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_dedupe from "../lib/dedupe.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_hookPayload from "../lib/hookPayload.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_playbook from "../lib/playbook.js";
import type * as lib_schedule from "../lib/schedule.js";
import type * as lib_serverEvents from "../lib/serverEvents.js";
import type * as lib_standardWebhooks from "../lib/standardWebhooks.js";
import type * as lib_templates from "../lib/templates.js";
import type * as playbooks from "../playbooks.js";
import type * as push from "../push.js";
import type * as pushSend from "../pushSend.js";
import type * as runs from "../runs.js";
import type * as status from "../status.js";
import type * as tokens from "../tokens.js";
import type * as users from "../users.js";
import type * as views from "../views.js";
import type * as waitlist from "../waitlist.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  alerts: typeof alerts;
  "api/auth": typeof api_auth;
  "api/fns": typeof api_fns;
  "api/http": typeof api_http;
  "api/openapi": typeof api_openapi;
  "api/rate": typeof api_rate;
  "api/reference": typeof api_reference;
  "api/router": typeof api_router;
  approvals: typeof approvals;
  auth: typeof auth;
  automations: typeof automations;
  benchmark: typeof benchmark;
  buffer: typeof buffer;
  crons: typeof crons;
  email: typeof email;
  "evals/setupAnswers": typeof evals_setupAnswers;
  hooks: typeof hooks;
  http: typeof http;
  "lib/ai/client": typeof lib_ai_client;
  "lib/ai/generate": typeof lib_ai_generate;
  "lib/ai/pricing": typeof lib_ai_pricing;
  "lib/ai/research": typeof lib_ai_research;
  "lib/ai/setup": typeof lib_ai_setup;
  "lib/ai/write": typeof lib_ai_write;
  "lib/allowlist": typeof lib_allowlist;
  "lib/apiToken": typeof lib_apiToken;
  "lib/budget": typeof lib_budget;
  "lib/buffer": typeof lib_buffer;
  "lib/crypto": typeof lib_crypto;
  "lib/dedupe": typeof lib_dedupe;
  "lib/email": typeof lib_email;
  "lib/hookPayload": typeof lib_hookPayload;
  "lib/limits": typeof lib_limits;
  "lib/playbook": typeof lib_playbook;
  "lib/schedule": typeof lib_schedule;
  "lib/serverEvents": typeof lib_serverEvents;
  "lib/standardWebhooks": typeof lib_standardWebhooks;
  "lib/templates": typeof lib_templates;
  playbooks: typeof playbooks;
  push: typeof push;
  pushSend: typeof pushSend;
  runs: typeof runs;
  status: typeof status;
  tokens: typeof tokens;
  users: typeof users;
  views: typeof views;
  waitlist: typeof waitlist;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
