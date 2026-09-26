/* network.js — RPC health checks, failover, network status */

function updateNetworkStatus(status) {
    const netPill = document.getElementById('net-pill');
    const statusText = netPill?.querySelector('span:last-child');
    const dot = netPill?.querySelector('.pulse-dot');
    
    if (!netPill) return;
    
    if (status === 'online' || status === 'idle') {
        netPill.classList.remove('status-pill--muted', 'status-pill--scanning', 'status-pill--degraded', 'status-pill--offline');
        netPill.title = "All chains are mainnet";
        if (statusText) statusText.textContent = 'Mainnet';
        if (dot) {
            dot.className = 'pulse-dot pulse-dot--online';
        }
    } else if (status === 'scanning') {
        netPill.classList.remove('status-pill--muted', 'status-pill--degraded', 'status-pill--offline');
        netPill.classList.add('status-pill--scanning');
        netPill.title = "Scanning network";
        if (statusText) statusText.textContent = 'Scanning...';
        if (dot) {
            dot.className = 'pulse-dot pulse-dot--scanning';
        }
    } else if (status === 'offline' || status === 'degraded') {
        netPill.classList.remove('status-pill--online');
        netPill.classList.add('status-pill--muted');
        netPill.title = "Some RPC endpoints may be degraded";
        if (statusText) statusText.textContent = 'Degraded';
        if (dot) {
            dot.className = 'pulse-dot pulse-dot--warning';
        }
    }
}

function updateVaultPill(status) {
    const vaultPill = document.getElementById('vault-pill');
    const vaultText = document.getElementById('vault-pill-text');
    
    if (!vaultPill || !vaultText) return;
    
    vaultPill.classList.remove('status-pill--active', 'status-pill--no-vault');
    
    if (status === 'no-vault' || !hasStoredVault()) {
        vaultPill.classList.add('status-pill--muted');
        vaultPill.classList.add('status-pill--no-vault');
        vaultPill.title = "No vault exists";
        vaultText.textContent = 'No Vault';
    } else {
        vaultPill.classList.remove('status-pill--muted');
        vaultPill.classList.add('status-pill--active');
        const count = (state.vaultData?.mnemonics?.length || 0) + (state.vaultData?.privKeys?.length || 0);
        vaultPill.title = count > 0 ? `Vault active — ${count} seed${count > 1 ? 's' : ''}/key${count > 1 ? 's' : ''}` : "Vault active";
        vaultText.textContent = 'Active';
    }
}

async function checkAllNetworkHealth() {
    const results = await checkNetworkHealth();
    let totalHealthy = 0;
    let total = 0;
    
    Object.entries(results).forEach(([chainKey, rpcs]) => {
        rpcs.forEach(rpc => {
            total++;
            if (rpc.healthy) totalHealthy++;
        });
    });
    
    if (totalHealthy === total) {
        updateNetworkStatus('online');
    } else if (totalHealthy > 0) {
        updateNetworkStatus('degraded');
    } else {
        updateNetworkStatus('offline');
    }
    
    renderNetworkConfig(results);
    return results;
}

function renderNetworkConfig(healthResults) {
    const container = document.getElementById('network-config-list');
    if (!container) return;
    
    let html = '';
    Object.entries(CHAINS).forEach(([chainKey, chain]) => {
        html += `<div class="network-chain-group">`;
        html += `<div class="network-chain-header">`;
        html += `<span class="network-chain-name">${chain.name}</span>`;
        html += `<span class="network-chain-status ${chainKey}-status">--</span>`;
        html += `</div>`;
        
        const rpcs = chain.rpc || [];
        const chainHealth = healthResults[chainKey] || [];
        
        rpcs.forEach((rpc, idx) => {
            const health = chainHealth.find(h => h.rpc === rpc);
            const isHealthy = health ? health.healthy : '-';
            const statusClass = isHealthy === true ? 'healthy' : isHealthy === false ? 'unhealthy' : 'unknown';
            
            html += `<div class="network-rpc-row" data-chain="${chainKey}" data-rpc="${rpc}">`;
            html += `<input type="text" class="rpc-input" value="${rpc}" readonly style="flex:1">`;
            html += `<span class="rpc-status ${statusClass}">${statusClass === 'healthy' ? '✓' : statusClass === 'unhealthy' ? '✗' : '…'}</span>`;
            html += `<button class="rpc-test-btn btn-secondary" type="button" style="flex:0 0 auto; padding:6px 12px">Test</button>`;
            html += `</div>`;
        });
        
        html += `</div>`;
    });
    
    container.innerHTML = html;
    
    container.querySelectorAll('.rpc-test-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
            const row = this.closest('.network-rpc-row');
            const rpc = row.querySelector('.rpc-input').value;
            const chainKey = row.dataset.chain;
            this.disabled = true;
            this.textContent = 'Testing...';
            
            try {
                const isHealthy = await testRpcEndpoint(rpc, chainKey);
                markRpcHealth(rpc, chainKey, isHealthy);
                row.querySelector('.rpc-status').className = `rpc-status ${isHealthy ? 'healthy' : 'unhealthy'}`;
                row.querySelector('.rpc-status').textContent = isHealthy ? '✓' : '✗';
                this.textContent = 'Retest';
                this.disabled = false;
            } catch (e) {
                this.textContent = 'Failed';
                setTimeout(() => { this.textContent = 'Retest'; this.disabled = false; }, 1500);
            }
        });
    });
    
    Object.keys(CHAINS).forEach(chainKey => {
        const chainHealth = healthResults[chainKey] || [];
        const healthyCount = chainHealth.filter(h => h.healthy).length;
        const statusEl = document.querySelector(`.${chainKey}-status`);
        if (statusEl) {
            statusEl.textContent = healthyCount > 0 ? `${healthyCount} RPC${healthyCount > 1 ? 's' : ''} online` : 'All offline';
            statusEl.classList.toggle('rpc-status-healthy', healthyCount > 0);
            statusEl.classList.toggle('rpc-status-unhealthy', healthyCount === 0);
        }
    });
}

async function testRpcEndpoint(rpc, chainKey) {
    const chain = CHAINS[chainKey];
    if (!chain) return false;
    
    try {
        if (chain.kind === 'evm') {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetchWithTimeout(rpc, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'eth_blockNumber',
                        params: [],
                        id: Date.now()
                    })
                });
                clearTimeout(timeoutId);
                if (!response.ok) return false;
                const data = await response.json();
                return !data.error && data.result;
            } catch (e) {
                clearTimeout(timeoutId);
                return false;
            }
        } else if (chain.kind === 'solana') {
            const response = await fetchWithTimeout(rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getSlot',
                    params: []
                })
            });
            const data = await response.json();
            return !data.error;
        } else if (chain.kind === 'tron') {
            const response = await fetchWithTimeout(`${rpc}/wallet/getnowblock`, { method: 'GET' });
            return response.ok;
        }
        return false;
    } catch (e) {
        return false;
    }
}

function initNetwork() {
    checkAllNetworkHealth();
    setInterval(checkAllNetworkHealth, 30000);
}