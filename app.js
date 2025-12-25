const STORAGE_KEY = 'finance-tracker-data';
const SETTINGS_KEY = 'finance-tracker-settings';

const CHART_COLORS = [
    '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a',
    '#0891b2', '#4f46e5', '#c026d3', '#d97706', '#059669'
];

let data = loadData();
let settings = loadSettings();
let chart = null;
let zeroBasedChart = true;
let hiddenAccounts = new Set();
let selectedTimeRange = 'all'; // 'all', '1', '3', '5' (years)

function loadSettings() {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
        return JSON.parse(stored);
    }
    return { currency: 'USD' };
}

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        const parsed = JSON.parse(stored);
        // Migration: rename sources to accounts if needed
        if (parsed.sources && !parsed.accounts) {
            parsed.accounts = parsed.sources;
            delete parsed.sources;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
        return parsed;
    }
    return {
        accounts: [],
        entries: []
    };
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getActiveAccounts() {
    return data.accounts.filter(a => !a.closed);
}

function getLatestValues() {
    const latest = {};
    const sortedEntries = [...data.entries].sort((a, b) => new Date(b.date) - new Date(a.date));

    for (const account of data.accounts) {
        if (account.closed) continue;
        for (const entry of sortedEntries) {
            if (entry.values[account.id] !== undefined) {
                latest[account.id] = entry.values[account.id];
                break;
            }
        }
    }
    return latest;
}

function calculateTotal() {
    const latest = getLatestValues();
    return Object.values(latest).reduce((sum, val) => sum + val, 0);
}

function calculateChangeSinceLastEntry() {
    if (data.entries.length < 2) return null;

    const sortedEntries = [...data.entries].sort((a, b) => new Date(b.date) - new Date(a.date));
    const activeAccounts = data.accounts.filter(a => !a.closed);

    // Calculate totals for the two most recent entries
    const runningValues = {};
    let latestTotal = 0;
    let previousTotal = 0;

    // Process all entries from oldest to newest to build running totals
    const chronological = [...sortedEntries].reverse();
    for (let i = 0; i < chronological.length; i++) {
        const entry = chronological[i];
        for (const account of activeAccounts) {
            if (entry.values[account.id] !== undefined) {
                runningValues[account.id] = entry.values[account.id];
            }
        }

        const total = activeAccounts.reduce((sum, a) => sum + (runningValues[a.id] || 0), 0);

        if (i === chronological.length - 1) {
            latestTotal = total;
        } else if (i === chronological.length - 2) {
            previousTotal = total;
        }
    }

    return latestTotal - previousTotal;
}

const CURRENCY_LOCALES = {
    USD: 'en-US',
    EUR: 'de-DE',
    GBP: 'en-GB',
    JPY: 'ja-JP',
    CHF: 'de-CH',
    CAD: 'en-CA',
    AUD: 'en-AU',
    CNY: 'zh-CN',
    CZK: 'cs-CZ'
};

function formatCurrency(amount) {
    const locale = CURRENCY_LOCALES[settings.currency] || 'en-US';
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: settings.currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatYear(dateStr) {
    return new Date(dateStr).getFullYear().toString();
}

function formatCompact(val) {
    if (val >= 1000000) {
        return (val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1) + ' M';
    }
    if (val >= 1000) {
        return (val / 1000).toFixed(val % 1000 === 0 ? 0 : 1) + ' K';
    }
    return val.toString();
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getAccountColor(accountId) {
    const idx = data.accounts.findIndex(a => a.id === accountId);
    return CHART_COLORS[idx % CHART_COLORS.length];
}

// Template helpers
const accountBreakdownTemplate = document.getElementById('accountBreakdownItemTemplate');
const accountInputTemplate = document.getElementById('accountInputTemplate');

function createAccountBreakdownItem(item, isHidden) {
    const clone = accountBreakdownTemplate.content.cloneNode(true);
    const wrapper = clone.querySelector('.account-breakdown-item');
    wrapper.dataset.accountId = item.id;
    if (isHidden) wrapper.classList.add('hidden-account');
    clone.querySelector('.account-color').style.background = item.color;
    clone.querySelector('.account-breakdown-name').textContent = item.name;
    clone.querySelector('.account-breakdown-value').textContent = item.value;
    return clone;
}

function createAccountInput(account, latestValue) {
    const clone = accountInputTemplate.content.cloneNode(true);
    const wrapper = clone.querySelector('.account-input');
    wrapper.dataset.accountId = account.id;
    clone.querySelector('label').textContent = account.name;
    clone.querySelector('button').onclick = () => closeAccount(account.id);
    clone.querySelector('input[type="number"]').value = latestValue || '';
    return clone;
}

function updateTotalDisplay() {
    document.getElementById('totalValue').textContent = formatCurrency(calculateTotal());

    // Update change since last entry
    const changeEl = document.getElementById('totalChange');
    const change = calculateChangeSinceLastEntry();
    if (change !== null) {
        const sign = change >= 0 ? '+' : '';
        changeEl.innerHTML = `<span class="change-amount">${sign}${formatCurrency(change)}</span> since last entry`;
        changeEl.className = 'total-change' + (change < 0 ? ' negative' : '');
    } else {
        changeEl.innerHTML = '';
    }

    const activeList = document.getElementById('activeAccountsList');
    const closedList = document.getElementById('closedAccountsList');
    const closedToggle = document.getElementById('closedAccountsToggle');
    const latestValues = getLatestValues();

    const activeAccounts = data.accounts.filter(a => !a.closed);
    const closedAccounts = data.accounts.filter(a => a.closed);

    // Render active accounts
    const activeItems = activeAccounts
        .map(account => ({
            id: account.id,
            name: account.name,
            value: formatCurrency(latestValues[account.id] || 0),
            color: getAccountColor(account.id)
        }))
        .sort((a, b) => (latestValues[b.id] || 0) - (latestValues[a.id] || 0));

    activeList.innerHTML = '';
    for (const item of activeItems) {
        activeList.appendChild(createAccountBreakdownItem(item, hiddenAccounts.has(item.id)));
    }

    // Render closed accounts
    if (closedAccounts.length > 0) {
        closedToggle.classList.add('visible');
        closedList.innerHTML = '';

        for (const account of closedAccounts) {
            const item = {
                id: account.id,
                name: account.name,
                value: 'closed',
                color: getAccountColor(account.id)
            };
            closedList.appendChild(createAccountBreakdownItem(item, hiddenAccounts.has(account.id)));
        }
    } else {
        closedToggle.classList.remove('visible');
        closedList.innerHTML = '';
    }

    // Add click handlers for toggling account visibility
    document.querySelectorAll('.account-breakdown-item[data-account-id]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const accountId = item.getAttribute('data-account-id');
            if (hiddenAccounts.has(accountId)) {
                hiddenAccounts.delete(accountId);
            } else {
                hiddenAccounts.add(accountId);
            }
            updateTotalDisplay();
            updateChart();
            updateTable();
        });
    });
}

function getFilteredEntries() {
    const sortedEntries = [...data.entries].sort((a, b) => new Date(a.date) - new Date(b.date));

    if (selectedTimeRange === 'all') {
        return sortedEntries;
    }

    const years = parseInt(selectedTimeRange);
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - years);

    return sortedEntries.filter(e => new Date(e.date) >= cutoffDate);
}

function updateResetZoomButton() {
    const btn = document.getElementById('resetZoomBtn');
    if (chart && chart.isZoomedOrPanned()) {
        btn.classList.add('visible');
    } else {
        btn.classList.remove('visible');
    }
}

function updateChart() {
    const canvas = document.getElementById('assetChart');
    const noDataMsg = document.getElementById('noDataMessage');

    if (data.entries.length === 0) {
        canvas.style.display = 'none';
        noDataMsg.classList.remove('hidden');
        if (chart) {
            chart.destroy();
            chart = null;
        }
        return;
    }

    canvas.style.display = 'block';
    noDataMsg.classList.add('hidden');

    const filteredEntries = getFilteredEntries();
    const accountsWithData = data.accounts.filter(a => {
        return filteredEntries.some(e => e.values[a.id] !== undefined);
    });

    // Filter out hidden accounts
    const visibleAccounts = accountsWithData.filter(a => !hiddenAccounts.has(a.id));

    // Build running values from the beginning for correct totals
    const allSortedEntries = [...data.entries].sort((a, b) => new Date(a.date) - new Date(b.date));

    const datasets = visibleAccounts.map((account) => {
        const color = getAccountColor(account.id);

        // Initialize running values from entries before the filtered range
        let lastValue = 0;
        for (const entry of allSortedEntries) {
            if (entry.values[account.id] !== undefined) {
                lastValue = entry.values[account.id];
            }
            if (filteredEntries.includes(entry)) break;
        }

        // Create data points with x (date) and y (value)
        const dataPoints = filteredEntries.map(entry => {
            if (entry.values[account.id] !== undefined) {
                lastValue = entry.values[account.id];
            }
            return { x: entry.date, y: lastValue };
        });

        return {
            label: account.name,
            data: dataPoints,
            fill: true,
            backgroundColor: color + '80',
            borderColor: color,
            borderWidth: 2
        };
    });

    if (chart) {
        chart.destroy();
    }

    chart = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            if (items.length > 0) {
                                return formatDate(items[0].parsed.x);
                            }
                            return '';
                        },
                        label: (context) => `${context.dataset.label}: ${formatCurrency(context.raw.y)}`
                    }
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        modifierKey: null
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                            speed: 0.05
                        },
                        pinch: {
                            enabled: true
                        },
                        drag: {
                            enabled: true,
                            backgroundColor: 'rgba(37, 99, 235, 0.1)',
                            borderColor: 'rgba(37, 99, 235, 0.5)',
                            borderWidth: 1
                        },
                        mode: 'x',
                        onZoom: updateResetZoomButton,
                        onZoomComplete: updateResetZoomButton
                    },
                    limits: {
                        x: { minRange: 30 * 24 * 60 * 60 * 1000 } // Minimum 30 days range
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'month',
                        displayFormats: {
                            day: 'MMM d',
                            week: 'MMM d',
                            month: 'MMM yyyy',
                            quarter: 'MMM yyyy',
                            year: 'yyyy'
                        },
                        tooltipFormat: 'MMM d, yyyy'
                    },
                    ticks: {
                        maxTicksLimit: 8,
                        autoSkip: true,
                        autoSkipPadding: 50
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: zeroBasedChart,
                    ticks: {
                        callback: (val) => formatCompact(val)
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });

    updateResetZoomButton();
}

function updateTable() {
    const thead = document.getElementById('tableHeader');
    const tbody = document.getElementById('tableBody');

    if (data.entries.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = '';
        return;
    }

    const sortedEntries = [...data.entries].sort((a, b) => new Date(b.date) - new Date(a.date));
    const activeAccounts = data.accounts.filter(a => {
        const hasData = sortedEntries.some(e => e.values[a.id] !== undefined);
        const isVisible = !hiddenAccounts.has(a.id);
        return hasData && isVisible;
    });

    // Build header
    let headerHtml = '<th>Date</th>';
    for (const account of activeAccounts) {
        headerHtml += `<th>${escapeHtml(account.name)}</th>`;
    }
    headerHtml += '<th>Total</th><th>Change</th>';
    thead.innerHTML = headerHtml;

    // Build body with running totals
    const runningValues = {};
    const rows = sortedEntries.map((entry, idx) => {
        // Update running values for this entry
        for (const account of activeAccounts) {
            if (entry.values[account.id] !== undefined) {
                runningValues[account.id] = entry.values[account.id];
            }
        }

        const total = activeAccounts.reduce((sum, a) => sum + (runningValues[a.id] || 0), 0);

        return {
            entry,
            values: { ...runningValues },
            total
        };
    });

    let bodyHtml = '';
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const prevRow = rows[i + 1];

        bodyHtml += '<tr>';
        bodyHtml += `<td>${formatDate(row.entry.date)}</td>`;

        for (const account of activeAccounts) {
            const val = row.values[account.id] || 0;
            const comment = row.entry.comments?.[account.id];
            let cellContent = formatCurrency(val);

            if (comment) {
                cellContent += `<span class="comment-indicator" data-comment="${escapeHtml(comment)}">
                    <svg viewBox="0 0 20 20"><path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z"/></svg>
                </span>`;
            }

            bodyHtml += `<td>${cellContent}</td>`;
        }

        bodyHtml += `<td><strong>${formatCurrency(row.total)}</strong></td>`;

        if (prevRow) {
            const change = row.total - prevRow.total;
            const pct = prevRow.total !== 0 ? (change / prevRow.total * 100) : 0;
            const cls = change >= 0 ? 'change-positive' : 'change-negative';
            const sign = change >= 0 ? '+' : '';
            bodyHtml += `<td class="${cls}">${sign}${formatCurrency(change)} (${sign}${pct.toFixed(1)}%)</td>`;
        } else {
            bodyHtml += '<td>-</td>';
        }

        bodyHtml += '</tr>';
    }

    tbody.innerHTML = bodyHtml;

    // Set up tooltip handlers
    setupTooltips();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupTooltips() {
    const tooltip = document.getElementById('tooltip');
    const indicators = document.querySelectorAll('.comment-indicator');

    indicators.forEach(indicator => {
        const showTooltip = (e) => {
            const comment = indicator.getAttribute('data-comment');
            tooltip.textContent = comment;
            tooltip.classList.add('visible');

            const rect = indicator.getBoundingClientRect();
            tooltip.style.left = `${rect.left}px`;
            tooltip.style.top = `${rect.bottom + 8}px`;
        };

        const hideTooltip = () => {
            tooltip.classList.remove('visible');
        };

        indicator.addEventListener('mouseenter', showTooltip);
        indicator.addEventListener('mouseleave', hideTooltip);
        indicator.addEventListener('touchstart', showTooltip);
        indicator.addEventListener('touchend', hideTooltip);
    });
}

function openModal() {
    const modal = document.getElementById('dataModal');
    const dateInput = document.getElementById('entryDate');
    const accountInputsContainer = document.getElementById('accountInputs');

    dateInput.value = new Date().toISOString().split('T')[0];

    const activeAccounts = getActiveAccounts();
    const latestValues = getLatestValues();

    accountInputsContainer.innerHTML = '';
    for (const account of activeAccounts) {
        accountInputsContainer.appendChild(createAccountInput(account, latestValues[account.id]));
    }

    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('dataModal').classList.remove('active');
}

function closeAccount(accountId) {
    if (confirm('Close this account? It will no longer appear in new entries.')) {
        const account = data.accounts.find(a => a.id === accountId);
        if (account) {
            account.closed = true;
            saveData();
            openModal(); // Refresh modal
        }
    }
}

function addAccount() {
    const input = document.getElementById('newAccountName');
    const name = input.value.trim();

    if (!name) {
        alert('Please enter an account name');
        return;
    }

    if (data.accounts.some(a => a.name.toLowerCase() === name.toLowerCase() && !a.closed)) {
        alert('An account with this name already exists');
        return;
    }

    data.accounts.push({
        id: generateId(),
        name,
        closed: false
    });

    saveData();
    input.value = '';
    openModal(); // Refresh modal
}

function saveEntry() {
    const dateInput = document.getElementById('entryDate');
    const date = dateInput.value;

    if (!date) {
        alert('Please select a date');
        return;
    }

    const accountInputs = document.querySelectorAll('.account-input');
    const values = {};
    const comments = {};

    accountInputs.forEach(input => {
        const accountId = input.getAttribute('data-account-id');
        const valueInput = input.querySelector('input[type="number"]');
        const commentInput = input.querySelector('input[type="text"]');

        if (valueInput.value !== '') {
            values[accountId] = parseFloat(valueInput.value);
        }

        if (commentInput.value.trim()) {
            comments[accountId] = commentInput.value.trim();
        }
    });

    if (Object.keys(values).length === 0) {
        alert('Please enter at least one value');
        return;
    }

    // Check if entry for this date exists
    const existingIdx = data.entries.findIndex(e => e.date === date);

    if (existingIdx >= 0) {
        // Merge with existing entry
        const existing = data.entries[existingIdx];
        existing.values = { ...existing.values, ...values };
        existing.comments = { ...existing.comments, ...comments };
    } else {
        data.entries.push({ date, values, comments });
    }

    saveData();
    closeModal();
    updateUI();
}

function exportCSV() {
    if (data.entries.length === 0) {
        alert('No data to export');
        return;
    }

    const sortedEntries = [...data.entries].sort((a, b) => new Date(a.date) - new Date(b.date));
    const allAccounts = data.accounts.filter(a => {
        return sortedEntries.some(e => e.values[a.id] !== undefined);
    });

    let csv = 'Date';
    for (const account of allAccounts) {
        csv += `,"${account.name}","${account.name} Comment"`;
    }
    csv += ',Total\n';

    const runningValues = {};

    for (const entry of sortedEntries) {
        for (const account of allAccounts) {
            if (entry.values[account.id] !== undefined) {
                runningValues[account.id] = entry.values[account.id];
            }
        }

        let row = entry.date;
        for (const account of allAccounts) {
            const val = runningValues[account.id] || 0;
            const comment = entry.comments?.[account.id] || '';
            row += `,${val},"${comment.replace(/"/g, '""')}"`;
        }

        const total = allAccounts.reduce((sum, a) => sum + (runningValues[a.id] || 0), 0);
        row += `,${total}`;
        csv += row + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

function parseDate(dateStr) {
    // Try DD.MM.YYYY format first
    const ddmmyyyy = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (ddmmyyyy) {
        const [, day, month, year] = ddmmyyyy;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }
    return null;
}

function isIgnoredColumn(header) {
    const lower = header.toLowerCase();
    const ignored = ['total', 'diff', 'note', 'eur', 'usd'];
    return ignored.some(term => lower.includes(term)) || lower.endsWith(' comment');
}

function parseNumber(str) {
    if (!str) return NaN;
    // Remove thousand separators (commas and spaces)
    const cleaned = str.replace(/[,\s]/g, '');
    return parseFloat(cleaned);
}

function importCSV(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.split('\n').filter(l => l.trim());

        if (lines.length < 2) {
            alert('CSV file must have a header and at least one data row');
            return;
        }

        const headers = parseCSVLine(lines[0]);
        const firstCol = headers[0].toLowerCase();
        if (firstCol !== 'date' && firstCol !== 'datum') {
            alert('First column must be "Date" or "Datum"');
            return;
        }

        // Find account columns (skip ignored columns)
        const accountColumns = [];
        for (let i = 1; i < headers.length; i++) {
            const header = headers[i];
            if (!header || isIgnoredColumn(header)) continue;
            accountColumns.push({ index: i, name: header });
        }

        // Create or find accounts
        const accountMap = {};
        for (const col of accountColumns) {
            let account = data.accounts.find(a => a.name.toLowerCase() === col.name.toLowerCase());
            if (!account) {
                account = { id: generateId(), name: col.name, closed: false };
                data.accounts.push(account);
            }
            accountMap[col.index] = account.id;
        }

        // Import entries
        let imported = 0;
        for (let i = 1; i < lines.length; i++) {
            const row = parseCSVLine(lines[i]);
            if (!row[0]) continue;

            const date = parseDate(row[0]);
            if (!date) continue;

            const values = {};

            for (const col of accountColumns) {
                const cellValue = row[col.index];
                const val = parseNumber(cellValue);
                // Empty cells or unparseable values become 0
                values[accountMap[col.index]] = isNaN(val) ? 0 : val;
            }

            if (Object.keys(values).length > 0) {
                const existingIdx = data.entries.findIndex(e => e.date === date);
                if (existingIdx >= 0) {
                    data.entries[existingIdx].values = { ...data.entries[existingIdx].values, ...values };
                } else {
                    data.entries.push({ date, values, comments: {} });
                }
                imported++;
            }
        }

        saveData();
        updateUI();
        alert(`Imported ${imported} entries`);
    };
    reader.readAsText(file);
}

function updateUI() {
    updateTotalDisplay();
    updateChart();
    updateTable();
}

// Event listeners
document.getElementById('totalValue').addEventListener('click', () => {
    document.getElementById('totalSection').classList.toggle('expanded');
});

document.getElementById('closedAccountsToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('closedAccountsList').classList.toggle('expanded');
});

document.getElementById('showAllBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    hiddenAccounts.clear();
    updateTotalDisplay();
    updateChart();
    updateTable();
});

document.getElementById('hideAllBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    data.accounts.forEach(a => hiddenAccounts.add(a.id));
    updateTotalDisplay();
    updateChart();
    updateTable();
});

document.getElementById('enterDataBtn').addEventListener('click', openModal);
document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
});
document.getElementById('importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        importCSV(e.target.files[0]);
        e.target.value = '';
    }
});
document.getElementById('exportBtn').addEventListener('click', exportCSV);
document.getElementById('addAccountBtn').addEventListener('click', addAccount);
document.getElementById('saveBtn').addEventListener('click', saveEntry);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.querySelector('#dataModal .close-btn').addEventListener('click', closeModal);

document.getElementById('dataModal').addEventListener('click', (e) => {
    if (e.target.id === 'dataModal') {
        closeModal();
    }
});

document.getElementById('newAccountName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addAccount();
    }
});

document.getElementById('zeroBasedCheckbox').addEventListener('change', (e) => {
    zeroBasedChart = e.target.checked;
    updateChart();
});

// Time range buttons
document.querySelectorAll('.time-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.time-range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedTimeRange = btn.dataset.range;
        updateChart();
    });
});

// Reset zoom button
document.getElementById('resetZoomBtn').addEventListener('click', () => {
    if (chart) {
        chart.resetZoom();
        updateResetZoomButton();
    }
});

// Settings
document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('currencySelect').value = settings.currency;
    document.getElementById('settingsModal').classList.add('active');
});

document.querySelector('#settingsModal .close-btn').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.remove('active');
});

document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') {
        document.getElementById('settingsModal').classList.remove('active');
    }
});

document.getElementById('currencySelect').addEventListener('change', (e) => {
    settings.currency = e.target.value;
    saveSettings();
    updateUI();
});

document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
        data = { accounts: [], entries: [] };
        saveData();
        updateUI();
        document.getElementById('settingsModal').classList.remove('active');
    }
});

// ==================== D3 CHART ====================

let d3Chart = null;
let d3ZeroBasedChart = true;
let d3SelectedTimeRange = 'all';
let d3CurrentTransform = d3.zoomIdentity;

function getD3FilteredEntries() {
    const sortedEntries = [...data.entries].sort((a, b) => new Date(a.date) - new Date(b.date));

    if (d3SelectedTimeRange === 'all') {
        return sortedEntries;
    }

    const years = parseInt(d3SelectedTimeRange);
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - years);

    return sortedEntries.filter(e => new Date(e.date) >= cutoffDate);
}

function updateD3ResetZoomButton() {
    const btn = document.getElementById('d3ResetZoomBtn');
    if (d3CurrentTransform.k !== 1 || d3CurrentTransform.x !== 0) {
        btn.classList.add('visible');
    } else {
        btn.classList.remove('visible');
    }
}

function updateD3Chart() {
    const container = document.getElementById('d3ChartContainer');
    const svg = d3.select('#d3Chart');
    const noDataMsg = document.getElementById('d3NoDataMessage');

    if (data.entries.length === 0) {
        svg.selectAll('*').remove();
        noDataMsg.classList.remove('hidden');
        return;
    }

    noDataMsg.classList.add('hidden');

    // Get dimensions
    const margin = { top: 20, right: 20, bottom: 40, left: 60 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = container.clientHeight - margin.top - margin.bottom;

    // Clear previous content
    svg.selectAll('*').remove();

    // Get data
    const filteredEntries = getD3FilteredEntries();
    const accountsWithData = data.accounts.filter(a => {
        return filteredEntries.some(e => e.values[a.id] !== undefined);
    });
    const visibleAccounts = accountsWithData.filter(a => !hiddenAccounts.has(a.id));

    if (visibleAccounts.length === 0 || filteredEntries.length === 0) {
        return;
    }

    // Build running values from the beginning
    const allSortedEntries = [...data.entries].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Create data structure for D3 stack
    const stackData = [];
    const runningValues = {};

    // Initialize running values from entries before filtered range
    for (const account of visibleAccounts) {
        runningValues[account.id] = 0;
        for (const entry of allSortedEntries) {
            if (entry.values[account.id] !== undefined) {
                runningValues[account.id] = entry.values[account.id];
            }
            if (filteredEntries.includes(entry)) break;
        }
    }

    // Build stack data
    for (const entry of filteredEntries) {
        const dataPoint = { date: new Date(entry.date) };
        for (const account of visibleAccounts) {
            if (entry.values[account.id] !== undefined) {
                runningValues[account.id] = entry.values[account.id];
            }
            dataPoint[account.id] = runningValues[account.id];
        }
        stackData.push(dataPoint);
    }

    // Create stack generator
    const keys = visibleAccounts.map(a => a.id);
    const stack = d3.stack()
        .keys(keys)
        .order(d3.stackOrderNone)
        .offset(d3.stackOffsetNone);

    const series = stack(stackData);

    // Create scales
    const xExtent = d3.extent(stackData, d => d.date);
    const xScale = d3.scaleTime()
        .domain(xExtent)
        .range([0, width]);

    const yMax = d3.max(series, s => d3.max(s, d => d[1]));
    const yScale = d3.scaleLinear()
        .domain([d3ZeroBasedChart ? 0 : d3.min(series, s => d3.min(s, d => d[0])), yMax * 1.05])
        .range([height, 0]);

    // Store original scales for zoom
    const xScaleOrig = xScale.copy();
    const yScaleOrig = yScale.copy();

    // Create main group
    const g = svg
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Add clip path
    svg.append('defs')
        .append('clipPath')
        .attr('id', 'd3-clip')
        .append('rect')
        .attr('width', width)
        .attr('height', height);

    // Create area generator
    const area = d3.area()
        .x(d => xScale(d.data.date))
        .y0(d => yScale(d[0]))
        .y1(d => yScale(d[1]))
        .curve(d3.curveMonotoneX);

    // Create line generator (for borders)
    const line = d3.line()
        .x(d => xScale(d.data.date))
        .y(d => yScale(d[1]))
        .curve(d3.curveMonotoneX);

    // Add grid lines
    const yGrid = g.append('g')
        .attr('class', 'grid')
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
            .ticks(5));

    // Add areas group with clip path
    const areasGroup = g.append('g')
        .attr('class', 'areas')
        .attr('clip-path', 'url(#d3-clip)');

    // Add areas
    const areas = areasGroup.selectAll('.area-layer')
        .data(series)
        .enter()
        .append('path')
        .attr('class', 'area-layer')
        .attr('d', area)
        .attr('fill', d => getAccountColor(d.key));

    // Add lines on top
    const lines = areasGroup.selectAll('.line-layer')
        .data(series)
        .enter()
        .append('path')
        .attr('class', 'line-layer')
        .attr('d', line)
        .attr('stroke', d => getAccountColor(d.key));

    // Create axes
    const xAxis = g.append('g')
        .attr('class', 'axis x-axis')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale)
            .ticks(getXAxisTicks(width))
            .tickFormat(d => formatXAxisLabel(d, xScale)));

    const yAxis = g.append('g')
        .attr('class', 'axis y-axis')
        .call(d3.axisLeft(yScale)
            .ticks(5)
            .tickFormat(d => formatCompact(d)));

    // Tooltip handling
    const tooltip = d3.select('#d3Tooltip');
    const bisect = d3.bisector(d => d.date).left;

    // Add overlay for mouse events
    const overlay = g.append('rect')
        .attr('class', 'zoom-rect')
        .attr('width', width)
        .attr('height', height)
        .on('mousemove', function(event) {
            const [mx] = d3.pointer(event);
            const x0 = xScale.invert(mx);
            const i = bisect(stackData, x0, 1);
            const d0 = stackData[i - 1];
            const d1 = stackData[i];

            if (!d0 && !d1) return;

            const d = !d1 ? d0 : !d0 ? d1 : (x0 - d0.date > d1.date - x0 ? d1 : d0);

            // Build tooltip content
            let html = `<div class="d3-tooltip-title">${formatDate(d.date)}</div>`;
            let total = 0;

            for (const account of visibleAccounts) {
                const value = d[account.id] || 0;
                total += value;
                const color = getAccountColor(account.id);
                html += `<div class="d3-tooltip-row">
                    <span class="d3-tooltip-name">
                        <span class="d3-tooltip-color" style="background:${color}"></span>
                        ${escapeHtml(account.name)}
                    </span>
                    <span class="d3-tooltip-value">${formatCurrency(value)}</span>
                </div>`;
            }

            html += `<div class="d3-tooltip-row" style="border-top: 1px solid rgba(255,255,255,0.2); margin-top: 0.5rem; padding-top: 0.5rem;">
                <span class="d3-tooltip-name"><strong>Total</strong></span>
                <span class="d3-tooltip-value"><strong>${formatCurrency(total)}</strong></span>
            </div>`;

            tooltip.html(html)
                .style('left', (event.pageX + 15) + 'px')
                .style('top', (event.pageY - 10) + 'px')
                .classed('visible', true);
        })
        .on('mouseleave', function() {
            tooltip.classed('visible', false);
        });

    // Zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([1, 20])
        .translateExtent([[0, 0], [width, height]])
        .extent([[0, 0], [width, height]])
        .on('zoom', function(event) {
            d3CurrentTransform = event.transform;

            // Update x scale
            const newXScale = event.transform.rescaleX(xScaleOrig);
            xScale.domain(newXScale.domain());

            // Redraw areas and lines
            areas.attr('d', area);
            lines.attr('d', line);

            // Update x axis
            xAxis.call(d3.axisBottom(xScale)
                .ticks(getXAxisTicks(width))
                .tickFormat(d => formatXAxisLabel(d, xScale)));

            updateD3ResetZoomButton();
        });

    // Apply zoom to overlay
    overlay.call(zoom);

    // Enable touch zoom
    overlay.on('touchstart.zoom', null)
        .call(zoom)
        .on('touchstart.zoom', function(event) {
            if (event.touches.length === 2) {
                event.preventDefault();
            }
        });

    // Store zoom reference for reset
    d3Chart = { svg, zoom, overlay, xScaleOrig };

    // Restore previous zoom state
    if (d3CurrentTransform.k !== 1) {
        overlay.call(zoom.transform, d3CurrentTransform);
    }

    updateD3ResetZoomButton();
}

function getXAxisTicks(width) {
    if (width < 400) return 4;
    if (width < 600) return 6;
    return 8;
}

function formatXAxisLabel(date, scale) {
    const domain = scale.domain();
    const range = domain[1] - domain[0];
    const days = range / (1000 * 60 * 60 * 24);

    if (days < 60) {
        return d3.timeFormat('%b %d')(date);
    } else if (days < 365) {
        return d3.timeFormat('%b %Y')(date);
    } else {
        return d3.timeFormat('%Y')(date);
    }
}

function resetD3Zoom() {
    if (d3Chart && d3Chart.overlay) {
        d3CurrentTransform = d3.zoomIdentity;
        d3Chart.overlay.call(d3Chart.zoom.transform, d3.zoomIdentity);
        updateD3ResetZoomButton();
    }
}

// D3 time range buttons
document.querySelectorAll('.d3-time-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.d3-time-range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        d3SelectedTimeRange = btn.dataset.range;
        d3CurrentTransform = d3.zoomIdentity; // Reset zoom on range change
        updateD3Chart();
    });
});

// D3 reset zoom button
document.getElementById('d3ResetZoomBtn').addEventListener('click', resetD3Zoom);

// D3 zero-based checkbox
document.getElementById('d3ZeroBasedCheckbox').addEventListener('change', (e) => {
    d3ZeroBasedChart = e.target.checked;
    updateD3Chart();
});

// Handle window resize for D3 chart
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        updateD3Chart();
    }, 150);
});

// Override updateUI to also update D3 chart
const originalUpdateUI = updateUI;
updateUI = function() {
    originalUpdateUI();
    updateD3Chart();
};

// Initialize
updateUI();
