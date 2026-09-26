/* transactions.js — transaction history, export/import, confirmation polling */

async function exportTransactionHistory() {
    const history = state.vaultData?.txHistory || [];
    if (history.length === 0) {
        showToast('No transactions to export', 'warning');
        return;
    }
    
    const csvRows = [];
    csvRows.push('Date,Chain,Type,Asset,Amount,From,To,Tx Hash,Status');
    
    for (const tx of history) {
        const date = new Date(tx.timestamp).toISOString();
        const chain = tx.chainKey ? CHAINS[tx.chainKey]?.name || tx.chainKey : 'Unknown';
        const fromDisplay = tx.from || '';
        const toDisplay = tx.to || '';
        csvRows.push([date, chain, tx.type || '', tx.asset || '', tx.amount || '', fromDisplay, toDisplay, tx.txHash || '', tx.status || ''].join(','));
    }
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omni-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Transaction history exported', 'success');
}

function renderTransactionHistory() {
    const tbody = document.getElementById('history-tbody');
    const empty = document.getElementById('history-empty');
    if (!tbody) return;
    
    const history = state.vaultData?.txHistory || [];
    const chainFilter = document.getElementById('history-chain-filter')?.value || 'all';
    const typeFilter = document.getElementById('history-type-filter')?.value || 'all';
    const searchTerm = (document.getElementById('history-search')?.value || '').toLowerCase();
    
    let filtered = history.filter(tx => {
        if (chainFilter !== 'all' && tx.chainKey !== chainFilter) return false;
        if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
        if (searchTerm && !(tx.txHash?.toLowerCase().includes(searchTerm) || tx.from?.toLowerCase().includes(searchTerm) || tx.to?.toLowerCase().includes(searchTerm))) return false;
        return true;
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        return;
    }
    
    if (empty) empty.classList.add('hidden');
    
    tbody.innerHTML = filtered.map(tx => {
        const chain = tx.chainKey ? CHAINS[tx.chainKey] : null;
        const date = new Date(tx.timestamp).toLocaleString();
        const statusColor = tx.status === 'confirmed' ? 'var(--success)' : tx.status === 'pending' ? 'var(--warning)' : 'var(--error)';
        const statusIcon = tx.status === 'confirmed' ? '✓' : tx.status === 'pending' ? '…' : '✗';
        const typeLabel = tx.type === 'send' ? 'Sent' : tx.type === 'receive' ? 'Received' : tx.type === 'sign' ? 'Signed' : tx.type;
        
        return `<tr>
            <td class="mono">${date}</td>
            <td>${chain ? chain.name : tx.chainKey || 'Unknown'}</td>
            <td>${typeLabel}</td>
            <td>${tx.asset === 'native' ? chain?.symbol || 'Native' : tx.asset || '—'}</td>
            <td class="mono">${tx.amount ? formatBalance(tx.amount, 6) : '—'}</td>
            <td class="mono">${tx.from ? tx.from.slice(0, 8) + '...' + tx.from.slice(-6) : '—'}</td>
            <td class="mono">${tx.to ? (tx.to.slice(0, 8) + '...' + tx.to.slice(-6)) : tx.type === 'sign' ? 'Message' : '—'}</td>
            <td class="mono">${tx.txHash ? tx.txHash.slice(0, 10) + '...' : '—'}</td>
            <td><span style="color: ${statusColor}">${statusIcon} ${tx.status}</span></td>
        </tr>`;
    }).join('');
    
    updateHistoryFilters();
}

function updateHistoryFilters() {
    const tbody = document.getElementById('history-tbody');
    const empty = document.getElementById('history-empty');
    if (tbody) {
        const hasRows = tbody.children.length > 0;
        if (hasRows) {
            empty?.classList.add('hidden');
        }
    }
    
    const countEl = document.querySelector('#tab-activity .count-badge');
    const count = tbody?.children.length || 0;
    if (countEl) {
        countEl.textContent = count;
    }
}

function populateHistoryChainFilter() {
    const select = document.getElementById('history-chain-filter');
    if (!select) return;
    
    select.innerHTML = '<option value="all">All Chains</option>';
    Object.entries(CHAINS).forEach(([key, chain]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = chain.name;
        select.appendChild(opt);
    });
}

async function pollTransactionStatus() {
    if (!state.vaultData?.txHistory) return;
    
    const pending = state.vaultData.txHistory.filter(tx => tx.status === 'pending');
    if (pending.length === 0) return;
    
    await Promise.all(pending.map(async (tx) => {
        try {
            const chain = CHAINS[tx.chainKey];
            if (!chain) return;
            
            if (chain.kind === 'evm') {
                const provider = getWorkingProvider(tx.chainKey, chain);
                const receipt = await provider.getTransactionReceipt(tx.txHash);
                if (receipt) {
                    tx.status = receipt.status === 1 ? 'confirmed' : 'failed';
                    persistVault();
                }
            } else if (chain.kind === 'solana') {
                const conn = new window.solana.web3.Connection(getWorkingRpcForChain(tx.chainKey, chain));
                const sig = await conn.getSignatureStatuses([tx.txHash]);
                if (sig?.value?.[0]?.confirmationStatus === 'finalized') {
                    tx.status = 'confirmed';
                    persistVault();
                }
            } else if (chain.kind === 'tron') {
                const tw = new window.TronWeb({ fullHost: getWorkingRpcForChain(tx.chainKey, chain) });
                const info = await tw.trx.getTransactionInfoById(tx.txHash);
                if (info && info.blockTimestamp) {
                    tx.status = 'confirmed';
                    persistVault();
                }
            }
        } catch (e) {
            console.warn("Polling error:", e);
        }
    }));
    
    renderTransactionHistory();
}

let historyFetchController = null;

async function fetchEvmHistory(address, chainObj, signal) {
    const txs = [];
    try {
        const apiKey = CONSTANTS.NETWORK_API_KEY || 'YourApiKeyToken';
        const url = `${chainObj.explorerApi}?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=100&apikey=${apiKey}`;
        const resp = await fetch(url, { signal });
        if (!resp.ok) return [];
        const data = await resp.json();
        if (data.status !== '1' || !data.result) {
            log(`History API returned status ${data.status} for ${chainObj.name}. ${data.message || ''}`, 'info');
            return [];
        }
        for (const entry of data.result) {
            const from = (entry.from || '').toLowerCase();
            const to = (entry.to || '').toLowerCase();
            const isSend = from === address.toLowerCase();
            const value = entry.value ? Number(window.ethers.formatEther(entry.value)) : 0;
            txs.push({
                chainKey: Object.keys(CHAINS).find(k => CHAINS[k] === chainObj) || null,
                txHash: entry.hash,
                from: entry.from || '',
                to: entry.to || '',
                amount: value,
                type: isSend ? 'send' : 'receive',
                asset: 'native',
                status: entry.isError === '1' ? 'failed' : (entry.txreceipt_status === '1' ? 'confirmed' : 'pending'),
                timestamp: entry.timeStamp ? parseInt(entry.timeStamp) * 1000 : Date.now()
            });
        }
    } catch (e) {
        if (e.name !== 'AbortError') console.warn("EVM history fetch error:", e);
    }
    return txs;
}

async function fetchSolanaHistory(address) {
    const txs = [];
    try {
        const conn = new window.solana.web3.Connection(getWorkingRpcForChain('solana', CHAINS.solana), 30000);
        const signatures = await conn.getConfirmedSignaturesForAddress2(
            new window.solana.web3.PublicKey(address),
            { limit: 50 }
        );
        for (const sig of signatures) {
            const tx = await conn.getTransaction(sig.signature, { commitment: 'confirmed', maxSlots: 1024 });
            if (!tx) continue;
            txs.push({
                chainKey: 'solana',
                chainObj: CHAINS.solana,
                txHash: sig.signature,
                from: tx.transaction?.message?.accountKeys?.[0]?.toBase58() || '',
                to: tx.transaction?.message?.accountKeys?.[1]?.toBase58() || '',
                amount: 0,
                type: 'sign',
                asset: 'native',
                status: 'confirmed',
                timestamp: (sig.blockTime || tx.blockTime || 0) * 1000
            });
        }
    } catch (e) {
        console.warn("Solana history fetch error:", e);
    }
    return txs;
}

async function fetchTronHistory(address, signal) {
    const txs = [];
    try {
        const apiKey = CONSTANTS.TRONGRID_KEY || '';
        const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {};
        const baseUrl = CHAINS.tron.explorerApi || 'https://api.trongrid.io/v1';
        const url = `${baseUrl}/accounts/${address}/transactions?limit=50&sort=-timestamp`;
        const resp = await fetch(url, { headers, signal });
        if (!resp.ok) return [];
        const data = await resp.json();
        if (!data.data) return [];
        for (const entry of data.data) {
            const from = entry.owner_address || '';
            const to = entry.to_address || '';
            const isSend = from === address;
            const amount = entry.amount || 0;
            const isTrc20 = entry.tokenTransfer;
            txs.push({
                chainKey: 'tron',
                chainObj: CHAINS.tron,
                txHash: entry.tx_id || '',
                from: from || '',
                to: to || '',
                amount: amount / CONSTANTS.TRON_SUN_PER_TRX,
                type: isSend ? 'send' : 'receive',
                asset: isTrc20 ? (entry.tokenStd || 'token') : 'native',
                status: 'confirmed',
                timestamp: entry.timestamp || 0
            });
        }
    } catch (e) {
        if (e.name !== 'AbortError') console.warn("Tron history fetch error:", e);
    }
    return txs;
}

async function fetchAccountHistory(acc, signal) {
    if (!acc.address) return [];
    try {
        if (acc.type === 'evm') {
            return await fetchEvmHistory(acc.address, acc.chainObj, signal);
        } else if (acc.type === 'solana') {
            return await fetchSolanaHistory(acc.address);
        } else if (acc.type === 'tron') {
            return await fetchTronHistory(acc.address, signal);
        }
    } catch (e) {
        console.warn("Account history fetch error:", e);
    }
    return [];
}

async function fetchTransactionHistory() {
    if (!state.vaultData) return;
    if (!state.vaultData.txHistory) state.vaultData.txHistory = [];
    
    const controller = new AbortController();
    const prevController = historyFetchController;
    historyFetchController = controller;
    if (prevController) prevController.abort();
    
    const existingHashes = new Set(state.vaultData.txHistory.map(tx => tx.txHash));
    const newTxs = [];
    
    const visibleAccounts = getActiveAccounts().filter(a => {
        if (!a.address) return false;
        return true;
    });
    
    log('Fetching on-chain transaction history...', 'info');
    
    await mapLimit(visibleAccounts, Math.max(2, Math.floor(scanConcurrency() / 2)), async (acc) => {
        const txs = await fetchAccountHistory(acc, controller.signal);
        txs.forEach(tx => {
            if (!existingHashes.has(tx.txHash) && tx.txHash) {
                existingHashes.add(tx.txHash);
                newTxs.push(tx);
            }
        });
    });
    
    if (newTxs.length > 0) {
        state.vaultData.txHistory.unshift(...newTxs);
        state.vaultData.txHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        persistVault();
        log(`Found ${newTxs.length} new transactions`, 'success');
    } else {
        log('No new transactions found', 'info');
    }
    
    renderTransactionHistory();
}

window.fetchTransactionHistory = fetchTransactionHistory;

function initTransactions() {
    populateHistoryChainFilter();
    
    const refreshBtn = document.getElementById('refresh-history-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            await fetchTransactionHistory();
            refreshBtn.disabled = false;
            showToast('History refreshed', 'success');
        });
    }
    
    const exportBtn = document.getElementById('export-history-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportTransactionHistory);
    }
    
    const chainFilter = document.getElementById('history-chain-filter');
    if (chainFilter) {
        chainFilter.addEventListener('change', renderTransactionHistory);
    }
    
    const typeFilter = document.getElementById('history-type-filter');
    if (typeFilter) {
        typeFilter.addEventListener('change', renderTransactionHistory);
    }
    
    const searchInput = document.getElementById('history-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(renderTransactionHistory, 300));
    }
    
    setInterval(pollTransactionStatus, 15000);
}

function debounce(fn, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}