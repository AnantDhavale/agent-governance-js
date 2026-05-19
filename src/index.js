import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "0.1.4";
const SDK_NAME = "agent-governance-node-sdk";
const DEFAULT_BASE_URL = "https://api.homersemantics.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CACHE_TTL_MS = 300_000;
const DEFAULT_CACHE_MAX_SIZE = 1_000;
const ACCESS_URL = "https://www.homersemantics.com/ai-agent-governance-and-oauth";

export class CeroneError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "CeroneError";
    this.status = options.status ?? null;
    this.body = options.body ?? null;
  }
}

export class AuthenticationError extends CeroneError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "AuthenticationError";
  }
}

export class ValidationError extends CeroneError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ValidationError";
  }
}

export class RateLimitError extends CeroneError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "RateLimitError";
  }
}

export class NetworkError extends CeroneError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "NetworkError";
  }
}

function defaultTrialTokenPath() {
  return path.join(os.homedir(), ".cerone", "trial_token");
}

function safeLower(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function ensureDirectoryFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readPersistedTrialToken(filePath) {
  try {
    const token = fs.readFileSync(filePath, "utf8").trim();
    return token || null;
  } catch {
    return null;
  }
}

function persistTrialToken(filePath, token) {
  ensureDirectoryFor(filePath);
  fs.writeFileSync(filePath, `${token}\n`, { mode: 0o600 });
}

function makeCacheKey(agentId, actionPayload) {
  return JSON.stringify([agentId, actionPayload.tool, actionPayload.parameters ?? {}]);
}

function parseValidationResult(value) {
  const normalized = safeLower(value);
  if (normalized === "approved" || normalized === "flagged" || normalized === "rejected") {
    return normalized;
  }
  return "error";
}

function normalizeActionPayload(action, parameters) {
  if (typeof action === "string") {
    const params = parameters ?? {};
    if (params && typeof params !== "object") {
      throw new ValidationError("Action parameters must be an object.");
    }
    return {
      tool: action,
      parameters: params,
    };
  }

  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new ValidationError("Action must be a tool string or an action object.");
  }

  const tool = action.tool;
  const params = action.parameters ?? parameters ?? {};
  if (typeof tool !== "string" || !tool.trim()) {
    throw new ValidationError("Action object must include a non-empty tool name.");
  }
  if (params && typeof params !== "object") {
    throw new ValidationError("Action parameters must be an object.");
  }

  const normalized = {
    tool,
    parameters: params,
  };
  if (action.context && typeof action.context === "object" && !Array.isArray(action.context)) {
    normalized.context = action.context;
  }
  return normalized;
}

export class CeroneClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? null;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryNonIdempotent = Boolean(options.retryNonIdempotent);
    this.enableCache = Boolean(options.enableCache);
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cacheMaxSize = options.cacheMaxSize ?? DEFAULT_CACHE_MAX_SIZE;
    this.trialTokenPath = options.trialTokenPath ?? defaultTrialTokenPath();
    this._cache = this.enableCache ? new Map() : null;
  }

  async createAgent(purpose, capabilities = [], options = {}) {
    if (!purpose || typeof purpose !== "string") {
      throw new ValidationError("Agent purpose must be a non-empty string.");
    }

    const response = await this._request("POST", "/v1/certificates", {
      json: {
        purpose,
        capabilities,
        ...(options.environment ? { environment: options.environment } : {}),
      },
      clientIntent: "sdk_create_agent_called",
      allowPrivateRequest: true,
    });

    const certificate = response.certificate && typeof response.certificate === "object"
      ? response.certificate
      : response;
    const agentId = certificate.agent_id ?? response.agent_id;
    if (!agentId) {
      throw new ValidationError("Missing agent_id in createAgent response.", { body: response });
    }

    return {
      agentId,
      purpose: certificate.purpose ?? purpose,
      capabilities: certificate.capabilities ?? capabilities,
      trustScore: Number(response.trust_score ?? certificate.trust_score ?? 0),
      signature: certificate.signature ?? response.signature ?? "",
      createdAt: certificate.issued_at ?? response.created_at ?? response.issued_at ?? "",
      raw: response,
    };
  }

  async spawnAgent(parentId, purpose, capabilities = [], options = {}) {
    if (!parentId || typeof parentId !== "string") {
      throw new ValidationError("parentId must be a non-empty string.");
    }
    if (!purpose || typeof purpose !== "string") {
      throw new ValidationError("Agent purpose must be a non-empty string.");
    }

    const response = await this._request("POST", "/v1/certificates/spawn", {
      json: {
        parent_id: parentId,
        purpose,
        capabilities,
        ...(options.maxLifespanHours !== undefined
          ? { max_lifespan_hours: options.maxLifespanHours }
          : {}),
      },
      clientIntent: "sdk_spawn_agent_called",
      allowPrivateRequest: true,
    });

    const certificate = response.certificate && typeof response.certificate === "object"
      ? response.certificate
      : response;
    const agentId = certificate.agent_id ?? response.agent_id;
    if (!agentId) {
      throw new ValidationError("Missing agent_id in spawnAgent response.", { body: response });
    }

    return {
      agentId,
      parentId: certificate.parent_id ?? parentId,
      purpose: certificate.purpose ?? purpose,
      capabilities: certificate.capabilities ?? capabilities,
      trustScore: Number(response.trust_score ?? certificate.trust_score ?? 0),
      signature: certificate.signature ?? response.signature ?? "",
      createdAt: certificate.issued_at ?? response.created_at ?? response.issued_at ?? "",
      raw: response,
    };
  }

  async validate(agentId, action, parameters = undefined) {
    if (!agentId || typeof agentId !== "string") {
      throw new ValidationError("agentId must be a non-empty string.");
    }

    const actionPayload = normalizeActionPayload(action, parameters);

    if (this._cache) {
      const key = makeCacheKey(agentId, actionPayload);
      const cached = this._cache.get(key);
      if (cached && Date.now() - cached.timestamp < this.cacheTtlMs && cached.response.trustScore > 0.95) {
        this._cache.delete(key);
        this._cache.set(key, cached);
        return clone(cached.response);
      }
    }

    const started = Date.now();
    const response = await this._request("POST", "/v1/validate", {
      json: {
        agent_id: agentId,
        action: actionPayload,
      },
      clientIntent: "sdk_validate_called",
      allowPrivateRequest: true,
    });
    const normalized = {
      validationId: response.validation_id ?? null,
      agentId,
      result: parseValidationResult(response.result),
      semanticAlignment: Number(response.semantic_alignment ?? 0),
      trustScore: Number(response.trust_score ?? 0),
      violations: Array.isArray(response.violations) ? response.violations : [],
      checks: Array.isArray(response.checks) ? response.checks : [],
      action: actionPayload.tool,
      timestamp: response.timestamp ?? "",
      latencyMs: Number(response.latency_ms ?? (Date.now() - started)),
      trialWarning: Boolean(response.trial_warning),
      trialStoploss: Boolean(response.trial_stoploss),
      raw: response,
    };

    if (this._cache && normalized.result === "approved" && normalized.trustScore > 0.95) {
      const key = makeCacheKey(agentId, actionPayload);
      this._cache.set(key, { response: normalized, timestamp: Date.now() });
      while (this._cache.size > this.cacheMaxSize) {
        const oldest = this._cache.keys().next().value;
        this._cache.delete(oldest);
      }
    }

    return normalized;
  }

  async validateBatch(validations) {
    if (!Array.isArray(validations) || validations.length === 0) {
      throw new ValidationError(
        "validateBatch requires at least one validation item. Use validate(...) for a single action, or validateBatch([...]) with one or more items.",
      );
    }

    const payload = validations.map((item) => {
      if (!item || typeof item !== "object") {
        throw new ValidationError("Each batch validation item must be an object.");
      }
      if (!item.agentId && !item.agent_id) {
        throw new ValidationError("Each batch validation item must include agentId.");
      }

      const agentId = item.agentId ?? item.agent_id;
      const action = item.action ?? item.tool;
      const parameters = item.parameters;
      return {
        agent_id: agentId,
        action: normalizeActionPayload(action, parameters),
      };
    });

    const response = await this._request("POST", "/v1/validate/batch", {
      json: { validations: payload },
      clientIntent: "sdk_validate_batch_called",
      allowPrivateRequest: true,
    });

    const results = Array.isArray(response.results) ? response.results : [];
    return results.map((item) => ({
      validationId: item.validation_id ?? null,
      agentId: item.agent_id ?? "",
      result: parseValidationResult(item.result),
      semanticAlignment: Number(item.semantic_alignment ?? 0),
      trustScore: Number(item.trust_score ?? 0),
      violations: Array.isArray(item.violations) ? item.violations : [],
      checks: Array.isArray(item.checks) ? item.checks : [],
      action: typeof item.action === "object" && item.action ? item.action.tool ?? "" : String(item.action ?? ""),
      timestamp: item.timestamp ?? "",
      latencyMs: Number(item.latency_ms ?? 0),
      raw: item,
    }));
  }

  async healthCheck() {
    return this._request("GET", "/health", {
      auth: "none",
      clientIntent: "sdk_health_check_called",
      allowPrivateRequest: true,
    });
  }

  async getUsage() {
    return this._request("GET", "/usage", {
      clientIntent: "sdk_get_usage_called",
      allowPrivateRequest: true,
    });
  }

  async delegateToken(options) {
    if (!options || typeof options !== "object") {
      throw new ValidationError("delegateToken options are required.");
    }
    if (!options.scope || typeof options.scope !== "string") {
      throw new ValidationError("delegateToken requires a scope string.");
    }

    const payload = {
      scope: options.scope,
      audience: options.audience ?? "aztp-api",
      ttl_minutes: options.ttlMinutes ?? 10,
      ...(options.agentId ? { agent_id: options.agentId } : {}),
      ...(options.parentAgentId ? { parent_agent_id: options.parentAgentId } : {}),
      ...(options.extraClaims ? { extra_claims: options.extraClaims } : {}),
    };

    return this._request("POST", "/v1/token/delegate", {
      json: payload,
      clientIntent: "sdk_delegate_token_called",
      allowPrivateRequest: true,
    });
  }

  async verifyToken(accessToken, options = {}) {
    if (!accessToken || typeof accessToken !== "string") {
      throw new ValidationError("verifyToken requires an access token string.");
    }
    return this._request("POST", "/v1/token/verify", {
      json: {
        access_token: accessToken,
        verify_audience: Boolean(options.verifyAudience),
        ...(options.audience ? { audience: options.audience } : {}),
      },
      clientIntent: "sdk_verify_token_called",
      allowPrivateRequest: true,
    });
  }

  async revokeToken(accessToken) {
    if (!accessToken || typeof accessToken !== "string") {
      throw new ValidationError("revokeToken requires an access token string.");
    }
    return this._request("POST", "/v1/token/revoke", {
      json: { access_token: accessToken },
      clientIntent: "sdk_revoke_token_called",
      allowPrivateRequest: true,
    });
  }

  async ensureApiKey() {
    return this._ensureApiKey();
  }

  async _ensureApiKey() {
    if (this.apiKey) {
      return this.apiKey;
    }

    const persisted = readPersistedTrialToken(this.trialTokenPath);
    if (persisted) {
      this.apiKey = persisted;
      return this.apiKey;
    }

    const response = await this._request("POST", "/trial/session", {
      auth: "none",
      clientIntent: "sdk_trial_bootstrap_called",
      persistTrialToken: true,
      allowPrivateRequest: true,
    });

    if (!response.trial_token || typeof response.trial_token !== "string") {
      throw new AuthenticationError("Trial bootstrap did not return a trial token.", { body: response });
    }

    this.apiKey = response.trial_token;
    persistTrialToken(this.trialTokenPath, this.apiKey);
    return this.apiKey;
  }

  async _request(method, endpoint, options = {}) {
    const upperMethod = method.toUpperCase();
    const url = `${this.baseUrl}${endpoint}`;
    const clientIntent = options.clientIntent;
    const allowPrivateRequest = Boolean(options.allowPrivateRequest);
    const retries = this._canRetry(upperMethod) ? this.maxRetries : 0;
    let attempt = 0;

    this._warnPrivateRequestUsage(endpoint, allowPrivateRequest);
    this._guardEmptyBatchRequest(endpoint, options.json);

    while (true) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

      try {
        const headers = {
          "Content-Type": "application/json",
          "User-Agent": `${SDK_NAME}/${VERSION}`,
          "X-Cerone-SDK-Name": SDK_NAME,
          "X-Cerone-SDK-Version": VERSION,
          "X-Cerone-Platform": `node-${process.platform}`,
          "X-Cerone-Client-Intent": clientIntent ?? "sdk_request",
          ...(options.headers ?? {}),
        };

        if ((options.auth ?? "apiKey") !== "none") {
          const apiKey = await this._ensureApiKey();
          headers["X-API-Key"] = apiKey;
        }

        const response = await fetch(url, {
          method: upperMethod,
          headers,
          body: options.json === undefined ? undefined : JSON.stringify(options.json),
          signal: controller.signal,
        });

        const text = await response.text();
        const body = text ? safeJsonParse(text) : {};

        if (response.ok) {
          if (options.persistTrialToken && body && typeof body.trial_token === "string") {
            persistTrialToken(this.trialTokenPath, body.trial_token);
          }
          return body;
        }

        const message = extractErrorMessage(body, response.status) || `Request failed with status ${response.status}`;
        if (response.status === 401) {
          throw new AuthenticationError(`${message} See access options at ${ACCESS_URL}`, {
            status: response.status,
            body,
          });
        }
        if (response.status === 402) {
          throw new RateLimitError(message, {
            status: response.status,
            body,
          });
        }
        if (response.status === 429) {
          throw new RateLimitError(`${message} See plan options at ${ACCESS_URL}`, {
            status: response.status,
            body,
          });
        }
        if (response.status >= 500) {
          throw new NetworkError(message, {
            status: response.status,
            body,
          });
        }
        throw new ValidationError(message, {
          status: response.status,
          body,
        });
      } catch (error) {
        clearTimeout(timeout);

        const shouldRetry = attempt <= retries && this._shouldRetryError(error);
        if (shouldRetry) {
          await sleep(Math.min(250 * attempt, 1_000));
          continue;
        }

        if (error instanceof CeroneError) {
          throw error;
        }

        if (error?.name === "AbortError") {
          throw new NetworkError(`Request timed out after ${options.timeoutMs ?? this.timeoutMs}ms.`);
        }

        throw new NetworkError(error instanceof Error ? error.message : "Cerone request failed.");
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  _canRetry(method) {
    return method === "GET" || method === "HEAD" || method === "OPTIONS" || this.retryNonIdempotent;
  }

  _guardEmptyBatchRequest(endpoint, payload) {
    if (endpoint !== "/v1/validate/batch") {
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return;
    }
    if (Array.isArray(payload.validations) && payload.validations.length === 0) {
      throw new ValidationError(
        "validateBatch requires at least one validation item. Use validate(...) for a single action, or validateBatch([...]) with one or more items.",
      );
    }
  }

  _warnPrivateRequestUsage(endpoint, allowPrivateRequest) {
    if (allowPrivateRequest || typeof endpoint !== "string" || !endpoint.startsWith("/")) {
      return;
    }
    process.emitWarning(
      "_request() is a private method. Use the public SDK methods instead.",
      { type: "DeprecationWarning" },
    );
  }

  _shouldRetryError(error) {
    if (error?.name === "AbortError") {
      return true;
    }
    return error instanceof NetworkError && (!error.status || error.status >= 500);
  }
}

export const AgentGovernanceClient = CeroneClient;
export const VERSION_STRING = VERSION;

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function extractErrorMessage(body, status) {
  if (!body || typeof body !== "object") {
    return `Request failed with status ${status}`;
  }
  return body.message || body.detail?.message || body.detail || body.error || null;
}
