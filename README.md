# agent-governance

JavaScript SDK for **Cerone** on **AZTP**.

Install it, create an agent, validate a real action, and get an explicit runtime decision:

- `approved`
- `flagged`
- `rejected`

The npm package name is `agent-governance` for discoverability. The product/runtime it talks to is Cerone powered by AZTP.

## Install

```bash
npm install agent-governance
```

Node 18+ is required because the SDK uses the built-in `fetch` and `AbortController`.

## Quick Start

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

## Hosted Trial

If you do not pass an API key, the SDK will automatically bootstrap a hosted trial token by calling:

- `POST /trial/session`

It persists the trial token at:

- `~/.cerone/trial_token`

Protected API routes still use:

- `X-API-Key: sk_trial_...`

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

`validateBatch([])` is rejected locally with a clear error before the request is sent.

### Trial / health / usage methods

- `healthCheck()`
- `getUsage()`
- `ensureApiKey()`

### Delegated token methods

- `delegateToken(options)`
- `verifyToken(accessToken, options?)`
- `revokeToken(accessToken)`

## Request Shape

Validation requests use the AZTP-compatible shape:

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

## Runtime Headers

The SDK sends telemetry headers including:

- `User-Agent: agent-governance-node-sdk/<version>`
- `X-Cerone-SDK-Name`
- `X-Cerone-SDK-Version`
- `X-Cerone-Platform`
- `X-Cerone-Client-Intent`

## Notes

- This package is server-side Node code.
- Do not expose your Cerone/AZTP API key in browser bundles.
- For enterprise / persistent access, contact `info@homersemantics.com`.
