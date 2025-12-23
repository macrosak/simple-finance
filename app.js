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
        return JSON.parse(stored);
    }
    return {
        sources: [],
        entries: []
    };
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getActiveSources() {
    return data.sources.filter(s => !s.closed);
}

function getLatestValues() {
    const latest = {};
    const sortedEntries = [...data.entries].sort((a, b) => new Date(b.date) - new Date(a.date));

    for (const source of data.sources) {
        if (source.closed) continue;
        for (const entry of sortedEntries) {
            if (entry.values[source.id] !== undefined) {
                latest[source.id] = entry.values[source.id];
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

function updateTotalDisplay() {
    document.getElementById('totalValue').textContent = formatCurrency(calculateTotal());
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

    const sortedEntries = [...data.entries].sort((a, b) => new Date(a.date) - new Date(b.date));
    const activeSources = data.sources.filter(s => {
        return sortedEntries.some(e => e.values[s.id] !== undefined);
    });

    const labels = sortedEntries.map(e => e.date);

    const datasets = activeSources.map((source, idx) => {
        let lastValue = 0;
        const values = sortedEntries.map(entry => {
            if (entry.values[source.id] !== undefined) {
                lastValue = entry.values[source.id];
            }
            return lastValue;
        });

        return {
            label: source.name,
            data: values,
            fill: true,
            backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] + '80',
            borderColor: CHART_COLORS[idx % CHART_COLORS.length],
            borderWidth: 2
        };
    });

    if (chart) {
        chart.destroy();
    }

    chart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${formatCurrency(context.raw)}`
                    }
                }
            },
            scales: {
                x: {
                    type: 'category',
                    ticks: {
                        callback: (val, idx) => formatYear(labels[idx])
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
    const activeSources = data.sources.filter(s => {
        return sortedEntries.some(e => e.values[s.id] !== undefined);
    });

    // Build header
    let headerHtml = '<th>Date</th>';
    for (const source of activeSources) {
        headerHtml += `<th>${escapeHtml(source.name)}</th>`;
    }
    headerHtml += '<th>Total</th><th>Change</th>';
    thead.innerHTML = headerHtml;

    // Build body with running totals
    const runningValues = {};
    const rows = sortedEntries.map((entry, idx) => {
        // Update running values for this entry
        for (const source of activeSources) {
            if (entry.values[source.id] !== undefined) {
                runningValues[source.id] = entry.values[source.id];
            }
        }

        const total = activeSources.reduce((sum, s) => sum + (runningValues[s.id] || 0), 0);

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

        for (const source of activeSources) {
            const val = row.values[source.id] || 0;
            const comment = row.entry.comments?.[source.id];
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
    const sourceInputs = document.getElementById('sourceInputs');

    dateInput.value = new Date().toISOString().split('T')[0];

    const activeSources = getActiveSources();
    const latestValues = getLatestValues();

    let html = '';
    for (const source of activeSources) {
        html += `
            <div class="source-input" data-source-id="${source.id}">
                <div class="source-input-header">
                    <label>${escapeHtml(source.name)}</label>
                    <button type="button" onclick="closeSource('${source.id}')">Close source</button>
                </div>
                <input type="number" step="0.01" placeholder="Value" value="${latestValues[source.id] || ''}">
                <input type="text" placeholder="Comment (optional)">
            </div>
        `;
    }

    sourceInputs.innerHTML = html;
    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('dataModal').classList.remove('active');
}

function closeSource(sourceId) {
    if (confirm('Close this source? It will no longer appear in new entries.')) {
        const source = data.sources.find(s => s.id === sourceId);
        if (source) {
            source.closed = true;
            saveData();
            openModal(); // Refresh modal
        }
    }
}

function addSource() {
    const input = document.getElementById('newSourceName');
    const name = input.value.trim();

    if (!name) {
        alert('Please enter a source name');
        return;
    }

    if (data.sources.some(s => s.name.toLowerCase() === name.toLowerCase() && !s.closed)) {
        alert('A source with this name already exists');
        return;
    }

    data.sources.push({
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

    const sourceInputs = document.querySelectorAll('.source-input');
    const values = {};
    const comments = {};

    sourceInputs.forEach(input => {
        const sourceId = input.getAttribute('data-source-id');
        const valueInput = input.querySelector('input[type="number"]');
        const commentInput = input.querySelector('input[type="text"]');

        if (valueInput.value !== '') {
            values[sourceId] = parseFloat(valueInput.value);
        }

        if (commentInput.value.trim()) {
            comments[sourceId] = commentInput.value.trim();
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
    const allSources = data.sources.filter(s => {
        return sortedEntries.some(e => e.values[s.id] !== undefined);
    });

    let csv = 'Date';
    for (const source of allSources) {
        csv += `,"${source.name}","${source.name} Comment"`;
    }
    csv += ',Total\n';

    const runningValues = {};

    for (const entry of sortedEntries) {
        for (const source of allSources) {
            if (entry.values[source.id] !== undefined) {
                runningValues[source.id] = entry.values[source.id];
            }
        }

        let row = entry.date;
        for (const source of allSources) {
            const val = runningValues[source.id] || 0;
            const comment = entry.comments?.[source.id] || '';
            row += `,${val},"${comment.replace(/"/g, '""')}"`;
        }

        const total = allSources.reduce((sum, s) => sum + (runningValues[s.id] || 0), 0);
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

        // Find source columns (skip ignored columns)
        const sourceColumns = [];
        for (let i = 1; i < headers.length; i++) {
            const header = headers[i];
            if (!header || isIgnoredColumn(header)) continue;
            sourceColumns.push({ index: i, name: header });
        }

        // Create or find sources
        const sourceMap = {};
        for (const col of sourceColumns) {
            let source = data.sources.find(s => s.name.toLowerCase() === col.name.toLowerCase());
            if (!source) {
                source = { id: generateId(), name: col.name, closed: false };
                data.sources.push(source);
            }
            sourceMap[col.index] = source.id;
        }

        // Import entries
        let imported = 0;
        for (let i = 1; i < lines.length; i++) {
            const row = parseCSVLine(lines[i]);
            if (!row[0]) continue;

            const date = parseDate(row[0]);
            if (!date) continue;

            const values = {};

            for (const col of sourceColumns) {
                const val = parseNumber(row[col.index]);
                if (!isNaN(val)) {
                    values[sourceMap[col.index]] = val;
                }
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
document.getElementById('addSourceBtn').addEventListener('click', addSource);
document.getElementById('saveBtn').addEventListener('click', saveEntry);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.querySelector('#dataModal .close-btn').addEventListener('click', closeModal);

document.getElementById('dataModal').addEventListener('click', (e) => {
    if (e.target.id === 'dataModal') {
        closeModal();
    }
});

document.getElementById('newSourceName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addSource();
    }
});

document.getElementById('zeroBasedCheckbox').addEventListener('change', (e) => {
    zeroBasedChart = e.target.checked;
    updateChart();
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
        data = { sources: [], entries: [] };
        saveData();
        updateUI();
        document.getElementById('settingsModal').classList.remove('active');
    }
});

// Initialize
updateUI();
