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
import type * as approvals from "../approvals.js";
import type * as auth from "../auth.js";
import type * as automations from "../automations.js";
import type * as buffer from "../buffer.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as evals_setupAnswers from "../evals/setupAnswers.js";
import type * as http from "../http.js";
import type * as lib_ai_client from "../lib/ai/client.js";
import type * as lib_ai_generate from "../lib/ai/generate.js";
import type * as lib_ai_pricing from "../lib/ai/pricing.js";
import type * as lib_ai_research from "../lib/ai/research.js";
import type * as lib_ai_setup from "../lib/ai/setup.js";
import type * as lib_ai_write from "../lib/ai/write.js";
import type * as lib_allowlist from "../lib/allowlist.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_buffer from "../lib/buffer.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_dedupe from "../lib/dedupe.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_playbook from "../lib/playbook.js";
import type * as lib_schedule from "../lib/schedule.js";
import type * as lib_templates from "../lib/templates.js";
import type * as playbooks from "../playbooks.js";
import type * as runs from "../runs.js";
import type * as status from "../status.js";
import type * as users from "../users.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  alerts: typeof alerts;
  approvals: typeof approvals;
  auth: typeof auth;
  automations: typeof automations;
  buffer: typeof buffer;
  crons: typeof crons;
  email: typeof email;
  "evals/setupAnswers": typeof evals_setupAnswers;
  http: typeof http;
  "lib/ai/client": typeof lib_ai_client;
  "lib/ai/generate": typeof lib_ai_generate;
  "lib/ai/pricing": typeof lib_ai_pricing;
  "lib/ai/research": typeof lib_ai_research;
  "lib/ai/setup": typeof lib_ai_setup;
  "lib/ai/write": typeof lib_ai_write;
  "lib/allowlist": typeof lib_allowlist;
  "lib/budget": typeof lib_budget;
  "lib/buffer": typeof lib_buffer;
  "lib/crypto": typeof lib_crypto;
  "lib/dedupe": typeof lib_dedupe;
  "lib/email": typeof lib_email;
  "lib/limits": typeof lib_limits;
  "lib/playbook": typeof lib_playbook;
  "lib/schedule": typeof lib_schedule;
  "lib/templates": typeof lib_templates;
  playbooks: typeof playbooks;
  runs: typeof runs;
  status: typeof status;
  users: typeof users;
  waitlist: typeof waitlist;
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
