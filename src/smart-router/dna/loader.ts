/**
 * DNA Binary File Loader
 *
 * Binary format:
 * - Magic: 0x52544356 ("VCTR")
 * - Version: uint32
 * - Vector Dim: uint32
 * - Count: uint32
 * - Reserved: 8 bytes
 * - Metadata Offset: uint64
 * - Data Offset: uint64
 * - [Padding to metadataOffset]
 * - Metadata: JSON string
 * - Data: Float32Array vectors (count * vectorDim * 4 bytes)
 *
 * Priority:
 * 1. DNA file in user directory (~/.openclaw/smart-router/base_dna.bin)
 * 2. Copy seed file from package if loading fails
 */

import type { DNAIntent } from '../types/smart-router.types.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Copy seed file from package to user directory
 */
async function copySeedFileToUserDir(targetPath: string): Promise<boolean> {
  try {
    const targetDir = path.dirname(targetPath)

    // Fixed location in package: dist/smart-router/dna/base_dna.bin
    // From dist/smart-router/dna/loader.js to dist/smart-router/dna/base_dna.bin
    const packagePath = path.join(__dirname, 'base_dna.bin')

    try {
      await fs.access(packagePath)

      // Ensure target directory exists
      await fs.mkdir(targetDir, { recursive: true })

      // Copy file
      await fs.copyFile(packagePath, targetPath)

      console.log(`[DNA Loader] Successfully copied seed file: ${packagePath} -> ${targetPath}`)
      return true
    } catch {
      console.warn('[DNA Loader] Seed file not found:', packagePath)
      return false
    }
  } catch (error) {
    console.error('[DNA Loader] Failed to copy seed file:', error)
    return false
  }
}

/** DNA file header information */
interface DNAHeader {
  magic: number
  version: number
  vectorDim: number
  count: number
  metadataOffset: bigint
  dataOffset: bigint
}

/** DNA file metadata */
interface DNAMetadata {
  version: string
  generatedAt: number
  count: number
  vectorDim: number
  intents: Array<{
    name: string
    tier: 'flagship' | 'lightweight'
    description: string
    keywords: string[]
  }>
}

/** File magic number (little-endian read of "VCTR") */
const MAGIC = 0x52544356 // Value of "VCTR" bytes when read in little-endian

/**
 * Read DNA file header
 *
 * Note: Python script uses little-endian for uint32, but big-endian for uint64
 */
async function readHeader(filePath: string): Promise<DNAHeader> {
  const buffer = await fs.readFile(filePath)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const magic = view.getUint32(0, true) // little-endian
  if (magic !== MAGIC) {
    throw new Error(`Invalid DNA file: bad magic number 0x${magic.toString(16)}`)
  }

  const version = view.getUint32(4, true) // little-endian
  const vectorDim = view.getUint32(8, true) // little-endian
  const count = view.getUint32(12, true) // little-endian
  const metadataOffset = view.getBigUint64(24, false) // big-endian (Python uses big-endian for uint64)
  const dataOffset = view.getBigUint64(32, false) // big-endian

  return {
    magic,
    version,
    vectorDim,
    count,
    metadataOffset,
    dataOffset
  }
}

/**
 * Load DNA intents from binary file
 *
 * If file loading fails, attempt to copy seed file from package
 */
export async function loadDNAFromFile(filePath: string): Promise<DNAIntent[]> {
  try {
    // Check if file exists
    try {
      await fs.access(filePath)
    } catch {
      console.warn(`[DNA Loader] DNA file not found: ${filePath}`)

      // Try to copy seed file from package
      console.log(`[DNA Loader] Attempting to copy seed file from package...`)
      const copied = await copySeedFileToUserDir(filePath)
      if (copied) {
        console.log(`[DNA Loader] Seed file copied successfully`)
        // Reload
        return loadDNAFromFile(filePath)
      }

      console.error(`[DNA Loader] Failed to load DNA file and no backup available`)
      return []
    }

    // Read file header
    const header = await readHeader(filePath)
    console.log(`[DNA Loader] File header:`, {
      vectorDim: header.vectorDim,
      count: header.count,
      version: header.version
    })

    // Read metadata
    const fileBuffer = await fs.readFile(filePath)
    const metadataStart = Number(header.metadataOffset)
    const metadataEnd = fileBuffer.length // Metadata at end of file

    if (metadataStart >= metadataEnd) {
      throw new Error('Invalid metadata offset')
    }

    const metadataBytes = fileBuffer.subarray(metadataStart, metadataEnd)
    const metadataJson = new TextDecoder().decode(metadataBytes)
    const metadata: DNAMetadata = JSON.parse(metadataJson)

    console.log(`[DNA Loader] Loaded metadata: ${metadata.intents.length} intents`)

    // Read vector data
    const dataStart = Number(header.dataOffset)
    const vectorSize = header.vectorDim * 4 // float32 = 4 bytes
    const intents: DNAIntent[] = []

    for (let i = 0; i < Math.min(header.count, metadata.intents.length); i++) {
      const intentDef = metadata.intents[i]
      const vectorOffset = dataStart + (i * vectorSize)
      const vectorBytes = fileBuffer.subarray(vectorOffset, vectorOffset + vectorSize)
      const centroid = new Float32Array(
        vectorBytes.buffer,
        vectorBytes.byteOffset,
        header.vectorDim
      )

      intents.push({
        id: `dna-${i}`,
        name: intentDef.name,
        description: intentDef.description,
        preferredTier: intentDef.tier,
        centroid,
        confidence: 1.0,
        sampleCount: 10
      })
    }

    console.log(`[DNA Loader] Successfully loaded ${intents.length} DNA intents from file`)
    return intents
  } catch (error) {
    console.error(`[DNA Loader] Failed to load DNA file:`, error)
    return []
  }
}

/**
 * Find seed DNA file source location
 * Supports multiple deployment scenarios: dev environment, built, global install
 *
 * @returns Found seed file path, or null if not found
 */
async function findSeedDNAFile(): Promise<string | null> {
  // Current file directory
  const currentDir = path.dirname(fileURLToPath(import.meta.url))

  // Possible seed file locations (by priority)
  const possiblePaths = [
    // 1. Current directory (same as loader.ts) - dev src/smart-router/dna/
    path.join(currentDir, 'base_dna.bin'),

    // 2. Built dist directory - built dist/smart-router/dna/
    path.join(currentDir, '../../dist/smart-router/dna/base_dna.bin'),

    // 3. Project root relative path - dev fallback
    path.join(process.cwd(), 'src/smart-router/dna/base_dna.bin'),

    // 4. npm global install path - node_modules/openclaw/dist/smart-router/dna/
    path.join(__dirname, '../openclaw/dist/smart-router/dna/base_dna.bin'),

    // 5. Current project dist directory
    path.join(process.cwd(), 'dist/smart-router/dna/base_dna.bin'),
  ]

  for (const seedPath of possiblePaths) {
    try {
      await fs.access(seedPath)
      console.log(`[DNA Loader] Found seed file: ${seedPath}`)
      return seedPath
    } catch {
      // Try next path
      continue
    }
  }

  console.warn('[DNA Loader] Seed file not found, tried paths:', possiblePaths)
  return null
}

/**
 * Copy seed DNA file to target directory
 *
 * @param targetDir - Target directory (e.g. ~/.openclaw/smart-router)
 * @returns Whether copy was successful
 */
export async function copySeedDNA(targetDir: string): Promise<boolean> {
  try {
    // Find seed file
    const sourcePath = await findSeedDNAFile()
    if (!sourcePath) {
      console.warn('[DNA Loader] Unable to find seed file, skipping copy')
      return false
    }

    const targetPath = path.join(targetDir, 'base_dna.bin')

    // Check if target file already exists
    try {
      await fs.access(targetPath)
      console.log(`[DNA Loader] Seed file already exists: ${targetPath}, skipping copy`)
      return true
    } catch {
      // Target doesn't exist, continue with copy
    }

    // Ensure target directory exists
    await fs.mkdir(targetDir, { recursive: true })

    // Copy file
    await fs.copyFile(sourcePath, targetPath)

    console.log(`[DNA Loader] Successfully copied seed file: ${sourcePath} -> ${targetPath}`)
    return true
  } catch (error) {
    console.warn(`[DNA Loader] Failed to copy seed file:`, error)
    return false
  }
}

/**
 * Copy default user memory file to target directory
 *
 * @param targetDir - Target directory (e.g. ~/.openclaw/smart-router)
 * @returns Whether copy was successful
 */
export async function copyDefaultUserMemory(targetDir: string): Promise<boolean> {
  try {
    // Current file directory
    const currentDir = path.dirname(fileURLToPath(import.meta.url))

    // Possible default user memory file locations
    const possiblePaths = [
      // 1. Current directory - dev src/smart-router/dna/
      path.join(currentDir, 'default_user_memory.bin'),

      // 2. Built dist directory - dist/smart-router/dna/
      path.join(currentDir, '../../dist/smart-router/dna/default_user_memory.bin'),

      // 3. Project root - dev fallback
      path.join(process.cwd(), 'src/smart-router/dna/default_user_memory.bin'),

      // 4. Current project dist directory
      path.join(process.cwd(), 'dist/smart-router/dna/default_user_memory.bin'),
    ]

    let sourcePath: string | null = null
    for (const testPath of possiblePaths) {
      try {
        await fs.access(testPath)
        sourcePath = testPath
        console.log(`[DNA Loader] Found default user memory: ${testPath}`)
        break
      } catch {
        continue
      }
    }

    if (!sourcePath) {
      console.warn('[DNA Loader] Default user memory file not found, skipping copy')
      return false
    }

    const targetPath = path.join(targetDir, 'user_memory.bin')

    // Check if target file already exists
    try {
      await fs.access(targetPath)
      console.log(`[DNA Loader] User memory file already exists: ${targetPath}, skipping copy`)
      return true
    } catch {
      // Target doesn't exist, continue with copy
    }

    // Ensure target directory exists
    await fs.mkdir(targetDir, { recursive: true })

    // Copy file
    await fs.copyFile(sourcePath, targetPath)

    console.log(`[DNA Loader] Successfully copied default user memory: ${sourcePath} -> ${targetPath}`)
    return true
  } catch (error) {
    console.warn(`[DNA Loader] Failed to copy default user memory:`, error)
    return false
  }
}


/**
 * Try loading DNA from multiple paths
 */
export async function loadDNAFromPaths(paths: string[]): Promise<DNAIntent[]> {
  for (const filePath of paths) {
    try {
      const intents = await loadDNAFromFile(filePath)
      if (intents.length > 0) {
        console.log(`[DNA Loader] Loaded DNA from: ${filePath}`)
        return intents
      }
    } catch (error) {
      // Try next path
      continue
    }
  }

  console.warn('[DNA Loader] Failed to load DNA from any path')
  return []
}
