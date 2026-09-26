/**
 * kv.js — chain/token configuration with Cloudflare KV storage backend
 * Drop-in replacement for config.js that stores cache in KV instead of browser
 * Usage: Replace <script src="js/config.js"></script> with <script src="js/kv.js"></script>
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
    SCAN_CONCURRENCY: 10,
    VAULT_STORAGE_KEY: 'omni_vault',
    THEME_STORAGE_KEY: 'omni_theme',
    DEFAULT_CURRENCY: 'usd',
    PRICE_CACHE_DURATION: 10000,
    MAX_RPC_RETRIES: 5,
    RPC_TIMEOUT: 12000,
    NETWORK_API_KEY: '',
    ALCHEMY_KEY: 'KedNAmevgHvaNnMRCnWDq',
    INFURA_KEY: 'f67ee0c6843b441787ed722460b29b7c',
    TRONGRID_KEY: '825d994a-594b-4439-9118-9948ccdb273c',
    CORS_PROXY: '',
    USE_PROXY: false,
    DUST_USD: 0.01,
    // KV Configuration
    KV_WORKER_URL: 'https://omni-wall-prod.your-account.workers.dev',
    KV_CACHE_TTL: 3600, // 1 hour
    KV_TIMEOUT: 9999 // 5 seconds
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
 * KV Storage Manager - Handles all Cloudflare KV operations
 * Uses L1 local cache + L2 KV store for RPC URLs
 */
class KVStorageManager {
    constructor(workerUrl, kvTimeout = 5000) {
        this.workerUrl = workerUrl;
        this.kvTimeout = kvTimeout;
        this.localCache = new Map(); // L1: In-memory cache
        this.workerAvailable = !!workerUrl; // Only use if URL is set
        this.cacheKeys = {
            rpc: 'rpc:',
            health: 'health:',
            tokens: 'tokens:',
            chains: 'chains:'
        };
    }

    /**
     * Get RPC URLs with KV storage (L1 -> L2 -> Generate)
     */
    async getRpcUrls(chainKey) {
        const cacheKey = this.cacheKeys.rpc + chainKey;

        // L1: In-memory cache (instant)
        if (this.localCache.has(cacheKey)) {
            return this.localCache.get(cacheKey);
        }

        // L2: Cloudflare KV (if available)
        if (this.workerAvailable) {
            try {
                const rpcs = await this._fetchFromKv(chainKey);
                if (rpcs && rpcs.length > 0) {
                    this.localCache.set(cacheKey, rpcs);
                    return rpcs;
                }
            } catch (err) {
                console.warn(`KV fetch failed for ${chainKey}:`, err.message);
                this.workerAvailable = false; // Fallback to local generation
            }
        }

        // L3: Generate locally and store in KV
        const rpcs = this._generateRpcs(chainKey);
        if (this.workerAvailable) {
            this._storeInKv(chainKey, rpcs).catch(err => 
                console.warn(`Failed to store ${chainKey} in KV:`, err)
            );
        }
        this.localCache.set(cacheKey, rpcs);
        return rpcs;
    }

    /**
     * Get multiple chains' RPCs in parallel
     */
    async getMultiChainRpcs(chainKeys) {
        const results = {};
        const promises = chainKeys.map(async (key) => {
            try {
                results[key] = await this.getRpcUrls(key);
            } catch (err) {
                console.error(`Failed to get RPCs for ${key}:`, err);
                results[key] = [];
            }
        });

        await Promise.all(promises);
        return results;
    }

    /**
     * Fetch RPC URLs from Cloudflare KV Worker
     */
    async _fetchFromKv(chainKey) {
        if (!this.workerUrl) return null;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.kvTimeout);

        try {
            const response = await fetch(
                `${this.workerUrl}/api/rpcs/${chainKey}`,
                {
                    signal: controller.signal,
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data.rpcs || [];
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Store RPC URLs in Cloudflare KV Worker
     */
    async _storeInKv(chainKey, rpcs) {
        if (!this.workerUrl) return;

        try {
            await fetch(`${this.workerUrl}/api/rpcs/${chainKey}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chainKey,
                    rpcs,
                    timestamp: Date.now()
                })
            });
        } catch (err) {
            console.warn(`Failed to store in KV:`, err);
        }
    }

    /**
     * Generate RPC URLs locally (combines all sources)
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
     * Report RPC health status
     */
    async recordRpcHealth(rpcUrl, isHealthy) {
        if (!this.workerAvailable) return;

        try {
            await fetch(`${this.workerUrl}/api/health`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rpcUrl, healthy: isHealthy })
            });
        } catch (err) {
            console.warn('Failed to report health:', err);
        }
    }

    /**
     * Warm up cache for all chains
     */
    async warmCache() {
        const chainKeys = Object.keys(CHAINS);
        console.log(`Warming KV cache for ${chainKeys.length} chains...`);

        const batchSize = 5;
        for (let i = 0; i < chainKeys.length; i += batchSize) {
            const batch = chainKeys.slice(i, i + batchSize);
            await Promise.all(batch.map(key => this.getRpcUrls(key)));
        }
        console.log('Cache warm-up complete');
    }

    /**
     * Clear local cache
     */
    clearLocalCache() {
        this.localCache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            localCacheSize: this.localCache.size,
            workerUrl: this.workerUrl,
            workerAvailable: this.workerAvailable,
            cachedChains: Array.from(this.localCache.keys())
                .filter(k => k.startsWith(this.cacheKeys.rpc))
                .map(k => k.replace(this.cacheKeys.rpc, ''))
        };
    }
}

/**
 * Initialize KV storage manager
 * Auto-initializes if KV_WORKER_URL is configured in CONSTANTS
 */
let kvManager = null;

function initKvManager() {
    if (!kvManager && CONSTANTS.KV_WORKER_URL) {
        kvManager = new KVStorageManager(
            CONSTANTS.KV_WORKER_URL,
            CONSTANTS.KV_TIMEOUT
        );
    }
    return kvManager;
}

/**
 * Public API - Wrapper functions that use KV if available
 */
const KVConfig = {
    /**
     * Get RPC URLs for a chain
     * Usage: await KVConfig.getRpcUrls('ethereum')
     */
    async getRpcUrls(chainKey) {
        const manager = initKvManager();
        if (manager) {
            return manager.getRpcUrls(chainKey);
        }
        // Fallback to local generation
        return [
            ...chainRpcs(CHAINS[chainKey]),
            ...alchemyRpcs(chainKey),
            ...infuraRpcs(chainKey)
        ].filter(Boolean);
    },

    /**
     * Get RPC URLs for multiple chains
     * Usage: await KVConfig.getMultiChainRpcs(['ethereum', 'polygon', 'arbitrum'])
     */
    async getMultiChainRpcs(chainKeys) {
        const manager = initKvManager();
        if (manager) {
            return manager.getMultiChainRpcs(chainKeys);
        }
        // Fallback to local generation
        const results = {};
        for (const key of chainKeys) {
            results[key] = [
                ...chainRpcs(CHAINS[key]),
                ...alchemyRpcs(key),
                ...infuraRpcs(key)
            ].filter(Boolean);
        }
        return results;
    },

    /**
     * Report RPC health
     */
    async reportHealth(rpcUrl, isHealthy) {
        const manager = initKvManager();
        if (manager) {
            await manager.recordRpcHealth(rpcUrl, isHealthy);
        }
    },

    /**
     * Warm up KV cache
     */
    async warmCache() {
        const manager = initKvManager();
        if (manager) {
            await manager.warmCache();
        }
    },

    /**
     * Get cache statistics
     */
    getStats() {
        const manager = initKvManager();
        if (manager) {
            return manager.getStats();
        }
        return { localCacheSize: 0, workerAvailable: false };
    },

    /**
     * Configure KV worker URL
     */
    setWorkerUrl(url) {
        CONSTANTS.KV_WORKER_URL = url;
        kvManager = null; // Reset manager to reinitialize with new URL
        return initKvManager();
    }
};

// Auto-initialize if worker URL is already configured
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        if (CONSTANTS.KV_WORKER_URL) {
            console.log('Initializing KV cache...');
            initKvManager();
        }
    });
}
