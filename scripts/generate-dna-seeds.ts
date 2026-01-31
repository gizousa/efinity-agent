#!/usr/bin/env tsx
/**
 * Generate DNA Seed Binary File (base_dna.bin)
 *
 * TypeScript implementation to ensure 100% compatibility with DNA loader.
 * Uses the exact same header layout and byte order as parseHeader expects.
 *
 * Usage:
 *   tsx scripts/generate-dna-seeds.ts
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Get script directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ==========================================
// CONFIGURATION - Modify these values
// ==========================================

// Seed data files (JSON format: [{ text: string, label: string }])
// Paths are relative to script directory
const SEED_FILES = [
  path.join(__dirname, 'openclaw_seed_data_1000.json')
]

// Output file path
const OUTPUT_PATH = 'src/smart-router/dna/base_dna.bin'

// Embedding API configuration
const EMBEDDING_API_KEY = process.env.SILICONFLOW_API_KEY || 'sk-xxxxx'
const EMBEDDING_API_URL = 'https://api.siliconflow.cn/v1/embeddings'
const EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-0.6B'  // 1024 dimensions
const BATCH_SIZE = 20

// DNA Intent labels (must match seed data labels)
const DNA_LABELS = ['CHAT', 'FACT', 'TRANS', 'CODE', 'REASON', 'WRITE'] as const

// DNA Intent tier mapping
const INTENT_TIERS: Record<string, 'flagship' | 'lightweight'> = {
  CODE: 'flagship',
  REASON: 'flagship',
  CHAT: 'lightweight',
  FACT: 'lightweight',
  TRANS: 'lightweight',
  WRITE: 'lightweight'
}

// ==========================================
// CONSTANTS - Do not modify
// ==========================================

// Vector dimension
const VECTOR_DIM = 1024

// Header size (fixed 40 bytes)
// Layout:
// - Offset 0-3:   magic (uint32 LE) = 0x52544356
// - Offset 4-7:   version (uint32 LE)
// - Offset 8-11:  vectorDim (uint32 LE)
// - Offset 12-15: count (uint32 LE)
// - Offset 16-23: reserved (8 bytes)
// - Offset 24-31: metadataOffset (uint64 BE)
// - Offset 32-39: dataOffset (uint64 BE)
const HEADER_SIZE = 40

/**
 * DNA Intent definition
 */
interface DNAIntentDef {
  name: string
  tier: 'flagship' | 'lightweight'
  description: string
  keywords: string[]
}

/**
 * DNA file metadata
 */
interface DNAMetadata {
  version: string
  generatedAt: number
  count: number
  vectorDim: number
  intents: DNAIntentDef[]
}

/**
 * Load seed data from JSON files
 */
async function loadSeedData(jsonFiles: string[]): Promise<Array<{ text: string; label: string }>> {
  const allData: Array<{ text: string; label: string }> = []

  for (const filepath of jsonFiles) {
    try {
      const content = await fs.readFile(filepath, 'utf-8')
      const data = JSON.parse(content) as Array<{ text: string; label: string }>
      allData.push(...data)
      console.log(`✓ Loaded ${data.length} entries from ${filepath}`)
    } catch (error) {
      console.warn(`⚠ Skipped: ${filepath} (${(error as NodeJS.ErrnoException).code})`)
    }
  }

  return allData
}

/**
 * Call embedding API to get vectors for texts
 */
async function getEmbeddings(texts: string[]): Promise<Float32Array[]> {
  if (!EMBEDDING_API_KEY) {
    throw new Error('EMBEDDING_API_KEY not set! Set EMBEDDING_API_KEY in file or SILICONFLOW_API_KEY environment variable.')
  }

  const response = await fetch(EMBEDDING_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${EMBEDDING_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      encoding_format: 'float'
    })
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`API Error ${response.status}: ${errorText}`)
  }

  const result = await response.json() as { data: Array<{ embedding: number[] }> }

  return result.data.map(item => {
    const vec = new Float32Array(item.embedding)
    normalize(vec)
    return vec
  })
}

/**
 * Calculate Medoid vectors for each label from seed data
 *
 * Medoid = 到同类其他所有点距离之和最短的真实向量
 * 优点：代表点是真实样本，不会被"平均化"抹除特征
 */
async function calculateCentroids(data: Array<{ text: string; label: string }>): Promise<Map<string, Float32Array>> {
  // 按label分组存储所有向量
  const labelVectors = new Map<string, Array<{ text: string; vector: Float32Array }>>()

  // Initialize
  for (const label of DNA_LABELS) {
    labelVectors.set(label, [])
  }

  // Process in batches
  console.log(`📊 Processing ${data.length} seed data entries...`)
  console.log(`🚀 Using ${EMBEDDING_API_KEY ? 'Embedding API' : 'random vectors (set EMBEDDING_API_KEY)'}`)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const texts = batch.map(item => item.text)

    // Get embeddings
    const vectors = await getEmbeddings(texts)

    // Group by label
    for (let idx = 0; idx < batch.length; idx++) {
      const item = batch[idx]
      const vec = vectors[idx]
      const group = labelVectors.get(item.label)

      if (group) {
        group.push({ text: item.text, vector: vec })
      }
    }

    // Progress
    if ((i + BATCH_SIZE) % 100 === 0 || (i + BATCH_SIZE) >= data.length) {
      console.log(`   Processed: ${Math.min(i + BATCH_SIZE, data.length)}/${data.length}...`)
    }
  }

  // Calculate Medoids for each label
  console.log('✅ Computing Medoids (most representative samples)...')
  const result = new Map<string, Float32Array>()

  for (const [label, vectors] of labelVectors) {
    if (vectors.length === 0) {
      result.set(label, generateRandomVector())
      console.log(`⚠ No data for ${label}, using random vector`)
      continue
    }

    // 找到Medoid：到其他所有点距离之和最小的向量
    const medoid = findMedoid(vectors.map(v => v.vector))
    result.set(label, medoid)

    // 找到medoid对应的原始文本（用于日志）
    const medoidIndex = vectors.findIndex(v => {
      // 简单比较：找到向量相同的那个
      for (let i = 0; i < VECTOR_DIM; i++) {
        if (v.vector[i] !== medoid[i]) return false
      }
      return true
    })
    const sampleText = medoidIndex >= 0 ? vectors[medoidIndex].text.substring(0, 30) : 'unknown'

    console.log(`✓ ${label}: ${vectors.length} samples, medoid: "${sampleText}..."`)
  }

  return result
}

/**
 * 找到Medoid：到其他所有点距离之和最小的向量
 *
 * @param vectors - 同类别的所有向量
 * @returns Medoid向量（真实样本之一）
 */
function findMedoid(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) {
    throw new Error('Cannot find medoid of empty array')
  }

  if (vectors.length === 1) {
    return vectors[0]
  }

  let minTotalDist = Infinity
  let medoidIndex = 0

  // 对每个向量，计算它到其他所有向量的距离之和
  for (let i = 0; i < vectors.length; i++) {
    let totalDist = 0

    for (let j = 0; j < vectors.length; j++) {
      if (i === j) continue

      // 距离 = 1 - 余弦相似度（因为向量已单位化）
      const similarity = dotProduct(vectors[i], vectors[j])
      const distance = 1 - similarity
      totalDist += distance
    }

    if (totalDist < minTotalDist) {
      minTotalDist = totalDist
      medoidIndex = i
    }
  }

  console.log(`   Medoid distance sum: ${minTotalDist.toFixed(4)} (average: ${(minTotalDist / (vectors.length - 1)).toFixed(4)})`)

  return vectors[medoidIndex]
}

/**
 * 点积计算（用于Medoid距离计算）
 */
function dotProduct(vecA: Float32Array, vecB: Float32Array): number {
  let dot = 0
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i]
  }
  return dot
}

/**
 * Generate random vector and L2 normalize (fallback)
 */
function generateRandomVector(): Float32Array {
  const vec = new Float32Array(VECTOR_DIM)
  for (let i = 0; i < VECTOR_DIM; i++) {
    vec[i] = Math.random() * 2 - 1  // [-1, 1]
  }
  normalize(vec)
  return vec
}

/**
 * L2 normalize vector in-place
 */
function normalize(vec: Float32Array): void {
  let norm = 0
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm) || 1

  for (let i = 0; i < vec.length; i++) {
    vec[i] /= norm
  }
}

/**
 * Generate VCTR DNA binary file
 */
async function generateDNAFile(
  centroids: Map<string, Float32Array>,
  outputPath: string
): Promise<void> {
  const intents: DNAIntentDef[] = []
  const vectorsData: Buffer[] = []

  // Build intents in LABELS order
  for (const label of DNA_LABELS) {
    const vec = centroids.get(label)
    if (!vec) {
      console.warn(`⚠ Label ${label} missing, skipping`)
      continue
    }

    intents.push({
      name: label.toLowerCase(),
      tier: INTENT_TIERS[label],
      description: `${label} intent for smart routing`,
      keywords: [label.toLowerCase()]
    })

    // Convert Float32Array to Buffer (little-endian)
    const vecBuffer = Buffer.from(vec.buffer)
    vectorsData.push(vecBuffer)
  }

  // Build metadata
  const metadata: DNAMetadata = {
    version: '1.0.0',
    generatedAt: Date.now(),
    count: intents.length,
    vectorDim: VECTOR_DIM,
    intents
  }

  const metadataJson = JSON.stringify(metadata)
  const metadataBytes = Buffer.from(metadataJson, 'utf-8')

  // Calculate file layout
  const dataOffset = HEADER_SIZE
  const metadataOffset = dataOffset + vectorsData.reduce((sum, buf) => sum + buf.length, 0)

  // Create buffer with exact header layout (40 bytes)
  // Layout must match DNA loader readHeader():
  // - Offset 0-3:   magic (uint32 LE)
  // - Offset 4-7:   version (uint32 LE)
  // - Offset 8-11:  vectorDim (uint32 LE)
  // - Offset 12-15: count (uint32 LE)
  // - Offset 16-23: reserved (8 bytes)
  // - Offset 24-31: metadataOffset (uint64 BE)
  // - Offset 32-39: dataOffset (uint64 BE)
  const buffer = Buffer.allocUnsafeSlow(metadataOffset + metadataBytes.length)

  // Write header (40 bytes)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  // Offset 0-3: magic (little-endian)
  view.setUint32(0, 0x52544356, true)

  // Offset 4-7: version (little-endian, uint32)
  view.setUint32(4, 1, true)

  // Offset 8-11: vectorDim (little-endian)
  view.setUint32(8, VECTOR_DIM, true)

  // Offset 12-15: count (little-endian)
  view.setUint32(12, intents.length, true)

  // Offset 16-23: reserved (8 bytes)
  buffer.writeBigUInt64BE(BigInt(0), 16)

  // Offset 24-31: metadataOffset (big-endian)
  buffer.writeBigUInt64BE(BigInt(metadataOffset), 24)

  // Offset 32-39: dataOffset (big-endian)
  buffer.writeBigUInt64BE(BigInt(dataOffset), 32)

  // Write vector data
  let offset = dataOffset
  for (const vecBuffer of vectorsData) {
    vecBuffer.copy(buffer, offset)
    offset += vecBuffer.length
  }

  // Write metadata
  metadataBytes.copy(buffer, metadataOffset)

  // Write file
  const outputDir = path.dirname(outputPath)
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(outputPath, buffer)

  console.log(`\n🎯 DNA file generated: ${outputPath}`)
  console.log(`   Size: ${buffer.length} bytes (${(buffer.length / 1024).toFixed(2)} KB)`)
  console.log(`   Intents: ${intents.length}`)
  console.log(`   Vector Dim: ${VECTOR_DIM}`)
  console.log(`   Data Offset: ${dataOffset}`)
  console.log(`   Metadata Offset: ${metadataOffset}`)
}

/**
 * Verify generated DNA file
 */
async function verifyDNAFile(filePath: string): Promise<boolean> {
  try {
    const buffer = await fs.readFile(filePath)
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    const magic = view.getUint32(0, true)
    const version = view.getUint32(4, true)
    const vectorDim = view.getUint32(8, true)
    const count = view.getUint32(12, true)
    const metadataOffset = Number(view.getBigUint64(24, false))
    const dataOffset = Number(view.getBigUint64(32, false))

    console.log('\n📋 Verification:')
    console.log(`   Magic: 0x${magic.toString(16).padStart(8, '0')} ${magic === 0x52544356 ? '✓' : '✗'}`)
    console.log(`   Version: ${version} ${version === 1 ? '✓' : '✗'}`)
    console.log(`   Vector Dim: ${vectorDim} ${vectorDim === VECTOR_DIM ? '✓' : '✗'}`)
    console.log(`   Count: ${count}`)
    console.log(`   Data Offset: ${dataOffset} ${dataOffset === HEADER_SIZE ? '✓' : '✗'}`)
    console.log(`   Metadata Offset: ${metadataOffset}`)
    console.log(`   File Size: ${buffer.length}`)

    // Read metadata
    const metadataJson = buffer.subarray(metadataOffset).toString('utf-8')
    const metadata = JSON.parse(metadataJson) as DNAMetadata

    console.log(`   Metadata: ✓ Valid JSON`)
    console.log(`   Intents: ${metadata.intents.length}`)

    // Test read one vector
    const testOffset = dataOffset
    const testVec = new Float32Array(
      buffer.buffer,
      buffer.byteOffset + testOffset,
      VECTOR_DIM
    )

    // Calculate L2 norm
    let norm = 0
    for (let i = 0; i < testVec.length; i++) {
      norm += testVec[i] * testVec[i]
    }
    norm = Math.sqrt(norm)

    console.log(`\n🧪 Test Vector L2 norm: ${norm.toFixed(6)} ${Math.abs(norm - 1.0) < 0.001 ? '✓' : '✗'}`)

    return true
  } catch (error) {
    console.error(`❌ Verification failed:`, error)
    return false
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log('=' .repeat(60))
  console.log('DNA Seed Binary Generator (TypeScript)')
  console.log('=' .repeat(60))

  // Load seed data
  console.log('\n📂 Loading seed data...')
  const seedData = await loadSeedData(SEED_FILES)

  if (seedData.length === 0) {
    console.warn('⚠ No seed data found, using random vectors')
    console.log('  To generate proper vectors, provide seed data files:')
    for (const f of SEED_FILES) {
      console.log(`    - ${f}`)
    }
  }

  // Calculate centroids
  console.log('\n📊 Calculating intent centroids...')
  const centroids = await calculateCentroids(seedData)

  // Generate binary file
  console.log('\n💾 Generating binary file...')
  await generateDNAFile(centroids, OUTPUT_PATH)

  // Verify
  console.log('\n🔍 Verifying...')
  await verifyDNAFile(OUTPUT_PATH)

  console.log('\n✅ Complete!')
}

main().catch(console.error)
