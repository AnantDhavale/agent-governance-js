export type ValidationDecision = "approved" | "flagged" | "rejected" | "error";

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
export declare class RateLimitError extends CeroneError {}
export declare class NetworkError extends CeroneError {}

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

  createAgent(purpose: string, capabilities?: string[], options?: CreateAgentOptions): Promise<AgentCertificate>;
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
