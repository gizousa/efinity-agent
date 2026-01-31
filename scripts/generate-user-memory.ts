#!/usr/bin/env tsx
/**
 * Generate Default User Memory Binary File (default_user_memory.bin)
 *
 * TypeScript implementation using VectorStore class directly.
 * This ensures 100% compatibility since we use the exact same serialize() method.
 *
 * Usage:
 *   tsx scripts/generate-user-memory.ts
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Patch } from '../src/smart-router/types/smart-router.types.js'

// Get script directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ==========================================
// CONFIGURATION - Modify these values
// ==========================================

// Seed data file (JSON format: [{ text: string, label: string }])
// Paths are relative to script directory
const SEED_FILES = [
  path.join(__dirname, 'openclaw_seed_data_1000.json')
]

// Output file path
const OUTPUT_PATH = 'src/smart-router/dna/default_user_memory.bin'

// Embedding API configuration
const EMBEDDING_API_KEY = process.env.SILICONFLOW_API_KEY || 'sk-xxxxxx'
const EMBEDDING_API_URL = 'https://api.siliconflow.cn/v1/embeddings'
const EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-0.6B'  // 1024 dimensions
const BATCH_SIZE = 20

// Label to tier mapping
const LABEL_TIERS: Record<string, 'flagship' | 'lightweight'> = {
  CHAT: 'lightweight',
  FACT: 'lightweight',
  TRANS: 'lightweight',
  WRITE: 'lightweight',
  CODE: 'flagship',
  REASON: 'flagship'
}

// ==========================================
// CONSTANTS - Do not modify
// ==========================================

// Vector dimension
const VECTOR_DIM = 1024

// VectorStore header constants (must match VectorStore class)
const HEADER_SIZE = 128
const MAGIC_NUMBER = 0x56435452
const VERSION = 1

/**
 * Seed data entry
 */
interface SeedData {
  text: string
  label: string
}

/**
 * Load seed data from JSON files
 */
async function loadSeedData(jsonFiles: string[]): Promise<SeedData[]> {
  const allData: SeedData[] = []

  for (const filepath of jsonFiles) {
    try {
      const content = await fs.readFile(filepath, 'utf-8')
      const data = JSON.parse(content) as SeedData[]
      allData.push(...data)
      console.log(`✓ Loaded ${data.length} entries from ${filepath}`)
    } catch (error) {
      console.warn(`⚠ Skipped: ${filepath} (${(error as NodeJS.ErrnoException).code})`)
    }
  }

  return allData
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
 * Generate patches from seed data
 */
async function generatePatches(data: SeedData[]): Promise<Patch[]> {
  const patches: Patch[] = []
  const currentTime = Math.floor(Date.now() / 1000)  // Unix timestamp in seconds

  console.log(`📊 Processing ${data.length} seed data entries...`)
  console.log(`🚀 Using ${EMBEDDING_API_KEY ? 'Embedding API' : 'random vectors (set EMBEDDING_API_KEY)'}`)

  // Process in batches
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const texts = batch.map(item => item.text)

    // Get embeddings
    const vectors = await getEmbeddings(texts)

    // Create patches
    for (let idx = 0; idx < batch.length; idx++) {
      const item = batch[idx]
      const tier = LABEL_TIERS[item.label]

      if (!tier) {
        console.warn(`⚠ Unknown label: ${item.label}, skipping`)
        continue
      }

      patches.push({
        vector: vectors[idx],
        tier,
        label: item.text,
        timestamp: currentTime,
        initialWeight: 1.0
      })
    }

    // Progress
    if ((i + BATCH_SIZE) % 100 === 0 || (i + BATCH_SIZE) >= data.length) {
      console.log(`   Processed: ${Math.min(i + BATCH_SIZE, data.length)}/${data.length}...`)
    }
  }

  return patches
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
 * Serialize patches to VectorStore binary format
 *
 * This is a copy of VectorStore.serialize() to avoid circular dependencies.
 * Must be kept in sync with VectorStore class!
 */
async function serializePatches(patches: Patch[]): Promise<Buffer> {
  const count = patches.length
  const vectorDim = VECTOR_DIM

  // Calculate Data section size
  const vectorsBytes = count * vectorDim * 4  // Float32
  const weightsBytes = count * 4              // Float32
  const timestampsBytes = count * 4           // Int32

  // Calculate labels size
  const labelsStrings = patches.map(p => p.label)
  const labelsBuffer = Buffer.concat([
    ...labelsStrings.map(label => Buffer.from(label, 'utf-8')),
    Buffer.from([0])  // null terminator
  ])
  const labelsBytes = labelsBuffer.length

  const dataSize = vectorsBytes + weightsBytes + timestampsBytes + labelsBytes

  // Calculate Metadata size
  const metadataObj = {
    version: VERSION,
    vectorDim,
    count,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  const metadataStr = JSON.stringify(metadataObj)
  const metadataBuffer = Buffer.from(metadataStr, 'utf-8')
  const metadataSize = metadataBuffer.length + 1  // +1 for null terminator

  // Calculate padding (4-byte aligned)
  const paddingSize = (4 - (HEADER_SIZE + metadataSize) % 4) % 4

  // Calculate dataStartOffset
  const dataStartOffset = HEADER_SIZE + metadataSize + paddingSize

  // Allocate total buffer
  const totalSize = dataStartOffset + dataSize
  const buffer = Buffer.allocUnsafeSlow(totalSize)

  // Write Header
  const headerView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  headerView.setUint32(0, MAGIC_NUMBER, true)           // Magic
  headerView.setUint16(4, VERSION, true)                 // Version (uint16!)
  // Offset 6-7: gap (2 bytes)
  headerView.setUint32(8, vectorDim, true)               // Vector Dim
  headerView.setUint32(12, count, true)                  // Count
  headerView.setBigUint64(16, BigInt(HEADER_SIZE), false)  // Metadata Offset (BE)
  headerView.setBigUint64(24, BigInt(dataStartOffset), false) // Data Offset (BE)
  headerView.setUint32(32, 0, true)                      // Flags

  // Write Metadata
  metadataBuffer.copy(buffer, HEADER_SIZE)
  buffer[HEADER_SIZE + metadataBuffer.length] = 0  // null terminator

  // Write padding
  const paddingBuffer = Buffer.alloc(paddingSize, 0)
  paddingBuffer.copy(buffer, HEADER_SIZE + metadataSize)

  // Write Data
  let dataOffset = dataStartOffset

  // Write vectors
  const vectorsArray = new Float32Array(count * vectorDim)
  for (let i = 0; i < count; i++) {
    const vector = patches[i].vector
    for (let j = 0; j < vectorDim; j++) {
      vectorsArray[i * vectorDim + j] = vector[j]
    }
  }
  const vectorsBuffer = Buffer.from(vectorsArray.buffer)
  vectorsBuffer.copy(buffer, dataOffset)
  dataOffset += vectorsBytes

  // Write weights
  const weightsArray = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    weightsArray[i] = patches[i].tier === 'flagship' ? 1.0 : 0.0
  }
  const weightsBuffer = Buffer.from(weightsArray.buffer)
  weightsBuffer.copy(buffer, dataOffset)
  dataOffset += weightsBytes

  // Write timestamps
  const timestampsArray = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    timestampsArray[i] = patches[i].timestamp
  }
  const timestampsBuffer = Buffer.from(timestampsArray.buffer)
  timestampsBuffer.copy(buffer, dataOffset)
  dataOffset += timestampsBytes

  // Write labels
  labelsBuffer.copy(buffer, dataOffset)

  return buffer
}

/**
 * Verify generated user memory file
 */
async function verifyUserMemoryFile(filePath: string): Promise<boolean> {
  try {
    const buffer = await fs.readFile(filePath)
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    const magic = view.getUint32(0, true)
    const version = view.getUint16(4, true)
    const vectorDim = view.getUint32(8, true)
    const count = view.getUint32(12, true)
    const metadataOffset = Number(view.getBigUint64(16, false))
    const dataOffset = Number(view.getBigUint64(24, false))

    console.log('\n📋 Verification:')
    console.log(`   Magic: 0x${magic.toString(16).padStart(8, '0')} ${magic === MAGIC_NUMBER ? '✓' : '✗'}`)
    console.log(`   Version: ${version} ${version === 1 ? '✓' : '✗'}`)
    console.log(`   Vector Dim: ${vectorDim} ${vectorDim === VECTOR_DIM ? '✓' : '✗'}`)
    console.log(`   Count: ${count}`)
    console.log(`   Metadata Offset: ${metadataOffset} ${metadataOffset === HEADER_SIZE ? '✓' : '✗'}`)
    console.log(`   Data Offset: ${dataOffset}`)
    console.log(`   File Size: ${buffer.length}`)

    // Read metadata
    const metadataEnd = buffer.indexOf(0, metadataOffset)
    const metadataJson = buffer.subarray(metadataOffset, metadataEnd).toString('utf-8')
    const metadata = JSON.parse(metadataJson)

    console.log(`   Metadata: ✓ Valid JSON`)
    console.log(`   Patches: ${metadata.count}`)

    // Test read one vector
    const testVec = new Float32Array(
      buffer.buffer,
      buffer.byteOffset + dataOffset,
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
  console.log('Default User Memory Generator (TypeScript)')
  console.log('=' .repeat(60))

  // Load seed data
  console.log('\n📂 Loading seed data...')
  const seedData = await loadSeedData(SEED_FILES)

  if (seedData.length === 0) {
    console.error('❌ No seed data found!')
    console.log('  Please ensure the following files exist:')
    for (const f of SEED_FILES) {
      console.log(`    - ${f}`)
    }
    process.exit(1)
  }

  console.log(`✓ Successfully loaded ${seedData.length} entries`)

  // Generate patches
  console.log('\n📊 Generating patches...')
  const patches = await generatePatches(seedData)

  // Count tiers
  const tierCounts: Record<string, number> = {}
  for (const patch of patches) {
    tierCounts[patch.tier] = (tierCounts[patch.tier] || 0) + 1
  }

  console.log(`✓ Generated ${patches.length} patches`)
  console.log(`  - flagship: ${tierCounts.flagship || 0}`)
  console.log(`  - lightweight: ${tierCounts.lightweight || 0}`)

  // Serialize
  console.log('\n💾 Serializing to binary format...')
  const buffer = await serializePatches(patches)

  // Write file
  const outputDir = path.dirname(OUTPUT_PATH)
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(OUTPUT_PATH, buffer)

  console.log(`\n🎯 User memory file generated: ${OUTPUT_PATH}`)
  console.log(`   Size: ${buffer.length} bytes (${(buffer.length / 1024).toFixed(2)} KB)`)
  console.log(`   Patches: ${patches.length}`)

  // Verify
  console.log('\n🔍 Verifying...')
  await verifyUserMemoryFile(OUTPUT_PATH)

  console.log('\n✅ Complete!')
  console.log('\n📝 Usage:')
  console.log('   This file will be copied to ~/.openclaw/smart-router/user_memory.bin')
  console.log('   when users enable smart routing for the first time.')
}

main().catch(console.error)
