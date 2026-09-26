/**
 * kv.js — chain/token configuration with persistent caching
 * Drop-in replacement for config.js
 * Features:
 * - IndexedDB for persistent browser cache (survives reload)
 * - Cloudflare KV for distributed edge caching
 * - Non-blocking concurrent request queue
 * - Immediate fallback to local generation
 * - No browser freeze on multiple imports
 */

const API_KEY_TOKEN = '{API_KEY}';

const ALCHEMY_SLUGS = {
    ethereum: 'eth-mainnet', bnb: 'bnb-mainnet', polygon: 'polygon-mainnet',
    arbitrum: 'arb-mainnet', optimism: 'opt-mainnet',
    base: 'base-mainnet', avalanche: 'avax-mainnet',
    gnosis: 'gnosis-mainnet'
};

function resolveRpcUrl(url) {
    if (typeof url !== 'string' || !url.includes(API_KEY_TOKEN)) return url;
    const key = (CONSTANTS.NETWORK_API_KEY || '').trim();
    if (!key) return null;
    return url.replace(API_KEY_TOKEN, key);
}

function infuraRpcs(chainKey) {
    const net = INFURA_NETWORKS[chainKey];
    const key = (CONSTANTS.INFURA_KEY || '').trim();
    if (!net || !key) return [];
    return [`https://${net}.infura.io/v3/${key}`];
}

function chainRpcs(chainObj) {
    const out = [];
    for (const url of chainObj.rpc || []) {
        const resolved = resolveRpcUrl(url);
        if (resolved) out.push(resolved);
    }
    return out;
}

function alchemyRpcs(chainKey) {
    const slug = ALCHEMY_SLUGS[chainKey];
    const key = (CONSTANTS.ALCHEMY_KEY || '').trim();
    if (!slug || !key) return [];
    return [`https://${slug}.g.alchemy.com/v2/${key}`];
}

const CHAINS = {
    ethereum: { kind: 'evm', chainId: 1, rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://rpc.flashbots.net'], alchemy: true, symbol: 'ETH', name: 'Ethereum', path: "m/44'/60'/0'/0/", color: '#627eea' },
    bnb:      { kind: 'evm', chainId: 56, rpc: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.defibit.io', 'https://bsc.publicnode.com'], alchemy: true, symbol: 'BNB', name: 'BNB Chain', path: "m/44'/60'/0'/0/", color: '#f3ba2f' },
    polygon:  { kind: 'evm', chainId: 137, rpc: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'], alchemy: true, symbol: 'POL', name: 'Polygon', path: "m/44'/60'/0'/0/", color: '#8247e5' },
    arbitrum: { kind: 'evm', chainId: 42161, rpc: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc', 'https://arb.drpc.org'], alchemy: true, symbol: 'ETH', name: 'Arbitrum', path: "m/44'/60'/0'/0/", color: '#28a0f0' },
    optimism: { kind: 'evm', chainId: 10, rpc: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io', 'https://op-pokt.nodies.app', 'https://optimism.drpc.org'], alchemy: true, symbol: 'ETH', name: 'Optimism', path: "m/44'/60'/0'/0/", color: '#ff0420' },
    base:     { kind: 'evm', chainId: 8453, rpc: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'], alchemy: true, symbol: 'ETH', name: 'Base', path: "m/44'/60'/0'/0/", color: '#0052ff' },
    avalanche:{ kind: 'evm', chainId: 43114, rpc: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc', 'https://avalanche.drpc.org'], alchemy: true, symbol: 'AVAX', name: 'Avalanche', path: "m/44'/60'/0'/0/", color: '#e84142' },
    solana:   { kind: 'solana', rpc: ['https://solana-rpc.publicnode.com'], symbol: 'SOL', name: 'Solana', path: "m/44'/501'/0'/0'/0", color: '#14f195', tokenSymbol: 'SOL', usdPrice: 150, explorerApi: 'https://api.solscan.io' },
    tron:     { kind: 'tron', rpc: ['https://api.trongrid.io', 'https://tron-rpc.publicnode.com', 'https://api.tronstack.io'], symbol: 'TRX', name: 'Tron', path: "m/44'/195'/0'/0/0", color: '#ff060a', explorerApi: 'https://apilist.tronscan.org/api' }
};

const TOKENS = {
    ethereum: { usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
    bnb:      { usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580e', usdt: '0x55d398326f99059fF775485246999027B3197955', weth: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' },
    polygon:  { usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' },
    arbitrum: { usdc: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
    optimism: { usdc: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', weth: '0x4200000000000000000000000000000000000006' },
    base:     { usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', usdt: '0xfde4C96c8593536E31F229EA1f3721D5b3800000', weth: '0x4200000000000000000000000000000000000006' },
    avalanche:{ usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', usdt: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', weth: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB' },
    tron:     { usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
};

const TRC20_ABI = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
    { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
    { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }
];

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function transfer(address to, uint256 amount) returns (bool)"
];

const TOKEN_PRICES = {
    usdc: 1.0, usdt: 1.0, weth: 2000
};

const TOKEN_NAMES = {
    usdc: 'USD Coin', usdt: 'Tether USD', weth: 'Wrapped Ether'
};

const CONSTANTS = {
    DERIVATION_COUNT: 3,
    NATIVE_GAS_LIMIT: 21000n,
    TRON_SUN_PER_TRX: 1e6,
    SCAN_CONCURRENCY: 3, // Reduced to prevent freeze
    VAULT_STORAGE_KEY: 'omni_vault',
    THEME_STORAGE_KEY: 'omni_theme',
    DEFAULT_CURRENCY: 'usd',
    PRICE_CACHE_DURATION: 10000,
    MAX_RPC_RETRIES: 5,
    RPC_TIMEOUT: 3000, // Reduced to 3s for faster fallback
    NETWORK_API_KEY: '',
    ALCHEMY_KEY: 'KedNAmevgHvaNnMRCnWDq',
    INFURA_KEY: 'f67ee0c6843b441787ed722460b29b7c',
    TRONGRID_KEY: '825d994a-594b-4439-9118-9948ccdb273c',
    CORS_PROXY: '',
    USE_PROXY: false,
    DUST_USD: 0.01,
    KV_WORKER_URL: '', // Set to your worker URL or leave empty
    KV_CACHE_TTL: 86400, // 24 hours in IndexedDB
    KV_TIMEOUT: 2000 // 2 seconds - fail fast to local fallback
};

const INFURA_NETWORKS = {
    ethereum: 'mainnet', bnb: 'bsc', polygon: 'polygon',
    arbitrum: 'arbitrum', optimism: 'optimism',
    base: 'base', avalanche: 'avalanche'
};

const CURRENCY_SYMBOLS = {
    usd: '$', eur: '€', gbp: '£', jpy: '¥', btc: '₿', eth: 'Ξ'
};

/**
 * IndexedDB Manager - Persistent browser cache
 */
class IndexedDBCache {
    constructor(dbName = 'omni_wall', storeName = 'rpc_cache') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
        this.ready = this._initDb();
    }

    async _initDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            
            request.onerror = () => {
                console.warn('IndexedDB failed, using memory cache');
                resolve(null);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'key' });
                }
            };
        });
    }

    async get(key) {
        await this.ready;
        if (!this.db) return null;

        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                // Check if expired
                if (result && result.expiry > Date.now()) {
                    resolve(result.value);
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => resolve(null);
        });
    }

    async set(key, value, ttl = CONSTANTS.KV_CACHE_TTL) {
        await this.ready;
        if (!this.db) return;

        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            store.put({
                key,
                value,
                expiry: Date.now() + (ttl * 1000)
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
        });
    }

    async clear() {
        await this.ready;
        if (!this.db) return;

        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            store.clear();
            transaction.oncomplete = () => resolve();
        });
    }
}

/**
 * Concurrent Request Queue - Prevents browser freeze
 * Limits parallel requests to SCAN_CONCURRENCY
 */
class RequestQueue {
    constructor(concurrency = CONSTANTS.SCAN_CONCURRENCY) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
    }

    async run(fn) {
        // If not at concurrency limit, run immediately
        if (this.running < this.concurrency) {
            this.running++;
            try {
                return await fn();
            } finally {
                this.running--;
                this._processQueue();
            }
        }

        // Otherwise, queue it
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                this.running++;
                try {
                    resolve(await fn());
                } catch (err) {
                    reject(err);
                } finally {
                    this.running--;
                    this._processQueue();
                }
            });
        });
    }

    _processQueue() {
        if (this.queue.length > 0 && this.running < this.concurrency) {
            const fn = this.queue.shift();
            fn().catch(err => console.error('Queue error:', err));
        }
    }
}

/**
 * Cache Manager - Coordinates L1 (IndexedDB) + L2 (KV) + L3 (Local generation)
 */
class CacheManager {
    constructor() {
        this.indexedDb = new IndexedDBCache();
        this.memoryCache = new Map(); // L0: Fast memory lookup
        this.queue = new RequestQueue(CONSTANTS.SCAN_CONCURRENCY);
        this.workerUrl = CONSTANTS.KV_WORKER_URL;
    }

    /**
     * Get RPC URLs with 3-tier caching (non-blocking)
     * L0 (Memory) -> L1 (IndexedDB) -> L2 (KV) -> L3 (Local generation)
     */
    async getRpcUrls(chainKey) {
        return this.queue.run(async () => {
            // L0: Memory cache
            const memKey = `rpc:${chainKey}`;
            if (this.memoryCache.has(memKey)) {
                return this.memoryCache.get(memKey);
            }

            // L1: IndexedDB (persistent, survives reload)
            const cached = await this.indexedDb.get(memKey);
            if (cached && Array.isArray(cached)) {
                this.memoryCache.set(memKey, cached);
                // Background refresh from KV
                this._refreshFromKvBackground(chainKey, memKey);
                return cached;
            }

            // L3: Generate locally (fast fallback)
            const rpcs = this._generateRpcs(chainKey);
            
            // Background: Try to fetch from KV and update caches
            this._backgroundFetchAndCache(chainKey, memKey, rpcs);

            // Return immediately
            return rpcs;
        });
    }

    /**
     * Get multiple chains in parallel (non-blocking queue)
     */
    async getMultiChainRpcs(chainKeys) {
        const promises = chainKeys.map(key => this.getRpcUrls(key));
        const results = {};

        // Use Promise.allSettled to not block on failures
        const settled = await Promise.allSettled(promises);
        chainKeys.forEach((key, i) => {
            results[key] = settled[i].status === 'fulfilled' ? settled[i].value : [];
        });

        return results;
    }

    /**
     * Background: Try KV, update IndexedDB if successful
     */
    async _backgroundFetchAndCache(chainKey, memKey, fallback) {
        if (!this.workerUrl) {
            // Store local generation in IndexedDB for persistence
            await this.indexedDb.set(memKey, fallback);
            this.memoryCache.set(memKey, fallback);
            return;
        }

        try {
            const rpcs = await this._fetchFromKvWithTimeout(chainKey);
            if (rpcs && rpcs.length > 0) {
                // Update all caches
                this.memoryCache.set(memKey, rpcs);
                await this.indexedDb.set(memKey, rpcs);
                return rpcs;
            }
        } catch (err) {
            // Silently fail - already using fallback
        }

        // Store fallback in IndexedDB
        this.memoryCache.set(memKey, fallback);
        await this.indexedDb.set(memKey, fallback);
    }

    /**
     * Background refresh: Try KV without blocking
     */
    async _refreshFromKvBackground(chainKey, memKey) {
        if (!this.workerUrl) return;

        // Don't await - run in background
        (async () => {
            try {
                const rpcs = await this._fetchFromKvWithTimeout(chainKey);
                if (rpcs && rpcs.length > 0) {
                    this.memoryCache.set(memKey, rpcs);
                    await this.indexedDb.set(memKey, rpcs);
                }
            } catch (err) {
                // Ignore errors
            }
        })();
    }

    /**
     * Fetch from KV with short timeout (fail fast)
     */
    async _fetchFromKvWithTimeout(chainKey) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONSTANTS.KV_TIMEOUT);

        try {
            const response = await fetch(
                `${this.workerUrl}/api/rpcs/${chainKey}`,
                {
                    signal: controller.signal,
                    headers: { 'Content-Type': 'application/json' },
                    cache: 'force-cache' // Use browser cache if available
                }
            );

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            return data.rpcs || [];
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Generate RPC URLs locally
     */
    _generateRpcs(chainKey) {
        const chain = CHAINS[chainKey];
        if (!chain) return [];

        const rpcs = [...chainRpcs(chain)];
        const alchemy = alchemyRpcs(chainKey);
        const infura = infuraRpcs(chainKey);

        return [...rpcs, ...alchemy, ...infura].filter(Boolean);
    }

    /**
     * Clear all caches
     */
    async clearAll() {
        this.memoryCache.clear();
        await this.indexedDb.clear();
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            memoryCacheSize: this.memoryCache.size,
            queueSize: this.queue.queue.length,
            running: this.queue.running,
            workerUrl: this.workerUrl
        };
    }
}

// Global cache manager instance
let cacheManager = null;

function initCacheManager() {
    if (!cacheManager) {
        cacheManager = new CacheManager();
    }
    return cacheManager;
}

/**
 * Public API - Non-blocking, fast fallback
 */
const KVConfig = {
    /**
     * Get RPC URLs for a single chain (non-blocking)
     * Returns immediately with cached or locally generated URLs
     */
    async getRpcUrls(chainKey) {
        const manager = initCacheManager();
        return manager.getRpcUrls(chainKey);
    },

    /**
     * Get RPC URLs for multiple chains (concurrent, non-blocking)
     * Best for importing multiple networks at once
     */
    async getMultiChainRpcs(chainKeys) {
        const manager = initCacheManager();
        return manager.getMultiChainRpcs(chainKeys);
    },

    /**
     * Clear all caches
     */
    async clearCache() {
        const manager = initCacheManager();
        await manager.clearAll();
    },

    /**
     * Get cache statistics
     */
    getStats() {
        const manager = initCacheManager();
        return manager.getStats();
    },

    /**
     * Set Cloudflare Worker URL
     */
    setWorkerUrl(url) {
        CONSTANTS.KV_WORKER_URL = url;
        const manager = initCacheManager();
        manager.workerUrl = url;
    }
};

// Auto-init on load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        initCacheManager();
    });
}
