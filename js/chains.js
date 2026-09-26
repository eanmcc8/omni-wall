/* chains.js — account derivation, balance scanning, sending with multi-RPC support */

function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length) {
            const i = index++;
            results[i] = await fn(items[i], i);
        }
    });
    return Promise.all(workers).then(() => results);
}

let rpcHealth = {};
let tokenDecimalsCache = {};

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('Timeout'));
        }, ms);
        promise.then(
            (v) => { if (settled) return; settled = true; clearTimeout(timeout); resolve(v); },
            (e) => { if (settled) return; settled = true; clearTimeout(timeout); reject(e); }
        );
    });
}
const RPC_COOLDOWN_MS = 45000;

function markRpcHealth(rpc, chainKey, healthy) {
    if (!rpcHealth[chainKey]) rpcHealth[chainKey] = {};
    if (healthy) {
        rpcHealth[chainKey][rpc] = { healthy: true, lastCheck: Date.now(), openUntil: 0 };
    } else {
        const prev = rpcHealth[chainKey][rpc] || {};
        const failures = (prev.failures || 0) + 1;
        const cooldown = Math.min(RPC_COOLDOWN_MS, 5000 * Math.pow(2, Math.min(failures, 4) - 1));
        rpcHealth[chainKey][rpc] = {
            healthy: false,
            failures,
            lastCheck: Date.now(),
            openUntil: Date.now() + cooldown
        };
    }
}

function orderRpcs(chainKey, chainObj) {
    const now = Date.now();
    const keyed = [...alchemyRpcs(chainKey), ...infuraRpcs(chainKey)];
    const resolved = chainRpcs(chainObj);
    const seen = new Set();
    const merged = [];
    for (const url of [...keyed, ...resolved]) {
        if (!url || seen.has(url)) continue;
        seen.add(url);
        merged.push(url);
    }
    return merged.sort((a, b) => {
        const sa = rpcHealth[chainKey]?.[a];
        const sb = rpcHealth[chainKey]?.[b];
        const aOpen = sa?.openUntil && sa.openUntil > now;
        const bOpen = sb?.openUntil && sb.openUntil > now;
        if (aOpen !== bOpen) return aOpen ? 1 : -1;
        const ha = sa?.healthy === false ? 1 : 0;
        const hb = sb?.healthy === false ? 1 : 0;
        return ha - hb;
    });
}

async function fetchWithTimeout(url, opts = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONSTANTS.RPC_TIMEOUT);
    try {
        const response = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

async function rpcCall(chainKey, method, params, retryCount = 0) {
    const chain = CHAINS[chainKey];
    if (!chain || !chain.rpc) throw new Error(`Chain ${chainKey} not configured`);

    const orderedRpcs = [...chain.rpc].sort((a, b) => {
        const ha = rpcHealth[chainKey]?.[a]?.healthy ? -1 : 0;
        const hb = rpcHealth[chainKey]?.[b]?.healthy ? -1 : 0;
        return ha - hb;
    });

    const rpcUrl = orderedRpcs[retryCount % orderedRpcs.length];
    try {
        const payload = {
            jsonrpc: '2.0',
            method,
            params,
            id: Date.now() + Math.random()
        };
        const response = await fetchWithTimeout(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message || 'RPC error');
        markRpcHealth(rpcUrl, chainKey, true);
        return data.result;
    } catch (e) {
        markRpcHealth(rpcUrl, chainKey, false);
        if (retryCount < CONSTANTS.MAX_RPC_RETRIES && retryCount < orderedRpcs.length - 1) {
            return rpcCall(chainKey, method, params, retryCount + 1);
        }
        throw e;
    }
}

async function checkNetworkHealth() {
    const results = {};
    await Promise.all(Object.keys(CHAINS).map(async (chainKey) => {
        const chain = CHAINS[chainKey];
        const providers = chain.rpc || [];
        results[chainKey] = [];
        await Promise.all(providers.map(async (rpc) => {
            const isHealthy = rpcHealth[chainKey]?.[rpc]?.healthy ?? false;
            if (!isHealthy) {
                try {
                    if (chain.kind === 'evm') {
                        const result = await rpcCall(chainKey, 'eth_blockNumber', []);
                        const healthy = !!result;
                        markRpcHealth(rpc, chainKey, healthy);
                        results[chainKey].push({ rpc, healthy });
                    } else if (chain.kind === 'solana') {
                        const result = await fetchWithTimeout(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }) });
                        const data = await result.json();
                        const healthy = data && !data.error;
                        markRpcHealth(rpc, chainKey, healthy);
                        results[chainKey].push({ rpc, healthy });
                    } else if (chain.kind === 'tron') {
                        const result = await fetchWithTimeout(`${rpc}/wallet/getnowblock`, { method: 'GET' });
                        const healthy = result.ok;
                        markRpcHealth(rpc, chainKey, healthy);
                        results[chainKey].push({ rpc, healthy });
                    }
                } catch (e) {
                    markRpcHealth(rpc, chainKey, false);
                    results[chainKey].push({ rpc, healthy: false });
                }
            } else {
                results[chainKey].push({ rpc, healthy: true });
            }
        }));
    }));
    state.networkHealth = results;
    return results;
}

async function slip10DeriveEd25519(seed, path) {
    const enc = new TextEncoder();
    async function hmac512(key, data) {
        const k = await window.crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
        return new Uint8Array(await window.crypto.subtle.sign('HMAC', k, data));
    }
    let I = await hmac512(enc.encode('ed25519 seed'), seed);
    let IL = I.slice(0, 32);
    const parts = path.split('/').filter(p => p && p !== 'm');
    for (const part of parts) {
        const hardened = part.endsWith("'");
        const idx = parseInt(part, 10) + (hardened ? 0x80000000 : 0);
        const data = new Uint8Array(37);
        data[0] = 0;
        data.set(IL, 1);
        new DataView(data.buffer).setUint32(33, idx >>> 0);
        I = await hmac512(IL, data);
        IL = I.slice(0, 32);
    }
    return IL;
}

async function getSolanaKeypair(acc) {
    const cacheKey = acc.id !== undefined ? `id_${acc.id}` : (acc.derivationPath || 'privkey');
    if (state.keyCache['sol:' + cacheKey]) return state.keyCache['sol:' + cacheKey];
    let kp = null;

    if (Array.isArray(acc.secretKey) && acc.secretKey.length === 32) {
        kp = window.solana.web3.Keypair.fromSeed(Uint8Array.from(acc.secretKey));
    }

    if (!kp) {
        for (const pk of state.vaultData.privKeys) {
            if (pk.type === 'solana') {
                try {
                    kp = window.solana.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk.key)));
                    break;
                } catch {
                    if (window.Buffer) kp = window.solana.web3.Keypair.fromSeed(window.Buffer.from(pk.key, 'base58'));
                    break;
                }
            }
        }
    }

    if (!kp && state.vaultData.mnemonics && state.vaultData.mnemonics.length > 0) {
        for (const mnemonic of state.vaultData.mnemonics) {
            try {
                const seed = window.ethers.Mnemonic.fromPhrase(mnemonic).computeSeed();
                const childKey = await slip10DeriveEd25519(seed, acc.derivationPath || (CHAINS.solana.path + "0"));
                kp = window.solana.web3.Keypair.fromSeed(childKey);
                if (kp) break;
            } catch { continue; }
        }
    }

    if (kp) state.keyCache['sol:' + cacheKey] = kp;
    return kp;
}

function getTronPrivateKey(acc) {
    if (acc.privateKey) return acc.privateKey;
    if (!state.vaultData.mnemonics?.length && !state.vaultData.mnemonic && !state.vaultData.privKeys.some(pk => pk.type === 'evm')) return null;
    try {
        if (state.vaultData.privKeys.some(pk => pk.type === 'evm')) {
            const evmKey = state.vaultData.privKeys.find(pk => pk.type === 'evm');
            return new window.ethers.Wallet(evmKey.key).privateKey;
        }
        const mnemonics = state.vaultData.mnemonics || (state.vaultData.mnemonic ? [state.vaultData.mnemonic] : []);
        for (const m of mnemonics) {
            try {
                const wallet = window.ethers.HDNodeWallet.fromPhrase(m, "", acc.derivationPath || `m/44'/195'/0'/0/0`);
                return wallet.privateKey;
            } catch { continue; }
        }
    } catch (e) {
        console.error("Tron key derivation error:", e);
    }
    return null;
}

function getTronWeb(acc) {
    const cacheKey = acc.id !== undefined ? `id_${acc.id}` : (acc.derivationPath || 'privkey');
    if (state.keyCache['trx:' + cacheKey]) return state.keyCache['trx:' + cacheKey];
    const privateKey = getTronPrivateKey(acc);
    if (!privateKey) return null;
    try {
        const tw = new window.TronWeb({ fullHost: getWorkingRpcForChain(acc.chainKey, acc.chainObj), privateKey });
        state.keyCache['trx:' + cacheKey] = tw;
        return tw;
    } catch (e) {
        console.error("TronWeb init error:", e);
        return null;
    }
}

function getEvmSigner(acc, provider) {
    if (acc.privateKey) {
        return new window.ethers.Wallet(acc.privateKey, provider);
    }
    if (state.vaultData.privKeys.length) {
        const evmKey = state.vaultData.privKeys.find(pk => pk.type === 'evm');
        if (evmKey) return new window.ethers.Wallet(evmKey.key, provider);
    }
    const mnemonics = state.vaultData.mnemonics || (state.vaultData.mnemonic ? [state.vaultData.mnemonic] : []);
    for (const mnemonic of mnemonics) {
        try {
            return window.ethers.HDNodeWallet.fromPhrase(mnemonic, "", acc.derivationPath || `${acc.chainObj.path}0`).connect(provider);
        } catch { continue; }
    }
    throw new Error("No EVM key available");
}

function getActiveAccounts() {
    return (state.accounts || []).filter(acc => acc.chainKey && CHAINS[acc.chainKey]);
}

async function generateAccountsList() {
    state.accounts = [];
    state.keyCache = {};
    let idCounter = 0;
    const seenAccounts = new Set();

    function addAccount(acc) {
        const key = `${acc.chainKey}:${acc.address}`;
        if (seenAccounts.has(key)) return;
        seenAccounts.add(key);
        acc.id = idCounter++;
        state.accounts.push(acc);
    }

    const mnemonics = state.vaultData.mnemonics || (state.vaultData.mnemonic ? [state.vaultData.mnemonic] : []);

    for (const mnemonic of mnemonics) {
        for (const chainKey of Object.keys(CHAINS)) {
            const chain = CHAINS[chainKey];
            if (chain.kind === 'evm' || chain.kind === 'tron' || chain.kind === 'solana') {
                for (let i = 0; i < CONSTANTS.DERIVATION_COUNT; i++) {
                    try {
                        if (chain.kind === 'evm') {
                            const wallet = window.ethers.HDNodeWallet.fromPhrase(mnemonic, "", `${chain.path}${i}`);
                            addAccount({
                                type: 'evm', address: wallet.address,
                                chainKey, chainObj: chain,
                                nativeBal: 0, tokens: {}, isLoading: true, scanError: null,
                                derivationPath: `${chain.path}${i}`,
                                privateKey: wallet.privateKey
                            });
                        } else if (chain.kind === 'solana') {
                            const seed = window.ethers.Mnemonic.fromPhrase(mnemonic).computeSeed();
                            const childKey = await slip10DeriveEd25519(seed, `${chain.path}${i}`);
                            const kp = window.solana.web3.Keypair.fromSeed(childKey);
                            addAccount({
                                type: 'solana', address: kp.publicKey.toBase58(),
                                chainKey, chainObj: chain,
                                nativeBal: 0, tokens: {}, isLoading: true, scanError: null,
                                derivationPath: `${chain.path}${i}`,
                                secretKey: Array.from(childKey)
                            });
                        } else {
                            const wallet = window.ethers.HDNodeWallet.fromPhrase(mnemonic, "", `m/44'/195'/0'/0/${i}`);
                            const tw = new window.TronWeb({ fullHost: getWorkingRpcForChain(chainKey, chain), privateKey: wallet.privateKey });
                            addAccount({
                                type: 'tron', address: tw.defaultAddress.base58,
                                chainKey, chainObj: chain,
                                nativeBal: 0, tokens: {}, isLoading: true, scanError: null,
                                derivationPath: `m/44'/195'/0'/0/${i}`,
                                privateKey: wallet.privateKey
                            });
                        }
                    } catch (e) { console.warn("Derivation error:", e); }
                }
            }
        }
    }

    for (const pk of state.vaultData.privKeys) {
        if (pk.type === 'evm') {
            const w = new window.ethers.Wallet(pk.key);
            Object.keys(CHAINS).forEach(chainKey => {
                if (CHAINS[chainKey].kind === 'evm') {
                    addAccount({
                        type: 'evm', address: w.address,
                        chainKey, chainObj: CHAINS[chainKey],
                        nativeBal: 0, tokens: {}, isLoading: true, scanError: null,
                        derivationPath: null, privateKey: w.privateKey
                    });
                }
            });
        } else if (pk.type === 'solana') {
            let kp = null;
            try {
                kp = window.solana.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk.key)));
            } catch {
                if (window.Buffer) kp = window.solana.web3.Keypair.fromSeed(window.Buffer.from(pk.key, 'base58'));
            }
            if (kp) {
                addAccount({
                    type: 'solana', address: kp.publicKey.toBase58(),
                    chainKey: 'solana', chainObj: CHAINS.solana,
                    nativeBal: 0, tokens: {}, isLoading: true, scanError: null,
                    derivationPath: CHAINS.solana.path + "0",
                    secretKey: Array.from(kp.secretKey)
                });
            }
        }
    }
}

async function scanAccount(acc) {
    acc.isLoading = true;
    acc.scanError = null;
    try {
        if (acc.type === 'evm') {
            const tokenAbi = [
                "function balanceOf(address) view returns (uint256)",
                "function decimals() view returns (uint8)"
            ];
            const builtInTokens = TOKENS[acc.chainKey] || {};
            const customTokens = getCustomTokensForChain(acc.chainKey);
            const allTokens = { ...builtInTokens };
            customTokens.forEach(t => {
                allTokens[t.symbol] = t.contractAddress;
            });
            const tokenEntries = Object.entries(allTokens);
            let balanceFailed = false;
            let balanceErr = null;
            const balancePromise = withRpcFailover(
                acc.chainKey, acc.chainObj,
                (p) => p.getBalance(acc.address),
                'getBalance'
            ).catch((e) => {
                balanceErr = e;
                balanceFailed = true;
                console.warn(`Balance fetch failed for ${acc.chainObj.name} ${acc.address.slice(0,6)}...${acc.address.slice(-4)}:`, e.message);
                return 0n;
            });
            const tokenPromises = tokenEntries.map(async ([sym, contractAddr]) => {
                try {
                    const addr = contractAddr.contract || contractAddr;
                    const cacheKey = `${acc.chainKey}:${addr}`;
                    const rawBal = await withRpcFailover(
                        acc.chainKey, acc.chainObj,
                        (p) => new window.ethers.Contract(addr, tokenAbi, p).balanceOf(acc.address),
                        `balanceOf ${sym}`
                    );
                    let dec = tokenDecimalsCache[cacheKey];
                    if (dec === undefined) {
                        dec = await withRpcFailover(
                            acc.chainKey, acc.chainObj,
                            (p) => new window.ethers.Contract(addr, tokenAbi, p).decimals(),
                            `decimals ${sym}`
                        ).catch((e) => {
                            console.warn(`Decimals fetch failed for ${sym} on ${acc.chainObj.name}:`, e.message);
                            return 18;
                        });
                        dec = Number(dec);
                        if (!Number.isFinite(dec) || dec < 0 || dec > 36) dec = 18;
                        tokenDecimalsCache[cacheKey] = dec;
                    }
                    return [sym, Number(window.ethers.formatUnits(rawBal, dec))];
                } catch (e) {
                    console.warn(`Token scan failed for ${sym} on ${acc.chainObj.name}:`, e.message);
                    return [sym, 0];
                }
            });
            const [balResult, ...tokenResults] = await Promise.all([balancePromise, ...tokenPromises]);
            acc.nativeBal = typeof balResult === 'bigint' ? Number(window.ethers.formatEther(balResult)) : 0;
            if (balanceFailed) {
                acc.scanError = `${acc.chainObj.name} RPC unavailable (${balanceErr?.message || 'error'}) — showing 0`;
            }
            tokenResults.forEach(([sym, val]) => { acc.tokens[sym] = val; });
        } else if (acc.type === 'solana') {
            const kp = await getSolanaKeypair(acc);
            if (kp) {
                let solanaFailed = false;
                let solanaErr = null;
                let lamports = 0;
                for (const rpc of orderRpcs(acc.chainKey, acc.chainObj)) {
                    try {
                        const conn = new window.solana.web3.Connection(rpc, 30000);
                        lamports = await withTimeout(conn.getBalance(kp.publicKey), 15000);
                        markRpcHealth(rpc, acc.chainKey, true);
                        solanaFailed = false;
                        break;
                    } catch (e) {
                        solanaErr = e;
                        markRpcHealth(rpc, acc.chainKey, false);
                        solanaFailed = true;
                    }
                }
                acc.nativeBal = lamports / window.solana.web3.LAMPORTS_PER_SOL;
                if (solanaFailed) {
                    console.warn(`Solana balance fetch failed for ${acc.address.slice(0,6)}...${acc.address.slice(-4)}:`, solanaErr?.message);
                    acc.scanError = `Solana RPC unavailable (${solanaErr?.message || 'error'}) — showing 0`;
                }
            }
        } else if (acc.type === 'tron') {
            const privKey = await getTronPrivateKey(acc);
            if (privKey) {
                let tronFailed = false;
                let tronErr = null;
                let balSun = 0;
                let tw = null;
                for (const rpc of orderRpcs(acc.chainKey, acc.chainObj)) {
                    try {
                        const inst = new window.TronWeb({ fullHost: rpc, privateKey: privKey });
                        balSun = await withTimeout(inst.trx.getBalance(acc.address), 15000);
                        markRpcHealth(rpc, acc.chainKey, true);
                        tw = inst;
                        tronFailed = false;
                        break;
                    } catch (e) {
                        tronErr = e;
                        markRpcHealth(rpc, acc.chainKey, false);
                        tronFailed = true;
                    }
                }
                acc.nativeBal = balSun / CONSTANTS.TRON_SUN_PER_TRX;
                if (tronFailed) {
                    console.warn(`Tron balance fetch failed for ${acc.address.slice(0,6)}...${acc.address.slice(-4)}:`, tronErr?.message);
                    acc.scanError = `Tron RPC unavailable (${tronErr?.message || 'error'}) — showing 0`;
                }
                if (!tw) return;

                const tokens = { ...(TOKENS.tron || {}) };
                getCustomTokensForChain('tron').forEach(t => { tokens[t.symbol] = t.contractAddress; });
                const tokenPromises = Object.entries(tokens).map(async ([sym, contractAddr]) => {
                    const addr = (contractAddr.contract || contractAddr || '').trim();
                    if (!addr) return [sym, 0];
                    try {
                        const contract = await tw.contract(TRC20_ABI).at(addr);
                        const res = await withTimeout(contract.balanceOf(acc.address).call(), 10000)
                            .catch((e) => { console.warn(`TRC20 balance fetch failed for ${sym}:`, e.message); return null; });
                        if (res === null || res === undefined) return [sym, 0];
                        if (typeof res === 'object' && typeof res.toString === 'function' && !res._hex && res.toString() === '0') return [sym, 0];

                        const cacheKey = `tron:${addr}`;
                        let dec = tokenDecimalsCache[cacheKey];
                        if (dec === undefined) {
                            dec = await withTimeout(contract.decimals().call(), 10000)
                                .catch((e) => { console.warn(`TRC20 decimals fetch failed for ${sym}:`, e.message); return 6; });
                            dec = Number(dec);
                            if (!Number.isFinite(dec) || dec < 0 || dec > 30) dec = 6;
                            tokenDecimalsCache[cacheKey] = dec;
                        }

                        let raw;
                        if (res && typeof res._hex === 'string') {
                            raw = BigInt(res._hex);
                        } else if (typeof res === 'bigint') {
                            raw = res;
                        } else if (res && typeof res.toString === 'function') {
                            raw = BigInt(res.toString());
                        } else {
                            raw = BigInt(Math.floor(Number(res)));
                        }
                        if (raw === 0n) return [sym, 0];
                        return [sym, Number(raw) / Math.pow(10, dec)];
                    } catch (e) {
                        console.warn(`TRC20 scan failed for ${sym}:`, e.message);
                        return [sym, 0];
                    }
                });
                const tokenResults = await Promise.all(tokenPromises);
                tokenResults.forEach(([sym, val]) => { acc.tokens[sym] = val; });
            }
        }
    } catch (e) {
        console.error("Scan error", e);
        acc.nativeBal = 0;
        acc.scanError = e?.message || "RPC scan failed";
    } finally {
        acc.isLoading = false;
        acc.lastScan = Date.now();
    }
}

const MAX_INFLIGHT = 24;
let inflight = 0;
const inflightWaiters = [];

async function acquireSlot() {
    if (inflight < MAX_INFLIGHT) { inflight++; return; }
    await new Promise(resolve => inflightWaiters.push(resolve));
    inflight++;
}

function releaseSlot() {
    inflight--;
    const next = inflightWaiters.shift();
    if (next) next();
}

async function withRpcFailover(chainKey, chainObj, fn, label = 'call') {
    const rpcs = orderRpcs(chainKey, chainObj);
    if (rpcs.length === 0) throw new Error(`No RPC configured for ${chainKey}`);
    let lastErr = null;
    for (const rpc of rpcs) {
        try {
            await acquireSlot();
            let result;
            try {
                const provider = getPooledProvider(rpc, chainObj, chainKey);
                result = await withTimeout(fn(provider), CONSTANTS.RPC_TIMEOUT);
            } finally {
                releaseSlot();
            }
            markRpcHealth(rpc, chainKey, true);
            return result;
        } catch (e) {
            lastErr = e;
            markRpcHealth(rpc, chainKey, false);
        }
    }
    throw lastErr || new Error(`All RPCs failed for ${chainKey} (${label})`);
}

const providerPool = new Map();

let ProxiedProviderClass = null;

function buildProxiedProviderClass() {
    if (ProxiedProviderClass) return ProxiedProviderClass;
    const base = window.ethers.JsonRpcApiProvider;
    ProxiedProviderClass = class ProxiedRpcProvider extends base {
        async send(method, params) {
            const target = String(CONSTANTS.CORS_PROXY).replace(/\/$/, '');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CONSTANTS.RPC_TIMEOUT);
            try {
                const res = await fetch(target, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: Date.now(),
                        method,
                        params,
                        target: this.rpcUrl || undefined
                    }),
                    signal: controller.signal
                });
                clearTimeout(timer);
                if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
                const json = await res.json();
                if (json.error) {
                    throw new Error(json.error.message || 'Proxy RPC error');
                }
                return json.result;
            } catch (e) {
                clearTimeout(timer);
                throw e;
            }
        }
    };
    return ProxiedProviderClass;
}

function proxyEnabled() {
    return Boolean(CONSTANTS.USE_PROXY && String(CONSTANTS.CORS_PROXY || '').trim());
}

function clearProviderPool() {
    providerPool.clear();
    rpcHealth = {};
}

function getPooledProvider(rpc, chainObj, chainKey) {
    const key = proxyEnabled() ? `proxy:${rpc}` : rpc;
    const existing = providerPool.get(key);
    if (existing) return existing;
    const network = chainObj.chainId ? { chainId: chainObj.chainId, name: chainKey } : true;
    let provider;
    if (proxyEnabled()) {
        const Cls = buildProxiedProviderClass();
        provider = new Cls(rpc, network, {
            staticNetwork: true,
            batchMaxCount: 1,
            throttleRetryAfter: 200
        });
    } else {
        provider = new window.ethers.JsonRpcProvider(rpc, network, {
            staticNetwork: true,
            batchMaxCount: 1,
            throttleRetryAfter: 200
        });
    }
    providerPool.set(key, provider);
    return provider;
}

function getWorkingProvider(chainKey, chainObj) {
    const bestRpc = orderRpcs(chainKey, chainObj)[0];
    if (!bestRpc) return null;
    return getPooledProvider(bestRpc, chainObj, chainKey);
}

function getCustomTokensForChain(chainKey) {
    return (state.vaultData.customTokens || []).filter(t => t.chainKey === chainKey);
}

function getWorkingRpcForChain(chainKey, chainObj) {
    const rpcs = chainObj.rpc || [];
    for (const rpc of rpcs) {
        if (rpcHealth[chainKey]?.[rpc]?.healthy !== false && state.balanceHealth?.[rpc] !== false) {
            return rpc;
        }
    }
    return rpcs[0] || '';
}

async function scanAllBalances() {
    if (state.scanRunning) {
        state.scanQueued = true;
        return;
    }
        state.scanRunning = true;
    try {
        renderAccounts();
        updateNetworkStatus('scanning');
        checkNetworkHealth();


        await mapLimit(getActiveAccounts(), scanConcurrency(), async (acc) => {
            await scanAccount(acc);
            updateAccountCard(acc);
        });
        updateStats();
        fetchTransactionHistory();
        updateNetworkStatus('online');
    } catch (e) {
        updateNetworkStatus('offline');
        log("Network scan failed: " + e.message, 'error');
    } finally {
        state.scanRunning = false;
        if (state.scanQueued) {
            state.scanQueued = false;
            return scanAllBalances();
        }
    }
}

function validateRecipient(address, acc) {
    try {
        if (acc.type === 'evm') return window.ethers.isAddress(address);
        if (acc.type === 'solana') { new window.solana.web3.PublicKey(address); return true; }
        if (acc.type === 'tron') return Boolean(window.TronWeb && window.TronWeb.isAddress(address));
    } catch (_) { return false; }
    return false;
}

async function getFeeData(acc) {
    if (acc.type === 'evm') {
        const provider = getWorkingProvider(acc.chainKey, acc.chainObj);
        const feeData = await provider.getFeeData();
        return {
            gasLimit: CONSTANTS.NATIVE_GAS_LIMIT,
            gasPrice: feeData.gasPrice || feeData.maxFeePerGas,
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
        };
    }
    if (acc.type === 'solana') {
        const conn = new window.solana.web3.Connection(getWorkingRpcForChain(acc.chainKey, acc.chainObj));
        try {
            const { feeCalculator } = await conn.getRecentPrioritizationFee({ locked: 'slot' }).catch(() => ({ feeCalculator: { lamportsPerByte: 5000 } }));
            return { fee: feeCalculator ? feeCalculator.lamportsPerByte : 5000 };
        } catch {
            return { fee: 5000 };
        }
    }
    if (acc.type === 'tron') {
        const tw = getTronWeb(acc);
        const fee = await tw?.transaction?.getBandwidth();
        return { fee: fee || 1 };
    }
    return null;
}

async function handleSend() {
    if (state.currentAccountId === null) { alert("Select an account first."); return; }
    const acc = state.accounts.find(a => a.id === state.currentAccountId);
    const to = document.getElementById('send-to').value.trim();
    const amountText = document.getElementById('send-amount').value.trim();
    const amount = Number(amountText);
    const assetType = document.getElementById('send-asset-type').value;
    const customContract = document.getElementById('custom-contract').value.trim();
    const btn = document.getElementById('send-btn');
    const status = document.getElementById('send-status');

    if (!to || !Number.isFinite(amount) || amount <= 0 || !validateRecipient(to, acc)) {
        status.textContent = "Invalid recipient address or amount.";
        status.className = "status-msg error";
        return;
    }

    let targetContract = null;
    let isToken = false;
    if (assetType !== 'native') {
        isToken = true;
        if (assetType === 'custom') {
            if (!customContract) { status.textContent = "Enter custom contract address"; status.className = "status-msg error"; return; }
            targetContract = customContract;
         } else {
            const builtInTokens = TOKENS[acc.chainKey] || {};
            const customTokens = getCustomTokensForChain(acc.chainKey);
            const allTokens = { ...builtInTokens };
            customTokens.forEach(t => { allTokens[t.symbol] = t.contractAddress; });
            const targetContractAddr = allTokens[assetType];
            if (!targetContractAddr) { status.textContent = `Token ${assetType} not supported on ${acc.chainObj.name}`; status.className = "status-msg error"; return; }
            targetContract = targetContractAddr;
        }
    }

    btn.disabled = true;
    status.textContent = "Estimating fees...";
    status.className = "status-msg";

    try {
        const feeData = await getFeeData(acc);
        const balance = await getCurrentBalance(acc, assetType, targetContract);
        const feeEstimate = await estimateFee(acc, assetType, targetContract, amount);

        const confirmData = { to, amount, assetType, isToken, targetContract, fee: feeEstimate, balance, acc };
        openSendConfirmationModal(confirmData, async () => {
            document.getElementById('send-confirm-modal').classList.add('hidden');
            await executeSend(acc, to, amount, assetType, targetContract);
        });
    } catch (e) {
        status.textContent = "Failed: " + e.message;
        status.className = "status-msg error";
        log(e.stack || e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function getCurrentBalance(acc, assetType, contractAddr) {
    if (acc.type === 'evm' && (assetType === 'native' || !contractAddr)) {
        const provider = getWorkingProvider(acc.chainKey, acc.chainObj);
        const rawBal = await withTimeout(provider.getBalance(acc.address), CONSTANTS.RPC_TIMEOUT || 10000).catch((e) => { console.warn(`Balance fetch failed for ${acc.chainObj.name}:`, e.message); return 0n; });
        return Number(window.ethers.formatEther(rawBal));
    }
    if (acc.type === 'evm') {
        const provider = getWorkingProvider(acc.chainKey, acc.chainObj);
        const contract = new window.ethers.Contract(contractAddr, ERC20_ABI, provider);
        const rawBal = await contract.balanceOf(acc.address);
        const decimals = await contract.decimals();
        return Number(window.ethers.formatUnits(rawBal, decimals));
    }
    return acc.nativeBal;
}

async function estimateFee(acc, assetType, contractAddr, amount) {
    if (acc.type === 'evm') {
        const provider = getWorkingProvider(acc.chainKey, acc.chainObj);
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;
        if (assetType === 'native') {
            const gasCost = CONSTANTS.NATIVE_GAS_LIMIT * (gasPrice || 0n);
            return Number(window.ethers.formatEther(gasCost));
        } else {
            const contract = new window.ethers.Contract(contractAddr, ERC20_ABI, provider);
            const decimals = await contract.decimals();
            const amt = window.ethers.parseUnits(amount.toString(), decimals);
            const estimatedGas = await contract.estimateGas.transfer(acc.address, amt);
            const gasCost = estimatedGas * (gasPrice || 0n);
            return Number(window.ethers.formatEther(gasCost));
        }
    }
    if (acc.type === 'solana') return (amount * 0.000005);
    if (acc.type === 'tron') {
        const tw = getTronWeb(acc);
        try {
            const params = await tw.trx.getChainParameters();
            const energyPerByte = Number(params.energyPerByte || 210);
            const free = Math.floor(600 / energyPerByte);
            const need = (assetType === 'native' || !contractAddr) ? 268 : 65000;
            const paid = Math.max(0, need - free);
            const sunPerEnergy = 420;
            return (paid * sunPerEnergy) / CONSTANTS.TRON_SUN_PER_TRX;
        } catch (_) {
            return (assetType === 'native' || !contractAddr) ? 0.1 : 15;
        }
    }
    return 0;
}

function openSendConfirmationModal(confirmData, onConfirm) {
    document.getElementById('sc-from-address').textContent = `${state.vaultData.mnemonics?.length ? 'Mnemonic Account' : 'Imported Key'} • ${confirmData.acc.address}`;
    document.getElementById('sc-to-address').textContent = confirmData.to;
    document.getElementById('sc-amount').textContent = `${formatBalance(confirmData.amount)} ${confirmData.assetType === 'native' ? confirmData.acc.chainObj.symbol : confirmData.assetType.toUpperCase()}`;
    document.getElementById('sc-asset').textContent = confirmData.assetType === 'native' ? `Native ${confirmData.acc.chainObj.symbol}` : confirmData.assetType.toUpperCase();
    document.getElementById('sc-fee').textContent = `≈ ${formatBalance(confirmData.fee, 8)} ${confirmData.acc.chainObj.symbol}`;
    const total = confirmData.assetType === 'native' ? confirmData.amount + confirmData.fee : confirmData.amount;
    document.getElementById('sc-total').textContent = `≈ ${formatBalance(total)} ${confirmData.assetType === 'native' ? confirmData.acc.chainObj.symbol : confirmData.assetType.toUpperCase()}`;
    document.getElementById('sc-balance').textContent = `${formatBalance(confirmData.balance)} ${confirmData.assetType === 'native' ? confirmData.acc.chainObj.symbol : confirmData.assetType.toUpperCase()}`;
    
    const verifyInput = document.getElementById('sc-verify-input');
    const confirmBtn = document.getElementById('sc-confirm-btn');
    const errorEl = document.getElementById('sc-error');

    const canAfford = confirmData.balance >= (confirmData.assetType === 'native' ? (confirmData.amount + confirmData.fee) : confirmData.amount);
    if (!canAfford) {
        errorEl.textContent = "Insufficient balance to cover amount and fees.";
        confirmBtn.disabled = true;
        if (verifyInput) verifyInput.disabled = true;
    } else {
        errorEl.textContent = "";
        confirmBtn.disabled = true;
        if (verifyInput) {
            verifyInput.disabled = false;
            verifyInput.value = '';
            verifyInput.addEventListener('input', () => {
                const match = verifyInput.value.trim() === confirmData.to;
                confirmBtn.disabled = !match;
            }, { once: false });
        }
    }

    window.sendConfirmCallback = onConfirm;
    document.getElementById('send-confirm-modal').classList.remove('hidden');
    if (verifyInput) {
        verifyInput.focus();
        verifyInput.select?.();
    }
}

async function executeSend(acc, to, amount, assetType, targetContract, onStatus) {
    const statusEl = document.getElementById('send-status');
    
    const setMsg = (msg, cls) => {
        if (statusEl) {
            statusEl.textContent = msg;
            statusEl.className = cls;
        }
        if (onStatus) onStatus(msg, cls);
    };
    
    try {
        if (acc.type === 'evm') {
             const provider = getWorkingProvider(acc.chainKey, acc.chainObj);
            let signer;
            try {
                signer = getEvmSigner(acc, provider);
            } catch {
                throw new Error("No key available");
            }
            const senderAddress = await signer.getAddress();

            if (assetType !== 'native') {
                const contract = new window.ethers.Contract(targetContract, ERC20_ABI, signer);
                const decimals = await contract.decimals();
                const amt = window.ethers.parseUnits(amount.toString(), decimals);
                const tokenBalance = await contract.balanceOf(senderAddress);
                if (tokenBalance < amt) throw new Error("Insufficient token balance");
                log(`Sending ${amount} ${assetType.toUpperCase()}...`);
                setMsg(`Sending ${amount} ${assetType.toUpperCase()}...`, 'status-msg');
                const tx = await contract.transfer(to, amt);
                addTransactionHistory({
                    type: 'send', chainKey: acc.chainKey, asset: assetType, amount,
                    txHash: tx.hash, to, from: senderAddress, status: 'pending'
                });
                await tx.wait();
                addTransactionHistory({
                    type: 'send', chainKey: acc.chainKey, asset: assetType, amount,
                    txHash: tx.hash, to, from: senderAddress, status: 'confirmed'
                });
                log(`Tx Hash: ${tx.hash}`, 'success');
                setMsg(`Success! Tx confirmed: ${tx.hash.slice(0, 10)}...`, 'status-msg success');
            } else {
                const value = window.ethers.parseEther(amount.toString());
                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;
                const gasCost = CONSTANTS.NATIVE_GAS_LIMIT * (gasPrice || 0n);
                const balance = await provider.getBalance(senderAddress);
                if (balance < value + gasCost) throw new Error("Insufficient native balance for amount and network fee");
                const tx = {
                    to, value, gasLimit: CONSTANTS.NATIVE_GAS_LIMIT, chainId: acc.chainObj.chainId,
                    ...(feeData.maxFeePerGas && feeData.maxPriorityFeePerGas
                        ? { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas }
                        : { gasPrice: feeData.gasPrice })
                };
                setMsg(`Sending ${amount} ${acc.chainObj.symbol}...`, 'status-msg');
                const txResp = await signer.sendTransaction(tx);
                addTransactionHistory({
                    type: 'send', chainKey: acc.chainKey, asset: 'native', amount,
                    txHash: txResp.hash, to, from: senderAddress, status: 'pending'
                });
                await txResp.wait();
                addTransactionHistory({
                    type: 'send', chainKey: acc.chainKey, asset: 'native', amount,
                    txHash: txResp.hash, to, from: senderAddress, status: 'confirmed'
                });
                log(`Tx Hash: ${txResp.hash}`, 'success');
                setMsg(`Success! Tx confirmed: ${txResp.hash.slice(0, 10)}...`, 'status-msg success');
            }
        } else if (acc.type === 'solana') {
            if (assetType !== 'native') throw new Error("SPL Token sending not implemented in this demo.");
            const kp = await getSolanaKeypair(acc);
            if (!kp) throw new Error("No Solana key available");
            const conn = new window.solana.web3.Connection(getWorkingRpcForChain('solana', CHAINS.solana));
            const dest = new window.solana.web3.PublicKey(to);
            const lamports = Math.floor(amount * window.solana.web3.LAMPORTS_PER_SOL);
            const tx = new window.solana.web3.Transaction().add(
                window.solana.web3.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: dest, lamports })
            );
            const { blockhash } = await conn.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.feePayer = kp.publicKey;
            setMsg(`Sending ${amount} SOL...`, 'status-msg');
            const sig = await window.solana.web3.sendAndConfirmTransaction(conn, tx, [kp]);
            addTransactionHistory({
                type: 'send', chainKey: acc.chainKey, asset: 'native', amount,
                txHash: sig, to, from: kp.publicKey.toBase58(), status: 'pending'
            });
            log(`Signature: ${sig}`, 'success');
            setMsg(`Success! Signature: ${sig.slice(0, 10)}...`, 'status-msg success');
        } else if (acc.type === 'tron') {
            const tw = getTronWeb(acc);
            if (!tw) throw new Error("No Tron key available");
            
            if (assetType !== 'native') {
                const contract = await tw.contract(TRC20_ABI).at(targetContract);
                const cacheKey = `tron:${targetContract}`;
                let dec = tokenDecimalsCache[cacheKey];
                if (dec === undefined) {
                    dec = Number(await contract.decimals().call());
                    if (!Number.isFinite(dec) || dec < 0 || dec > 30) dec = 6;
                    tokenDecimalsCache[cacheKey] = dec;
                }
                const amt = BigInt(Math.floor(amount * Math.pow(10, dec))).toString();
                setMsg(`Sending ${amount} token...`, 'status-msg');
                const tx = await contract.transfer(to, amt).send();
                addTransactionHistory({
                    type: 'send', chainKey: acc.chainKey, asset: assetType, amount,
                    txHash: tx, to, from: acc.address, status: 'pending'
                });
                log(`Tx ID: ${tx}`, 'success');
                setMsg(`Success! Tx ID: ${tx.slice(0, 10)}...`, 'status-msg success');
            } else {
                const suns = Math.floor(amount * CONSTANTS.TRON_SUN_PER_TRX);
                setMsg(`Sending ${amount} TRX...`, 'status-msg');
                const tx = await tw.trx.sendTransaction(to, suns);
                if (!tx.result) throw new Error("Broadcast failed");
                addTransactionHistory({
                    type: 'send', chainKey: acc.chainKey, asset: 'native', amount,
                    txHash: tx.txID, to, from: acc.address, status: 'pending'
                });
                log(`Tx ID: ${tx.txID}`, 'success');
                setMsg(`Success! Tx ID: ${tx.txID.slice(0, 10)}...`, 'status-msg success');
            }
        }

        scanAllBalances();
        showToast('Transaction submitted', 'success');
    } catch (e) {
        setMsg("Failed: " + e.message, 'status-msg error');
        log(e.stack || e.message, 'error');
        showToast('Transaction failed: ' + e.message, 'error');
    }
}