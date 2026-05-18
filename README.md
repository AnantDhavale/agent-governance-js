# agent-governance

**Cerone runtime agent governance for AI agents in JavaScript and Node.**

Install it. Create an agent. Validate a real action. Get a live governance decision in minutes.

This package talks to the **Cerone runtime** and returns explicit runtime decisions before an action executes:

- `approved`
- `flagged`
- `rejected`

The npm package name is `agent-governance` for discoverability. The hosted runtime behind it is Cerone.

## Why developers use it

- start immediately with hosted trial access from the SDK
- validate agent actions before they execute
- keep your own OpenAI, Anthropic, or other model key
- add runtime governance without replacing the rest of your stack
- get real decisions instead of vague policy claims
- use a lean trust layer instead of a heavy platform rewrite

## Install

```bash
npm install agent-governance
```

Node 18+ is required because the SDK uses the built-in `fetch` and `AbortController`.

## Quick start

```js
import { CeroneClient } from "agent-governance";

const client = new CeroneClient();

const agent = await client.createAgent(
  "Customer billing support",
  ["db_read", "billing_api"],
);

const result = await client.validate(
  agent.agentId,
  "database_query",
  { table: "billing", customer_id: "123" },
);

console.log("Agent:", agent.agentId);
console.log("Decision:", result.result);
console.log("Trust:", result.trustScore);
```

## Hosted trial and access

If you do not pass an API key, the SDK automatically bootstraps a hosted trial token by calling:

- `POST /trial/session`

That token is persisted locally at:

- `~/.cerone/trial_token`

Protected API routes still use:

- `X-API-Key: sk_trial_...`

Current access paths:

1. Hosted trial
- no manual signup required to begin evaluation
- designed for testing, demos, and first integrations
- if the trial is exhausted, contact us for persistent access

2. Persistent access
- use a provisioned key for POCs, pilots, and production environments

Support:

- [homersemantics.com](https://homersemantics.com)
- [info@homersemantics.com](mailto:info@homersemantics.com)

Hosted service terms:

- [TERMS_OF_SERVICE.md](https://github.com/AnantDhavale/agent-governance-js/blob/main/TERMS_OF_SERVICE.md)
- [PRIVACY.md](https://github.com/AnantDhavale/agent-governance-js/blob/main/PRIVACY.md)

## What this SDK does

It is a thin Node client for the hosted Cerone runtime. It can:

- create root agents
- spawn child agents
- validate actions
- validate action batches
- fetch usage
- issue delegated tokens
- verify and revoke delegated tokens

The goal is to keep the client side light while identity, validation, trust, governance, and audit logic stay centralized in the Cerone runtime.

## Single action vs batch validation

Start with `validate(...)` for a single action. Use `validateBatch([...])` only when you already have two or more validation items to send together.

Single action:

```js
import { CeroneClient } from "agent-governance";

const client = new CeroneClient();

const agent = await client.createAgent(
  "Customer billing support",
  ["db_read", "billing_api"],
);

const result = await client.validate(
  agent.agentId,
  "database_query",
  { table: "billing", customer_id: "123" },
);

console.log(result.result, result.trustScore);
```

Batch validation:

```js
import { CeroneClient } from "agent-governance";

const client = new CeroneClient();

const results = await client.validateBatch([
  {
    agentId: "agt_123",
    action: {
      tool: "database_query",
      parameters: { table: "billing", customer_id: "123" },
    },
  },
  {
    agentId: "agt_456",
    action: {
      tool: "refund_lookup",
      parameters: { refund_id: "rf_789" },
    },
  },
]);

for (const item of results) {
  console.log(item.agentId, item.result, item.trustScore);
}
```

If you call `validateBatch([])`, the SDK raises a local error before making a request.

## API

Main exports:

- `CeroneClient`
- `AgentGovernanceClient` (alias)
- `CeroneError`
- `AuthenticationError`
- `ValidationError`
- `RateLimitError`
- `NetworkError`

### `new CeroneClient(options?)`

Options:

- `apiKey`
- `baseUrl` default: `https://api.homersemantics.com`
- `timeoutMs` default: `30000`
- `maxRetries` default: `3`
- `retryNonIdempotent` default: `false`
- `enableCache` default: `false`
- `cacheTtlMs` default: `300000`
- `trialTokenPath`

### Agent / certificate methods

- `createAgent(purpose, capabilities?, options?)`
- `spawnAgent(parentId, purpose, capabilities?, options?)`

### Validation methods

- `validate(agentId, action, parameters?)`
- `validateBatch(validations)`

### Trial / health / usage methods

- `healthCheck()`
- `getUsage()`
- `ensureApiKey()`

### Delegated token methods

- `delegateToken(options)`
- `verifyToken(accessToken, options?)`
- `revokeToken(accessToken)`

## Request shape

Validation requests use the Cerone runtime request shape:

```json
{
  "agent_id": "agt_...",
  "action": {
    "tool": "database_query",
    "parameters": {
      "table": "billing"
    }
  }
}
```

## Runtime headers

The SDK sends telemetry headers including:

- `User-Agent: agent-governance-node-sdk/<version>`
- `X-Cerone-SDK-Name`
- `X-Cerone-SDK-Version`
- `X-Cerone-Platform`
- `X-Cerone-Client-Intent`

## Bring your own model key

Cerone governs agent behavior, not inference.

You keep your own OpenAI, Anthropic, or other provider key and pass it directly to your model calls. Cerone validates the intended action and records the governance trail, but it does not sit in the middle of your model billing path.

## Notes

- this package is server-side Node code
- do not expose your Cerone API key in browser bundles
- for enterprise or persistent access, contact `info@homersemantics.com`
