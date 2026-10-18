/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as buffer from "../buffer.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as lib_allowlist from "../lib/allowlist.js";
import type * as lib_budget from "../lib/budget.js";
import type * as lib_buffer from "../lib/buffer.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_email from "../lib/email.js";
import type * as users from "../users.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  buffer: typeof buffer;
  crons: typeof crons;
  email: typeof email;
  http: typeof http;
  "lib/allowlist": typeof lib_allowlist;
  "lib/budget": typeof lib_budget;
  "lib/buffer": typeof lib_buffer;
  "lib/crypto": typeof lib_crypto;
  "lib/email": typeof lib_email;
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
