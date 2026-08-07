// app.js
const app = new Vue({
    el: '#app',
    data: {
        rawData: [],
        columns: [],
        originalData: [],
        logs: [],
        logId: 0,
        pasteText: ''
    },
    computed: {
        rows() {
            return this.rawData.length;
        },
        cols() {
            return this.columns.length;
        },
        displayData() {
            return this.rawData.slice(0, 100);
        },
        missing() {
            if (this.rows === 0 || this.cols === 0) return 0;
            let count = 0;
            const total = this.rows * this.cols;
            this.rawData.forEach(row => {
                this.columns.forEach(col => {
                    const val = row[col];
                    if (val === undefined || val === null || val === '' || val === 'null' || val === 'undefined') {
                        count++;
                    }
                });
            });
            return Math.round((count / total) * 100);
        },
        score() {
            if (this.rows === 0) return 0;
            let s = 100;
            s -= Math.min(this.missing * 0.5, 40);
            const dupes = this.duplicateCount();
            s -= Math.min(dupes * 0.8, 40);
            return Math.max(0, Math.round(s));
        }
    },
    methods: {
        duplicateCount() {
            const seen = new Set();
            let dupes = 0;
            this.rawData.forEach(row => {
                const key = JSON.stringify(row);
                if (seen.has(key)) dupes++;
                else seen.add(key);
            });
            return dupes;
        },
        addLog(msg) {
            this.logs.push({ id: this.logId++, msg });
            if (this.logs.length > 20) this.logs.shift();
        },
        handleFile(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.pasteText = ev.target.result;
                this.parsePaste();
                this.addLog(`loaded: ${file.name}`);
            };
            reader.readAsText(file);
            e.target.value = '';
        },
        parsePaste() {
            const text = this.pasteText.trim();
            if (!text) {
                this.addLog('nothing to parse');
                return;
            }
            this.parseData(text);
        },
        parseData(text) {
            text = text.trim();
            if (!text) return;

            try {
                // try JSON
                if (text.startsWith('[') || text.startsWith('{')) {
                    const json = JSON.parse(text);
                    if (Array.isArray(json) && json.length > 0) {
                        this.columns = Object.keys(json[0]);
                        this.rawData = json;
                        this.originalData = JSON.parse(JSON.stringify(json));
                        this.addLog(`parsed JSON: ${this.rows} rows, ${this.cols} columns`);
                        return;
                    }
                }

                // try CSV/TSV
                const lines = text.split('\n').filter(l => l.trim());
                if (lines.length < 2) throw new Error('not enough rows');

                const headers = lines[0].split(/[,\t;|]/).map(h => h.trim().replace(/^["']|["']$/g, ''));
                const rows = [];
                for (let i = 1; i < lines.length; i++) {
                    const vals = lines[i].split(/[,\t;|]/).map(v => v.trim().replace(/^["']|["']$/g, ''));
                    const row = {};
                    headers.forEach((h, idx) => {
                        row[h] = vals[idx] !== undefined ? vals[idx] : '';
                    });
                    rows.push(row);
                }

                this.columns = headers;
                this.rawData = rows;
                this.originalData = JSON.parse(JSON.stringify(rows));
                this.addLog(`parsed data: ${this.rows} rows, ${this.cols} columns`);

            } catch (err) {
                this.addLog(`error: ${err.message}`);
            }
        },
        cleanMissing() {
            if (this.rows === 0) return;
            let filled = 0;
            this.rawData.forEach(row => {
                this.columns.forEach(col => {
                    const val = row[col];
                    if (val === undefined || val === null || val === '' || val === 'null' || val === 'undefined') {
                        row[col] = 'missing';
                        filled++;
                    }
                });
            });
            this.addLog(`filled ${filled} missing values`);
        },
        removeDupes() {
            if (this.rows === 0) return;
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
            this.addLog(`removed ${removed} duplicates`);
        },
        normalize() {
            if (this.rows === 0) return;
            let count = 0;
            this.rawData.forEach(row => {
                this.columns.forEach(col => {
                    if (typeof row[col] === 'string') {
                        row[col] = row[col].toLowerCase().trim().replace(/\s+/g, ' ');
                        count++;
                    }
                });
            });
            this.addLog(`normalized ${count} text fields`);
        },
        detectOutliers() {
            if (this.rows < 3) return;
            let found = 0;
            this.columns.forEach(col => {
                const nums = this.rawData.map(r => parseFloat(r[col])).filter(n => !isNaN(n));
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
                    if (!isNaN(val) && (val < lower || val > upper)) {
                        if (!row[col + '_flag']) {
                            row[col + '_flag'] = 'outlier';
                            found++;
                        }
                    }
                });
            });
            this.addLog(`flagged ${found} outliers`);
        },
        resetData() {
            if (this.originalData.length === 0) return;
            this.rawData = JSON.parse(JSON.stringify(this.originalData));
            this.columns.forEach(col => {
                if (col.endsWith('_flag')) {
                    this.rawData.forEach(row => delete row[col]);
                }
            });
            this.addLog('reset to original data');
        },
        exportCSV() {
            if (this.rows === 0) return;
            const headers = this.columns.join(',');
            const rows = this.rawData.map(row => {
                return this.columns.map(col => {
                    let val = row[col] !== undefined ? row[col] : '';
                    if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                        val = '"' + val.replace(/"/g, '""') + '"';
                    }
                    return val;
                }).join(',');
            }).join('\n');
            const csv = headers + '\n' + rows;
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cleanse-${Date.now()}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.addLog(`exported ${this.rows} rows to CSV`);
        },
        async exportPDF() {
            if (this.rows === 0) {
                this.addLog('no data to export');
                return;
            }

            try {
                const { PDFDocument, StandardFonts, rgb } = PDFLib;

                const doc = await PDFDocument.create();
                const page = doc.addPage([600, 800]);
                const { width, height } = page.getSize();
                const font = await doc.embedFont(StandardFonts.Helvetica);
                const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

                let y = height - 50;
                const margin = 50;
                const lineHeight = 16;
                const fontSize = 9;

                page.drawText('cleanse — data export', {
                    x: margin,
                    y: y,
                    size: 14,
                    font: boldFont,
                    color: rgb(0.2, 0.2, 0.2),
                });
                y -= 30;

                const meta = [
                    `rows: ${this.rows}`,
                    `columns: ${this.cols}`,
                    `missing: ${this.missing}%`,
                    `health: ${this.score}%`,
                    `exported: ${new Date().toLocaleString()}`
                ];
                meta.forEach(line => {
                    page.drawText(line, {
                        x: margin,
                        y: y,
                        size: 10,
                        font: font,
                        color: rgb(0.3, 0.3, 0.3),
                    });
                    y -= 16;
                });
                y -= 10;

                page.drawLine({
                    start: { x: margin, y: y + 5 },
                    end: { x: width - margin, y: y + 5 },
                    thickness: 0.5,
                    color: rgb(0.8, 0.8, 0.8),
                });
                y -= 15;

                const cols = this.columns;
                const colWidths = cols.map(c => Math.max(c.length * 6, 40));
                let totalWidth = colWidths.reduce((a, b) => a + b, 0);
                if (totalWidth > width - margin * 2) {
                    const scale = (width - margin * 2) / totalWidth;
                    colWidths.forEach((w, i) => colWidths[i] = w * scale * 0.9);
                }

                let x = margin;
                cols.forEach((col, i) => {
                    page.drawText(col.slice(0, 20), {
                        x: x + 2,
                        y: y,
                        size: fontSize,
                        font: boldFont,
                        color: rgb(0.1, 0.1, 0.1),
                    });
                    x += colWidths[i] + 4;
                });
                y -= lineHeight;

                const maxRows = Math.min(50, this.rows);
                for (let r = 0; r < maxRows; r++) {
                    if (y < 40) {
                        const newPage = doc.addPage([600, 800]);
                        y = height - 40;
                        x = margin;
                        cols.forEach((col, i) => {
                            newPage.drawText(col.slice(0, 20), {
                                x: x + 2,
                                y: y,
                                size: fontSize,
                                font: boldFont,
                                color: rgb(0.1, 0.1, 0.1),
                            });
                            x += colWidths[i] + 4;
                        });
                        y -= lineHeight;
                        const row = this.rawData[r];
                        x = margin;
                        cols.forEach((col, i) => {
                            const val = row[col] !== undefined && row[col] !== null ? String(row[col]).slice(0, 30) : '—';
                            newPage.drawText(val, {
                                x: x + 2,
                                y: y,
                                size: fontSize - 1,
                                font: font,
                                color: rgb(0.2, 0.2, 0.2),
                            });
                            x += colWidths[i] + 4;
                        });
                        y -= lineHeight;
                        continue;
                    }

                    const row = this.rawData[r];
                    x = margin;
                    cols.forEach((col, i) => {
                        const val = row[col] !== undefined && row[col] !== null ? String(row[col]).slice(0, 30) : '—';
                        page.drawText(val, {
                            x: x + 2,
                            y: y,
                            size: fontSize - 1,
                            font: font,
                            color: rgb(0.2, 0.2, 0.2),
                        });
                        x += colWidths[i] + 4;
                    });
                    y -= lineHeight;
                }

                if (this.rows > 50) {
                    page.drawText(`... and ${this.rows - 50} more rows`, {
                        x: margin,
                        y: y,
                        size: 9,
                        font: font,
                        color: rgb(0.5, 0.5, 0.5),
                    });
                }

                const pdfBytes = await doc.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `cleanse-${Date.now()}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this.addLog(`exported ${Math.min(this.rows, 50)} rows to PDF`);

            } catch (err) {
                this.addLog(`PDF error: ${err.message}`);
            }
        }
    }
});
