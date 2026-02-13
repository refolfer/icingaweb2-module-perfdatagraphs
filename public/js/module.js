;(function(Icinga, $) {

    'use strict';

    // The element in which we will add the charts
    const CHART_CLASS = '.perfdatagraphs-line-chart';
    // Names to identify the warning/critical series
    const CHART_WARN_SERIESNAME = 'warning';
    const CHART_CRIT_SERIESNAME = 'critical';
    // Golden angle in degrees gives distinct colors for sequential series.
    const AUTO_COLOR_GOLDEN_ANGLE = 137.508;

    class Perfdatagraphs extends Icinga.EventListener {
        // plots contains the chart objects with the element ID where it is rendered as key.
        // Used for resizing the charts.
        plots = new Map();
        // Where we store data in between autorefresh
        currentSelect = null;
        currentCursor = null;
        currentSeriesShow = {};

        constructor(icinga)
        {
            super(icinga);

            // We register a ResizeObserver so that we can resize the charts
            // when their respective .container changes size.
            this.resizeObserver = new ResizeObserver(entries => {
                for (let elem of entries) {
                    const plot = this.plots.get(elem.target);
                    if (plot !== undefined) {
                        const s = this.getChartSize(elem.contentRect.width);
                        plot.setSize(s);
                    }
                }
            });

            // TODO: The 'rendered' selectors might not yet be optimal.
            this.on('rendered', '#main > .icinga-module, #main > .container', this.rendered, this);
        }

        /**
         * rendered makes sure the data is available and then renders the charts
         */
        rendered(event, isAutorefresh)
        {
            let _this = event.data.self;

            if (!isAutorefresh) {
                _this.icinga.logger.debug('perfdatagraphs', 'not an autorefresh. resetting');
                // Reset the selection and set the duration when it's
                // an autorefresh and new data is being loaded.
                // _this.currentSelect = {min: 0, max: 0};
                _this.currentSelect = null;
                // 1: value, 2: warning, 3: critical
                _this.currentSeriesShow = {};
                _this.currentCursor = null;
            }

            // Remove leftover eventhandlers and uPlot instances
            _this.plots.forEach((plot, element) => {
                plot.destroy();
            });
            // Then, reset the existing plots map for the new rendering
            _this.plots = new Map();

            // Get the elements we going to render the charts in
            const lineCharts = document.querySelectorAll(CHART_CLASS);

            // Check if the elements exist, just to be safe
            if (lineCharts.length < 1) {
                return;
            }

            _this.renderCharts(lineCharts);
        }

        /**
         * getChartSize is used to recalculate the canvas size based on the
         * object-detail colum width.
         */
        getChartSize(width)
        {
            return {
                // Subtract some pixels to avoid flickering scollbar in Chrome
                // Maybe there's a better way?
                width: width - 10,
                // Collapsed container height is adjusted dynamically after render.
                height: 200,
            };
        }

        /**
         * getXProperty returns the properties for the x-axis.
         * Decided to make this a method to have future customization options.
         */
        getXProperty(axesColor)
        {
            return {
                stroke: axesColor,
                grid: { stroke: axesColor, width: 0.5 },
                // TODO: We should also format datetime here. But thats a bit more work
                ticks: { stroke: axesColor, width: 0.5 }
            };
        }

        /**
         * getYProperty returns the properties for the y-axis.
         * Decided to make this a method to have future customization options.
         */
        getYProperty(axesColor, formatFunction)
        {
            return {
                stroke: axesColor,
                values: formatFunction,
                grid: { stroke: axesColor, width: 0.5 },
                ticks: { stroke: axesColor, width: 0.5 },
                size(self, values, axisIdx, cycleNum) {
                    // We calculate the size of the axis based on the width of the elements
                    let axis = self.axes[axisIdx];

                    // Bail out, force convergence
                    if (cycleNum > 1)
                        return axis._size;

                    let axisSize = axis.ticks.size + axis.gap;

                    // Find longest value
                    let longestVal = (values ?? []).reduce((acc, val) => (val.length > acc.length ? val : acc), "");

                    if (longestVal != "") {
                        self.ctx.font = axis.font[0];
                        axisSize += self.ctx.measureText(longestVal).width / devicePixelRatio;
                    }

                    return Math.ceil(axisSize);
                },
            };
        }

        /**
         * getChartOptions returns shared base options for all charts.
         * These will get merged with individual options (e.g. axes config).
         */
        getChartBaseOptions()
        {
            // Options for formatting datetime
            const timezone = this.icinga.config.timezone;
            const legendFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'short', timeStyle: 'medium', timeZone: timezone}).format;

            // The shared options for each chart. These
            // can then be combined with individual options e.g. the width.
            const opts = {
                cursor: { sync: { key: 0, setSeries: true } },
                tzDate: ts => uPlot.tzDate(new Date(ts * 1e3), timezone),
                fmtDate: tpl => {
                    const tplNew = this.fmtDate(tpl, navigator.language);
                    return uPlot.fmtDate(tplNew)
                },
                scales: {
                    x: { time: true },
                    y: { range: {
                            min: {
                                soft: 0,
                                mode: 1,
                            },
                            max: {
                                soft: 0,
                                mode: 2,
                            },
                        }
                    },
                },
                // series holds the config of each dataset, such as visibility, styling,
                // labels & value display in the legend
                series: [
                    {
                        value: (u, ts) => ts == null ? '' : legendFormat(uPlot.tzDate(new Date(ts * 1e3), timezone))
                    }
                ],
                hooks: {
                    init: [
                        u => {
                            u.over.ondblclick = e => {
                                // We need to reset the currentSelect to the min/max
                                // when we zoom out again.
                                this.currentSelect = {min: 0, max: 0};
                            }
                        }
                    ],
                    setCursor: [
                        (u) => {
                            // We need to store the current cursor
                            // to refresh it when the autorefresh hits.
                            this.currentCursor = u.cursor;
                        }
                    ],
                    setSeries: [
                        (u, sidx) => {
                            // When series are toggled, we store the current option
                            // so that it can be restored when the Icinga Web autorefresh hits.
                            if (u.series[sidx] !== undefined) {
                                this.currentSeriesShow[sidx] = u.series[sidx].show;
                            }
                        }
                    ],
                    setSelect: [
                        u => {
                            // When a select is performed, we store the current selection
                            // so that it can be restored when the Icinga Web autorefresh hits.
                            let _min = u.posToVal(u.select.left, 'x');
                            let _max = u.posToVal(u.select.left + u.select.width, 'x');
                            this.currentSelect = {min: _min, max: _max};
                        }
                    ]
                }
            };

            return opts;
        }

        /**
         * renderCharts creates the canvas objects given the provided datasets.
         */
        renderCharts(lineCharts)
        {
            // Get the colors from these sneaky little HTML elements
            const axesColor = $('div.axes-color').css('background-color');
            const warningColor = $('div.warning-color').css('background-color');
            const criticalColor = $('div.critical-color').css('background-color');
            const valueColor = $('div.value-color').css('background-color');
            // These are the shared options for all charts
            const baseOpts = this.getChartBaseOptions();

            this.icinga.logger.debug('perfdatagraphs', 'start renderCharts');

            const entriesByContainer = new Map();

            for (let elem of lineCharts) {
                this.icinga.logger.debug('perfdatagraphs', 'rendering for', elem);

                let dataset;
                try {
                    dataset = JSON.parse(elem.getAttribute('data-perfdata'));
                } catch (e) {
                    this.icinga.logger.error('perfdatagraphs', 'failed to parse dataset payload', e);
                    continue;
                }

                if (!Array.isArray(dataset.series)) {
                    this.icinga.logger.error('perfdatagraphs', 'dataset has no series array', dataset);
                    continue;
                }

                const rangeFromAttr = elem.getAttribute('data-range-from');
                const rangeToAttr = elem.getAttribute('data-range-to');
                const rangeFrom = rangeFromAttr === null || rangeFromAttr === '' ? null : parseInt(rangeFromAttr, 10);
                const rangeTo = rangeToAttr === null || rangeToAttr === '' ? null : parseInt(rangeToAttr, 10);
                const container = elem.parentElement;
                const entry = {
                    elem: elem,
                    dataset: dataset,
                    rangeFrom: rangeFrom,
                    rangeTo: rangeTo,
                };

                if (!entriesByContainer.has(container)) {
                    entriesByContainer.set(container, []);
                }

                entriesByContainer.get(container).push(entry);
            }

            for (let [container, entries] of entriesByContainer) {
                const groupedCharts = this.groupDatasetsForCharts(entries, valueColor, warningColor, criticalColor);
                const containerElements = entries.map(entry => entry.elem);
                let firstVisibleChartElement = null;

                this.setChartsControlVisibility(container, groupedCharts.length);

                for (let chartIdx = 0; chartIdx < groupedCharts.length; chartIdx++) {
                    const chart = groupedCharts[chartIdx];
                    const elem = containerElements[chartIdx];
                    if (elem === undefined) {
                        break;
                    }

                    // The size can vary from chart to chart for example when
                    // there are two containers on the page.
                    let opts = {...baseOpts, ...this.getChartSize(elem.offsetWidth)};
                    opts.axes = [this.getXProperty(axesColor), this.getYProperty(axesColor, chart.formatYFunction)];
                    opts.title = chart.title;
                    opts.title += chart.unit ? ' | ' + chart.unit : '';

                    // Add each element to the resize observer so that we can
                    // resize the chart when its container changes
                    this.resizeObserver.observe(elem);

                    // Reset the existing canvas elements for the new rendering
                    elem.style.display = '';
                    elem.replaceChildren();

                    let u = new uPlot(opts, [], elem);
                    // Where we store the finished data for the chart
                    let d = [chart.timestamps];

                    for (let idx = 0; idx < chart.series.length; idx++) {
                        const series = chart.series[idx];
                        // See if there are series options from the last autorefresh
                        // if so we use them, otherwise the default.
                        const show = this.currentSeriesShow[idx + 1] ?? series.defaultShow;

                        u.addSeries({
                            label: series.label,
                            stroke: series.stroke,
                            fill: series.fill,
                            show: show,
                            gaps: this.timeseriesThresholdGapFunction,
                            value: chart.formatLegendFunction,
                        }, idx + 1);

                        // Add this to the final data for the chart
                        d.push(series.values);
                    }

                    // Add the data to the chart
                    u.setData(d);

                    // If a selection is stored we restore it.
                    if (this.currentSelect !== null) {
                        u.setScale('x', this.currentSelect);
                    } else if (Number.isFinite(chart.rangeFrom) && Number.isFinite(chart.rangeTo)) {
                        u.setScale('x', { min: chart.rangeFrom, max: chart.rangeTo });
                    }
                    // If a cursor is stored we restore it.
                    if (this.currentCursor !== null) {
                        u.setCursor(this.currentCursor);
                    }

                    // Add the chart to the map which we use for the resize observer
                    this.plots.set(elem, u);

                    if (firstVisibleChartElement === null) {
                        firstVisibleChartElement = elem;
                    }
                }

                for (let idx = groupedCharts.length; idx < containerElements.length; idx++) {
                    containerElements[idx].replaceChildren();
                    containerElements[idx].style.display = 'none';
                }

                this.updateCollapsedContainerHeight(container, firstVisibleChartElement);
            }

            this.icinga.logger.debug('perfdatagraphs', 'finish renderCharts');
        }

        /**
         * updateCollapsedContainerHeight adjusts the collapsed preview height
         * so the first chart (including legend table) is fully visible.
         */
        updateCollapsedContainerHeight(container, firstVisibleChartElement)
        {
            if (container == null || firstVisibleChartElement == null) {
                return;
            }

            // Keep the original fallback while allowing taller legends.
            const baseMinHeight = 275;
            const requiredHeight = Math.ceil(firstVisibleChartElement.scrollHeight + 12);
            const minHeight = Math.max(baseMinHeight, requiredHeight);
            container.style.minHeight = `${minHeight}px`;
        }

        /**
         * groupDatasetsForCharts groups all datasets by unit and aligns their
         * series to a shared timestamps array.
         */
        groupDatasetsForCharts(entries, valueColor, warningColor, criticalColor)
        {
            const groupedByUnit = new Map();

            for (let entry of entries) {
                const dataset = entry.dataset;
                dataset.timestamps = this.ensureArray(dataset.timestamps ?? []);
                const unit = dataset.unit ?? '';
                const key = unit === '' ? '__no_unit__' : unit;

                if (!groupedByUnit.has(key)) {
                    groupedByUnit.set(key, {
                        unit: unit,
                        entries: [],
                        rangeFrom: entry.rangeFrom,
                        rangeTo: entry.rangeTo,
                    });
                }

                const group = groupedByUnit.get(key);
                group.entries.push(entry);
                if (!Number.isFinite(group.rangeFrom) && Number.isFinite(entry.rangeFrom)) {
                    group.rangeFrom = entry.rangeFrom;
                }
                if (!Number.isFinite(group.rangeTo) && Number.isFinite(entry.rangeTo)) {
                    group.rangeTo = entry.rangeTo;
                }
            }

            const groupedCharts = [];

            for (let group of groupedByUnit.values()) {
                // Base format function for the y-axis
                let formatYFunction = (u, vals, space) => vals.map(v => this.formatNumber(v));
                // Override the default uplot callback so that smaller values are
                // shown in the hover and not rounded.
                let formatLegendFunction = (u, rawValue) => rawValue == null ? '' : this.formatNumber(rawValue);

                // We change the format function based on the unit of the dataset
                // This can be extended in the future:
                // - Create a new format function that returns a formated string for the given value
                // - Add a new case with the function here
                // - Update the documentation to include the new format option
                const unitInfo = this.detectUnitType(group);
                switch (unitInfo.type) {
                case 'bytes':
                    formatYFunction = (u, vals, space) => vals.map(v => this.formatBytesHuman(v, unitInfo));
                    formatLegendFunction = (u, rawValue) => rawValue == null ? '' : this.formatBytesHuman(rawValue, unitInfo) + ' (' + this.formatNumber(rawValue) + ')';
                    break;
                case 'seconds':
                    formatYFunction = (u, vals, space) => vals.map(v => this.formatTimeSeconds(v));
                    formatLegendFunction = (u, rawValue) => rawValue == null ? '' : this.formatTimeSeconds(rawValue) + ' (' + this.formatNumber(rawValue) + ')';
                    break;
                case 'percentage':
                    formatYFunction = (u, vals, space) => vals.map(v => this.formatPercentage(v));
                    formatLegendFunction = (u, rawValue) => rawValue == null ? '' : this.formatPercentage(rawValue) + ' (' + this.formatNumber(rawValue) + ')';
                    break;
                }

                const title = group.entries.length > 1 ? 'Grouped Metrics' : (group.entries[0].dataset.title ?? 'Metrics');
                const timestamps = this.buildSharedTimestamps(group.entries);
                const series = [];
                let metricColorIdx = 0;

                for (let entry of group.entries) {
                    const dataset = entry.dataset;
                    const datasetTimestamps = this.ensureArray(dataset.timestamps ?? []);

                    for (let rawSeries of dataset.series) {
                        const seriesValues = this.ensureArray(rawSeries.values ?? []);
                        const name = rawSeries.name ?? '';
                        const isWarn = name === CHART_WARN_SERIESNAME;
                        const isCrit = name === CHART_CRIT_SERIESNAME;
                        const label = this.getSeriesLabel(dataset.title ?? '', name, group.entries.length);
                        const stroke = isWarn
                            ? warningColor
                            : isCrit
                            ? criticalColor
                            : (dataset.stroke || this.getAutoColor(metricColorIdx++));
                        const fill = isWarn || isCrit
                            ? false
                            : (dataset.fill || this.ensureRgba(stroke || valueColor, 0.22));
                        const defaultShow = isWarn || isCrit ? (dataset.show_thresholds ?? true) : true;

                        series.push({
                            label: label,
                            stroke: stroke || valueColor,
                            fill: fill,
                            defaultShow: defaultShow,
                            values: this.alignSeriesValues(timestamps, datasetTimestamps, seriesValues),
                        });
                    }
                }

                groupedCharts.push({
                    title: title,
                    unit: group.unit,
                    rangeFrom: group.rangeFrom,
                    rangeTo: group.rangeTo,
                    timestamps: timestamps,
                    series: series,
                    formatYFunction: formatYFunction,
                    formatLegendFunction: formatLegendFunction,
                });
            }

            return groupedCharts;
        }

        /**
         * buildSharedTimestamps returns sorted unique timestamps for all entries.
         */
        buildSharedTimestamps(entries)
        {
            const timestampsSet = new Set();

            for (let entry of entries) {
                const timestamps = this.ensureArray(entry.dataset.timestamps ?? []);
                for (let ts of timestamps) {
                    const numericTs = this.toFiniteNumber(ts);
                    if (numericTs !== null) {
                        timestampsSet.add(numericTs);
                    }
                }
            }

            return Array.from(timestampsSet).sort((a, b) => a - b);
        }

        /**
         * alignSeriesValues aligns values to a given shared timestamps array.
         */
        alignSeriesValues(sharedTimestamps, seriesTimestamps, values)
        {
            const valueByTs = new Map();
            const maxLen = Math.min(seriesTimestamps.length, values.length);

            for (let idx = 0; idx < maxLen; idx++) {
                const numericTs = this.toFiniteNumber(seriesTimestamps[idx]);
                if (numericTs !== null) {
                    const numericVal = this.toFiniteNumber(values[idx]);
                    valueByTs.set(numericTs, numericVal ?? null);
                }
            }

            return sharedTimestamps.map(ts => valueByTs.get(ts) ?? null);
        }

        /**
         * getSeriesLabel returns user-facing label for grouped charts.
         */
        getSeriesLabel(datasetTitle, seriesName, groupedDatasetCount)
        {
            if (groupedDatasetCount <= 1) {
                return seriesName;
            }

            if (seriesName === CHART_WARN_SERIESNAME || seriesName === CHART_CRIT_SERIESNAME) {
                return `${datasetTitle} ${seriesName}`;
            }

            if (seriesName === 'value' || seriesName === '') {
                return datasetTitle;
            }

            return `${datasetTitle} ${seriesName}`;
        }

        /**
         * getAutoColor returns deterministic per-series color.
         */
        getAutoColor(idx)
        {
            const hue = Math.round((idx * AUTO_COLOR_GOLDEN_ANGLE) % 360);
            return `hsl(${hue} 70% 45%)`;
        }

        /**
         * setChartsControlVisibility hides chart controls if grouping collapsed
         * all charts into a single plot.
         */
        setChartsControlVisibility(chartContainer, chartCount)
        {
            if (chartContainer == null) {
                return;
            }

            const perfdataRoot = chartContainer.parentElement;
            if (perfdataRoot == null) {
                return;
            }

            const control = perfdataRoot.querySelector('.perfdata-charts-container-control');
            if (control == null) {
                return;
            }

            control.style.display = chartCount > 1 ? '' : 'none';
        }

        /**
         * detectUnitType normalizes unit handling so we can auto-format
         * bytes and common aliases (e.g. B, MB, MiB, B/s).
         */
        detectUnitType(group)
        {
            const rawUnit = (group.unit ?? '').trim();
            const lowerUnit = rawUnit.toLowerCase();
            const isRate = /\/\s*s$/.test(lowerUnit);
            const unitNoRate = lowerUnit.replace(/\/\s*s$/, '').trim();

            const byteUnits = {
                b: {factor: 1, base: 1000},
                byte: {factor: 1, base: 1000},
                bytes: {factor: 1, base: 1000},
                kb: {factor: 1e3, base: 1000},
                mb: {factor: 1e6, base: 1000},
                gb: {factor: 1e9, base: 1000},
                tb: {factor: 1e12, base: 1000},
                pb: {factor: 1e15, base: 1000},
                eb: {factor: 1e18, base: 1000},
                kib: {factor: 1024, base: 1024},
                mib: {factor: 1024 ** 2, base: 1024},
                gib: {factor: 1024 ** 3, base: 1024},
                tib: {factor: 1024 ** 4, base: 1024},
                pib: {factor: 1024 ** 5, base: 1024},
                eib: {factor: 1024 ** 6, base: 1024},
            };

            if (unitNoRate in byteUnits) {
                const config = byteUnits[unitNoRate];
                return {
                    type: 'bytes',
                    factor: config.factor,
                    base: config.base,
                    rateSuffix: isRate ? '/s' : '',
                };
            }

            if (unitNoRate === 'seconds' || unitNoRate === 'second' || unitNoRate === 'sec' || unitNoRate === 's') {
                return { type: 'seconds' };
            }

            if (
                unitNoRate === 'percentage'
                || unitNoRate === 'percent'
                || unitNoRate === 'pct'
                || unitNoRate === '%'
            ) {
                return { type: 'percentage' };
            }

            // Fallback: format as bytes when metric names explicitly mention bytes.
            const mentionsBytes = group.entries.some(entry => {
                const title = (entry.dataset.title ?? '').toLowerCase();
                if (title.includes('byte')) {
                    return true;
                }

                return (entry.dataset.series ?? []).some(series => {
                    const name = (series.name ?? '').toLowerCase();
                    return name.includes('byte');
                });
            });

            if (mentionsBytes) {
                return {
                    type: 'bytes',
                    factor: 1,
                    base: 1000,
                    rateSuffix: '',
                };
            }

            const looksLikeStorageMetric = group.entries.some(entry => {
                const title = (entry.dataset.title ?? '').toLowerCase().trim();
                const driveLetterPattern = /(^|[^a-z])[a-z]:([\\/]|$)/;
                const storageKeywords = /(disk|drive|storage|memory|mem|ram|swap|cache|buffer|volume|filesystem|fs)/;

                if (driveLetterPattern.test(title) || storageKeywords.test(title)) {
                    return true;
                }

                return (entry.dataset.series ?? []).some(series => {
                    const name = (series.name ?? '').toLowerCase().trim();
                    return driveLetterPattern.test(name) || storageKeywords.test(name);
                });
            });

            if (looksLikeStorageMetric || this.looksLikeBytesByMagnitude(group)) {
                return {
                    type: 'bytes',
                    factor: 1,
                    base: 1000,
                    rateSuffix: '',
                };
            }

            return { type: 'default' };
        }

        /**
         * looksLikeBytesByMagnitude applies a conservative heuristic for
         * untyped metrics: very large values are likely byte-sized counters.
         */
        looksLikeBytesByMagnitude(group)
        {
            const values = [];

            for (let entry of group.entries) {
                const series = entry.dataset.series ?? [];
                for (let s of series) {
                    const name = (s.name ?? '').toLowerCase();
                    if (name === CHART_WARN_SERIESNAME || name === CHART_CRIT_SERIESNAME) {
                        continue;
                    }

                    const seriesValues = this.ensureArray(s.values ?? []);
                    for (let v of seriesValues) {
                        const numericValue = this.toFiniteNumber(v);
                        if (numericValue !== null && numericValue !== 0) {
                            values.push(Math.abs(numericValue));
                        }
                    }
                }
            }

            if (values.length < 3) {
                return false;
            }

            values.sort((a, b) => a - b);
            const p50 = values[Math.floor(values.length * 0.5)];
            const p90 = values[Math.floor(values.length * 0.9)];

            // Typical byte-sized values for memory/disk datasets are in the
            // millions and above; this avoids catching normal percentages/timers.
            return p50 >= 1e6 && p90 >= 1e7;
        }

        /**
         * fmtDate reformats uPlot's template a given locale uses the sensible
         * DMY, the cool YMD or the whatever MDY is.
         * We use this when rendering the time in the plots axis
         */
        fmtDate(tpl, locale) {
            const formatter = new Intl.DateTimeFormat(locale);
            const parts = formatter.formatToParts(new Date(2024, 0, 2));
            // This is generally not optimal but should work for now
            const dateOrder = parts
                  .filter(p => ['day', 'month', 'year'].includes(p.type))
                  .map(p => p.type)
                  .join('-');

            // We always want to use a 24-hour timeformat, no am/pm
            // Just for simplicity
            let tplNew = tpl
                .replace('{h}:{mm}{aa}', '{H}:{mm}')
                .replace('{h}{aa}', '{H}:00');

            // This is a bit hacky and not very flexible. However,
            // uPlot doesn't have a good solution for this (yet).
            // At least we can adjust for DMY,YMD,MDY
            switch (dateOrder) {
            case 'day-month-year':
                tplNew = tplNew
                    .replace('{M}/{D}/{YY}', '{D} {MMM} {YY}')
                    .replace('{M}/{D}', '{D} {MMM}')
                    .replace('{M}/{D}\n{YY}', '{D} {MMM}\n{YY}')
                break;
            case 'year-month-day':
                tplNew = tplNew
                    .replace('{M}/{D}/{YY}', '{YY} {MMM} {D}')
                    .replace('{M}/{D}', '{MMM} {D}')
                    .replace('{M}/{D}\n{YY}', '{YY} {MMM}\n{D}')
                break;
            case 'month-day-year':
                tplNew = tplNew
                    .replace('{M}/{D}/{YY}', '{MMM} {D} {YY}')
                    .replace('{M}/{D}', '{MMM} {D}')
                    .replace('{M}/{D}\n{YY}', '{D} {MMM}\n{YY}')
                break;
            }

            return tplNew;
        }

        /**
         * ensureArray ensures the given object is an Array.
         * It will transform Objects if possible.
         * A dirty PHP 8.0 hack since I sometimes used SplFixedArray.
         * Can be removed once PHP 8.0 is ancient history.
         */
        ensureArray(obj) {
            if (typeof obj === 'object' && !Array.isArray(obj)) {
                return Object.values(obj);
            }

            return obj;
        }

        /**
         * Translate a given CSS color to the same color with alpha.
         * Used for the fill of the chart.
         */
        ensureRgba(color, alpha=1) {
            if (typeof color !== 'string') {
                return color;
            }

            // If already in rgba() update the alpha.
            const rgbaMatch = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)$/);
            if (rgbaMatch) {
                const [_, r, g, b] = rgbaMatch;
                return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            }

            // Try to match the rgb format and return with alpha.
            const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
            if (rgbMatch) {
                const [_, r, g, b] = rgbMatch;
                return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            }

            // hsl(H S% L%) syntax used by auto-colors.
            const hslMatch = color.match(/^hsl\(([^)]+)\)$/);
            if (hslMatch) {
                return `hsl(${hslMatch[1]} / ${alpha})`;
            }

            // hsla(H, S, L, A) syntax.
            const hslaMatch = color.match(/^hsla\(([^,]+),\s*([^,]+),\s*([^,]+),\s*[\d.]+\)$/);
            if (hslaMatch) {
                const [_, h, s, l] = hslaMatch;
                return `hsla(${h}, ${s}, ${l}, ${alpha})`;
            }

            // #RRGGBB or #RGB
            if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
                let hex = color.slice(1);
                if (hex.length === 3) {
                    hex = hex.split('').map(c => c + c).join('');
                }

                const r = parseInt(hex.slice(0, 2), 16);
                const g = parseInt(hex.slice(2, 4), 16);
                const b = parseInt(hex.slice(4, 6), 16);
                return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            }

            // If we match nothing return what was given just to be safe.
            return color;
        }

        /**
         * formatNumber returns exponential format for too low/high numbers, so that the y-axis does not grow endlessly.
         * A suffix can be passed to have details in the axis.
         */
        formatNumber(n, suffix)
        {
            if (n == 0) {
                return '0.00';
            }

            let str = Number.isFinite(n) ? n.toFixed(2) : n.toString();

            // If the output would be too long we change to exponential
            if (str.length >= 20) {
                str = Number.isFinite(n) ? n.toExponential(2) : n.toString();
            }

            // Add suffix if it is defined
            if (suffix !== undefined) {
                str = str + ' ' + suffix;
            }

            return str;
        }

        /**
         * formatPercentage returns the given value with % attached.
         */
        formatPercentage(n)
        {
            if (n == 0) {
                return "0.00%";
            }

            let value = n;
            return `${value.toFixed(2)}%`;
        }

        /**
         * formatSeconds turns the number of seconds into a time format
         * TODO: Maybe we should have a helper function that calculates the
         * required number of decimals. Because fixed decimals may not
         * help to distinquish certains values.
         */
        formatTimeSeconds(n)
        {
            if (n == 0) {
                return "0 s";
            }

            let value = n;

            if (Math.abs(n) < 0.000001) {
                value = n * 1e9;
                return `${value.toFixed(2)} ns`;
            }

            if (Math.abs(n) < 0.001) {
                value = n * 1e6;
                return `${value.toFixed(2)} µs`;
            }

            if (Math.abs(n) < 1) {
                value = n * 1e3;
                return `${value.toFixed(2)} ms`;
            }

            // TODO: Plurals could maybe be conditional
            if (Math.abs(n) < 60) {
                return `${value.toFixed(2)} s`;
            }  else if (Math.abs(n) < 3600) {
                value = n / 60;
                return `${value.toFixed(2)} mins`;
            } else if (Math.abs(n) < 86400) {
                value = n / 3600;
                return `${value.toFixed(2)} hours`;
            } else if (Math.abs(n) < 604800) {
                value = n / 86400;
                return `${value.toFixed(2)} days`;
            } else if (Math.abs(n) < 31536000) {
                value = n / 604800;
                return `${value.toFixed(2)} weeks`;
            }

            value = n / 31536000;
            return `${value.toFixed(2)} years`;
        }

        /**
         * formatBytesHuman turns raw values into a readable bytes format.
         * The raw value is scaled via unitInfo.factor first.
         */
        formatBytesHuman(n, unitInfo = {factor: 1, base: 1000, rateSuffix: ''})
        {
            const numericValue = this.toFiniteNumber(n);
            if (numericValue === null) {
                return n.toString();
            }

            if (numericValue === 0) {
                return `0 B${unitInfo.rateSuffix ?? ''}`;
            }

            const factor = Number.isFinite(unitInfo.factor) ? unitInfo.factor : 1;
            const base = unitInfo.base === 1024 ? 1024 : 1000;
            const units = base === 1024
                ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"]
                : ["B", "kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
            const suffix = unitInfo.rateSuffix ?? '';
            const bytes = numericValue * factor;
            const abs = Math.abs(bytes);
            const maxIdx = units.length - 1;
            let idx = abs > 0 ? Math.floor(Math.log(abs) / Math.log(base)) : 0;

            idx = Math.max(0, Math.min(idx, maxIdx));
            const value = (bytes / Math.pow(base, idx)).toFixed(2);

            return `${value} ${units[idx]}${suffix}`;
        }

        /**
         * toFiniteNumber converts numbers and numeric-looking strings to Number.
         * Returns null for non-numeric values.
         */
        toFiniteNumber(value)
        {
            if (Number.isFinite(value)) {
                return value;
            }

            if (typeof value === 'string') {
                const normalized = value.trim().replace(',', '.');
                if (normalized === '') {
                    return null;
                }

                const numeric = Number(normalized);
                if (Number.isFinite(numeric)) {
                    return numeric;
                }
            }

            return null;
        }

        /**
         * timeseriesThresholdGapFunction is a gap function for uPlot
         * to add gaps for then there is no data.
         */
        timeseriesThresholdGapFunction(u, sidx, idx0, idx1, nullGaps)
        {
            let xData = u.data[0];
            let yData = u.data[sidx];

            // If the timestamps differ by delta (e.g. the check_interval)
            // we add a gap. But users can change the check_interval.
            // Thus, we calculate delta for the entire set and then
            // if there is a change in deltas.
            let previousDelta = 60; // We start at 60 since 1m is Icinga2's default
            // Since check_interval is not perfect, we expect some jitter
            const jitter = 5; // I chose 5 arbitrarily
            // Just for convenience
            const isNum = Number.isFinite;

            let addlGaps = [];

            for (let i = idx0 + 1; i <= idx1; i++) {
                if (isNum(yData[i]) && isNum(yData[i-1])) {
                    const currentDelta = xData[i] - xData[i - 1];

                    if (currentDelta > previousDelta + jitter) {
                        uPlot.addGap(
                            addlGaps,
                            Math.round(u.valToPos(xData[i - 1], 'x', true)),
                            Math.round(u.valToPos(xData[i],     'x', true)),
                        );
                    }

                    previousDelta = currentDelta;
                }
            }

            nullGaps.push(...addlGaps);
            nullGaps.sort((a, b) => a[0] - b[0]);

            return nullGaps;
        }
    }

    Icinga.Behaviors.Perfdatagraphs = Perfdatagraphs;

}(Icinga, jQuery));
