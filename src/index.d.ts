export type ValidationDecision = "approved" | "flagged" | "rejected" | "error";

export type InteractionMode =
  | "client_lifecycle"
  | "trial_bootstrap"
  | "agent_create"
  | "single_validation"
  | "batch_validation"
  | "private_request";

export type TelemetryEventType =
  | "client_initialized"
  | "hosted_trial_started"
  | "trial_token_received"
  | "agent_created"
  | "validation_attempted"
  | "validation_result_received"
  | "batch_validation_attempted"
  | "local_error";

export type LocalErrorCategory =
  | "missing_token"
  | "missing_agent_id"
  | "empty_batch"
  | "serialization_error"
  | "invalid_action_shape"
  | "wrapper_misuse"
  | "unsupported_path";

export type SDKTelemetryEvent = {
  eventType: TelemetryEventType;
  timestamp: string;
  sdkName: string;
  sdkVersion: string;
  runtime: string;
  clientSessionId: string;
  integrationId: string | null;
  authSessionId: string | null;
  payload: Record<string, unknown>;
};

export type CeroneClientOptions = {
  apiKey?: string | null;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryNonIdempotent?: boolean;
  enableCache?: boolean;
  cacheTtlMs?: number;
  cacheMaxSize?: number;
  trialTokenPath?: string;
  integrationId?: string | null;
  clientSessionId?: string;
  telemetryHook?: (event: SDKTelemetryEvent) => void;
  telemetryMetadata?: Record<string, unknown>;
};

export type InferAgentProfileOptions = {
  purpose?: string;
  capabilities?: string[];
  parameters?: Record<string, unknown>;
  workspaceTarget?: string;
};

export type AgentCertificate = {
  agentId: string;
  purpose: string;
  capabilities: string[];
  trustScore: number;
  signature: string;
  createdAt: string;
  raw: Record<string, unknown>;
};

export type ValidationAction = {
  tool: string;
  parameters?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export type ValidationResponse = {
  validationId: string | null;
  agentId: string;
  result: ValidationDecision;
  semanticAlignment: number;
  trustScore: number;
  violations: unknown[];
  checks: unknown[];
  action: string;
  timestamp: string;
  latencyMs: number;
  trialWarning?: boolean;
  trialStoploss?: boolean;
  environmentMode?: string;
  note?: string;
  hint?: string;
  raw: Record<string, unknown>;
};

export type BatchValidationItem = {
  agentId?: string;
  agent_id?: string;
  action?: ValidationAction;
  tool?: string;
  parameters?: Record<string, unknown>;
};

export type SpawnAgentOptions = {
  maxLifespanHours?: number;
};

export type CreateAgentOptions = {
  environment?: string;
};

export type CreateAgentForActionOptions = CreateAgentOptions & InferAgentProfileOptions;

export type DelegateTokenOptions = {
  scope: string;
  audience?: string;
  ttlMinutes?: number;
  agentId?: string;
  parentAgentId?: string;
  extraClaims?: Record<string, unknown>;
};

export type VerifyTokenOptions = {
  audience?: string;
  verifyAudience?: boolean;
};

export declare class CeroneError extends Error {
  status: number | null;
  body: unknown;
  constructor(message: string, options?: { status?: number | null; body?: unknown });
}

export declare class AuthenticationError extends CeroneError {}
export declare class ValidationError extends CeroneError {}
export declare class LocalValidationError extends ValidationError {
  category: LocalErrorCategory;
  details: Record<string, unknown>;
  constructor(
    message: string,
    category: LocalErrorCategory,
    details?: Record<string, unknown>,
    options?: { status?: number | null; body?: unknown },
  );
}
export declare class RateLimitError extends CeroneError {}
export declare class NetworkError extends CeroneError {}

export declare function inferAgentProfileFromAction(
  action: string | ValidationAction,
  options?: InferAgentProfileOptions,
): {
  purpose: string;
  capabilities: string[];
  inferred: boolean;
  action: ValidationAction;
};

export declare class CeroneClient {
  constructor(options?: CeroneClientOptions);
  apiKey: string | null;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryNonIdempotent: boolean;
  enableCache: boolean;
  cacheTtlMs: number;
  cacheMaxSize: number;
  trialTokenPath: string;
  integrationId: string | null;
  clientSessionId: string;

  createAgent(purpose: string, capabilities?: string[], options?: CreateAgentOptions): Promise<AgentCertificate>;
  createAgentForAction(
    action: string | ValidationAction,
    options?: CreateAgentForActionOptions,
  ): Promise<AgentCertificate>;
  spawnAgent(parentId: string, purpose: string, capabilities?: string[], options?: SpawnAgentOptions): Promise<AgentCertificate & { parentId: string }>;
  validate(agentId: string, action: string | ValidationAction, parameters?: Record<string, unknown>): Promise<ValidationResponse>;
  validateBatch(validations: BatchValidationItem[]): Promise<ValidationResponse[]>;
  healthCheck(): Promise<Record<string, unknown>>;
  getUsage(): Promise<Record<string, unknown>>;
  delegateToken(options: DelegateTokenOptions): Promise<Record<string, unknown>>;
  verifyToken(accessToken: string, options?: VerifyTokenOptions): Promise<Record<string, unknown>>;
  revokeToken(accessToken: string): Promise<Record<string, unknown>>;
  ensureApiKey(): Promise<string>;
}

export declare const AgentGovernanceClient: typeof CeroneClient;
export declare const VERSION_STRING: string;
export declare const InteractionMode: Readonly<Record<string, InteractionMode>>;
export declare const TelemetryEventType: Readonly<Record<string, TelemetryEventType>>;
export declare const LocalErrorCategory: Readonly<Record<string, LocalErrorCategory>>;
