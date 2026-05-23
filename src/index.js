import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const VERSION = "0.1.10";
const SDK_NAME = "agent-governance-node-sdk";
const SDK_RUNTIME = "node";
const DEFAULT_BASE_URL = "https://api.homersemantics.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CACHE_TTL_MS = 300_000;
const DEFAULT_CACHE_MAX_SIZE = 1_000;
const ACCESS_URL = "https://www.homersemantics.com/ai-agent-governance-and-oauth";

export const InteractionMode = Object.freeze({
  CLIENT_LIFECYCLE: "client_lifecycle",
  TRIAL_BOOTSTRAP: "trial_bootstrap",
  AGENT_CREATE: "agent_create",
  SINGLE_VALIDATION: "single_validation",
  BATCH_VALIDATION: "batch_validation",
  PRIVATE_REQUEST: "private_request",
});

export const TelemetryEventType = Object.freeze({
  CLIENT_INITIALIZED: "client_initialized",
  HOSTED_TRIAL_STARTED: "hosted_trial_started",
  TRIAL_TOKEN_RECEIVED: "trial_token_received",
  AGENT_CREATED: "agent_created",
  VALIDATION_ATTEMPTED: "validation_attempted",
  VALIDATION_RESULT_RECEIVED: "validation_result_received",
  BATCH_VALIDATION_ATTEMPTED: "batch_validation_attempted",
  LOCAL_ERROR: "local_error",
});

export const LocalErrorCategory = Object.freeze({
  MISSING_TOKEN: "missing_token",
  MISSING_AGENT_ID: "missing_agent_id",
  EMPTY_BATCH: "empty_batch",
  SERIALIZATION_ERROR: "serialization_error",
  INVALID_ACTION_SHAPE: "invalid_action_shape",
  WRAPPER_MISUSE: "wrapper_misuse",
  UNSUPPORTED_PATH: "unsupported_path",
});

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

export class LocalValidationError extends ValidationError {
  constructor(message, category, details = {}, options = {}) {
    super(message, options);
    this.name = "LocalValidationError";
    this.category = category;
    this.details = details;
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

function utcNowIso() {
  return new Date().toISOString();
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

function generateClientSessionId() {
  return `csn_${crypto.randomBytes(8).toString("hex")}`;
}

function fingerprintToken(token) {
  return `auth_${crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 16)}`;
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

function normalizeToolName(toolName) {
  return typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
}

function inferCapabilityFromAction(toolName) {
  const normalized = normalizeToolName(toolName);
  if (normalized.startsWith("database_") || normalized.startsWith("db_")) {
    return /(write|update|insert|delete|create)/u.test(normalized) ? "db_write" : "db_read";
  }
  if (normalized.startsWith("api_") || normalized.endsWith("_api")) {
    return "api_call";
  }
  if (normalized.startsWith("file_")) {
    return /(write|update|create|delete)/u.test(normalized) ? "file_write" : "file_read";
  }
  if (
    normalized.includes("http") ||
    normalized.includes("fetch") ||
    normalized.includes("search") ||
    normalized.includes("browse") ||
    normalized.includes("network")
  ) {
    return "network_access";
  }
  return normalized;
}

function describeWorkspaceTarget(workspaceTarget) {
  if (typeof workspaceTarget === "string" && workspaceTarget.trim()) {
    return workspaceTarget.trim();
  }
  return "source code, configuration, and project structure";
}

function inferPurpose(requiredCapability, toolName, workspaceTarget) {
  switch (requiredCapability) {
    case "file_read":
      return (
        `Perform ${toolName} operations to read files from a codebase and inspect ${workspaceTarget} ` +
        "for source code analysis, configuration review, debugging, and implementation planning."
      );
    case "file_write":
      return (
        `Perform ${toolName} operations to update project files within ${workspaceTarget} ` +
        "for software engineering changes, fixes, and implementation tasks."
      );
    case "api_call":
      return (
        `Perform ${toolName} operations to call development and service APIs needed for ` +
        "software engineering workflows, diagnostics, and implementation tasks."
      );
    case "network_access":
      return (
        `Perform ${toolName} operations to access network resources related to ${workspaceTarget} ` +
        "for software engineering research, dependency inspection, and debugging."
      );
    case "db_read":
      return (
        `Perform ${toolName} operations to read database records needed for debugging, ` +
        "system analysis, and software engineering investigation."
      );
    case "db_write":
      return (
        `Perform ${toolName} operations to update database records required for controlled ` +
        "software engineering workflows and operational fixes."
      );
    default:
      return (
        `Perform ${toolName} operations to work with ${workspaceTarget} ` +
        "for software engineering, debugging, and workflow tasks."
      );
  }
}

export function inferAgentProfileFromAction(action, options = {}) {
  const actionPayload = normalizeActionPayload(action, options.parameters);
  const toolName = actionPayload.tool;
  const requiredCapability = inferCapabilityFromAction(toolName);
  const capabilities = Array.isArray(options.capabilities) && options.capabilities.length > 0
    ? options.capabilities
    : [requiredCapability];
  const purpose = typeof options.purpose === "string" && options.purpose.trim()
    ? options.purpose.trim()
    : inferPurpose(requiredCapability, toolName, describeWorkspaceTarget(options.workspaceTarget));

  return {
    purpose,
    capabilities,
    inferred: !(typeof options.purpose === "string" && options.purpose.trim()) &&
      !(Array.isArray(options.capabilities) && options.capabilities.length > 0),
    action: actionPayload,
  };
}

function parseValidationResult(value) {
  const normalized = safeLower(value);
  if (normalized === "approved" || normalized === "flagged" || normalized === "rejected") {
    return normalized;
  }
  return "error";
}

function dedupeSemanticDrift(text) {
  return typeof text === "string"
    ? text.replace(/^(Semantic drift detected:\s*)(Semantic drift detected:\s*)+/u, "$1")
    : text;
}

function normalizeViolations(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => (typeof entry === "string" ? dedupeSemanticDrift(entry) : entry));
}

function normalizeActionPayload(action, parameters) {
  if (typeof action === "string") {
    const params = parameters ?? {};
    if (params && typeof params !== "object") {
      throw new LocalValidationError(
        "Action parameters must be an object.",
        LocalErrorCategory.INVALID_ACTION_SHAPE,
        { action, parameters },
      );
    }
    return {
      tool: action,
      parameters: params,
    };
  }

  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new LocalValidationError(
      "Action must be a tool string or an action object.",
      LocalErrorCategory.INVALID_ACTION_SHAPE,
      { action },
    );
  }

  const tool = action.tool;
  const params = action.parameters ?? parameters ?? {};
  if (typeof tool !== "string" || !tool.trim()) {
    throw new LocalValidationError(
      "Action object must include a non-empty tool name.",
      LocalErrorCategory.INVALID_ACTION_SHAPE,
      { action },
    );
  }
  if (params && typeof params !== "object") {
    throw new LocalValidationError(
      "Action parameters must be an object.",
      LocalErrorCategory.INVALID_ACTION_SHAPE,
      { action, parameters: params },
    );
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
    this.apiKey = null;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryNonIdempotent = Boolean(options.retryNonIdempotent);
    this.enableCache = Boolean(options.enableCache);
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cacheMaxSize = options.cacheMaxSize ?? DEFAULT_CACHE_MAX_SIZE;
    this.trialTokenPath = options.trialTokenPath ?? defaultTrialTokenPath();
    this.integrationId = options.integrationId ?? null;
    this.clientSessionId = options.clientSessionId ?? generateClientSessionId();
    this.telemetryHook = typeof options.telemetryHook === "function" ? options.telemetryHook : null;
    this.telemetryMetadata = options.telemetryMetadata && typeof options.telemetryMetadata === "object"
      ? { ...options.telemetryMetadata }
      : {};
    this._authSessionId = null;
    this._requestSequence = 0;
    this._cache = this.enableCache ? new Map() : null;

    if (options.apiKey) {
      this._applyApiKey(options.apiKey);
    }

    this._emitEvent(TelemetryEventType.CLIENT_INITIALIZED, {
      baseUrl: this.baseUrl,
      hasApiKey: Boolean(options.apiKey),
      integrationId: this.integrationId,
    });
  }

  async createAgent(purpose, capabilities = [], options = {}) {
    if (!purpose || typeof purpose !== "string") {
      throw this._localError(
        "Agent purpose must be a non-empty string.",
        LocalErrorCategory.WRAPPER_MISUSE,
        { purpose },
      );
    }

    const response = await this._request("POST", "/v1/certificates", {
      json: {
        purpose,
        capabilities,
        ...(options.environment ? { environment: options.environment } : {}),
      },
      clientIntent: "sdk_create_agent_called",
      interactionMode: InteractionMode.AGENT_CREATE,
      allowPrivateRequest: true,
    });

    const certificate = response.certificate && typeof response.certificate === "object"
      ? response.certificate
      : response;
    const agentId = certificate.agent_id ?? response.agent_id;
    if (!agentId) {
      throw new ValidationError("Missing agent_id in createAgent response.", { body: response });
    }

    const normalized = {
      agentId,
      purpose: certificate.purpose ?? purpose,
      capabilities: certificate.capabilities ?? capabilities,
      trustScore: Number(response.trust_score ?? certificate.trust_score ?? 0),
      signature: certificate.signature ?? response.signature ?? "",
      createdAt: certificate.issued_at ?? response.created_at ?? response.issued_at ?? "",
      raw: response,
    };
    this._emitEvent(TelemetryEventType.AGENT_CREATED, {
      agentId: normalized.agentId,
      declaredPurpose: purpose,
      declaredCapabilities: capabilities,
      effectivePurpose: normalized.purpose,
      effectiveCapabilities: normalized.capabilities,
      environment: options.environment ?? null,
    });
    return normalized;
  }

  async createAgentForAction(action, options = {}) {
    const profile = inferAgentProfileFromAction(action, {
      purpose: options.purpose,
      capabilities: options.capabilities,
      parameters: options.parameters,
      workspaceTarget: options.workspaceTarget,
    });
    return this.createAgent(profile.purpose, profile.capabilities, {
      environment: options.environment,
    });
  }

  async spawnAgent(parentId, purpose, capabilities = [], options = {}) {
    if (!parentId || typeof parentId !== "string") {
      throw this._localError(
        "parentId must be a non-empty string.",
        LocalErrorCategory.MISSING_AGENT_ID,
        { parentId },
      );
    }
    if (!purpose || typeof purpose !== "string") {
      throw this._localError(
        "Agent purpose must be a non-empty string.",
        LocalErrorCategory.WRAPPER_MISUSE,
        { purpose },
      );
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
      interactionMode: InteractionMode.AGENT_CREATE,
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
      throw this._localError(
        "agentId must be a non-empty string.",
        LocalErrorCategory.MISSING_AGENT_ID,
        { agentId },
      );
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
    this._emitEvent(TelemetryEventType.VALIDATION_ATTEMPTED, {
      interactionMode: InteractionMode.SINGLE_VALIDATION,
      agentId,
      tool: actionPayload.tool,
      capabilityHint: inferCapabilityFromAction(actionPayload.tool),
    });
    const response = await this._request("POST", "/v1/validate", {
      json: {
        agent_id: agentId,
        action: actionPayload,
      },
      clientIntent: "sdk_validate_called",
      interactionMode: InteractionMode.SINGLE_VALIDATION,
      allowPrivateRequest: true,
    });
    const normalized = {
      validationId: response.validation_id ?? null,
      agentId,
      result: parseValidationResult(response.result),
      semanticAlignment: Number(response.semantic_alignment ?? 0),
      trustScore: Number(response.trust_score ?? 0),
      violations: normalizeViolations(response.violations),
      checks: Array.isArray(response.checks) ? response.checks : [],
      action: actionPayload.tool,
      timestamp: response.timestamp ?? "",
      latencyMs: Number(response.latency_ms ?? (Date.now() - started)),
      trialWarning: Boolean(response.trial_warning),
      trialStoploss: Boolean(response.trial_stoploss),
      environmentMode: typeof response.environment_mode === "string" ? response.environment_mode : undefined,
      note: typeof response.note === "string" ? response.note : undefined,
      hint: typeof response.hint === "string" ? response.hint : undefined,
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

    this._emitEvent(TelemetryEventType.VALIDATION_RESULT_RECEIVED, {
      interactionMode: InteractionMode.SINGLE_VALIDATION,
      agentId,
      tool: actionPayload.tool,
      result: normalized.result,
      semanticAlignment: normalized.semanticAlignment,
      trustScore: normalized.trustScore,
      latencyMs: normalized.latencyMs,
    });

    return normalized;
  }

  async validateBatch(validations) {
    if (!Array.isArray(validations) || validations.length === 0) {
      throw this._localError(
        "validateBatch requires at least one validation item. Use validate(...) for a single action, or validateBatch([...]) with one or more items.",
        LocalErrorCategory.EMPTY_BATCH,
        {},
      );
    }

    const payload = validations.map((item) => {
      if (!item || typeof item !== "object") {
        throw this._localError(
          "Each batch validation item must be an object.",
          LocalErrorCategory.INVALID_ACTION_SHAPE,
          { item },
        );
      }
      if (!item.agentId && !item.agent_id) {
        throw this._localError(
          "Each batch validation item must include agentId.",
          LocalErrorCategory.MISSING_AGENT_ID,
          { item },
        );
      }

      const agentId = item.agentId ?? item.agent_id;
      const action = item.action ?? item.tool;
      const parameters = item.parameters;
      return {
        agent_id: agentId,
        action: normalizeActionPayload(action, parameters),
      };
    });

    this._emitEvent(TelemetryEventType.BATCH_VALIDATION_ATTEMPTED, {
      interactionMode: InteractionMode.BATCH_VALIDATION,
      validationCount: payload.length,
      agentIds: payload.map((item) => item.agent_id),
      tools: payload.map((item) => item.action.tool),
    });

    const response = await this._request("POST", "/v1/validate/batch", {
      json: { validations: payload },
      clientIntent: "sdk_validate_batch_called",
      interactionMode: InteractionMode.BATCH_VALIDATION,
      allowPrivateRequest: true,
    });

    const results = Array.isArray(response.results) ? response.results : [];
    return results.map((item) => ({
      validationId: item.validation_id ?? null,
      agentId: item.agent_id ?? "",
      result: parseValidationResult(item.result),
      semanticAlignment: Number(item.semantic_alignment ?? 0),
      trustScore: Number(item.trust_score ?? 0),
      violations: normalizeViolations(item.violations),
      checks: Array.isArray(item.checks) ? item.checks : [],
      action: typeof item.action === "object" && item.action ? item.action.tool ?? "" : String(item.action ?? ""),
      timestamp: item.timestamp ?? "",
      latencyMs: Number(item.latency_ms ?? 0),
      trialWarning: Boolean(item.trial_warning),
      trialStoploss: Boolean(item.trial_stoploss),
      environmentMode: typeof item.environment_mode === "string" ? item.environment_mode : undefined,
      note: typeof item.note === "string" ? item.note : undefined,
      hint: typeof item.hint === "string" ? item.hint : undefined,
      raw: item,
    }));
  }

  async healthCheck() {
    return this._request("GET", "/health", {
      auth: "none",
      clientIntent: "sdk_health_check_called",
      interactionMode: InteractionMode.CLIENT_LIFECYCLE,
      allowPrivateRequest: true,
    });
  }

  async getUsage() {
    return this._request("GET", "/usage", {
      clientIntent: "sdk_get_usage_called",
      interactionMode: InteractionMode.CLIENT_LIFECYCLE,
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
      interactionMode: InteractionMode.PRIVATE_REQUEST,
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
      interactionMode: InteractionMode.PRIVATE_REQUEST,
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
      interactionMode: InteractionMode.PRIVATE_REQUEST,
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
      this._applyApiKey(persisted);
      return this.apiKey;
    }

    this._emitEvent(TelemetryEventType.HOSTED_TRIAL_STARTED, {
      endpoint: "/trial/session",
      baseUrl: this.baseUrl,
    });
    const response = await this._request("POST", "/trial/session", {
      auth: "none",
      clientIntent: "sdk_trial_bootstrap_called",
      interactionMode: InteractionMode.TRIAL_BOOTSTRAP,
      persistTrialToken: true,
      allowPrivateRequest: true,
    });

    if (!response.trial_token || typeof response.trial_token !== "string") {
      throw this._localError(
        "Trial bootstrap did not return a trial token.",
        LocalErrorCategory.MISSING_TOKEN,
        { response },
      );
    }

    this._applyApiKey(response.trial_token);
    persistTrialToken(this.trialTokenPath, this.apiKey);
    this._emitEvent(TelemetryEventType.TRIAL_TOKEN_RECEIVED, {
      endpoint: "/trial/session",
      authSessionId: this._authSessionId,
    });
    return this.apiKey;
  }

  async _request(method, endpoint, options = {}) {
    const upperMethod = method.toUpperCase();
    const url = `${this.baseUrl}${endpoint}`;
    const clientIntent = options.clientIntent;
    const interactionMode = options.interactionMode ?? InteractionMode.PRIVATE_REQUEST;
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
          "X-Cerone-Runtime": SDK_RUNTIME,
          "X-Cerone-Platform": `node-${process.platform}`,
          "X-Cerone-Node-Version": process.versions.node,
          "X-Cerone-Client-Session": this.clientSessionId,
          "X-Cerone-Request-Sequence": String(this._nextRequestSequence()),
          "X-Cerone-Client-Intent": clientIntent ?? "sdk_request",
          "X-Cerone-Interaction-Mode": interactionMode,
          ...(options.headers ?? {}),
        };

        if (this.integrationId) {
          headers["X-Cerone-Integration-Id"] = this.integrationId;
        }
        if ((options.auth ?? "apiKey") !== "none") {
          const apiKey = await this._ensureApiKey();
          headers["X-API-Key"] = apiKey;
          if (this._authSessionId) {
            headers["X-Cerone-Auth-Session"] = this._authSessionId;
          }
        } else if (this._authSessionId) {
          headers["X-Cerone-Auth-Session"] = this._authSessionId;
        }

        let requestBody;
        if (options.json !== undefined) {
          try {
            requestBody = JSON.stringify(options.json);
          } catch (error) {
            throw this._localError(
              "Request payload could not be serialized to JSON.",
              LocalErrorCategory.SERIALIZATION_ERROR,
              { endpoint, error: error instanceof Error ? error.message : String(error) },
            );
          }
        }

        const response = await fetch(url, {
          method: upperMethod,
          headers,
          body: requestBody,
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
      throw this._localError(
        "validateBatch requires at least one validation item. Use validate(...) for a single action, or validateBatch([...]) with one or more items.",
        LocalErrorCategory.EMPTY_BATCH,
        {},
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

  _applyApiKey(token) {
    this.apiKey = token;
    this._authSessionId = fingerprintToken(token);
  }

  _nextRequestSequence() {
    this._requestSequence += 1;
    return this._requestSequence;
  }

  _emitEvent(eventType, payload = {}) {
    if (!this.telemetryHook) {
      return;
    }
    try {
      this.telemetryHook({
        eventType,
        timestamp: utcNowIso(),
        sdkName: SDK_NAME,
        sdkVersion: VERSION,
        runtime: SDK_RUNTIME,
        clientSessionId: this.clientSessionId,
        integrationId: this.integrationId,
        authSessionId: this._authSessionId,
        payload: {
          ...this.telemetryMetadata,
          ...payload,
        },
      });
    } catch {
      // Telemetry must never break callers.
    }
  }

  _localError(message, category, details = {}) {
    this._emitEvent(TelemetryEventType.LOCAL_ERROR, {
      category,
      message,
      details,
    });
    return new LocalValidationError(message, category, details);
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
