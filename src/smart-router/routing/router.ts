/**
 * Smart Routing Decision Module
 *
 * Core features:
 * - Prefix detection (highest priority)
 * - Embedding API call + timeout protection
 * - Patch search (user learning)
 * - DNA partition search (static features)
 * - Keyword matching fallback (offline protection)
 * - Default lightweight model fallback
 *
 * Decision flow:
 * 1. Prefix detection → direct return
 * 2. Embedding API → patch search
 * 3. DNA search → static feature matching
 * 4. Keyword matching → offline fallback
 * 5. Default lightweight → fallback
 */

import type { RoutingDecision, KeywordMatchResult, SmartRouterConfig } from '../types/smart-router.types.js'
import { detectPrefixCommand, stripPrefix } from './prefix-detector.js'
import { VectorStore } from '../memory/vector-store.js'
import { LayeredIndex } from './layered-index.js'
import { normalize } from './similarity.js'

/**
 * Embedding API function type
 */
export type EmbeddingFunction = (text: string) => Promise<Float32Array>

/**
 * Smart Router class
 */
export class SmartRouter {
  private config: SmartRouterConfig
  private vectorStore: VectorStore
  private layeredIndex: LayeredIndex
  private embed: EmbeddingFunction
  private dnaLoaded = false

  constructor(
    config: SmartRouterConfig,
    embed: EmbeddingFunction
  ) {
    this.config = config
    this.embed = embed

    // Initialize vector storage
    this.vectorStore = new VectorStore(config.vectorStore)

    // Initialize layered index
    this.layeredIndex = new LayeredIndex({
      softPartitionThreshold: config.softPartitionThreshold,
      patchSearchTopK: 5,
      patchSimilarityThreshold: config.patchSimilarityThreshold,
      dnaSimilarityThreshold: config.dnaSimilarityThreshold
    })
  }

  /**
   * Initialize (load DNA and patches)
   */
  async initialize(): Promise<void> {
    // Load vector storage
    await this.vectorStore.load()

    // Load patches into index
    const patches = this.vectorStore.getAllPatches()
    this.layeredIndex.loadPatches(patches)

    console.log('[SmartRouter] Initialized successfully')
  }

  /**
   * Load DNA intents
   */
  loadDNA(intents: import('../types/smart-router.types.js').DNAIntent[]): void {
    this.layeredIndex.loadDNA(intents)
    this.dnaLoaded = true
    console.log(`[SmartRouter] Loaded ${intents.length} DNA intents`)
  }

  /**
   * Routing decision (main entry point)
   */
  async decide(query: string): Promise<RoutingDecision> {
    console.log(`[SmartRouter] Processing query: "${query.substring(0, 50)}..."`)

    // 1. Prefix detection (highest priority, no API call needed)
    const prefixCommand = detectPrefixCommand(query)
    if (prefixCommand) {
      const cleanQuery = stripPrefix(query, prefixCommand)

      // Record learning
      await this.recordLearning(cleanQuery, prefixCommand)

      const selectedModel = prefixCommand === 'flagship'
        ? this.config.defaultFlagshipModel
        : this.config.defaultLightweightModel

      return {
        modelTier: prefixCommand,
        selectedModel,
        confidence: 1.0,
        reasoning: 'User explicitly specified'
      }
    }

    // 2. Embedding API call (with timeout protection)
    let queryVector: Float32Array
    try {
      queryVector = await this.withTimeout(
        this.embed(query),
        this.config.embedding.timeoutMs
      )
      normalize(queryVector)  // Ensure vector is normalized
    } catch (error) {
      console.warn('[SmartRouter] Embedding failed, fallback to keyword matching:', error)
      const keywordResult = this.matchByKeywords(query)

      if (keywordResult.matched) {
        const selectedModel = keywordResult.tier === 'flagship'
          ? this.config.defaultFlagshipModel
          : this.config.defaultLightweightModel

        return {
          modelTier: keywordResult.tier,
          selectedModel,
          confidence: 0.7,
          reasoning: `Keyword match: ${keywordResult.keyword}`
        }
      }

      // Keywords also don't match, use default lightweight model
      return {
        modelTier: 'lightweight',
        selectedModel: this.config.defaultLightweightModel,
        confidence: 0.5,
        reasoning: 'No clear signal, using default lightweight model'
      }
    }

    // 3. Search patches (user learning data)
    const patchResult = this.layeredIndex.search(queryVector, query)
    const hasPatches = this.layeredIndex.getPatchCount() > 0

    // Debug: Log patch search result
    if (patchResult.found) {
      console.log(`[SmartRouter] Patch result: score=${patchResult.score.toFixed(3)}, tier=${patchResult.tier}, from=${patchResult.from || 'patch'}, threshold=${this.config.patchSimilarityThreshold}`)
    }

    if (patchResult.found && patchResult.score >= this.config.patchSimilarityThreshold) {
      const selectedModel = patchResult.tier === 'flagship'
        ? this.config.defaultFlagshipModel
        : this.config.defaultLightweightModel

      return {
        modelTier: patchResult.tier,
        selectedModel,
        confidence: patchResult.score,
        reasoning: `Patch hit (similarity ${patchResult.score.toFixed(2)})`
      }
    }

    // 4. Search DNA (static features)
    // If no patch data, use DNA best match (regardless of similarity)
    // If have patch data but not hit, use DNA match (requires similarity >= 0.3)
    if (this.dnaLoaded) {
      const dnaResult = this.layeredIndex.search(queryVector, query)
      if (dnaResult.found) {
        const dnaThreshold = hasPatches ? 0.3 : 0.0 // When no patches, accept any DNA match

        if (dnaResult.score >= dnaThreshold) {
          const selectedModel = dnaResult.tier === 'flagship'
            ? this.config.defaultFlagshipModel
            : this.config.defaultLightweightModel

          return {
            modelTier: dnaResult.tier,
            selectedModel,
            confidence: dnaResult.score,
            reasoning: hasPatches
              ? `Intent matched: ${dnaResult.intent?.name || 'unknown'} (similarity ${dnaResult.score.toFixed(2)})`
              : `Intent matched: ${dnaResult.intent?.name || 'unknown'} (no learning data)`
          }
        }
      }
    }

    // 5. Default lightweight model (fallback)
    return {
      modelTier: 'lightweight',
      selectedModel: this.config.defaultLightweightModel,
      confidence: 0.5,
      reasoning: 'No clear signal, using default lightweight model'
    }
  }

  /**
   * Record learning
   */
  async recordLearning(query: string, tier: 'flagship' | 'lightweight'): Promise<void> {
    try {
      // Vectorize
      const vector = await this.embed(query)
      normalize(vector)

      // Add to storage
      await this.vectorStore.addPatch({
        vector,
        tier,
        label: query,
        timestamp: Date.now(),
        initialWeight: 1.0
      })

      // Update index
      const patches = this.vectorStore.getAllPatches()
      this.layeredIndex.loadPatches(patches)

      console.log(`[SmartRouter] Learned: "${query.substring(0, 30)}..." → ${tier}`)
    } catch (error) {
      console.error('[SmartRouter] Failed to record learning:', error)
    }
  }

  /**
   * Keyword matching (offline fallback, bilingual Chinese/English)
   */
  matchByKeywords(query: string): KeywordMatchResult {
    const flagshipKeywords = [
      // Chinese
      '写代码', '开发', '实现', '设计', '架构',
      'debug', '调试', '优化', '部署',
      // English
      'code', 'write', 'implement', 'develop', 'build',
      'design', 'architecture', 'debug', 'optimize', 'deploy',
      'create', 'generate', 'refactor'
    ]

    const lightweightKeywords = [
      // Chinese
      '解释', '说明', '什么是', '如何', '怎么',
      '简单', '快速', '查询', '搜索',
      // English
      'explain', 'what is', 'how to', 'what',
      'simple', 'quick', 'fast', 'search', 'query',
      'describe', 'define', 'tell me'
    ]

    const lowerQuery = query.toLowerCase()

    for (const keyword of flagshipKeywords) {
      if (lowerQuery.includes(keyword)) {
        return { matched: true, tier: 'flagship', keyword }
      }
    }

    for (const keyword of lightweightKeywords) {
      if (lowerQuery.includes(keyword)) {
        return { matched: true, tier: 'lightweight', keyword }
      }
    }

    return { matched: false, tier: 'lightweight', keyword: '' }
  }

  /**
   * Timeout protection
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Embedding timeout')), timeoutMs)
      )
    ])
  }

  /**
   * Get statistics
   */
  getStats(): {
    patchCount: number
    dnaLoaded: boolean
    config: SmartRouterConfig
  } {
    return {
      patchCount: this.vectorStore.getCount(),
      dnaLoaded: this.dnaLoaded,
      config: this.config
    }
  }
}

/**
 * Create smart router instance
 */
export function createSmartRouter(
  config: Partial<SmartRouterConfig> = {},
  embed: EmbeddingFunction
): SmartRouter {
  const fullConfig: SmartRouterConfig = {
    vectorStore: {
      configDir: config.vectorStore?.configDir || process.cwd(),
      vectorDim: config.vectorStore?.vectorDim || 1024,
      dataFilePath: config.vectorStore?.dataFilePath ||
        `${process.cwd()}/user_memory.bin`,
      enableCompaction: config.vectorStore?.enableCompaction ?? true,
      compactionThreshold: config.vectorStore?.compactionThreshold || 1500
    },
    prefix: {
      flagship: config.prefix?.flagship || ['旗舰:', '旗舰 ', 'Force:', 'Force ', 'F:', 'F '],
      lightweight: config.prefix?.lightweight || ['轻量:', '轻量 ', 'Fast:', 'Fast ', 'L:', 'L ']
    },
    timeDecay: {
      gamma: config.timeDecay?.gamma || 0.95,
      halfLifeDays: config.timeDecay?.halfLifeDays || 30,
      deathThreshold: config.timeDecay?.deathThreshold || 0.1,
      minRetention: config.timeDecay?.minRetention || 3
    },
    embedding: {
      timeoutMs: config.embedding?.timeoutMs || 1500,
      maxRetries: config.embedding?.maxRetries || 2,
      retryDelayMs: config.embedding?.retryDelayMs || 500
    },
    patchSimilarityThreshold: config.patchSimilarityThreshold || 0.92,
    dnaSimilarityThreshold: config.dnaSimilarityThreshold || 0.85,
    softPartitionThreshold: config.softPartitionThreshold || 0.1,
    defaultLightweightModel: config.defaultLightweightModel || 'haiku',
    defaultFlagshipModel: config.defaultFlagshipModel || 'opus'
  }

  return new SmartRouter(fullConfig, embed)
}
