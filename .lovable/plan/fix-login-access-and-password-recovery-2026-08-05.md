# Fix login access and password recovery

## What's wrong

The email being used to sign in, `nixin@bizsyncgroup.com`, has no account in the system — so every attempt correctly returns "Invalid login credentials". The accounts that do exist for you are `nswift@bizsyncgroup.com` and `nixinswift@gmail.com`.

Since registration is restricted to approved emails, the right path is to regain access to the existing `nswift@bizsyncgroup.com` account with a password reset rather than create a new one.

While reviewing the sign-in page, two real defects in the recovery flow were found that would block that reset from working:

1. The reset email link delivers its parameters in the URL hash fragment (or as a `code` query param), but the page only inspects `location.search` for `type=recovery`. The "Set a new password" form therefore never appears.
2. The auth listener navigates away to `/` as soon as any session appears. The recovery link creates a session, so the user is bounced off the reset form before they can set a password.

## What will change

- Detect recovery mode from the URL hash as well as the query string, and from the `PASSWORD_RECOVERY` auth event.
- Stop the auto-redirect to `/` while the page is in recovery mode, so the new-password form stays on screen.
- Keep the existing forgot-password and magic-link entry points as they are.

No database or schema changes.

## How you get back in

After the fix, use "Forgot password?" on the sign-in page with `nswift@bizsyncgroup.com`, open the emailed link, and set a new password. The magic-link option works as an alternative.

## Technical notes

All changes are confined to `src/pages/Auth.tsx`: recovery detection reads `window.location.hash` params in addition to `location.search`, an `isRecoveryMode` guard is added to both the `getSession` check and the `onAuthStateChange` handler, and `PASSWORD_RECOVERY` is handled explicitly.
