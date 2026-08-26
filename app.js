(function() {
    'use strict';

    const app = new Vue({
        el: '#app',
        data: {
            rawData: [],
            columns: [],
            originalData: [],
            logs: [],
            logId: 0,
            pasteText: '',
            darkMode: false,
            highlights: {},
            tableLimit: 250,
            logLimit: 30
        },
        computed: {
            rows() { return this.rawData.length; },
            cols() { return this.columns.length; },
            displayData() { return this.rawData.slice(0, this.tableLimit); },
            missing() {
                if (this.rows === 0 || this.cols === 0) return 0;
                let count = 0;
                const total = this.rows * this.cols;
                this.rawData.forEach(row => {
                    this.columns.forEach(col => {
                        if (this.isMissing(row[col])) count++;
                    });
                });
                return Math.round((count / total) * 100);
            },
            score() {
                if (this.rows === 0) return 0;
                let s = 100;
                s -= Math.min(this.missing * 0.5, 40);
                s -= Math.min(this.duplicateCount * 0.8, 40);
                const emptyCols = this.columns.filter(c =>
                    this.rawData.every(r => this.isMissing(r[c]))
                ).length;
                s -= Math.min(emptyCols * 3, 15);
                return Math.max(0, Math.round(s));
            },
            duplicateCount() {
                const seen = new Set();
                let d = 0;
                this.rawData.forEach(row => {
                    const key = JSON.stringify(row);
                    if (seen.has(key)) d++;
                    else seen.add(key);
                });
                return d;
            },
            uniqueCount() {
                const seen = new Set();
                this.rawData.forEach(row => seen.add(JSON.stringify(row)));
                return seen.size;
            },
            missingClass() {
                if (this.missing < 10) return 'good';
                if (this.missing < 30) return 'warn';
                return 'bad';
            },
            healthClass() {
                if (this.score >= 80) return 'good';
                if (this.score >= 50) return 'warn';
                return 'bad';
            }
        },
        methods: {
            // ---- Utilities ----
            isMissing(val) {
                return val === undefined || val === null || val === '' ||
                       val === 'null' || val === 'undefined' || val === 'NaN';
            },

            getColumnValues(col) {
                return this.rawData.map(r => r[col]).filter(v => !this.isMissing(v));
            },

            getColumnMode(col) {
                const vals = this.getColumnValues(col);
                if (vals.length === 0) return 'N/A';
                const freq = {};
                vals.forEach(v => freq[v] = (freq[v] || 0) + 1);
                let max = 0, mode = 'N/A';
                for (const [k, c] of Object.entries(freq)) {
                    if (c > max) { max = c; mode = k; }
                }
                return mode;
            },

            detectDelimiter(text) {
                const firstLine = text.split('\n')[0] || '';
                for (const d of ['\t', ';', '|', ',']) {
                    if (firstLine.includes(d)) return d;
                }
                return ',';
            },

            // ---- Logging ----
            addLog(msg, type = 'info') {
                this.logs.push({ id: this.logId++, msg, type });
                if (this.logs.length > this.logLimit) this.logs.shift();
            },

            isHighlighted(row, col) {
                return this.highlights[col] && this.highlights[col].includes(row[col]);
            },

            // ---- Theme ----
            toggleTheme() {
                this.darkMode = !this.darkMode;
                document.body.classList.toggle('dark', this.darkMode);
                localStorage.setItem('forge-theme', this.darkMode ? 'dark' : 'light');
            },

            // ---- File Handling ----
            handleFile(e) {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.pasteText = ev.target.result;
                    this.parsePaste();
                    this.addLog(`Loaded: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`, 'success');
                };
                reader.onerror = () => {
                    this.addLog(`Error reading: ${file.name}`, 'error');
                };
                reader.readAsText(file);
                e.target.value = '';
            },

            // ---- Parsing ----
            parsePaste() {
                const text = this.pasteText.trim();
                if (!text) {
                    this.addLog('Nothing to parse', 'warning');
                    return;
                }
                this.parseData(text);
            },

            parseData(text) {
                text = text.trim();
                if (!text) {
                    this.addLog('Empty data', 'error');
                    return;
                }

                try {
                    if (text.startsWith('[') || text.startsWith('{')) {
                        const json = JSON.parse(text);
                        if (Array.isArray(json) && json.length > 0) {
                            this.columns = Object.keys(json[0]);
                            this.rawData = json;
                            this.originalData = JSON.parse(JSON.stringify(json));
                            this.addLog(`Parsed ${this.rows} rows, ${this.cols} columns from JSON`, 'success');
                            return;
                        }
                        throw new Error('JSON must be an array of objects');
                    }

                    const lines = text.split('\n').filter(l => l.trim());
                    if (lines.length < 2) throw new Error('Not enough rows');

                    const delim = this.detectDelimiter(text);
                    const headers = lines[0].split(delim).map(h =>
                        h.trim().replace(/^["']|["']$/g, '')
                    ).filter(h => h);

                    if (headers.length === 0) throw new Error('No headers found');

                    const rows = [];
                    for (let i = 1; i < lines.length; i++) {
                        const vals = lines[i].split(delim).map(v =>
                            v.trim().replace(/^["']|["']$/g, '')
                        );
                        const row = {};
                        headers.forEach((h, idx) => {
                            row[h] = vals[idx] !== undefined ? vals[idx] : '';
                        });
                        rows.push(row);
                    }

                    if (rows.length === 0) throw new Error('No data rows found');

                    this.columns = headers;
                    this.rawData = rows;
                    this.originalData = JSON.parse(JSON.stringify(rows));
                    this.addLog(`Parsed ${this.rows} rows, ${this.cols} columns`, 'success');

                } catch (err) {
                    this.addLog(`Error: ${err.message}`, 'error');
                }
            },

            // ---- Cleaning ----
            cleanMissing() {
                if (this.rows === 0) {
                    this.addLog('No data to clean', 'warning');
                    return;
                }
                let filled = 0;
                const changes = {};
                this.rawData.forEach(row => {
                    this.columns.forEach(col => {
                        if (this.isMissing(row[col])) {
                            row[col] = this.getColumnMode(col);
                            filled++;
                            changes[col] = (changes[col] || 0) + 1;
                        }
                    });
                });
                if (filled === 0) {
                    this.addLog('No missing values found', 'success');
                    return;
                }
                const summary = Object.entries(changes)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(', ');
                this.addLog(`Filled ${filled} missing values (${summary})`, 'success');
            },

            removeDupes() {
                if (this.rows === 0) {
                    this.addLog('No data to dedupe', 'warning');
                    return;
                }
                const seen = new Set();
                const unique = [];
                this.rawData.forEach(row => {
                    const key = JSON.stringify(row);
                    if (!seen.has(key)) {
                        seen.add(key);
                        unique.push(row);
                    }
                });
                const removed = this.rawData.length - unique.length;
                this.rawData = unique;
                if (removed === 0) {
                    this.addLog('No duplicates found', 'success');
                } else {
                    this.addLog(`Removed ${removed} duplicate rows`, 'success');
                }
            },

            normalize() {
                if (this.rows === 0) {
                    this.addLog('No data to normalize', 'warning');
                    return;
                }
                let count = 0;
                this.rawData.forEach(row => {
                    this.columns.forEach(col => {
                        if (typeof row[col] === 'string') {
                            const n = row[col].toLowerCase().trim().replace(/\s+/g, ' ');
                            if (n !== row[col]) {
                                row[col] = n;
                                count++;
                            }
                        }
                    });
                });
                if (count === 0) {
                    this.addLog('No text to normalize', 'success');
                } else {
                    this.addLog(`Normalized ${count} text fields`, 'success');
                }
            },

            trimWhitespace() {
                if (this.rows === 0) {
                    this.addLog('No data to trim', 'warning');
                    return;
                }
                let count = 0;
                this.rawData.forEach(row => {
                    this.columns.forEach(col => {
                        if (typeof row[col] === 'string') {
                            const t = row[col].trim();
                            if (t !== row[col]) {
                                row[col] = t;
                                count++;
                            }
                        }
                    });
                });
                if (count === 0) {
                    this.addLog('No whitespace to trim', 'success');
                } else {
                    this.addLog(`Trimmed ${count} fields`, 'success');
                }
            },

            // ---- Analysis ----
            detectOutliers() {
                if (this.rows < 3) {
                    this.addLog('Need at least 3 rows for outlier detection', 'warning');
                    return;
                }
                let found = 0;
                this.highlights = {};
                this.columns.forEach(col => {
                    const nums = this.rawData
                        .map(r => parseFloat(r[col]))
                        .filter(n => !isNaN(n) && isFinite(n));
                    if (nums.length < 3) return;

                    nums.sort((a, b) => a - b);
                    const q1 = nums[Math.floor(nums.length * 0.25)];
                    const q3 = nums[Math.floor(nums.length * 0.75)];
                    const iqr = q3 - q1;
                    if (iqr === 0) return;

                    const lower = q1 - 1.5 * iqr;
                    const upper = q3 + 1.5 * iqr;

                    this.rawData.forEach(row => {
                        const val = parseFloat(row[col]);
                        if (!isNaN(val) && isFinite(val) && (val < lower || val > upper)) {
                            if (!this.highlights[col]) this.highlights[col] = [];
                            this.highlights[col].push(row[col]);
                            found++;
                        }
                    });
                });
                if (found === 0) {
                    this.addLog('No outliers detected', 'success');
                } else {
                    this.addLog(`Flagged ${found} outliers in ${Object.keys(this.highlights).length} columns`, 'warning');
                }
            },

            analyzeTypes() {
                if (this.rows === 0) {
                    this.addLog('No data to analyze', 'warning');
                    return;
                }
                const types = {};
                this.columns.forEach(col => {
                    const vals = this.getColumnValues(col);
                    if (vals.length === 0) {
                        types[col] = 'empty';
                        return;
                    }

                    const isNum = vals.every(v => !isNaN(parseFloat(v)) && isFinite(v));
                    if (isNum) { types[col] = 'numeric'; return; }

                    const isBool = vals.every(v =>
                        v === 'true' || v === 'false' ||
                        v === 'True' || v === 'False' ||
                        v === 'TRUE' || v === 'FALSE' ||
                        v === '0' || v === '1'
                    );
                    if (isBool) { types[col] = 'boolean'; return; }

                    const isDate = vals.every(v => !isNaN(Date.parse(v)));
                    if (isDate) { types[col] = 'date'; return; }

                    types[col] = 'text';
                });

                const summary = Object.entries(types)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(', ');
                this.addLog(`Column types: ${summary}`, 'success');
            },

            generateSummary() {
                if (this.rows === 0) {
                    this.addLog('No data to summarize', 'warning');
                    return;
                }
                let numCols = 0, textCols = 0, dateCols = 0, boolCols = 0, emptyCols = 0;
                this.columns.forEach(col => {
                    const vals = this.getColumnValues(col);
                    if (vals.length === 0) { emptyCols++; return; }
                    const isNum = vals.every(v => !isNaN(parseFloat(v)) && isFinite(v));
                    if (isNum) { numCols++; return; }
                    const isBool = vals.every(v =>
                        v === 'true' || v === 'false' || v === 'True' || v === 'False' ||
                        v === 'TRUE' || v === 'FALSE' || v === '0' || v === '1'
                    );
                    if (isBool) { boolCols++; return; }
                    const isDate = vals.every(v => !isNaN(Date.parse(v)));
                    if (isDate) { dateCols++; return; }
                    textCols++;
                });
                this.addLog(
                    `${this.rows} rows · ${this.cols} cols · ` +
                    `${numCols} numeric · ${textCols} text · ` +
                    `${dateCols} date · ${boolCols} boolean · ${emptyCols} empty`,
                    'info'
                );
            },

            // ---- Sample ----
            generateSample() {
                const sampleData = [
                    { id: 1, name: 'Alpha', value: 42, active: true, date: '2024-01-15' },
                    { id: 2, name: 'Beta', value: 73, active: false, date: '2024-02-20' },
                    { id: 3, name: 'Gamma', value: 99, active: true, date: '2024-03-10' },
                    { id: 4, name: 'Delta', value: 56, active: true, date: '2024-04-05' },
                    { id: 5, name: 'Epsilon', value: 88, active: false, date: '2024-05-12' },
                    { id: 6, name: 'Zeta', value: 34, active: true, date: '2024-06-18' },
                    { id: 7, name: 'Eta', value: 95, active: true, date: '2024-07-22' },
                    { id: 8, name: 'Theta', value: 67, active: false, date: '2024-08-30' },
                    { id: 9, name: 'Iota', value: 81, active: true, date: '2024-09-14' },
                    { id: 10, name: 'Kappa', value: 49, active: true, date: '2024-10-01' }
                ];
                this.columns = Object.keys(sampleData[0]);
                this.rawData = JSON.parse(JSON.stringify(sampleData));
                this.originalData = JSON.parse(JSON.stringify(sampleData));
                this.addLog(`Loaded ${this.rows} sample rows`, 'success');
            },

            // ---- Reset ----
            resetData() {
                if (this.originalData.length === 0) {
                    this.addLog('No original data to restore', 'warning');
                    return;
                }
                this.rawData = JSON.parse(JSON.stringify(this.originalData));
                this.highlights = {};
                this.addLog(`Restored ${this.rows} rows`, 'success');
            },

            clearAll() {
                if (this.rows === 0 && this.logs.length === 0) {
                    this.addLog('Nothing to clear', 'warning');
                    return;
                }
                this.rawData = [];
                this.columns = [];
                this.originalData = [];
                this.highlights = {};
                this.pasteText = '';
                this.logs = [];
                this.logId = 0;
                this.addLog('Cleared all data', 'success');
            },

            // ---- Export ----
            exportCSV() {
                if (this.rows === 0) {
                    this.addLog('No data to export', 'warning');
                    return;
                }
                const headers = this.columns.join(',');
                const rows = this.rawData.map(row => {
                    return this.columns.map(col => {
                        let v = row[col] !== undefined ? row[col] : '';
                        if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
                            v = '"' + v.replace(/"/g, '""') + '"';
                        }
                        return v;
                    }).join(',');
                }).join('\n');
                const csv = headers + '\n' + rows;
                this.downloadFile(csv, `forge-${Date.now()}.csv`, 'text/csv');
                this.addLog(`Exported ${this.rows} rows to CSV`, 'success');
            },

            exportJSON() {
                if (this.rows === 0) {
                    this.addLog('No data to export', 'warning');
                    return;
                }
                const json = JSON.stringify(this.rawData, null, 2);
                this.downloadFile(json, `forge-${Date.now()}.json`, 'application/json');
                this.addLog(`Exported ${this.rows} rows to JSON`, 'success');
            },

            async exportPDF() {
                if (this.rows === 0) {
                    this.addLog('No data to export', 'warning');
                    return;
                }

                try {
                    const { PDFDocument, StandardFonts, rgb } = PDFLib;
                    const doc = await PDFDocument.create();
                    const page = doc.addPage([612, 792]);
                    const { width, height } = page.getSize();
                    const font = await doc.embedFont(StandardFonts.Helvetica);
                    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

                    let y = height - 40;
                    const m = 40;
                    const lh = 12;
                    const fs = 7;

                    page.drawText('Data Forge — Export', {
                        x: m,
                        y: y,
                        size: 14,
                        font: bold,
                        color: rgb(0.1, 0.1, 0.1)
                    });
                    y -= 24;

                    const meta = `${this.rows} rows · ${this.cols} cols · ${this.missing}% missing · ${this.score}% health`;
                    page.drawText(meta, {
                        x: m,
                        y: y,
                        size: 8,
                        font: font,
                        color: rgb(0.3, 0.3, 0.3)
                    });
                    y -= 16;

                    const cols = this.columns;
                    const cw = cols.map(c => Math.max(c.length * 5 + 8, 30));
                    let tw = cw.reduce((a, b) => a + b, 0);
                    if (tw > width - m * 2) {
                        const scale = (width - m * 2) / tw;
                        cw.forEach((w, i) => cw[i] = Math.max(w * scale * 0.9, 20));
                    }

                    let x = m;
                    cols.forEach((col, i) => {
                        page.drawText(col.slice(0, 20), {
                            x: x + 1,
                            y: y,
                            size: fs + 0.5,
                            font: bold,
                            color: rgb(0.1, 0.1, 0.1)
                        });
                        x += cw[i] + 2;
                    });
                    y -= lh;

                    const maxRows = Math.min(80, this.rows);
                    let rowCount = 0;
                    for (let r = 0; r < maxRows; r++) {
                        if (y < 30) {
                            const np = doc.addPage([612, 792]);
                            y = height - 40;
                            x = m;
                            cols.forEach((col, i) => {
                                np.drawText(col.slice(0, 20), {
                                    x: x + 1,
                                    y: y,
                                    size: fs + 0.5,
                                    font: bold,
                                    color: rgb(0.1, 0.1, 0.1)
                                });
                                x += cw[i] + 2;
                            });
                            y -= lh;
                            const row = this.rawData[r];
                            x = m;
                            cols.forEach((col, i) => {
                                const v = row[col] !== undefined && row[col] !== null ?
                                    String(row[col]).slice(0, 35) : '—';
                                np.drawText(v, {
                                    x: x + 1,
                                    y: y,
                                    size: fs - 0.5,
                                    font: font,
                                    color: rgb(0.2, 0.2, 0.2)
                                });
                                x += cw[i] + 2;
                            });
                            y -= lh;
                            rowCount++;
                            continue;
                        }

                        const row = this.rawData[r];
                        x = m;
                        cols.forEach((col, i) => {
                            const v = row[col] !== undefined && row[col] !== null ?
                                String(row[col]).slice(0, 35) : '—';
                            page.drawText(v, {
                                x: x + 1,
                                y: y,
                                size: fs - 0.5,
                                font: font,
                                color: rgb(0.2, 0.2, 0.2)
                            });
                            x += cw[i] + 2;
                        });
                        y -= lh;
                        rowCount++;
                    }

                    if (this.rows > maxRows) {
                        page.drawText(`... and ${this.rows - maxRows} more`, {
                            x: m,
                            y: y,
                            size: 7,
                            font: font,
                            color: rgb(0.5, 0.5, 0.5)
                        });
                    }

                    const pdfBytes = await doc.save();
                    this.downloadFile(pdfBytes, `forge-${Date.now()}.pdf`, 'application/pdf');
                    this.addLog(`Exported ${rowCount} rows to PDF`, 'success');

                } catch (err) {
                    this.addLog(`PDF error: ${err.message}`, 'error');
                }
            },

            downloadFile(content, filename, mimeType) {
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        },
        mounted() {
            const savedTheme = localStorage.getItem('forge-theme');
            if (savedTheme === 'dark') {
                this.darkMode = true;
                document.body.classList.add('dark');
            }

            document.addEventListener('keydown', (e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    const target = e.target;
                    if (target.tagName === 'TEXTAREA') {
                        e.preventDefault();
                        this.parsePaste();
                    }
                }
            });

            this.addLog('Data Forge · Fusion ready', 'success');
            this.addLog('Upload or paste data to begin', 'info');
        }
    });

})();
