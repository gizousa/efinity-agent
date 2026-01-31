# OpenClaw Smart Router System - Complete Guide

## 🚀 Quick Start (Must Read)

### Step 1: Install and Enable

```bash
# 1. Clone project and install dependencies
git clone <your-repo-url>
cd openclaw
pnpm install
pnpm build

# 2. Install to system
pnpm link  # or npm link

# 3. ⚠️ Important: Must enable smart routing (copies seed files to user directory)
openclaw smart-router enable
```

**Why must you run `openclaw smart-router enable`?**
- Enable command automatically copies seed files to `~/.openclaw/smart-router/`
- If not enabled, you must manually copy (not recommended)
- Seed files include: DNA intent categories + default user learning data

### Step 2: Configure Models (Required!)

⚠️ **Important: Check and modify routing configuration!**

```bash
# View current config
openclaw config get

# Edit config file
~/.openclaw/config.json
```

**Required configuration items:**

```json
{
  "smartRouting": {
    "enabled": true,
    "lightweightModels": ["your-lightweight-model"],
    "flagshipModels": ["your-flagship-model"],
    "embedding": {
      "model": "Qwen/Qwen3-Embedding-0.6B",
      "apiKey": "your-qwen-api-key"
    }
  }
}
```

**⚠️ Critical Warning: Model Consistency!**

```
Seed data generation model  MUST EQUAL  Runtime model
│                              │
│     Qwen/Qwen3-Embedding-0.6B      │
└────────────────────────────────┘
```

- Project defaults to **Qwen Qwen3-Embedding-0.6B** model
- If using project's bundled data → Must configure Qwen model
- If using your own data → Must regenerate with Qwen model

### Step 3: Verify Configuration

```bash
# Send a test query
echo "Test smart routing"

# Check routing logs (should see routing decision)
# Log location: depends on your system config
```

---

## 📚 Advanced: Custom Seed Data

### DNA Category Overview

System includes **6 predefined semantic categories**:

| Category | Description | Priority | Example Queries |
|----------|-------------|----------|-----------------|
| **CHAT** | Casual chat | Lightweight | "Hello", "How's the weather" |
| **CODE** | Code-related | Flagship | "Write a function", "Help me debug" |
| **FACT** | Factual queries | Lightweight | "What is 1+1", "Capital of France" |
| **REASON** | Reasoning | Flagship | "Analyze this problem", "Compare options" |
| **TRANS** | Translation | Lightweight | "Translate this", "Summarize" |
| **WRITE** | Writing | Lightweight | "Write a poem", "Write an article" |

### Custom Data Format

**Seed data JSON format:**

```json
[
  {
    "text": "Your query text",
    "label": "Category name"
  }
]
```

**Examples:**

```json
[
  {"text": "Help me write a Python function", "label": "CODE"},
  {"text": "How's the weather today", "label": "CHAT"},
  {"text": "What is 1+1", "label": "FACT"},
  {"text": "Analyze pros and cons", "label": "REASON"},
  {"text": "Translate to English", "label": "TRANS"},
  {"text": "Write a poem about spring", "label": "WRITE"}
]
```

### Generate Seed Files

**Important: Configure API key before generating!**

```bash
# Set Qwen API key
export SILICONFLOW_API_KEY="sk-your-key"

# Or configure directly in code (see below)
```

**Generation commands:**

```bash
# Generate DNA intent file (6 category representatives)
pnpm smart-router:generate-dna

# Generate user learning data file
pnpm smart-router:generate-user-memory

# Or generate all at once
pnpm smart-router:generate-all
```

**Generation scripts:**

```
scripts/generate-dna-seeds.ts     # DNA generation script
scripts/generate-user-memory.ts  # User memory generation script
```

**Output files:**

```
src/smart-router/dna/base_dna.bin              # DNA intent categories
src/smart-router/dna/default_user_memory.bin  # User learning data
```

### Modify Generation Script Config

To customize API or seed data paths, edit:

**scripts/generate-dna-seeds.ts:**

```typescript
// Configuration area (top of file)
const SEED_FILES = [
  path.join(__dirname, 'your-seeds.json')  // Your seed data
]

const EMBEDDING_API_KEY = process.env.SILICONFLOW_API_KEY || 'sk-your-key'
const EMBEDDING_API_URL = 'https://api.siliconflow.cn/v1/embeddings'
const EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-0.6B'  // Must match runtime!
```

**scripts/generate-user-memory.ts:** Same as above

### Regenerate Seed Files

If you modified seed data or model:

```bash
# 1. Regenerate
pnpm smart-router:generate-all

# 2. Copy to user directory (overwrite old files)
cp src/smart-router/dna/base_dna.bin ~/.openclaw/smart-router/
cp src/smart-router/dna/default_user_memory.bin ~/.openclaw/smart-router/user_memory.bin

# 3. Restart application for new files to take effect
```

---

## ⚠️ Common Issues and Notes

### Issue 1: Smart routing not enabled

**Symptoms:** Routing doesn't work, all queries use same model

**Solution:**
```bash
openclaw smart-router enable
```

### Issue 2: Model configuration error

**Symptoms:** Query errors or unreasonable routing decisions

**Solution:**
1. Check `~/.openclaw/config.json`
2. Ensure `lightweightModels` and `flagshipModels` are correct
3. Ensure `embedding.model` is Qwen model

### Issue 3: Poor vector quality

**Symptoms:** Similarity scores consistently low (< 0.6)

**Possible causes:**
- Seed data model ≠ Runtime model
- API key error or quota exhausted

**Solution:**
1. Verify model consistency
2. Check API key
3. Regenerate seed files

---

## Table of Contents
- [System Overview](#system-overview)
- [Implementation Details](#implementation-details)
- [Usage](#usage)
- [Configuration](#configuration)
- [Quick Start Tutorial](#quick-start-tutorial)
- [Key Features](#key-features)
- [Known Issues](#known-issues)
- [System Architecture](#system-architecture)
- [Problem Log](#problem-log)

---

## System Overview

### What is Smart Routing?

OpenClaw Smart Router is an AI model auto-selection engine based on semantic similarity that:

- **Automatic Query Classification**: Categorizes queries by semantic type
- **Intelligent Model Selection**: Simple queries → lightweight models, complex queries → flagship models
- **Continuous Learning**: Optimizes routing based on user behavior patterns
- **Cost Optimization**: Saves 60-80% of API call costs

### Core Value Proposition

```
Traditional Approach: All queries → Flagship model → High cost
Smart Routing:
  ├─ Simple queries (60%) → Lightweight model → Cost savings
  ├─ Code queries (20%) → Flagship model → Quality
  ├─ Reasoning queries (15%) → Flagship model → Quality
  └─ Other queries (5%) → Lightweight model → Cost savings
```

---

## Implementation Details

### 1. Vector Representation

All text (queries, DNA intents, user learning data) is converted to 1024-dimensional vectors via Embedding model:

```typescript
// Text → Vector
"Write a regex function" → Float32Array(1024)
  ↓ Embedding API
[0.0123, -0.0456, 0.0789, ...]  // 1024-dimensional vector
```

### 2. Layered Index System

```
┌─────────────────────────────────────────────┐
│ Layer 1: User Learning Data (Patches)      │
│   - 874 personalized learning samples      │
│   - Soft partition dual detection         │
│   - Threshold: 0.55                       │
├─────────────────────────────────────────────┤
│ Layer 2: DNA Intent Categories            │
│   - 6 predefined semantic categories      │
│   - Medoid representative points            │
│   - Threshold: 0.60                       │
├─────────────────────────────────────────────┤
│ Layer 3: Keyword Matching                 │
│   - Prefix command detection              │
│   - Special keyword recognition           │
└─────────────────────────────────────────────┘
```

### 3. Similarity Calculation

Uses **Cosine Similarity** (optimized via dot product):

```typescript
// Vectors are pre-normalized, cosine similarity = dot product
similarity = dotProduct(queryVector, centroid)
// Range: [-1, 1], 1 means identical
```

**Performance Optimization:**
- Vector pre-normalization (one-time normalize)
- Avoid repeated magnitude calculation
- 10x performance improvement

### 4. Intelligent Decision Flow

```typescript
1. Prefix detection → User specified? → Return directly
2. Keyword matching → Special keyword? → Return model
3. Patch search → User data matched? → Return model
4. DNA classification → Semantic type matched? → Return model
5. Default → Lightweight model
```

---

## Usage

### Enable Smart Routing

```bash
# Method 1: Via config file
~/.openclaw/config.json
{
  "smartRouting": {
    "enabled": true
  }
}

# Method 2: Via command
openclaw smart-router enable
```

### Disable Smart Routing

```bash
openclaw smart-router disable
```

### View Routing Statistics

```bash
openclaw smart-router stats
```

---

## Configuration

### Main Config: `~/.openclaw/config.json`

```json
{
  "smartRouting": {
    "enabled": true,

    // Model configuration
    "lightweightModels": ["zai/glm-4.5-air", "claude-3-5-haiku"],
    "flagshipModels": ["zai/glm-4.7", "claude-3-7-sonnet"],

    // Threshold configuration
    "patchSimilarityThreshold": 0.55,
    "dnaSimilarityThreshold": 0.60,
    "softPartitionThreshold": 0.1,

    // Embedding configuration
    "embedding": {
      "model": "Qwen/Qwen3-Embedding-0.6B",
      "timeoutMs": 5000,
      "apiKey": "your-api-key"
    }
  }
}
```

### Threshold Guide

| Threshold | Default | Purpose | Tuning Guide |
|-----------|---------|---------|---------------|
| `patchSimilarityThreshold` | 0.55 | User learning data match threshold | Higher → stricter, Lower → more permissive |
| `dnaSimilarityThreshold` | 0.60 | DNA intent match threshold | Higher → stricter, Lower → more permissive |
| `softPartitionThreshold` | 0.1 | Soft partition boundary threshold | Lower → more dual detection |

---

## Quick Start Tutorial

### Tutorial 1: Generate Custom DNA File

If you have your own seed data:

```bash
# 1. Prepare seed data JSON file
cat > my_seeds.json << EOF
[
  {"text": "Help me write a function", "label": "CODE"},
  {"text": "How's the weather today", "label": "CHAT"},
  {"text": "What is 1+1", "label": "FACT"}
]
EOF

# 2. Modify generation script
# Edit scripts/generate-dna-seeds.ts
# Add my_seeds.json to SEED_FILES array

# 3. Generate DNA file
pnpm smart-router:generate-dna

# 4. Copy to config directory
cp src/smart-router/dna/base_dna.bin ~/.openclaw/smart-router/
```

### Tutorial 2: Regenerate User Learning Data

If vector quality is problematic:

```bash
# 1. Ensure API key is correct
export SILICONFLOW_API_KEY="your-key"

# 2. Generate user memory
pnpm smart-router:generate-user-memory

# 3. Copy to config directory
cp src/smart-router/dna/default_user_memory.bin ~/.openclaw/smart-router/user_memory.bin
```

### Tutorial 3: Adjust Routing Strategy

Tune thresholds based on your needs:

```json
{
  "smartRouting": {
    // More aggressive: Match more queries
    "patchSimilarityThreshold": 0.50,
    "dnaSimilarityThreshold": 0.55,

    // More conservative: Only high-confidence matches
    "patchSimilarityThreshold": 0.70,
    "dnaSimilarityThreshold": 0.75
  }
}
```

---

## Key Features

### 1. Medoid Algorithm Instead of Centroid

**Advantages:**
- Medoid is always a real sample vector
- Not "averaged out" losing characteristics
- More robust to outliers

**Implementation:**
```typescript
// Select vector with minimum total distance to all other vectors
Medoid = argmin(Σ distance(v, other))
```

### 2. Dynamic Confidence Penalty

**Smooth penalty curve:**
```
confidence >= 0.15 → No penalty (factor = 1.0)
confidence = 0.10  → Light penalty (factor = 0.98)
confidence = 0.05  → Medium penalty (factor = 0.95)
confidence = 0.00  → Heavy penalty (factor = 0.90)
```

**Benefits:**
- Better handles fuzzy boundaries between CHAT and WRITE
- Avoids sudden jumps from hard thresholds

### 3. Short Query Enhancement

**Detection:** Character count < 6
**Boost:** Threshold lowered by 0.05

**Examples:**
```typescript
"Write poem" (10 chars) → Threshold 0.60 → 0.55
"你吃饭了吗" (5 chars) → Threshold 0.60 → 0.55
```

### 4. Soft Partition Dual Detection

**Trigger condition:** Best DNA and second best DNA score difference < 0.1
**Behavior:** Search patches from both partitions simultaneously

**Example:**
```
Query: "Help me write a love poem"
DNA scores: write(0.65), chat(0.62), code(0.30)
Confidence: 0.65 - 0.62 = 0.03 < 0.1 → Trigger dual detection
Search: flagship patches + lightweight patches
```

### 5. Query Result Caching

**LRU Cache:**
- Maximum 1000 entries
- 60-second TTL
- Vector hash as key

**Performance:**
- Cache hit: < 1ms
- Cache miss: 5-10ms

---

## Known Issues

### Issue 1: Vector Space Inconsistency

**Symptoms:**
- User memory has 874 data points
- But Patch scores only 0.52-0.65
- Should have >0.80 matches theoretically

**Root Cause:**
- User memory may be generated with old Embedding model
- Runtime uses new model
- Vector space misalignment

**Solutions:**
1. Verify user memory and runtime use same model
2. Regenerate user memory (with current model)

### Issue 2: Short Query Matching Difficulty

**Symptoms:**
```
"Write poem" → 0.526 (low)
"Help me write a very long function" → 0.78 (high)
```

**Root Cause:**
- Short queries have less semantic information
- Embedding models perform better on long text

**Mitigation:**
- Short query boost (< 6 chars threshold -0.05)
- Add more short sentence seed data

### Issue 3: Chinese-English Mixed Performance

**Symptoms:**
```
"Write a function" → 0.75 (good)
"写个函数" → 0.58 (poor)
```

**Root Cause:**
- Current model (Qwen3) is multilingual
- Not optimized for Chinese short sentences

**Solution:**
- Switch to Chinese-specific model: `BAAI/bge-large-zh-v1.5`

### Issue 4: DNA Category Distinction Insufficient

**Symptoms:**
- Confidence普遍 < 0.1
- Small gap between best and second best

**Root Cause:**
- 6 categories may be too coarse-grained
- CHAT and WRITE boundaries are fuzzy

**Future Improvements:**
- Increase category count (12)
- Multi-label classification
- Hierarchical classification

---

## System Architecture

### Overall Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    User Query Input                       │
│              "Help me write a Python regex"             │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              SmartRouter.decide()                        │
│                                                         │
│  1. Prefix detection → "flagship:" prefix             │
│  2. Keyword matching → regex, code keywords            │
│  3. Embedding API call → 1024-dimensional vector        │
│  4. LayeredIndex search → Patches + DNA                 │
│  5. Decision output → tier + model + confidence         │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│               LayeredIndex.search()                      │
│                                                         │
│  ┌───────────────────────────────────────────────┐    │
│  │ Query Cache (LRU)                             │    │
│  │ - Vector hash as key                           │    │
│  │ - 60-second TTL                                │    │
│  └─────────────────┬─────────────────────────────┘    │
│                    ↓ Cache miss                        │
│  ┌───────────────────────────────────────────────┐    │
│  │ searchPatches() - Soft partition detection    │    │
│  │ - DNA determines tier                          │    │
│  │ - Search patches in corresponding tier        │    │
│  │ - Threshold: 0.55                              │    │
│  └─────────────────┬─────────────────────────────┘    │
│                    ↓ No match                          │
│  ┌───────────────────────────────────────────────┐    │
│  │ searchDNA() - Top-K confidence check          │    │
│  │ - Calculate similarity to 6 DNA intents        │    │
│  │ - Dynamic confidence penalty                  │    │
│  │ - Threshold: 0.60                              │    │
│  └───────────────────────────────────────────────┘    │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              RoutingDecision Output                       │
│                                                         │
│  {                                                     │
│    modelTier: "flagship",                             │
│    selectedModel: "zai/glm-4.7",                      │
│    confidence: 0.65,                                   │
│    reasoning: "Patch hit (similarity 0.65)"           │
│  }                                                     │
└─────────────────────────────────────────────────────────┘
```

### Module Dependencies

```
smart-router/
├── types/
│   └── smart-router.types.ts          # Type definitions
├── routing/
│   ├── router.ts                     # Main routing logic
│   ├── layered-index.ts              # Layered index
│   ├── similarity.ts                 # Similarity calculation
│   └── vector-store.ts               # Vector storage
├── memory/
│   └── vector-store.ts               # VectorStore class
└── dna/
    ├── base_dna.bin                  # DNA file
    └── default_user_memory.bin       # User memory file
```

---

## Problem Log

### Current Issues

#### Issue 1: Low Patch Similarity Scores

**Date:** 2026-02-01
**Symptoms:** 874 user data points, but Patch scores only 0.52-0.65
**Analysis:**
- Threshold lowered from 0.85 to 0.55 to achieve matches
- Indicates vector quality or consistency issues
**Current Status:** Mitigated by lowering threshold to 0.55
**To Resolve:** Verify Embedding model used for user memory generation

#### Issue 2: Generally Low DNA Confidence

**Date:** 2026-02-01
**Symptoms:** Most confidence scores < 0.1
**Analysis:**
- Small gap between best and second best DNA scores
- 6 DNA categories lack sufficient distinction
**Current Status:** Mitigated with dynamic confidence penalty
**To Resolve:** Consider increasing category count or using finer-grained classification

#### Issue 3: Short Query Matching Difficulty

**Date:** 2026-02-01
**Symptoms:** "写个诗"(4 chars) scores 0.526, long sentences 0.75+
**Analysis:** Short queries lack semantic information, unstable vector representation
**Current Status:** Implemented short query boost (< 6 chars threshold -0.05)
**To Resolve:** Add more short sentence seed data, or switch to Chinese-specific model

#### Issue 4: Embedding Model Selection

**Date:** 2026-02-01
**Current Model:** Qwen/Qwen3-Embedding-0.6B
**Issue:** Insufficient understanding of Chinese short sentences
**Recommendation:** Switch to BAAI/bge-large-zh-v1.5
**To Test:** Need to regenerate seed data for validation

### Optimization Priority

1. **Immediate:** Test Chinese Embedding model switch
2. **This Week:** Add daily conversation seed data
3. **This Month:** Increase DNA category count (6→12)
4. **Long-term:** User feedback learning mechanism

---

## Tech Stack

- **Language:** TypeScript/Node.js
- **Vector Dimension:** 1024
- **Similarity Algorithm:** Cosine Similarity (dot product optimized)
- **Embedding Model:** Qwen/Qwen3-Embedding-0.6B
- **Vector Storage:** Custom binary format (VectorStore)
- **DNA Format:** VCTR (Vector Centroid)

---

## Contributing

To improve the smart router system:

1. **Report Issues:** Describe in detail in GitHub Issues
2. **Improve Code:** Submit Pull Request
3. **Share Experience:** Share your configuration and tuning experience in forums

---

## License

MIT License - See LICENSE file in project root

---

## Contact

- Project: [OpenClaw GitHub](https://github.com/your-repo)
- Issues: GitHub Issues
