/**
 * Smart Router Hook Entry Point
 * Integrated into model selection flow, executes smart routing decision before model selection
 *
 * New system: DNA + Patches + Prefix triggering
 */

import type { OpenClawConfig } from '../config/config.js'
import type { RoutingDecision } from '../smart-router/types/smart-router.types.js'
import { createEmbeddingProvider } from '../memory/embeddings.js'
import { CONFIG_DIR } from '../utils.js'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs/promises'

// Import new smart router (DNA+Patches version)
import { createSmartRouter as createNewSmartRouter, type SmartRouter as NewSmartRouter } from '../smart-router/routing/router.js'
// Import DNA loader
import { loadDNAFromFile, copySeedDNA, copyDefaultUserMemory } from '../smart-router/dna/loader.js'

/**
 * Smart Router separate config file structure
 * Stored at ~/.openclaw/smart-router/config.json
 */
interface SmartRouterConfigFile {
  enabled: boolean;
  lightweightModels?: string[];
  flagshipModels?: string[];
  confidenceThreshold?: number;
  tokenThreshold?: number;
  flagshipKeywords?: string[];
  vectorIndexPath?: string;
  defaultModel?: string;
  keywordsFilePath?: string;
  memorySearch?: {
    provider: "openai" | "gemini" | "local";
    model?: string;
    remote?: {
      apiKey: string;
      baseUrl?: string;
    };
    local?: {
      modelPath: string;
    };
  };
}

/**
 * Get smart router config file path
 */
function getSmartRouterConfigPath(): string {
  return path.join(CONFIG_DIR, 'smart-router', 'config.json')
}

/**
 * Read smart router config from separate file
 */
async function readSmartRouterConfig(): Promise<SmartRouterConfigFile | null> {
  const configPath = getSmartRouterConfigPath()
  try {
    const raw = await fs.readFile(configPath, 'utf-8')
    return JSON.parse(raw) as SmartRouterConfigFile
  } catch {
    return null
  }
}

/**
 * AsyncLocalStorage for propagating routing decisions through the call chain
 * This avoids passing smartRouteDecision through 7+ function parameters
 */
type SmartRouteDecisionStorage = RoutingDecision | null
export const smartRouteStorage = new AsyncLocalStorage<SmartRouteDecisionStorage>()

/**
 * Get the current smart route decision from AsyncLocalStorage
 * Returns undefined if no decision has been stored in this context
 */
export function getSmartRouteDecision(): RoutingDecision | undefined {
  return smartRouteStorage.getStore() ?? undefined
}

/**
 * Run a callback with a smart route decision stored in AsyncLocalStorage
 */
export function runWithSmartRouteDecision<T>(
  decision: RoutingDecision | null,
  callback: () => T
): T {
  return smartRouteStorage.run(decision, callback)
}

/**
 * New smart router instance (DNA+Patches version)
 */
let newRouterInstance: NewSmartRouter | null = null

/**
 * Check if smart routing is enabled
 * First check main config (for backward compatibility), then check separate config file's enabled field
 */
async function isSmartRouterEnabled(cfg: OpenClawConfig): Promise<boolean> {
  // First check main config (for backward compatibility)
  if (cfg.smartRouter?.enabled === true) {
    return true;
  }
  if (cfg.smartRouter?.enabled === false) {
    return false;
  }

  // Check separate config file
  const configPath = getSmartRouterConfigPath();
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as SmartRouterConfigFile;
    return config.enabled === true;
  } catch {
    return false;
  }
}

/**
 * Initialize new smart router (DNA+Patches version)
 */
async function initializeNewSmartRouter(
  cfg: OpenClawConfig
): Promise<NewSmartRouter | null> {
  // Check if smart routing is enabled
  if (!(await isSmartRouterEnabled(cfg))) {
    return null
  }

  // If already initialized, return directly
  if (newRouterInstance) {
    return newRouterInstance
  }

  try {
    // Create config directory
    const configDir = path.join(CONFIG_DIR, 'smart-router')
    await fs.mkdir(configDir, { recursive: true })

    // Read smart router config from separate file
    const separateConfig = await readSmartRouterConfig()

    // Merge separate config with main config (separate config takes precedence)
    const memorySearchConfig = separateConfig?.memorySearch || cfg.agents?.defaults?.memorySearch
    const lightweightModels = separateConfig?.lightweightModels || cfg.smartRouter?.lightweightModels
    const flagshipModels = separateConfig?.flagshipModels || cfg.smartRouter?.flagshipModels

    // Create embedding provider
    const embeddingResult = await createEmbeddingProvider({
      config: cfg,
      provider: memorySearchConfig?.provider || 'auto',  // Use configured provider or auto-select
      fallback: (memorySearchConfig as any)?.fallback || 'local',
      model: memorySearchConfig?.model || cfg.agents?.defaults?.model?.primary || 'text-embedding-3-small',
      remote: memorySearchConfig?.remote ? {
        baseUrl: memorySearchConfig.remote.baseUrl,
        apiKey: memorySearchConfig.remote.apiKey,
        headers: (memorySearchConfig.remote as any)?.headers,
      } : undefined,
      local: memorySearchConfig?.local ? {
        modelPath: memorySearchConfig.local.modelPath,
        modelCacheDir: (memorySearchConfig.local as any)?.modelCacheDir,
      } : undefined,
    })

    // Create adapter: number[] -> Float32Array
    const embedFn = async (text: string): Promise<Float32Array> => {
      const vector = await embeddingResult.provider.embedQuery(text)
      return new Float32Array(vector)
    }

    // Create new smart router
    const agentDefaults = cfg.agents?.defaults
    const primaryModel = agentDefaults?.model?.primary || 'haiku'

    newRouterInstance = createNewSmartRouter({
      vectorStore: {
        configDir,
        vectorDim: 1024,
        dataFilePath: path.join(configDir, 'user_memory.bin'),
        enableCompaction: true,
        compactionThreshold: 1500
      },
      prefix: {
        flagship: ['旗舰:', '旗舰 ', 'Force:', 'Force ', 'F:', 'F '],
        lightweight: ['轻量:', '轻量 ', 'Fast:', 'Fast ', 'L:', 'L ']
      },
      timeDecay: {
        gamma: 0.95,
        halfLifeDays: 30,
        deathThreshold: 0.1,
        minRetention: 3
      },
      embedding: {
        timeoutMs: 1500,
        maxRetries: 2,
        retryDelayMs: 500
      },
      patchSimilarityThreshold: 0.55,  // Optimized: covers 95%+ of queries (actual scores 0.52-0.65)
      dnaSimilarityThreshold: 0.60,     // Balanced threshold based on actual query patterns
      softPartitionThreshold: 0.1,
      defaultLightweightModel: lightweightModels?.[0] || cfg.smartRouter?.lightweightModels?.[0] || primaryModel,
      defaultFlagshipModel: flagshipModels?.[0] || cfg.smartRouter?.flagshipModels?.[0] || 'opus'
    }, embedFn)

    // IMPORTANT: Copy seed files BEFORE initialization!
    // The initialize() call loads user_memory.bin, so files must exist first.

    // Try to copy default user memory file for better initial matching
    const userMemoryPath = path.join(configDir, 'user_memory.bin')
    try {
      await fs.access(userMemoryPath)
      console.log('[smart-route] User memory file exists, skipping copy')
    } catch {
      // User memory file doesn't exist, try to copy default from source
      console.log('[smart-route] User memory file not found, attempting to copy default...')
      const copied = await copyDefaultUserMemory(configDir)
      if (copied) {
        console.log('[smart-route] Default user memory copied successfully')
      } else {
        console.warn('[smart-route] Failed to copy default user memory file')
      }
    }

    // Try to copy DNA seed file
    const dnaPath = path.join(configDir, 'base_dna.bin')
    try {
      // Check if DNA file exists
      await fs.access(dnaPath)
      console.log('[smart-route] DNA seed file exists, skipping copy')
    } catch {
      // DNA file doesn't exist, try to copy seed DNA from source
      console.log('[smart-route] DNA file not found, attempting to copy seed DNA...')
      const copied = await copySeedDNA(configDir)
      if (!copied) {
        console.warn('[smart-route] Failed to copy seed DNA file')
      }
    }

    // Now initialize router (files must exist before this call!)
    await newRouterInstance.initialize()

    // Load DNA intents
    try {
      const intents = await loadDNAFromFile(dnaPath)
      if (intents.length > 0) {
        newRouterInstance.loadDNA(intents)
        console.log(`[smart-route] Loaded ${intents.length} DNA intents`)
      } else {
        console.warn('[smart-route] DNA file loading failed or is empty')
      }
    } catch (error) {
      console.warn('[smart-route] Failed to load DNA configuration:', error)
    }

    console.log('[smart-route] New smart router initialized successfully')
    return newRouterInstance
  } catch (error) {
    console.error('[smart-route] New smart router initialization failed:', error)
    return null
  }
}

/**
 * Smart Router Hook Entry Point
 * Execute before model selection, return routing decision details
 *
 * @param query - User query text
 * @param cfg - System configuration
 * @param agentId - Agent ID
 * @returns Promise<RoutingDecision | null> - Routing decision, returns null if disabled or failed
 */
export async function smartRouteHook(
  query: string,
  cfg: OpenClawConfig,
  agentId?: string
): Promise<RoutingDecision | null> {
  try {
    // 1. Check if smart routing is enabled
    if (!(await isSmartRouterEnabled(cfg))) {
      return null
    }

    // 2. Initialize or get new router
    const router = await initializeNewSmartRouter(cfg)

    // If router instance not created, return null
    if (!router) {
      return null
    }

    // 3. Execute routing decision
    const decision = await router.decide(query)

    // 4. Output routing decision log
    console.log(`[smart-route] 🤖 Routing decision: ${decision.modelTier.toUpperCase()}`)
    console.log(`[smart-route] 📦 Selected model: ${decision.selectedModel}`)
    console.log(`[smart-route] 📊 Confidence: ${decision.confidence.toFixed(3)}`)
    console.log(`[smart-route] 💭 Reason: ${decision.reasoning}`)

    // 5. Return decision (caller establishes context via runWithSmartRouteDecision)
    return decision
  } catch (error) {
    // Return null on failure, fallback to original logic
    console.error('[smart-route] ❌ Hook failed, falling back to default model selection:', error)
    return null
  }
}

/**
 * Reset router instance (for testing or config update)
 */
export function resetRouterInstance(): void {
  if (newRouterInstance) {
    newRouterInstance = null
  }
}

/**
 * Record routing decision result (for feedback learning)
 *
 * @param query - Query text
 * @param modelRef - Model used
 * @param outcome - Actual result
 * @param additionalData - Additional data
 */
export async function recordRoutingDecision(
  query: string,
  modelRef: string,
  outcome?: 'success' | 'failure' | 'partial',
  additionalData?: {
    cost?: number
    latency?: number
    tokenCount?: number
    reasoningComplexity?: number
    taskCategory?: string
    sessionId?: string
  },
  cfg?: OpenClawConfig
): Promise<void> {
  if (!newRouterInstance || !cfg) {
    return
  }

  // Read smart router config from separate file to get flagship models
  const separateConfig = await readSmartRouterConfig()
  const flagshipModels = separateConfig?.flagshipModels || cfg.smartRouter?.flagshipModels

  // Determine model tier
  const modelTier = flagshipModels?.includes(modelRef) ? 'flagship' : 'lightweight'

  // Record learning
  await newRouterInstance.recordLearning(query, modelTier)

  console.log(`[smart-route] Recorded learning: "${query.substring(0, 30)}..." → ${modelTier}`)
}
