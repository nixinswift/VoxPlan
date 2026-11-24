# Health & API Key Verification

## What I can confirm right now (read-only checks)

- Backend (database + auth) is up and responding normally.
- Both AI credentials are present in backend secrets: `LOVABLE_API_KEY` (used by 9 functions) and `OPENAI_API_KEY` (used by voice: `voxpal-realtime`, `transcribe-audio`).
- No errors in dev server or browser console.
- No AI Gateway requests and no voice-function logs in the last 7 days — meaning nothing has failed, but nothing has actually exercised the keys either. So "still connects" is currently unverified, not proven.

## Proposed verification pass

1. Live-call one Lovable AI function (e.g. `parse-voice-input` with a tiny prompt) and read the response/status to confirm the gateway key authenticates and the model id is accepted.
2. Live-call `voxpal-realtime` to confirm the OpenAI key mints a realtime session token and the `gpt-realtime` model name is accepted (this was the recent fix and has never been exercised since).
3. Live-call `transcribe-audio` with a minimal audio payload to confirm the Whisper endpoint accepts the same OpenAI key.
4. Spot-check the remaining Lovable-AI functions for outdated model ids against the current supported catalog, so nothing else fails the way the realtime model did.
5. Load the app in a headless browser against the preview, sign-in state included, and screenshot the main pages (Gantt, Estimating, Specs) to confirm no runtime errors on load.
6. Report per-key result: OK / failing with the exact error, plus any model ids that need updating.

## Fixes included if a check fails

- Update any outdated model id to the current supported equivalent.
- Fix auth/header or CORS issues surfaced by the live calls.
- If the OpenAI key itself is rejected by OpenAI, I'll tell you so you can regenerate it — I can't validate it any other way.

## Technical notes

- Function invocations in step 1-3 consume a very small amount of AI credits; that's the only way to truly prove the keys connect.
- `LOVABLE_API_KEY` can be rotated automatically if the gateway reports the key itself is invalid; `OPENAI_API_KEY` is user-provided and would need re-entry.
