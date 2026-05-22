# agent-governance

**Cerone runtime agent governance for AI agents in JavaScript and Node.**

Install it. Create an agent. Validate a real action. Get a live governance decision in minutes.

This package talks to the **Cerone runtime** and returns explicit runtime decisions before an action executes:

- `approved`
- `flagged`
- `rejected`

The npm package name is `agent-governance` for discoverability. The hosted runtime behind it is Cerone.

The SDK also forwards stable client metadata with every request so trial bootstrap,
agent creation, and validation attempts can be correlated cleanly without forcing
you into any separate telemetry product.

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

const agent = await client.createAgentForAction("file_read", {
  workspaceTarget: "repository files and source code",
  environment: "development",
});

const result = await client.validate(
  agent.agentId,
  "file_read",
  { path: "README.md" },
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
- create root agents from a real action with inferred purpose/capability framing
- spawn child agents
- validate actions
- validate action batches
- fetch usage
- issue delegated tokens
- verify and revoke delegated tokens

The goal is to keep the client side light while identity, validation, trust, governance, and audit logic stay centralized in the Cerone runtime.

## Runtime policy and containment

Cerone is also evolving into a stronger runtime policy layer, not just an
identity and semantic-alignment layer.

The current direction includes runtime detections for patterns such as:

- prompt injection
- instruction override
- role manipulation
- policy evasion
- secret harvesting
- data exfiltration
- obfuscation and encoded payload tricks

These checks are meant to complement semantic validation:

- semantic alignment asks whether the action fits the declared purpose
- runtime policy checks ask whether the action payload itself looks unsafe,
  manipulative, evasive, or exfiltration-oriented

Cerone also has an operator-controlled containment direction:

- manual kill switch support
- soft containment
- hard containment

Important:

- detection does not automatically activate containment by default
- the intended default behavior is operator-controlled, manual activation

For integrators, the practical rule remains simple:

- `approved` -> continue
- `flagged` -> review or warn according to your app policy
- `rejected` -> block execution

## Single action vs batch validation

Start with `validate(...)` for a single action. Use `validateBatch([...])` only when you already have two or more validation items to send together.

Single action:

```js
import { CeroneClient } from "agent-governance";

const client = new CeroneClient();

const agent = await client.createAgentForAction("file_read", {
  workspaceTarget: "repository files and source code",
  environment: "development",
});

const result = await client.validate(
  agent.agentId,
  "file_read",
  { path: "README.md" },
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
- `LocalValidationError`
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
- `integrationId` optional stable identifier for your host app or wrapper
- `clientSessionId` optional run/session correlation id
- `telemetryHook` optional callback for structured SDK lifecycle events
- `telemetryMetadata` optional static metadata merged into emitted SDK events

### Agent / certificate methods

- `createAgent(purpose, capabilities?, options?)`
- `createAgentForAction(action, options?)`
- `spawnAgent(parentId, purpose, capabilities?, options?)`

### Validation methods

- `validate(agentId, action, parameters?)`
- `validateBatch(validations)`

### Telemetry and local errors

Optional SDK lifecycle events:

- `client_initialized`
- `hosted_trial_started`
- `trial_token_received`
- `agent_created`
- `validation_attempted`
- `validation_result_received`
- `batch_validation_attempted`
- `local_error`

Structured local error categories include:

- `missing_token`
- `missing_agent_id`
- `empty_batch`
- `serialization_error`
- `invalid_action_shape`
- `wrapper_misuse`
- `unsupported_path`

These are surfaced through `LocalValidationError` and the optional `telemetryHook`.

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

The SDK also sends stable request metadata headers such as:

- `X-Cerone-SDK-Name`
- `X-Cerone-SDK-Version`
- `X-Cerone-Runtime`
- `X-Cerone-Client-Session`
- `X-Cerone-Integration-Id` when provided
- `X-Cerone-Auth-Session` after an API key or trial token is active
- `X-Cerone-Request-Sequence`
- `X-Cerone-Client-Intent`
- `X-Cerone-Interaction-Mode`

Validation responses may also include:

- `environmentMode`
- `note`
- `hint`
- `trialWarning`
- `trialStoploss`

The SDK normalizes repeated semantic-drift wording in `violations` so application-facing error text is cleaner.

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

## Other SDKs

Cerone now has more than one SDK surface.

Current SDKs:

- **Node / JavaScript SDK**
  - package: `agent-governance`
  - repo: [github.com/AnantDhavale/agent-governance-js](https://github.com/AnantDhavale/agent-governance-js)

- **Python SDK**
  - package: `cerone`
  - repo: [github.com/AnantDhavale/cerone_sdk](https://github.com/AnantDhavale/cerone_sdk)

The product name is **Cerone** across both SDKs.  
The npm package uses the name `agent-governance` for discoverability.

If you are building in Node:

```bash
npm install agent-governance
```

If you are building in Python:

```bash
pip install cerone
```

## Notes

- this package is server-side Node code
- do not expose your Cerone API key in browser bundles
- for enterprise or persistent access, contact `info@homersemantics.com`
