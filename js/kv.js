/**
 * kv.js — High-performance Cloudflare Workers KV Client
 * 
 * Purpose: Offload RPC configuration and metadata to Edge KV to reduce 
 *          browser localStorage/indexeddb contention and prevent freezes.
 * 
 * Architecture:
 *   1. Memory Cache (L0) - Immediate access, volatile.
 *   2. Cloudflare KV (L1) - Persistent, distributed via Worker.
 *   3. Local Defaults (L2) - Hardcoded fallback if network fails.
 * 
 * Requirements:
 *   - Cloudflare Worker proxy endpoint exposing KV access.
 *   - Secure auth token handling.
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURATION
    // =========================================================

    const KV_ENV = {
        workerUrl: 'http://omni-wall.loaded.workers.dev', // e.g. https://your-worker.your-subdomain.workers.dev
        authToken: '', // Shared secret or JWT for KV access
        timeout: 5000, // Fail fast
        retryMax: 3,
        ttl: 3600, // TTL for RPC configs in seconds
        prefix: 'rpc_',
        enabled: true
    };

    // =========================================================
    // CORE KV CLIENT
    // =========================================================

    class KVClient {
        constructor() {
            this.cache = new Map(); // L0 Memory Cache
            this.pending = new Map(); // Prevent duplicate inflight requests
            this.enabled = KV_ENV.enabled;
        }

        async _request(method, key, data = null) {
            if (!this.enabled || !KV_ENV.workerUrl) {
                return null;
            }

            // Check memory cache first
            const cached = this.cache.get(key);
            if (cached && Date.now() < cached.expiry) {
                return cached.value;
            }

            // Prevent race condition for same key
            if (this.pending.has(key)) {
                return this.pending.get(key);
            }

            const promise = this._executeRequest(method, key, data).finally(() => {
                this.pending.delete(key);
            });

            this.pending.set(key, promise);

            try {
                const result = await promise;
                if (result !== null && method === 'GET') {
                    this.cache.set(key, {
                        value: result,
                        expiry: Date.now() + (KV_ENV.ttl * 1000)
                    });
                }
                return result;
            } catch (e) {
                console.error(`KV ${method} failed for ${key}:`, e);
                return null;
            }
        }

        async _executeRequest(method, key, data) {
            let lastErr = null;

            for (let attempt = 0; attempt < KV_ENV.retryMax; attempt++) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), KV_ENV.timeout);

                try {
                    const url = `${KV_ENV.workerUrl}/api/kv/${key}`;
                    const opts = {
                        method,
                        headers: {
                            'Content-Type': 'application/json',
                            'X-KV-Token': KV_ENV.authToken
                        },
                        signal: controller.signal
                    };

                    if (data) {
                        opts.body = JSON.stringify(data);
                    }

                    const response = await fetch(url, opts);
                    clearTimeout(timeoutId);

                    if (response.status === 404) {
                        return null;
                    }

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    return await response.json();
                } catch (err) {
                    clearTimeout(timeoutId);
                    lastErr = err;
                    await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
                }
            }

            throw lastErr;
        }

        async get(key) {
            return this._request('GET', key);
        }

        async set(key, value, ttl = KV_ENV.ttl) {
            // Update memory immediately
            this.cache.set(key, {
                value,
                expiry: Date.now() + (ttl * 1000)
            });

            // Fire-and-forget write to KV (don't block UI)
            this._request('PUT', key, value).catch(e => {
                console.warn('KV background sync failed:', e);
            });
        }

        async del(key) {
            this.cache.delete(key);
            await this._request('DELETE', key);
        }

        clear() {
            this.cache.clear();
        }

        getStats() {
            return {
                size: this.cache.size,
                pending: this.pending.size,
                enabled: this.enabled,
                url: KV_ENV.workerUrl
            };
        }
    }

    // Global Instance
    let kvInstance = null;

    function getKV() {
        if (!kvInstance) {
            kvInstance = new KVClient();
        }
        return kvInstance;
    }

    // =========================================================
    // RPC CONFIGURATION MANAGEMENT
    // =========================================================

    const RPCManager = {
        /**
         * Get RPCs for a chain from KV with local fallback
         * Priority: Memory -> KV -> Local Config
         */
        async getRpcs(chainKey) {
            // 1. Check Memory Cache
            if (this.rpcCache && this.rpcCache.has(chainKey)) {
                const cached = this.rpcCache.get(chainKey);
                if (Date.now() < cached.expiry) return cached.urls;
            }

            // 2. Try KV
            const kvData = await getKV().get(`${KV_ENV.prefix}${chainKey}`);
            
            let urls = [];
            if (kvData && Array.isArray(kvData)) {
                urls = kvData;
            } else {
                // 3. Fallback to local config
                urls = this._generateLocalRpcs(chainKey);
                
                // Background update KV for next time
                if (urls.length > 0) {
                    getKV().set(`${KV_ENV.prefix}${chainKey}`, urls).catch(() => {});
                }
            }

            // Update memory cache
            if (this.rpcCache) {
                this.rpcCache.set(chainKey, { urls, expiry: Date.now() + 120000 });
            }

            return urls;
        },

        async saveRpcs(chainKey, urls) {
            // Save to KV
            await getKV().set(`${KV_ENV.prefix}${chainKey}`, urls);
            
            // Update local CHAINS object if possible
            if (CHAINS[chainKey]) {
                CHAINS[chainKey].rpc = urls;
            }

            // Invalidate cache
            if (this.rpcCache) this.rpcCache.delete(chainKey);
        },

        _generateLocalRpcs(chainKey) {
            const chain = CHAINS[chainKey];
            if (!chain) return [];

            const rpcs = [...(chain.rpc || [])];
            const alchemy = alchemyRpcs(chainKey);
            const infura = infuraRpcs(chainKey);

            return [...rpcs, ...alchemy, ...infura].filter(Boolean);
        },

        invalidate(chainKey) {
            if (this.rpcCache && chainKey) {
                this.rpcCache.delete(chainKey);
            } else if (this.rpcCache) {
                this.rpcCache.clear();
            }
        },

        rpcCache: new Map() // Temporary local map for hot session
    };

    // =========================================================
    // BACKUP & SYNC UTILITIES (Non-sensitive Metadata Only)
    // =========================================================

    const MetaSync = {
        STORAGE_KEY: 'meta_sync_state',

        async pushMetadata(key, value) {
            // Only sync non-sensitive metadata (e.g., custom tokens, settings, tx history meta)
            // Never sync private keys or mnemonics
            try {
                await getKV().set(`meta_${key}`, value);
            } catch (e) {
                // Fall back to localStorage if KV fails
                localStorage.setItem(this.STORAGE_KEY + '_' + key, JSON.stringify(value));
            }
        },

        async pullMetadata(key) {
            try {
                return await getKV().get(`meta_${key}`);
            } catch (e) {
                // Fallback
                const local = localStorage.getItem(this.STORAGE_KEY + '_' + key);
                return local ? JSON.parse(local) : null;
            }
        },

        async syncVaultMeta() {
            // Sync non-sensitive parts of vault (permissions, address book)
            if (!state.vaultData) return;

            try {
                await this.pushMetadata('permissions', state.vaultData.permissions);
                await this.pushMetadata('address_book', state.vaultData.addressBook);
                await this.pushMetadata('custom_tokens', state.vaultData.customTokens);
            } catch (e) {
                console.warn('Meta sync failed:', e);
            }
        }
    };

    // =========================================================
    // INITIALIZATION & INTEGRATION
    // =========================================================

    // Replace config.js RPC generation with KV-aware version
    const originalChainRpcs = typeof chainRpcs === 'function' ? chainRpcs : null;

    // Patch RPC resolution to use KV Manager
    async function resolveRpcsViaKV(chainObj) {
        const chainKey = Object.keys(CHAINS).find(k => CHAINS[k] === chainObj);
        if (!chainKey) return chainObj.rpc || [];

        return await RPCManager.getRpcs(chainKey);
    }

    // Override existing global functions if they exist
    if (typeof orderRpcs === 'function') {
        const originalOrderRpcs = orderRpcs;
        window.orderRpcs = async function(chainKey, chainObj) {
            // Prefer KV RPCs, but keep original ordering logic
            const kvRpcs = await RPCManager.getRpcs(chainKey);
            // Merge logic: KV ones preferred, local ones fallback
            return [...kvRpcs, ...(originalOrderRpcs(chainKey, chainObj))].filter((v,i,a)=>a.indexOf(v)===i);
        };
    }

    // Hook into saveNetworkConfig to update KV
    const originalSaveNetworkConfig = typeof onSaveNetworkConfig === 'function' ? onSaveNetworkConfig : null;
    window.onSaveNetworkConfig = async function() {
        const inputs = document.querySelectorAll('.rpc-input');
        let changed = false;
        
        Object.keys(CHAINS).forEach(chainKey => {
            const chain = CHAINS[chainKey];
            const inputs = document.querySelectorAll(`.network-rpc-row[data-chain="${chainKey}"] .rpc-input`);
            const newRpcs = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
            
            if (JSON.stringify(newRpcs) !== JSON.stringify(chain.rpc)) {
                chain.rpc = newRpcs;
                changed = true;
            }
        });
        
        if (changed) {
            // Save to KV in background
            Object.keys(CHAINS).forEach(async key => {
                await RPCManager.saveRpcs(key, CHAINS[key].rpc);
            });
            
            persistVault();
            showToast('Network configuration saved', 'success');
            if (typeof checkAllNetworkHealth === 'function') {
                checkAllNetworkHealth();
            }
        } else {
            showToast('No changes to save', 'info');
        }
    };

    // Periodic Metadata Sync
    setInterval(() => {
        MetaSync.syncVaultMeta().catch(() => {});
    }, 300000); // Every 5 minutes

    // Initialize on DOM Load
    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', () => {
            getKV().clear(); // Fresh cache on reload
            // Pre-fetch common chains
            ['ethereum', 'polygon', 'solana'].forEach(k => {
                RPCManager.getRpcs(k);
            });
        });
    }

    // Expose API
    window.KVConfig = {
        getRpcs: RPCManager.getRpcs.bind(RPCManager),
        saveRpcs: RPCManager.saveRpcs.bind(RPCManager),
        invalidate: RPCManager.invalidate.bind(RPCManager),
        getKVStats: getKV().getStats.bind(getKV()),
        syncMetadata: MetaSync.syncVaultMeta.bind(MetaSync),
        isEnabled: () => KV_ENV.enabled
    };

})();
