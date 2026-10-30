# Launch day: opening sign-up (7 November)

Nothing here has been run. Every step is Barry's call.

## What is already on main

- The sign-in page drops its "opens on 7 November" note as soon as `SIGNUP_OPEN` is `true`.
  People who signed in before launch were put on the list and had their Buffer access revoked.
  They get in by signing in again.
- With the flag on, the waiting list form endpoint answers 410 and stores nothing, and sign-ins
  stop joining the list.
- A daily job deletes the closed list. Unconfirmed and unsubscribed rows go at once. The rest go
  14 days after their launch email, so its unsubscribe link works until then. `waitlist:purge`
  deletes everything by hand. Both do nothing while the flag is off.

## What is on the local `launch` branch

The branch is not pushed, so Cloudflare builds nothing from it. It holds one commit on top of main:

- The landing page swaps the waiting list form for a "Start with Buffer" link to /app. The same
  link goes on the demo's end screen and in the closing section. The "Sign-up opens 7 November"
  copy goes.
- Privacy and terms are dated 7 Nov 2026. They say the list has closed. They also cover API
  tokens, webhooks, run URLs, assistant connections, browser notifications and shared runs, which
  the 18 October policy does not mention.
- The end-to-end tests are updated, and the unused waiting list components are removed.

The policy promises the list is deleted within 30 days of closing. The daily job keeps that
promise as long as the launch email goes out within two weeks of opening.

## Steps

1. Before the day, send yourself a test copy of the launch email. Nobody is marked as sent.

   ```sh
   npx convex run email:sendLaunchTest '{"email":"barrydoyle18@gmail.com"}' --prod
   ```

2. Check the production spend cap and free allowance. The defaults are a $15 daily cap, 10 free
   runs and 3 dry runs. A new playbook's automatic first dry run uses one of the 3.

   ```sh
   npx convex env list --prod | grep -E "GLOBAL_DAILY_USD_CAP|FREE_|SIGNUP_OPEN"
   ```

3. Open sign-up.

   ```sh
   npx convex env set SIGNUP_OPEN true --prod
   ```

4. Ship the site copy, rebasing first if main has moved, then wait for the Cloudflare build.

   ```sh
   git switch launch && git rebase main && git switch main && git merge --ff-only launch && git push
   ```

5. Send the launch email. It is safe to run again, because rows already sent are skipped.

   ```sh
   npx convex run email:sendLaunch --prod
   ```

6. Test with a Buffer account that is not yours. Sign in, answer the questions, and check the dry
   run starts on its own (SPEC D11).

7. Nothing to do for the list. The daily job deletes it. To delete it at once instead, run this
   until it prints 0.

   ```sh
   npx convex run waitlist:purge --prod
   ```

## Undo

Before the email goes out, run `npx convex env set SIGNUP_OPEN false --prod` and revert the merge.
After the email, keep it open.
