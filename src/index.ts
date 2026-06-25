// Types
export * from "./types/index.js";

// Database
export { getDatabase, closeDatabase, resetDatabase, uuid, shortId, now, resolvePartialId } from "./db/database.js";
export {
  SANDBOXES_STORAGE_ENV,
  SANDBOXES_STORAGE_FALLBACK_ENV,
  SANDBOXES_STORAGE_MODE_ENV,
  SANDBOXES_STORAGE_MODE_FALLBACK_ENV,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  getConnectionString,
  getStorageConfig,
  getStorageConnectionString,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  type StorageConfig,
  type StorageEnv,
  type StorageMode,
} from "./db/storage-config.js";
export { PgAdapterAsync } from "./db/remote-storage.js";
export { applyPgMigrations } from "./db/pg-migrate.js";
export {
  SANDBOXES_STORAGE_TABLES,
  STORAGE_TABLES,
  getStoragePg,
  getStorageStatus,
  parseStorageTables,
  pullStorageChanges,
  pushStorageChanges,
  runStorageMigrations,
  syncStorageChanges,
} from "./db/storage-sync.js";
export type { StorageStatus, SyncResult } from "./db/storage-sync.js";
export { createSandbox, getSandbox, listSandboxes, updateSandbox, deleteSandbox } from "./db/sandboxes.js";
export { createSession, getSession, listSessions, updateSession, endSession } from "./db/sessions.js";
export { addEvent, listEvents } from "./db/events.js";
export { registerAgent, getAgent, getAgentByName, listAgents, deleteAgent } from "./db/agents.js";
export { createProject, getProject, getProjectByPath, listProjects, ensureProject, deleteProject } from "./db/projects.js";
export { createWebhook, getWebhook, listWebhooks, deleteWebhook } from "./db/webhooks.js";
export { createTemplate, getTemplate, getTemplateByName, listTemplates, deleteTemplate } from "./db/templates.js";
export { createSnapshot, getSnapshot, listSnapshots, deleteSnapshot } from "./db/snapshots.js";
export type { Snapshot, SnapshotRow } from "./db/snapshots.js";
export { SnapshotNotFoundError } from "./db/snapshots.js";

// Config
export { loadConfig, saveConfig, getDefaultProvider, getDefaultTimeout, getDefaultImage, getProviderApiKey, setConfigValue, getConfigValue } from "./lib/config.js";

// Images
export { BUILTIN_IMAGES, resolveImage, getBuiltinImageSetupScript } from "./lib/images.js";

// Providers
export { getProvider } from "./providers/index.js";
export type { SandboxProvider, ProviderSandbox, CreateSandboxOpts, ExecOptions } from "./providers/types.js";

// SDK
export {
  SandboxesSDK,
  createSandboxesSDK,
} from "./sdk.js";
export type {
  ExecCommandResult,
  ProviderFactory,
  RunAgentOptions,
  RunCommandInSandboxOptions,
  RunCommandInSandboxResult,
  RunCommandInSandboxUploadOptions,
  SandboxesSDKOptions,
  OneShotSandboxCleanup,
  WaitForSessionOptions,
} from "./sdk.js";

// Stream
export { createStreamCollector, addStreamListener, emitLifecycleEvent } from "./lib/stream.js";

// Agent drivers
export { getAgentDriver, listAgentDrivers } from "./lib/agents/index.js";
export type { AgentDriver } from "./lib/agents/types.js";
