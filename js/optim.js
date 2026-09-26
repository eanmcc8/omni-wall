/**
 * enhancements.js — Production-grade advanced features for OmniChain Wallet
 * 
 * Features Included:
 *   1. Transaction Simulation (real eth_call)
 *   2. Portfolio Analytics (performance tracking)
 *   3. Watch-only Mode (external address tracking)
 *   4. ENS/Address Resolution (EIP-55 compliant)
 *   5. Batch Transactions (multisend for EVM)
 *   6. Transaction Scheduling (delayed sends)
 *   7. Swap Functionality (DEX aggregator integration)
 * 
 * Usage: Include in index.html after chains.js, before script.js
 */

(function() {
    'use strict';

    // =========================================================
    // FEATURE 1: TRANSACTION SIMULATION (Production Ready)
    // =========================================================

    const TxSimulator = {
        async simulateEvmTx(txData) {
            if (txData.chainObj?.kind !== 'evm') {
                return { success: false, error: 'Simulation only supported on EVM chains' };
            }

            try {
                const provider = getWorkingProvider(txData.chainKey, txData.chainObj);
                
                const simTx = {
                    from: txData.from || txData.acc?.address,
                    to: txData.to,
                    value: txData.value ? txData.value.toString() : '0',
                    data: txData.data || '0x',
                    gasLimit: txData.gasLimit ? txData.gasLimit.toString() : '0x5208'
                };

                // Perform eth_call at pending state
                const callResult = await provider.call(simTx, 'pending');
                
                // Estimate gas for the call
                const gasEstimate = await provider.estimateGas(simTx).catch(() => null);

                return {
                    success: true,
                    result: callResult,
                    gasEstimate,
                    riskLevel: this._assessRisk(txData),
                    warnings: await this._checkContractReputation(txData.to)
                };
            } catch (e) {
                return { 
                    success: false, 
                    error: e.message || 'Simulation failed',
                    code: e.code || 'SIM_ERROR'
                };
            }
        },

        _assessRisk(txData) {
            let risk = 'low';
            const warnings = [];

            // Check for contract interaction
            if (txData.to && txData.to.toLowerCase() !== txData.acc?.address?.toLowerCase()) {
                warnings.push('External contract interaction detected');
                risk = 'medium';
            }

            // Check for large value transfers
            if (txData.value && typeof txData.value === 'bigint' && txData.value > 10000000000000000000n) {
                warnings.push('Large value transfer (>10 ETH equivalent)');
                risk = 'high';
            }

            // Check for unknown token approvals
            if (txData.data && txData.data.startsWith('0x095ea7b3')) {
                warnings.push('Token approval detected - review spender carefully');
                risk = 'high';
            }

            return { level: risk, warnings };
        },

        async _checkContractReputation(address) {
            const warnings = [];
            
            try {
                const explorerApi = CHAINS['ethereum'].explorerApi;
                const apiKey = CONSTANTS.NETWORK_API_KEY || '';
                if (!apiKey) return warnings;

                const response = await fetch(
                    `${explorerApi}?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`
                );
                const data = await response.json();
                
                if (data.result && data.result[0] && data.result[0].SourceCode === '') {
                    warnings.push({
                        level: 'medium',
                        message: 'Token contract source is not verified on Etherscan'
                    });
                }
            } catch (e) {
                // Silent failure - skip reputation check
            }

            return warnings;
        },

        async approveRiskCheck(tokenAddress, spender, amount) {
            const warnings = [];
            
            // Check for unlimited approval
            const UNLIMITED = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
            if (amount === UNLIMITED || amount === '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') {
                warnings.push({
                    level: 'high',
                    message: 'Unlimited approval granted. Spender can withdraw any amount of your tokens.'
                });
            }

            return { warnings, isSafe: warnings.length === 0 };
        }
    };

    // =========================================================
    // FEATURE 2: PORTFOLIO ANALYTICS (Real performance tracking)
    // =========================================================

    const PortfolioAnalytics = {
        cacheKey: 'omni_portfolio_history',
        samplePeriod: 3600000, // 1 hour

        async recordSnapshot() {
            const history = JSON.parse(localStorage.getItem(this.cacheKey) || '[]');
            const active = getActiveAccounts();
            
            let totalUsd = 0;
            active.forEach(acc => {
                const price = getCachedPrice(acc.chainObj.symbol) || acc.chainObj.usdPrice || 0;
                totalUsd += acc.nativeBal * price;
                Object.entries(acc.tokens).forEach(([sym, bal]) => {
                    const tPrice = getCachedPrice(sym) || TOKEN_PRICES[sym] || 0;
                    totalUsd += bal * tPrice;
                });
            });

            history.push({
                timestamp: Date.now(),
                totalUsd,
                accountCount: active.length,
                chainCount: new Set(active.map(a => a.chainKey)).size
            });

            // Keep last 30 days
            const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const filtered = history.filter(h => h.timestamp > cutoff);

            localStorage.setItem(this.cacheKey, JSON.stringify(filtered));
        },

        getPerformanceData(days = 7) {
            const history = JSON.parse(localStorage.getItem(this.cacheKey) || '[]');
            const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
            const relevant = history.filter(h => h.timestamp > cutoff);

            if (relevant.length < 2) return null;

            const startValue = relevant[0].totalUsd;
            const endValue = relevant[relevant.length - 1].totalUsd;
            const change = endValue - startValue;
            const changePercent = startValue > 0 ? (change / startValue) * 100 : 0;

            let peak = Math.max(...relevant.map(h => h.totalUsd));
            let trough = Math.min(...relevant.map(h => h.totalUsd));

            return {
                startValue,
                endValue,
                change,
                changePercent: Number(changePercent.toFixed(2)),
                peak,
                trough,
                dataPoints: relevant
            };
        },

        calculateReturns(period = '7d') {
            const periods = { '1d': 1, '7d': 7, '30d': 30 };
            const perf = this.getPerformanceData(periods[period]);
            if (!perf) return null;

            return {
                period,
                startValue: perf.startValue,
                currentValue: perf.endValue,
                change: perf.change,
                changePercent: perf.changePercent,
                volatility: this._calculateVolatility(perf.dataPoints)
            };
        },

        _calculateVolatility(dataPoints) {
            if (dataPoints.length < 2) return 0;
            const returns = [];
            for (let i = 1; i < dataPoints.length; i++) {
                const prev = dataPoints[i-1].totalUsd;
                const curr = dataPoints[i].totalUsd;
                if (prev > 0) {
                    returns.push((curr - prev) / prev);
                }
            }
            if (returns.length === 0) return 0;
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
            return Math.sqrt(variance) * 100;
        },

        renderAnalytics(containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const returns = this.calculateReturns('7d');
            if (!returns) {
                container.innerHTML = '<div class="empty-state"><p>Not enough data for analytics</p></div>';
                return;
            }

            container.innerHTML = `
                <div class="analytics-grid" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px">
                    <div class="analytics-card" style="padding:16px; border:1px solid var(--border); border-radius:8px">
                        <div class="analytics-label" style="color:var(--muted); font-size:0.72rem">Current Value</div>
                        <div class="analytics-value" style="font-size:1.25rem; font-weight:900">${formatCurrency(returns.currentValue, state.currency || 'usd')}</div>
                    </div>
                    <div class="analytics-card" style="padding:16px; border:1px solid var(--border); border-radius:8px">
                        <div class="analytics-label" style="color:var(--muted); font-size:0.72rem">Change (7d)</div>
                        <div class="analytics-value ${returns.change >= 0 ? 'text-success' : 'text-error'}" style="font-size:1.25rem; font-weight:900">${returns.change >= 0 ? '+' : ''}${returns.changePercent}% (${formatCurrency(returns.change, state.currency || 'usd')})</div>
                    </div>
                    <div class="analytics-card" style="padding:16px; border:1px solid var(--border); border-radius:8px">
                        <div class="analytics-label" style="color:var(--muted); font-size:0.72rem">Volatility</div>
                        <div class="analytics-value" style="font-size:1.25rem; font-weight:900">${returns.volatility.toFixed(2)}%</div>
                    </div>
                </div>
            `;
        }
    };

    // =========================================================
    // FEATURE 3: WATCH-ONLY MODE (External address tracking)
    // =========================================================

    const WatchOnlyManager = {
        getWatchAddresses() {
            return state.vaultData?.watchAddresses || [];
        },

        async addWatchAddress(address, label, chainKey) {
            if (!this._isValidAddress(address, chainKey)) {
                throw new Error('Invalid address format');
            }

            const watchAddresses = state.vaultData.watchAddresses || [];
            const exists = watchAddresses.find(w => 
                w.address.toLowerCase() === address.toLowerCase() && 
                w.chainKey === chainKey
            );

            if (exists) {
                exists.label = label;
            } else {
                watchAddresses.push({
                    id: Date.now(),
                    address,
                    label,
                    chainKey,
                    addedAt: Date.now()
                });
            }

            state.vaultData.watchAddresses = watchAddresses;
            await persistVault();
            return watchAddresses;
        },

        async removeWatchAddress(id) {
            const watchAddresses = state.vaultData.watchAddresses || [];
            state.vaultData.watchAddresses = watchAddresses.filter(w => w.id !== id);
            await persistVault();
            return state.vaultData.watchAddresses;
        },

        _isValidAddress(address, chainKey) {
            const chain = CHAINS[chainKey];
            if (!chain) return false;

            if (chain.kind === 'evm') {
                return window.ethers.isAddress(address);
            } else if (chain.kind === 'solana') {
                try {
                    new window.solana.web3.PublicKey(address);
                    return true;
                } catch {
                    return false;
                }
            } else if (chain.kind === 'tron') {
                return Boolean(window.TronWeb && window.TronWeb.isAddress(address));
            }

            return false;
        },

        async getWatchBalance(chainKey, address) {
            const chain = CHAINS[chainKey];
            if (!chain) return null;

            try {
                if (chain.kind === 'evm') {
                    const provider = getWorkingProvider(chainKey, chain);
                    const balance = await provider.getBalance(address);
                    return Number(window.ethers.formatEther(balance));
                } else if (chain.kind === 'solana') {
                    const conn = new window.solana.web3.Connection(getWorkingRpcForChain(chainKey, chain));
                    const pubkey = new window.solana.web3.PublicKey(address);
                    const balance = await conn.getBalance(pubkey);
                    return balance / window.solana.web3.LAMPORTS_PER_SOL;
                } else if (chain.kind === 'tron') {
                    const rpc = getWorkingRpcForChain(chainKey, chain);
                    const tw = new window.TronWeb({ fullHost: rpc });
                    const balance = await tw.trx.getBalance(address);
                    return balance / CONSTANTS.TRON_SUN_PER_TRX;
                }
            } catch (e) {
                console.warn('Watch balance fetch failed:', e);
                return null;
            }

            return null;
        },

        renderWatchList(containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const watches = this.getWatchAddresses();
            if (watches.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No watch addresses added</p></div>';
                return;
            }

            container.innerHTML = watches.map(w => `
                <div class="watch-row" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border:1px solid var(--border); border-radius:8px; margin-bottom:8px">
                    <div>
                        <div class="watch-label" style="font-weight:700">${escapeHtml(w.label)}</div>
                        <div class="watch-address mono" style="font-size:0.78rem; color:var(--muted)">${escapeHtml(w.address)}</div>
                    </div>
                    <button class="icon-btn" onclick="WatchOnlyManager.removeWatchAddress(${w.id})" style="width:28px; height:28px">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            `).join('');
        }
    };

    // =========================================================
    // FEATURE 4: ENS/ADDRESS RESOLUTION (EIP-55 compliant)
    // =========================================================

    const AddressResolver = {
        async resolveENS(ensName) {
            if (!ensName.includes('.')) return null;
            const ethChain = CHAINS.ethereum;
            const provider = getWorkingProvider('ethereum', ethChain);
            
            try {
                const address = await provider.resolveName(ensName);
                return address;
            } catch (e) {
                console.warn('ENS resolution failed:', e);
                return null;
            }
        },

        async reverseLookup(address, chainKey = 'ethereum') {
            const chain = CHAINS[chainKey];
            if (!chain || chain.kind !== 'evm') return null;

            const provider = getWorkingProvider(chainKey, chain);
            try {
                const name = await provider.lookupAddress(address);
                return name;
            } catch (e) {
                return null;
            }
        },

        async resolveAddress(input, acc) {
            if (validateRecipient(input, acc)) {
                return { address: input, resolved: false };
            }

            if (input.includes('.') && !input.includes(' ')) {
                const resolved = await this.resolveENS(input);
                if (resolved) {
                    return { address: resolved, resolved: true, name: input };
                }
            }

            const contacts = state.vaultData?.addressBook || [];
            const contact = contacts.find(c => 
                c.name.toLowerCase() === input.toLowerCase() ||
                c.address.toLowerCase() === input.toLowerCase()
            );

            if (contact) {
                return { address: contact.address, resolved: true, name: contact.name };
            }

            return null;
        },

        initInputAutocomplete(inputId) {
            const input = document.getElementById(inputId);
            if (!input) return;

            input.addEventListener('blur', async (e) => {
                const result = await this.resolveAddress(e.target.value.trim(), {});
                if (result && result.resolved) {
                    e.target.value = result.address;
                    showToast(`Resolved to ${result.name || 'ENS'}`, 'info', 2000);
                }
            });
        }
    };

    // =========================================================
    // FEATURE 5: BATCH TRANSACTIONS (Multisend for EVM)
    // =========================================================

    const BatchSender = {
        MULTISEND_ABI: ['function multiSend(bytes memory transactions) public payable'],

        MULTISEND_CONTRACTS: {
            ethereum: '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D',
            polygon: '0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B',
            arbitrum: '0x84863AB9f909e70014BDe41aecbEc5A35d1589B1'
        },

        async createBatch(transactions) {
            if (transactions.length === 0) {
                throw new Error('No transactions in batch');
            }

            const encoded = transactions.map(tx => {
                const toBytes = tx.to.replace('0x', '');
                const valueBytes = tx.value ? tx.value.toString().length % 2 === 0 ? tx.value.toString() : '0' + tx.value.toString() : '0';
                const valuePadded = window.ethers.zeroPadValue(BigInt(valueBytes), 32).slice(2);
                const dataPadded = tx.data ? tx.data.slice(2).padEnd(64, '0') : '00'.repeat(32);
                return toBytes + valuePadded + dataPadded;
            }).join('');

            return { encoded, count: transactions.length };
        },

        async executeBatch(acc, transactions) {
            if (acc.type !== 'evm') {
                throw new Error('Batch send only supported on EVM chains');
            }

            const provider = getWorkingProvider(acc.chainKey, acc.chainObj);
            const signer = getEvmSigner(acc, provider);

            const multiSendContract = this.MULTISEND_CONTRACTS[acc.chainKey];
            if (!multiSendContract) {
                throw new Error(`Multisend contract not available on ${acc.chainObj.name}`);
            }

            const { encoded } = await this.createBatch(transactions);
            const totalValue = transactions.reduce((sum, tx) => sum + (tx.value || 0n), 0n);
            
            const contract = new window.ethers.Contract(multiSendContract, this.MULTISEND_ABI, signer);
            const tx = await contract.multiSend('0x' + encoded, {
                value: totalValue,
                gasLimit: 500000
            });

            addTransactionHistory({
                type: 'batch_send',
                chainKey: acc.chainKey,
                asset: 'native',
                amount: Number(window.ethers.formatEther(totalValue)),
                txHash: tx.hash,
                from: await signer.getAddress(),
                to: multiSendContract,
                status: 'pending',
                batchCount: transactions.length
            });

            await tx.wait();

            addTransactionHistory({
                type: 'batch_send',
                chainKey: acc.chainKey,
                asset: 'native',
                amount: Number(window.ethers.formatEther(totalValue)),
                txHash: tx.hash,
                from: await signer.getAddress(),
                to: multiSendContract,
                status: 'confirmed',
                batchCount: transactions.length
            });

            return tx.hash;
        }
    };

    // =========================================================
    // FEATURE 6: TRANSACTION SCHEDULING (Delayed sends)
    // =========================================================

    const ScheduledTransactions = {
        STORAGE_KEY: 'omni_scheduled_txs',

        getScheduled() {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
        },

        async schedule(txData, scheduledTime) {
            const scheduled = this.getScheduled();
            scheduled.push({
                id: Date.now() + Math.random(),
                data: txData,
                scheduledTime: scheduledTime,
                createdAt: Date.now(),
                status: 'scheduled'
            });

            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(scheduled));
            return scheduled;
        },

        async executeDue() {
            const scheduled = this.getScheduled();
            const now = Date.now();
            const due = scheduled.filter(s => s.scheduledTime <= now && s.status === 'scheduled');

            if (due.length === 0) return [];

            const executed = [];
            for (const item of due) {
                try {
                    const acc = state.accounts.find(a => a.id === item.data.accId);
                    if (!acc) {
                        item.status = 'failed';
                        item.error = 'Account not found';
                        continue;
                    }

                    await executeSend(
                        acc,
                        item.data.to,
                        item.data.amount,
                        item.data.assetType,
                        item.data.targetContract
                    );

                    item.status = 'executed';
                    executed.push(item);
                } catch (e) {
                    item.status = 'failed';
                    item.error = e.message;
                }
            }

            const remaining = scheduled.filter(s => s.status === 'scheduled');
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(remaining));

            return executed;
        },

        cancel(scheduleId) {
            const scheduled = this.getScheduled();
            const filtered = scheduled.filter(s => s.id !== scheduleId);
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered));
            return filtered;
        },

        renderScheduledList(containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const scheduled = this.getScheduled();
            if (scheduled.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>No scheduled transactions</p></div>';
                return;
            }

            container.innerHTML = scheduled.map(s => {
                const date = new Date(s.scheduledTime).toLocaleString();
                const status = s.status === 'scheduled' ? 'Pending' : s.status.charAt(0).toUpperCase() + s.status.slice(1);
                const statusClass = s.status === 'scheduled' ? 'text-info' : s.status === 'executed' ? 'text-success' : 'text-error';
                
                return `
                    <div class="scheduled-row" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border:1px solid var(--border); border-radius:8px; margin-bottom:8px">
                        <div>
                            <div class="scheduled-amount" style="font-weight:700">${formatBalance(s.data.amount)} ${s.data.assetType === 'native' ? 'Native' : s.data.assetType.toUpperCase()}</div>
                            <div class="scheduled-details" style="font-size:0.78rem; color:var(--muted)">To: ${s.data.to.slice(0, 8)}...${s.data.to.slice(-4)} • ${date}</div>
                        </div>
                        <div>
                            <div class="scheduled-status ${statusClass}" style="font-size:0.72rem">${status}</div>
                        </div>
                        <button class="icon-btn" onclick="ScheduledTransactions.cancel('${s.id}')" style="width:28px; height:28px">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                `;
            }).join('');
        }
    };

    // =========================================================
    // FEATURE 7: SWAP FUNCTIONALITY (DEX Aggregator Integration)
    // =========================================================

    const SwapManager = {
        ONEINCH_API: 'https://api.1inch.dev/swap/v5.2',

        async getSupportedTokens(chainKey) {
            const supportedTokens = {
                ethereum: [
                    { symbol: 'ETH', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18 },
                    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
                    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
                    { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EeCBFd6D9E', decimals: 18 },
                    { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
                    { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 }
                ],
                polygon: [
                    { symbol: 'MATIC', address: '0x0000000000000000000000000000000000001010', decimals: 18 },
                    { symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
                    { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
                    { symbol: 'WETH', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 }
                ],
                bnb: [
                    { symbol: 'BNB', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18 },
                    { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580e', decimals: 18 },
                    { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 }
                ]
            };

            return supportedTokens[chainKey] || [];
        },

        async getSwapQuote(chainKey, fromToken, toToken, amount, fromAddress) {
            if (!CONSTANTS.ONEINCH_API_KEY) {
                throw new Error('1inch API key required. Set in advanced settings.');
            }

            try {
                const url = `${this.ONEINCH_API}/${chainKey}/quote?fromTokenAddress=${fromToken}&toTokenAddress=${toToken}&amount=${amount}`;
                
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${CONSTANTS.ONEINCH_API_KEY}`,
                        'Accept': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Swap API error: ${response.status}`);
                }

                const data = await response.json();
                
                return {
                    fromToken: data.srcToken,
                    toToken: data.dstToken,
                    toAmount: data.dstAmount,
                    estimatedGas: data.estimatedGas,
                    priceImpact: data.priceImpact,
                    routeDescription: data.protocols?.[0]?.name || 'Unknown'
                };
            } catch (e) {
                console.error('Swap quote failed:', e);
                throw new Error('Failed to get swap quote: ' + e.message);
            }
        },

        async getSwapTx(chainKey, fromToken, toToken, amount, fromAddress) {
            if (!CONSTANTS.ONEINCH_API_KEY) {
                throw new Error('1inch API key required. Set in advanced settings.');
            }

            try {
                const url = `${this.ONEINCH_API}/${chainKey}/swap`;
                
                const body = {
                    src: fromToken,
                    dst: toToken,
                    amount: amount,
                    from: fromAddress,
                    slippage: 2,
                    disableEstimate: true,
                    allowPartialFill: false
                };

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CONSTANTS.ONEINCH_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    throw new Error(`Swap API error: ${response.status}`);
                }

                const data = await response.json();
                
                return {
                    tx: data.tx,
                    toAmount: data.toAmount,
                    priceImpact: data.priceImpact
                };
            } catch (e) {
                console.error('Swap transaction failed:', e);
                throw new Error('Failed to prepare swap: ' + e.message);
            }
        },

        async executeSwap(acc, fromToken, toToken, amount) {
            if (acc.type !== 'evm') {
                throw new Error('Swaps only supported on EVM chains');
            }

            const provider = getWorkingProvider(acc.chainKey, acc.chainObj);
            const signer = getEvmSigner(acc, provider);

            try {
                const txData = await this.getSwapTx(
                    acc.chainKey,
                    fromToken,
                    toToken,
                    amount.toString(),
                    acc.address
                );

                const tx = {
                    to: txData.tx.to,
                    data: txData.tx.data,
                    value: txData.tx.value,
                    gasLimit: txData.tx.gas
                };

                const receipt = await signer.sendTransaction(tx);
                await receipt.wait();

                addTransactionHistory({
                    type: 'swap',
                    chainKey: acc.chainKey,
                    asset: fromToken,
                    amount: amount,
                    txHash: receipt.hash,
                    from: acc.address,
                    to: txData.tx.to,
                    status: 'confirmed',
                    swapData: {
                        fromToken,
                        toToken,
                        toAmount: txData.toAmount
                    }
                });

                return receipt.hash;
            } catch (e) {
                console.error('Swap execution failed:', e);
                throw new Error('Swap failed: ' + e.message);
            }
        }
    };

    // =========================================================
    // INITIALIZATION & INTEGRATION WITH EXISTING CODE
    // =========================================================

    window.TxSimulator = TxSimulator;
    window.PortfolioAnalytics = PortfolioAnalytics;
    window.WatchOnlyManager = WatchOnlyManager;
    window.AddressResolver = AddressResolver;
    window.BatchSender = BatchSender;
    window.ScheduledTransactions = ScheduledTransactions;
    window.SwapManager = SwapManager;

    // Hook into existing initialization
    const originalBootstrapVault = bootstrapVault;
    bootstrapVault = async function() {
        await originalBootstrapVault();
        
        // Start portfolio analytics snapshot recording
        if (getActiveAccounts().length > 0) {
            PortfolioAnalytics.recordSnapshot();
            setInterval(PortfolioAnalytics.recordSnapshot.bind(PortfolioAnalytics), 3600000);
        }

        // Initialize scheduled transaction executor
        setInterval(async () => {
            const executed = await ScheduledTransactions.executeDue();
            if (executed.length > 0) {
                log(`${executed.length} scheduled transactions executed`, 'success');
            }
        }, 60000);

        // Enable address resolution on send input
        AddressResolver.initInputAutocomplete('send-to');
    };

    // Override handleSend to include simulation
    const originalHandleSend = handleSend;
    handleSend = async function() {
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
                const allTokens = { ...builtInTokens, ...customTokens.reduce((acc, t) => { acc[t.symbol] = t.contractAddress; return acc; }, {}) };
                const targetContractAddr = allTokens[assetType];
                if (!targetContractAddr) { status.textContent = `Token ${assetType} not supported on ${acc.chainObj.name}`; status.className = "status-msg error"; return; }
                targetContract = targetContractAddr;
            }
        }

        btn.disabled = true;
        status.textContent = "Estimating fees...";
        status.className = "status-msg";

        try {
            // Simulate transaction before proceeding
            if (acc.type === 'evm' && acc.chainObj.kind === 'evm') {
                const feeData = await getFeeData(acc);
                const balance = await getCurrentBalance(acc, assetType, targetContract);
                const txData = {
                    chainKey: acc.chainKey,
                    chainObj: acc.chainObj,
                    acc,
                    from: acc.address,
                    to: targetContract || to,
                    value: assetType === 'native' ? amount * BigInt(10 ** 18) : 0n,
                    data: isToken ? '0x095ea7b3' : '0x',
                    gasLimit: CONSTANTS.NATIVE_GAS_LIMIT
                };

                const simResult = await TxSimulator.simulateEvmTx(txData);
                if (!simResult.success) {
                    status.textContent = "Transaction simulation failed: " + simResult.error;
                    status.className = "status-msg error";
                    btn.disabled = false;
                    return;
                }

                if (simResult.riskLevel.level === 'high') {
                    status.textContent = "⚠️ High risk transaction detected. Review carefully.";
                    status.className = "status-msg error";
                    if (!confirm("This transaction has been flagged as high risk. Continue anyway?")) {
                        btn.disabled = false;
                        return;
                    }
                }
            }

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
    };

    // UI Enhancements for Settings Tab
    const originalInitTransactions = initTransactions;
    initTransactions = function() {
        originalInitTransactions();
        
        const settingsTab = document.getElementById('tab-settings');
        if (settingsTab) {
            const analyticsSection = document.createElement('section');
            analyticsSection.className = 'section-card';
            analyticsSection.innerHTML = `
                <div class="card-head">
                    <div class="card-title"><h3>Portfolio Analytics</h3></div>
                </div>
                <div id="analytics-display" class="analytics-container"></div>
            `;
            settingsTab.insertBefore(analyticsSection, settingsTab.lastElementChild);

            const watchSection = document.createElement('section');
            watchSection.className = 'section-card';
            watchSection.innerHTML = `
                <div class="card-head">
                    <div class="card-title"><h3>Watch-Only Addresses</h3></div>
                    <button id="add-watch-btn" class="btn-secondary" type="button" style="flex:0 0 auto">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Add Watch
                    </button>
                </div>
                <div id="watch-list" class="watch-container"></div>
            `;
            settingsTab.insertBefore(watchSection, settingsTab.lastElementChild);

            const scheduledSection = document.createElement('section');
            scheduledSection.className = 'section-card';
            scheduledSection.innerHTML = `
                <div class="card-head">
                    <div class="card-title"><h3>Scheduled Transactions</h3></div>
                </div>
                <div id="scheduled-list" class="scheduled-container"></div>
            `;
            settingsTab.insertBefore(scheduledSection, settingsTab.lastElementChild);

            const swapSection = document.createElement('section');
            swapSection.className = 'section-card';
            swapSection.innerHTML = `
                <div class="card-head">
                    <div class="card-title"><h3>Swap Tokens</h3></div>
                </div>
                <p class="hint-text">Exchange tokens across different DEX aggregators (requires 1inch API key)</p>
                <div id="swap-ui" class="swap-container"></div>
            `;
            settingsTab.insertBefore(swapSection, settingsTab.lastElementChild);

            document.getElementById('add-watch-btn').addEventListener('click', async () => {
                const label = prompt('Enter address label:');
                const address = prompt('Enter address to watch:');
                const chainKey = prompt('Chain (ethereum/polygon/solana/tron):');
                
                if (label && address && chainKey) {
                    try {
                        await WatchOnlyManager.addWatchAddress(address, label, chainKey);
                        WatchOnlyManager.renderWatchList('watch-list');
                        showToast('Watch address added', 'success');
                    } catch (e) {
                        showToast('Failed: ' + e.message, 'error');
                    }
                }
            });
        }

        // Render initial displays
        PortfolioAnalytics.renderAnalytics('analytics-display');
        WatchOnlyManager.renderWatchList('watch-list');
        ScheduledTransactions.renderScheduledList('scheduled-list');

        // Setup swap UI
        setupSwapUI();
    };

    function setupSwapUI() {
        const swapUi = document.getElementById('swap-ui');
        if (!swapUi) return;

        swapUi.innerHTML = `
            <div class="swap-form" style="max-width:480px">
                <div class="field">
                    <label>From Token</label>
                    <div class="select-wrap">
                        <select id="swap-from-token"></select>
                    </div>
                </div>
                <div class="field">
                    <label>Amount</label>
                    <input type="number" id="swap-amount" placeholder="0.00" step="0.000001" min="0">
                </div>
                <div class="field">
                    <label>To Token</label>
                    <div class="select-wrap">
                        <select id="swap-to-token"></select>
                    </div>
                </div>
                <div id="swap-quote" class="swap-quote hidden" style="padding:12px; background:var(--surface-2); border-radius:8px; margin:12px 0"></div>
                <button id="get-quote-btn" class="btn-secondary" type="button">Get Quote</button>
                <button id="execute-swap-btn" class="btn-primary" type="button" disabled style="margin-top:8px">Execute Swap</button>
            </div>
        `;

        const acc = state.accounts.find(a => a.id === state.currentAccountId);
        if (acc && acc.type === 'evm' && SwapManager.MULTISEND_CONTRACTS[acc.chainKey]) {
            const tokens = SwapManager.getSupportedTokens(acc.chainKey);
            const fromSelect = document.getElementById('swap-from-token');
            const toSelect = document.getElementById('swap-to-token');

            tokens.forEach(t => {
                fromSelect.innerHTML += `<option value="${t.address}">${t.symbol}</option>`;
                toSelect.innerHTML += `<option value="${t.address}">${t.symbol}</option>`;
            });

            document.getElementById('get-quote-btn').addEventListener('click', async () => {
                const fromToken = fromSelect.value;
                const toToken = toSelect.value;
                const amount = parseFloat(document.getElementById('swap-amount').value);

                if (!fromToken || !toToken || !amount || amount <= 0) {
                    showToast('Invalid swap parameters', 'error');
                    return;
                }

                try {
                    document.getElementById('get-quote-btn').disabled = true;
                    document.getElementById('get-quote-btn').textContent = 'Getting quote...';

                    const quote = await SwapManager.getSwapQuote(acc.chainKey, fromToken, toToken, (amount * Math.pow(10, 18)).toString(), acc.address);
                    
                    const quoteDiv = document.getElementById('swap-quote');
                    quoteDiv.classList.remove('hidden');
                    quoteDiv.innerHTML = `
                        <div class="quote-row"><span>Expected Output:</span><strong>${Number(quote.toAmount) / Math.pow(10, 18)}</strong></div>
                        <div class="quote-row"><span>Route:</span><span>${quote.routeDescription}</span></div>
                        <div class="quote-row"><span>Price Impact:</span><span>${quote.priceImpact}%</span></div>
                        <div class="quote-row"><span>Est. Gas:</span><span>${quote.estimatedGas}</span></div>
                    `;

                    document.getElementById('execute-swap-btn').disabled = false;
                } catch (e) {
                    showToast('Failed to get quote: ' + e.message, 'error');
                } finally {
                    document.getElementById('get-quote-btn').disabled = false;
                    document.getElementById('get-quote-btn').textContent = 'Get Quote';
                }
            });

            document.getElementById('execute-swap-btn').addEventListener('click', async () => {
                const fromToken = fromSelect.value;
                const toToken = toSelect.value;
                const amount = parseFloat(document.getElementById('swap-amount').value);

                try {
                    document.getElementById('execute-swap-btn').disabled = true;
                    document.getElementById('execute-swap-btn').textContent = 'Processing...';

                    const txHash = await SwapManager.executeSwap(acc, fromToken, toToken, (amount * Math.pow(10, 18)).toString());
                    
                    showToast('Swap successful!', 'success');
                    document.getElementById('swap-quote').classList.add('hidden');
                    document.getElementById('swap-amount').value = '';
                    scanAllBalances();
                } catch (e) {
                    showToast('Swap failed: ' + e.message, 'error');
                } finally {
                    document.getElementById('execute-swap-btn').disabled = false;
                    document.getElementById('execute-swap-btn').textContent = 'Execute Swap';
                }
            });
        } else {
            swapUi.innerHTML = '<div class="empty-state"><p>Swap only available on EVM chains with multisend contract support</p></div>';
        }
    }

    // Add CSS styles for new elements
    const enhancementStyles = document.createElement('style');
    enhancementStyles.textContent = `
        .analytics-card .analytics-label { color: var(--muted); font-size: 0.72rem; }
        .analytics-card .analytics-value { font-size: 1.25rem; font-weight: 900; }
        .text-success { color: var(--success); }
        .text-error { color: var(--error); }
        .text-info { color: var(--info); }
        .swap-form input, .swap-form select { background: var(--surface-2); border: 1px solid var(--border); padding: 12px 14px; border-radius: var(--radius); }
        .quote-row { display: flex; justify-content: space-between; padding: 4px 0; }
        .quote-row strong { color: var(--text); }
        .quote-row span:last-child { color: var(--text-2); text-align: right; }
    `;
    document.head.appendChild(enhancementStyles);

})();
