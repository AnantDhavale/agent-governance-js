import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AgentGovernanceClient,
  AuthenticationError,
  CeroneClient,
  RateLimitError,
  ValidationError,
  VERSION_STRING,
} from "../src/index.js";

function tempTokenPath(name) {
  return path.join(os.tmpdir(), `agent-governance-test-${name}-${Date.now()}`);
}

test("exports client alias", () => {
  assert.equal(AgentGovernanceClient, CeroneClient);
  assert.equal(VERSION_STRING, "0.1.0");
});

test("trial bootstrap persists token and reuses it", async () => {
  const trialTokenPath = tempTokenPath("trial");
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/trial/session")) {
      return fakeResponse(200, {
        trial_token: "sk_trial_demo",
      });
    }
    if (url.endsWith("/usage")) {
      return fakeResponse(200, {
        remaining: 2399,
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const client = new CeroneClient({ trialTokenPath, baseUrl: "https://api.homersemantics.com" });
  const usage = await client.getUsage();
  assert.equal(usage.remaining, 2399);
  assert.equal(fs.readFileSync(trialTokenPath, "utf8").trim(), "sk_trial_demo");
  assert.equal(calls[0].url, "https://api.homersemantics.com/trial/session");
  assert.equal(calls[1].options.headers["X-API-Key"], "sk_trial_demo");
});

test("createAgent uses AZTP certificate response shape", async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["X-Cerone-Client-Intent"], "sdk_create_agent_called");
    assert.equal(options.headers["User-Agent"], "agent-governance-node-sdk/0.1.0");
    return fakeResponse(200, {
      certificate: {
        agent_id: "agt_123",
        purpose: "Billing support",
        capabilities: ["db_read"],
        signature: "sig_123",
        issued_at: "2026-01-01T00:00:00Z",
      },
      trust_score: 0.98,
    });
  };

  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  const agent = await client.createAgent("Billing support", ["db_read"]);
  assert.equal(agent.agentId, "agt_123");
  assert.equal(agent.trustScore, 0.98);
});

test("validate normalizes string action and parses response", async () => {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {
      agent_id: "agt_1",
      action: {
        tool: "database_query",
        parameters: { customer_id: "123" },
      },
    });
    return fakeResponse(200, {
      validation_id: "val_1",
      result: "approved",
      semantic_alignment: 0.99,
      trust_score: 0.97,
      violations: [],
      timestamp: "2026-01-01T00:00:00Z",
      latency_ms: 42,
    });
  };

  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  const result = await client.validate("agt_1", "database_query", { customer_id: "123" });
  assert.equal(result.result, "approved");
  assert.equal(result.action, "database_query");
  assert.equal(result.trustScore, 0.97);
});

test("validateBatch rejects empty payload locally", async () => {
  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  await assert.rejects(
    () => client.validateBatch([]),
    (error) => error instanceof ValidationError && /at least one validation item/.test(error.message),
  );
});

test("delegateToken sends the current AZTP payload shape", async () => {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {
      scope: "read:trust",
      audience: "aztp-api",
      ttl_minutes: 10,
      agent_id: "agt_123",
      parent_agent_id: "agt_parent",
    });
    return fakeResponse(200, { access_token: "jwt_123" });
  };

  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  const response = await client.delegateToken({
    scope: "read:trust",
    agentId: "agt_123",
    parentAgentId: "agt_parent",
  });
  assert.equal(response.access_token, "jwt_123");
});

test("maps 401 and 429 to typed errors", async () => {
  let count = 0;
  globalThis.fetch = async () => {
    count += 1;
    if (count === 1) {
      return fakeResponse(401, { message: "API key required." });
    }
    return fakeResponse(429, { message: "Too many requests." });
  };

  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  await assert.rejects(() => client.getUsage(), AuthenticationError);
  await assert.rejects(() => client.getUsage(), RateLimitError);
});

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
