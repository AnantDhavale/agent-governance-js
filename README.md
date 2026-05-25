# agent-governance

**Check AI agent actions before they run.**

`agent-governance` is the JavaScript / Node SDK for **Cerone**.

It lets you give an agent a declared purpose and capabilities, then ask Cerone
for a runtime decision before a tool call executes:

- `approved`
- `flagged`
- `rejected`

Use it when your agent is about to do something real:

- read or write files
- call internal APIs
- query a database
- perform support, billing, or ops actions
- run tools on behalf of users

The npm package name is `agent-governance` for discoverability. The hosted
runtime behind it is Cerone.

---

## Why Developers Install It

- validate agent tool calls before execution
- keep your own OpenAI, Anthropic, or other model key
- catch actions that do not fit the agent's declared purpose
- detect suspicious or unsafe action payloads early
- add identity, trust, and audit signals without replacing your stack
- start immediately from a hosted trial

Cerone is not a model proxy. It sits around agent actions, not between you and
your LLM provider.

---

## Install

```bash
npm install agent-governance
```

Node `18+` is required because the SDK uses built-in `fetch` and
`AbortController`.

## Once The Trial Starts, Do This Next

Do not stop at trial bootstrap.

Go immediately to the first value path:

1. Create your first agent with a real purpose and capability set.
2. Validate one real action your app or tool wrapper actually wants to run.
3. Inspect the decision: `approved`, `flagged`, or `rejected`.

If you only acquire a hosted trial token but never create an agent or validate
an action, you have not actually tested Cerone yet.

---

## Quick Start

```js
import { CeroneClient } from "agent-governance";

const client = new CeroneClient();

const agent = await client.createAgentForAction("file_read", {
  workspaceTarget: "repository files such as README.md",
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

What happens here:

1. Cerone creates an agent identity with declared purpose and capabilities.
2. Your app asks Cerone to validate a real action.
3. Cerone returns a runtime decision before that action is executed.

---

## A More Typical Example

```js
import { CeroneClient } from "agent-governance";

const client = new CeroneClient();

const agent = await client.createAgent(
  "Answer customer billing questions and look up billing records.",
  ["db_read", "billing_api"],
  { environment: "development" },
);

const result = await client.validate(
  agent.agentId,
  "database_query",
  { table: "billing", customer_id: "123" },
);

console.log(result.result, result.trustScore);
```

The intended flow is simple:

- `approved` -> continue
- `flagged` -> review or warn according to your app policy
- `rejected` -> block execution

---

## Purpose Fidelity Matters

Cerone works best when the declared purpose actually matches what the agent is
doing.

If you are wrapping common tools like `file_read`, avoid vague purpose text.
`createAgentForAction(...)` exists to help you get to a stronger first-run
agent profile more quickly.

```js
import { CeroneClient } from "agent-governance";

const client = new CeroneClient();

const agent = await client.createAgentForAction("file_read", {
  workspaceTarget: "repository files such as README.md",
  environment: "development",
});
```

If you already know exactly what the agent is for, pass an explicit purpose and
capability set yourself.

---

## Hosted Trial and Access

If you do not pass an API key, the SDK can bootstrap a hosted trial token
automatically by calling:

- `POST /trial/session`

That token is persisted locally at:

- `~/.cerone/trial_token`

Protected API routes still use:

- `X-API-Key: sk_trial_...`

Current access paths:

### 1. Hosted trial

- no manual signup required to begin evaluation
- designed for testing, demos, and first integrations
- if the trial is exhausted, contact us for persistent access

### 2. Persistent access

- use a provisioned key for POCs, pilots, and production environments

Support:

- [homersemantics.com](https://homersemantics.com)
- [info@homersemantics.com](mailto:info@homersemantics.com)

Hosted service terms:

- [TERMS_OF_SERVICE.md](https://github.com/AnantDhavale/agent-governance-js/blob/main/TERMS_OF_SERVICE.md)
- [PRIVACY.md](https://github.com/AnantDhavale/agent-governance-js/blob/main/PRIVACY.md)

---

## What This SDK Does

This is a thin Node client for the hosted Cerone runtime. It can:

- create root agents
- create root agents from a real action with inferred purpose/capability framing
- spawn child agents
- validate actions
- validate action batches
- fetch usage
- issue delegated tokens
- verify and revoke delegated tokens

The goal is to keep the client side light while identity, validation, trust,
and audit logic stay centralized in Cerone.

---

## Single Validation vs Batch Validation

Start with `validate(...)` for one action. Use `validateBatch([...])` only when
you already have multiple validation items to send together.

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

If you call `validateBatch([])`, the SDK raises a local error before making a
request.

---

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

### `new CeroneClient([options])`

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

### Agent methods

- `createAgent(purpose, [capabilities], [options])`
- `createAgentForAction(action, [options])`
- `spawnAgent(parentId, purpose, [capabilities], [options])`

### Validation methods

- `validate(agentId, action, [parameters])`
- `validateBatch(validations)`

### Trial / health / usage methods

- `healthCheck()`
- `getUsage()`
- `ensureApiKey()`

### Delegated token methods

- `delegateToken(options)`
- `verifyToken(accessToken, [options])`
- `revokeToken(accessToken)`

---

## Telemetry and Local Errors

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

These are surfaced through `LocalValidationError` and the optional
`telemetryHook`.

The SDK also sends stable request metadata headers such as:

- `User-Agent: agent-governance-node-sdk/<version>`
- `X-Cerone-SDK-Name`
- `X-Cerone-SDK-Version`
- `X-Cerone-Runtime`
- `X-Cerone-Client-Session`
- `X-Cerone-Integration-Id` when provided
- `X-Cerone-Auth-Session` after an API key or trial token is active
- `X-Cerone-Request-Sequence`
- `X-Cerone-Client-Intent`
- `X-Cerone-Interaction-Mode`

---

## Bring Your Own Model Key

Cerone validates agent behaviour. It does not replace your inference provider.

You keep your own OpenAI, Anthropic, or other provider key and send model calls
through your normal stack. Cerone checks intended actions and returns runtime
decisions around those actions.

---

## Other SDKs

Current Cerone SDK surfaces:

- **Node / JavaScript**
  - package: `agent-governance`
  - repo: [github.com/AnantDhavale/agent-governance-js](https://github.com/AnantDhavale/agent-governance-js)

- **Python**
  - package: `cerone`
  - repo: [github.com/AnantDhavale/cerone_sdk](https://github.com/AnantDhavale/cerone_sdk)

If you are building in Node:

```bash
npm install agent-governance
```

If you are building in Python:

```bash
pip install cerone
```

---

## Notes

- this package is for server-side Node code
- do not expose your Cerone API key in browser bundles
- for enterprise or persistent access, contact `info@homersemantics.com`
