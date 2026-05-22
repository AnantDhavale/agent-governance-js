import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AgentGovernanceClient,
  AuthenticationError,
  CeroneClient,
  InteractionMode,
  LocalErrorCategory,
  LocalValidationError,
  RateLimitError,
  TelemetryEventType,
  ValidationError,
  VERSION_STRING,
  inferAgentProfileFromAction,
} from "../src/index.js";

function tempTokenPath(name) {
  return path.join(os.tmpdir(), `agent-governance-test-${name}-${Date.now()}`);
}

test("exports client alias", () => {
  assert.equal(AgentGovernanceClient, CeroneClient);
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION_STRING, pkg.version);
});

test("inferAgentProfileFromAction builds a file_read-oriented profile", () => {
  const profile = inferAgentProfileFromAction("file_read", {
    workspaceTarget: "repository files such as README.md",
  });

  assert.equal(profile.inferred, true);
  assert.equal(profile.capabilities[0], "file_read");
  assert.match(profile.purpose, /Perform file_read operations/);
  assert.match(profile.purpose, /read files from a codebase/);
  assert.match(profile.purpose, /repository files such as README\.md/);
});

test("createAgentForAction uses inferred purpose and minimal capabilities", async () => {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.purpose.includes("Perform file_read operations"), true);
    assert.deepEqual(body.capabilities, ["file_read"]);
    return fakeResponse(200, {
      certificate: {
        agent_id: "agt_derived",
        purpose: body.purpose,
        capabilities: body.capabilities,
        signature: "sig_derived",
        issued_at: "2026-01-01T00:00:00Z",
      },
      trust_score: 0.91,
    });
  };

  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  const agent = await client.createAgentForAction("file_read", {
    workspaceTarget: "repository files such as README.md",
    environment: "development",
  });
  assert.equal(agent.agentId, "agt_derived");
  assert.deepEqual(agent.capabilities, ["file_read"]);
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
  assert.equal(calls[0].options.headers["X-Cerone-Client-Intent"], "sdk_trial_bootstrap_called");
  assert.equal(calls[0].options.headers["X-Cerone-Interaction-Mode"], InteractionMode.TRIAL_BOOTSTRAP);
  assert.equal(calls[1].options.headers["X-API-Key"], "sk_trial_demo");
  assert.match(calls[1].options.headers["X-Cerone-Auth-Session"], /^auth_/);
});

test("createAgent uses AZTP certificate response shape", async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["X-Cerone-Client-Intent"], "sdk_create_agent_called");
    assert.equal(options.headers["User-Agent"], `agent-governance-node-sdk/${VERSION_STRING}`);
    assert.equal(options.headers["X-Cerone-Runtime"], "node");
    assert.match(options.headers["X-Cerone-Client-Session"], /^csn_/);
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

test("emits structured telemetry events", async () => {
  const events = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/trial/session")) {
      return fakeResponse(200, { trial_token: "sk_trial_demo" });
    }
    if (url.endsWith("/v1/certificates")) {
      return fakeResponse(200, {
        certificate: {
          agent_id: "agt_telemetry",
          purpose: "Perform file_read operations to read files from a codebase.",
          capabilities: ["file_read"],
          signature: "sig_telemetry",
          issued_at: "2026-01-01T00:00:00Z",
        },
        trust_score: 1,
      });
    }
    if (url.endsWith("/v1/validate")) {
      return fakeResponse(200, {
        validation_id: "val_telemetry",
        result: "approved",
        semantic_alignment: 0.66,
        trust_score: 1,
        violations: [],
        timestamp: "2026-01-01T00:00:00Z",
        latency_ms: 10,
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const client = new CeroneClient({
    trialTokenPath: tempTokenPath("telemetry"),
    telemetryHook: (event) => events.push(event),
    integrationId: "openclaw-plugin",
  });

  const agent = await client.createAgentForAction("file_read", {
    workspaceTarget: "repository files",
  });
  await client.validate(agent.agentId, "file_read", { path: "README.md" });

  assert.equal(events[0].eventType, TelemetryEventType.CLIENT_INITIALIZED);
  assert.equal(events[1].eventType, TelemetryEventType.HOSTED_TRIAL_STARTED);
  assert.equal(events[2].eventType, TelemetryEventType.TRIAL_TOKEN_RECEIVED);
  assert.equal(events[3].eventType, TelemetryEventType.AGENT_CREATED);
  assert.equal(events[4].eventType, TelemetryEventType.VALIDATION_ATTEMPTED);
  assert.equal(events[5].eventType, TelemetryEventType.VALIDATION_RESULT_RECEIVED);
  assert.equal(events[5].integrationId, "openclaw-plugin");
  assert.match(events[5].clientSessionId, /^csn_/);
  assert.match(events[5].authSessionId, /^auth_/);
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
      violations: ["Semantic drift detected: Semantic drift detected: test"],
      timestamp: "2026-01-01T00:00:00Z",
      latency_ms: 42,
      environment_mode: "development",
      note: "Development thresholds applied.",
      hint: "Include your tool names explicitly in your agent purpose declaration.",
    });
  };

  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  const result = await client.validate("agt_1", "database_query", { customer_id: "123" });
  assert.equal(result.result, "approved");
  assert.equal(result.action, "database_query");
  assert.equal(result.trustScore, 0.97);
  assert.deepEqual(result.violations, ["Semantic drift detected: test"]);
  assert.equal(result.environmentMode, "development");
  assert.equal(result.note, "Development thresholds applied.");
  assert.equal(result.hint, "Include your tool names explicitly in your agent purpose declaration.");
});

test("validateBatch rejects empty payload locally", async () => {
  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  await assert.rejects(
    () => client.validateBatch([]),
    (error) =>
      error instanceof LocalValidationError &&
      error.category === LocalErrorCategory.EMPTY_BATCH &&
      /at least one validation item/.test(error.message),
  );
});

test("low-level request rejects empty batch payload locally", async () => {
  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  globalThis.fetch = async () => {
    throw new Error("Network call should not happen for empty batch payload");
  };
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = () => {};

  try {
    await assert.rejects(
      () => client._request("POST", "/v1/validate/batch", { json: { validations: [] } }),
      (error) =>
        error instanceof LocalValidationError &&
        error.category === LocalErrorCategory.EMPTY_BATCH &&
        /at least one validation item/.test(error.message),
    );
  } finally {
    process.emitWarning = originalEmitWarning;
  }
});

test("local invalid action errors are categorized", async () => {
  const client = new CeroneClient({ apiKey: "sk_live_demo" });
  await assert.rejects(
    () => client.validate("agt_demo", { parameters: {} }),
    (error) =>
      error instanceof LocalValidationError &&
      error.category === LocalErrorCategory.INVALID_ACTION_SHAPE,
  );
});

test("low-level request emits deprecation warning", async () => {
  const warnings = [];
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = (warning, options) => {
    warnings.push({ warning, options });
  };

  try {
    globalThis.fetch = async () => fakeResponse(200, { ok: true });
    const client = new CeroneClient({ apiKey: "sk_live_demo" });
    const response = await client._request("GET", "/usage");
    assert.deepEqual(response, { ok: true });
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0].warning), /_request\(\) is a private method/);
    assert.equal(warnings[0].options?.type, "DeprecationWarning");
  } finally {
    process.emitWarning = originalEmitWarning;
  }
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
