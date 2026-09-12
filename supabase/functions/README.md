# `functions/` — Edge Functions (Deno)

Empty at the initial migration set. Nothing in 0001–0016 requires an edge function: the action
envelope, the policy gate and the outbox are all in-database, and realtime is served by
Postgres logical replication rather than a function.

The first functions this project will need, when their lane lands:

| Function | Why it cannot be a database function |
|---|---|
| `webhook-email` / `webhook-whatsapp` | Verify a provider HMAC before the payload is trusted |
| `outbox-dispatch` | Outbound HTTP to the accounting package and the BSP |
| `ai-run` | Calls model providers with keys that never enter the database |

`_shared/` holds cross-function helpers (CORS, the shared-secret gate, the tenant resolver).

Any function that authenticates with something other than a Supabase JWT needs
`verify_jwt = false` in `../config.toml`, with a comment naming the mechanism it uses instead.
The platform's default JWT check runs BEFORE the handler, so leaving it on 401s a caller the
function was designed to authenticate itself.
