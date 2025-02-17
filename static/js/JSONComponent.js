
function JSONComponent(Utils, sharedUI, renderCallback, saveSettingsCallback, successCallback) {

    function JSONPath(jsonPath = '$') {

        const cleanedPath = jsonPath.substr(1);

        function getNextKey(path) {
            if (path[0] === '.') {
                const match = path.match(/^\.(.*?)[.[]/);
                if (!match) {
                    return [path.substr(1), null];
                }
                const nextPath = path.substr(match.index + match[0].length - 1);
                return [match[1], nextPath.length === 0 ? null : nextPath];
            } else if (path[0] === '[') {
                if (path.length > 3 && path[1] === "'") {
                    // this could just be /\['(.*?)(?<!\\)']/ but Safari doesn't support yet negative lookbehind in RegExp
                    let previousChar = path[2];
                    let isEscaped = false;
                    if (previousChar === "'") {
                        const nextPath = path.substr(4);
                        return ["", nextPath.length === 0 ? null : nextPath];
                    } else {
                        for (let i = 3; i < path.length; i++) {
                            if (path[i] === "'" && previousChar === "\\") {
                                isEscaped = true;
                            } else if (path[i] === "]" && previousChar === "'" && !isEscaped) {
                                const nextPath = path.substr(i + 1);
                                return [path.substring(2, i - 1), nextPath.length === 0 ? null: nextPath];
                            } else {
                                isEscaped = false;
                            }
                            previousChar = path[i];
                        }
                    }
                    return undefined;
                } else {
                    const match = path.match(/^\[([0-9]+)]/);
                    const nextPath = path.substr(match.index + match[0].length);
                    return [parseInt(match[1], 10), nextPath.length === 0 ? null : nextPath];
                }
            }
        }

        function evaluate(o, path) {
            if (!path) {
                return o;
            }
            const nextKeyInfo = getNextKey(path);
            const key = nextKeyInfo[0];
            const nextPath = nextKeyInfo[1];
            return evaluate(o[key], nextPath);
        }

        return {
            evaluate: function(object) {
                try {
                    return evaluate(object, cleanedPath);
                } catch(e) {
                    console.error(e);
                    return undefined;
                }
            }
        };
    }

    class JSONRenderer {

        constructor(elementCreator, options) {
            this.elementCreator = elementCreator;
            this.options = options;
            this.colorRegex = /^#[0-9a-f]{3,6}$/i;
            this.basicJSIdentifier = /^[$_A-Z][$_A-Z0-9]*$/i;
            this.unsafeNumberPaths = [];
        }

        isTimestamp(key) {
            if (!this.options.detectDates || !key) {
                return false;
            }
            const normalizedKey = key.toLowerCase();
            return normalizedKey.endsWith('date') || normalizedKey.endsWith('timestamp') || normalizedKey.endsWith('_ts')
        }

        getDateFromTimestamp(n) {
            const timestamp = (n <= 100000000000 ? n * 1000 : n); // ms
            return new Date(timestamp);
        }

        getURL(s) {
            if (!this.options.detectLinks || !s.startsWith('http')) {
                return undefined;
            }
            try {
                return new URL(s);
            } catch (e) {
                return undefined;
            }
        }

        shouldCollapse(level) {
            return !this.options.expandAll && (this.options.collapseAll || (this.options.expandFirstLevelOnly && level !== 0));
        }

        shouldRenderLazily(level) {
            return !this.options.expandAll && (this.options.expandFirstLevelOnly && level >= 1);
        }

        isHexColor(s) {
            return this.options.previewColors && s.startsWith('#') && s.match(this.colorRegex) !== null;
        }

        getEllipsis(path, count) {
            let ellipsis = Utils.createElement('span', null, ['bj-ext-ell'], null, []);
            ellipsis.innerHTML = '&#8226;&#8226;&#8226;';
            return Utils.createElement('span', `bj-ext-ell-${path}`, ['bj-ext-ellc', 'bj-ext-collapsed'], {'data-bj-ext-tog': path}, [
                ellipsis,
                ` ${count} ${count < 2 ? 'element' : 'elements'} `,
            ])
        }

        getEllipsisIfNeeded(path, count, level) {
            if (!this.shouldCollapse(level)) {
                return [];
            }
            return [
                ' ',
                this.getEllipsis(path, count)
            ];
        }

        getToggler(path, level) {
            return  Utils.createElement('span', '', ['bj-ext-tog', this.shouldCollapse(level) ? 'bj-ext-collapsed' : null], {'data-bj-ext-tog': path});
        }

        highlightResults(elt) {
            if (!this.options.filter) {
                return elt;
            }
            let haystack = elt.textContent;
            let elements = [];
            while (true) { // eslint-disable-line no-constant-condition
                let nextResult = haystack.match(this.options.filter);
                if (nextResult === null) {
                    elements.push(haystack);
                    break;
                }
                if (nextResult.index !== 0) {
                    elements.push(haystack.substr(0, nextResult.index));
                }
                elements.push(Utils.createElement('span', null, ['bj-ext-result'], null, nextResult[0]));
                haystack = haystack.substr(nextResult.index + nextResult[0].length);
            }
            elt.innerHTML = '';
            elt.append(...elements);
            return elt;
        }

        renderNull() {
            return [this.highlightResults(Utils.createElement('span', null, ['bj-ext-null'], null, 'null'))];
        }

        renderString(s) {
            const url = this.getURL(s);
            const escaped = JSON.stringify(s);
            const renderedString = escaped.substr(1, escaped.length - 2);

            if (url !== undefined) {
                return [
                    Utils.createElement('span', null, ['bj-ext-str'], null, [
                        this.highlightResults(Utils.createElement('a', null, null, {href: url.href, rel: 'noopener noreferer'}, renderedString))
                    ])
                ];
            } else if (this.isHexColor(s)) {
                return [
                    this.highlightResults(Utils.createElement('span', null, ['bj-ext-str'], null, renderedString)),
                    Utils.createElement('span', null, ['bj-ext-color'], {style: `background-color: ${s}`}, ' '),
                ];
            }
            return [this.highlightResults(Utils.createElement('span', null, ['bj-ext-str'], null, renderedString))];
        }

        renderNumber(n, key, path) {
            let renderedValue = `${n}`;
            const isUnsafe = (n > Number.MAX_SAFE_INTEGER || n < Number.MIN_SAFE_INTEGER);
            if (isUnsafe) {
                if (unsafeNumberMap[path]) {
                    renderedValue = unsafeNumberMap[path];
                } else {
                    this.unsafeNumberPaths.push(path);
                }
            }
            if (!isUnsafe && this.isTimestamp(key)) {
                const date = this.getDateFromTimestamp(n);
                return [
                    this.highlightResults(Utils.createElement('span', null, ['bj-ext-num'], null, `${n}`)),
                    Utils.createElement('span', null, ['bj-ext-date'], {title: date.toString()}, date.toISOString()),
                ];
            }
            return [this.highlightResults(Utils.createElement('span', isUnsafe ? `unsafe-number-${path}` : null, ['bj-ext-num'], null, renderedValue))];
        }

        renderBoolean(b) {
            return [this.highlightResults(Utils.createElement('span', null, ['bj-ext-bool'], null, `${b}`))];
        }

        renderArrayItems(a, level, path) {
            let arrayChildren = [];
            for (let i = 0; i < a.length; i++) {
                let itemPath = `${path}[${i}]`;
                let item = a[i];
                const children = this.renderValue(item, level + 1, itemPath, undefined);
                if (children === undefined) {
                    continue;
                }
                const isLast = i === a.length - 1;
                arrayChildren.push(Utils.createElement('div', null, null, {'data-path': itemPath}, [
                    this.options.filter ? Utils.createElement('span', null, ['bj-ext-index'], null, `${i}`) : null,
                    ...children,
                    isLast ? '' : ',',
                ]));
            }
            return arrayChildren;
        }

        renderArray(a, level, path) {
            if (a.length === 0) {
                return ['[]'];
            }

            let arrayElement = Utils.createElement('div', path, ['bj-ext-block', this.shouldCollapse(level) ? 'bj-ext-collapsed' : null], {'data-count': `${a.length}`});
            if (this.shouldRenderLazily(level)) {
                arrayElement.__bf__lazy = {
                    value: a,
                    level: level,
                    path: path,
                    options: this.options,
                };
            } else {
                arrayElement.append(...this.renderArrayItems(a, level, path));
            }
            arrayElement.__bf__level = level;

            return [
                this.getToggler(path, level),
                this.options.filter ? Utils.createElement('span', null, ['bj-ext-count'], null, `(${a.length}) `) : null,
                Utils.createElement('span', null, null, {'data-bj-ext-tog': path}, '['),
                ...this.getEllipsisIfNeeded(path, a.length, level),
                arrayElement,
                ']'
            ]
        }

        renderObjectProperties(o, level, path, keys) {
            let finalKeys = keys || Object.keys(o);
            let objectChildren = [];
            if (this.options.sortKeys) {
                finalKeys = finalKeys.sort();
            }

            for (let i = 0; i < finalKeys.length; i++) {
                const key = finalKeys[i];
                const value = o[key];
                let valuePath = '';
                let isBasicIdentifier = this.basicJSIdentifier.test(key);
                if (!isBasicIdentifier) {
                    valuePath = `${path}['${key.replaceAll("'", "\\'")}']`;
                } else {
                    valuePath = `${path}.${key}`;
                }
                const children = this.renderValue(value, level + 1, valuePath, key);
                if (children === undefined) { // filtered array for example
                    continue;
                }
                const isNotLiteral = (typeof value === 'object');

                const escaped = JSON.stringify(key);
                const renderedKey = escaped.substr(1, escaped.length - 2);
                const keyElement = Utils.createElement('div', null, null, {'data-path': valuePath}, [
                    this.highlightResults(Utils.createElement('span', null, ['bj-ext-key', `l${level % 5}`], {'data-bj-ext-tog': isNotLiteral ? valuePath : null}, renderedKey)),
                    ': ',
                    ...children,
                    i === finalKeys.length - 1 ? '' : ',',
                ]);
                objectChildren.push(keyElement);
            }
            return objectChildren;
        }

        renderObject(o, level, path) {
            let keys = Object.keys(o);
            if (keys.length === 0) {
                return ['{}'];
            }

            const objectElement = Utils.createElement('div', path, ['bj-ext-block', this.shouldCollapse(level) ? 'bj-ext-collapsed' : null], {'data-count': `${keys.length}`});
            if (this.shouldRenderLazily(level)) {
                objectElement.__bf__lazy = {
                    value: o,
                    level: level,
                    path: path,
                    keys: keys,
                };
            } else {
                objectElement.append(...this.renderObjectProperties(o, level, path, keys));
            }
            objectElement.__bf__level = level;

            return [
                this.getToggler(path, level),
                Utils.createElement('span', null, null, {'data-bj-ext-tog': path}, ['{']),
                ...this.getEllipsisIfNeeded(path, keys.length, level),
                objectElement,
                '}'
            ]
        }

        renderValue(v, level, path, key) {
            if (v === undefined) {
                return undefined;
            } else if (typeof v === 'string') {
                return this.renderString(v);
            } else if (typeof v === 'boolean') {
                return this.renderBoolean(v);
            } else if (typeof v === 'number') {
                return this.renderNumber(v, key, path);
            } else if (v === null) {
                return this.renderNull();
            } else if (v.constructor === Array) {
                return this.renderArray(v, level, path);
            } else if (typeof v === 'object') {
                return this.renderObject(v, level, path);
            }
            return undefined;
        }

        render(root) {
            return Utils.createElement('div', 'bj-ext-root', null, {'data-path': '$'}, this.renderValue(root, 0, '$', undefined));
        }

        renderLazyElementIfNeeded(elt) {
            const lazyInfo = elt.__bf__lazy;
            if (!lazyInfo) { return; }
            if (Array.isArray(lazyInfo.value)) {
                elt.append(...this.renderArrayItems(lazyInfo.value, lazyInfo.level, lazyInfo.path));
            } else {
                elt.append(...this.renderObjectProperties(lazyInfo.value, lazyInfo.level, lazyInfo.path, lazyInfo.keys));
            }
            delete elt.__bf__lazy;
        }

        renderSubtree(elt, value, path) {
            if (value === undefined && elt.__bf__level !== undefined) {
                return;
            }
            const level = elt.__bf__level;
            if (Array.isArray(value)) {
                elt.innerHTML = '';
                elt.append(...this.renderArrayItems(value, level, path));
            } else {
                elt.innerHTML = '';
                elt.append(...this.renderObjectProperties(value, level, path));
            }
        }

    }

    const ui = {
        jsonPath: undefined,
        jsonPathValue: undefined,
        sortKeys: undefined,
        copyPreserveQuotes: undefined,
        expandAll: undefined,
    };

    const LARGE_FILE_SIZE_THRESHOLD = 2 * 1024 * 1024
    let root = undefined;
    let isLarge = undefined;
    let renderer = undefined;
    let fileSize = 0;
    let unsafeNumberMap = {};
    const path = {
        element: undefined,
        value: undefined,
        highlightedKeyElement: undefined,
    }

    function render(extensionSettings, options, filter, elementCreator) {

        isLarge = fileSize > LARGE_FILE_SIZE_THRESHOLD;

        if (isLarge) {
            sharedUI.largeFileSize.textContent = `${Math.round(fileSize / (1024*1024))}`;
            sharedUI.largeFileWarning.__bf__show('inline-block');
            ui.expandAll.textContent = 'Expand all (slow)';
        }

        if (isLarge && filter && filter.raw.length < 3) {
            return null;
        }

        let finalJSON = root;

        if (filter !== null && (!isLarge || filter.raw.length > 2)) {
            finalJSON = JSON.parse(sharedUI.source.textContent);
            const resultCount = applyFilter(filter.count, finalJSON, '$');
            if (resultCount === 0) {
                sharedUI.filterResults.textContent = 'Not found';
            } else if (resultCount === 1) {
                sharedUI.filterResults.textContent = '1 result';
            } else {
                sharedUI.filterResults.textContent = `${resultCount} results`;
            }
            if (isLarge) {
                isLarge = JSON.stringify(finalJSON).length > LARGE_FILE_SIZE_THRESHOLD;
            }
            sharedUI.filterResults.__bf__show('inline');
        } else {
            sharedUI.filterResults.__bf__hide();
        }

        const finalOptions = {
            ...extensionSettings,
            ...(options || {}),
            filter: filter ? filter.content : null,
            expandFirstLevelOnly: isLarge,
            isLarge: isLarge,
        }

        renderer = new JSONRenderer(elementCreator, finalOptions);

        if (isLarge) {
            sharedUI.prettified.classList.add('bj-ext-large');
        } else {
            sharedUI.prettified.classList.remove('bj-ext-large');
        }

        let result = renderer.render(finalJSON);
        if (renderer.unsafeNumberPaths.length !== 0) {
            Utils.safari.extension.dispatchMessage('JSONFixUnsafeNumbers', {
                paths: renderer.unsafeNumberPaths,
                json: sharedUI.source.textContent
            });
        }
        return result;
    }

    function applyFilter(filter, json, path) {
        if (json === null) {
            const matches = 'null'.match(filter);
            return matches === null ? 0 : matches.length;
        } else if (json.constructor === Array) {
            let results = 0;
            for (let i = 0; i < json.length; i++) {
                const subResults = applyFilter(filter, json[i], unsafeNumberMap.length === 0 ? undefined : `${path}[${i}]`);
                if (subResults === 0) {
                    delete json[i];
                } else {
                    results += subResults;
                }
            }
            return results;
        } else if (typeof json === 'object') {
            let keys = Object.keys(json);
            let results = 0;
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                let subResults = 0;
                let nextKeyPath = null;
                if (unsafeNumberMap.length === 0) {
                    nextKeyPath = undefined;
                } else if (!renderer.basicJSIdentifier.test(key)) {
                    nextKeyPath = `${path}['${key.replaceAll("'", "\\'")}']`;
                } else {
                    nextKeyPath = `${path}.${key}`;
                }
                subResults += applyFilter(filter, json[key], nextKeyPath);
                const keyMatches = key.match(filter);
                if (keyMatches !== null) {
                    subResults += keyMatches.length;
                }
                if (subResults === 0) {
                    delete json[key];
                } else {
                    results += subResults
                }
            }
            return results;
        } else {
            let contentMatches;
            if (path !== undefined && unsafeNumberMap[path]) {
                contentMatches = `${unsafeNumberMap[path]}`.match(filter);
            } else {
                contentMatches = `${json}`.match(filter);
            }
            if (contentMatches === null) {
                return 0;
            }
            return contentMatches.length;
        }
    }

    function getJSONPathElement(element) {
        if (element.hasAttribute('data-path')) {
            return element;
        }
        if (!element.parentElement) {
            return null;
        }
        return getJSONPathElement(element.parentElement);
    }

    function copyJSONPath(path) {
        Utils.safari.extension.dispatchMessage('copyToClipboard', { value: path });
    }

    function copyJSONValue(path) {
        if (!root) {
            return;
        }

        if (unsafeNumberMap[path] !== undefined) {
            Utils.safari.extension.dispatchMessage('copyToClipboard', {value: unsafeNumberMap[path]});
            return;
        }

        const jsonPath = new JSONPath(path);
        const jsonValue = jsonPath.evaluate(root);
        if (jsonValue === undefined) {
            return;
        }

        let value = JSON.stringify(jsonValue, null, 2);
        if (value.length !== 0 && value[0] === '"') {
            value = JSON.parse(value);
        }
        if (typeof jsonValue === 'string' && !!renderer && renderer.options.copyPreserveQuotes) {
            value = `"${value}"`;
        }
        Utils.safari.extension.dispatchMessage('copyToClipboard', { value: value });
    }

    function revealFullTree(info) {
        const blockElement = document.getElementById(info.blockId);
        if (!root || !blockElement) {
            return;
        }
        const jsonPath = new JSONPath(info.blockId);
        const jsonValue = jsonPath.evaluate(root);
        if (jsonValue === undefined) {
            return;
        }
        renderer.renderSubtree(blockElement, jsonValue, info.jsonPath);
    }

    function collapseAll() {
        renderCallback({
            collapseAll: true
        })
    }

    function expandAll() {
        renderCallback({
            expandAll: true
        });
    }

    function fixUnsafeNumbers(unsafeNumbers) {
        const paths = Object.keys(unsafeNumbers);
        paths.forEach( path => {
            let element = document.getElementById(`unsafe-number-${path}`);
            if (element) {
                element.textContent = unsafeNumbers[path];
            }
            unsafeNumberMap[path] = unsafeNumbers[path];
        });

    }

    return {
        tabName: "JSON",
        filterPlaceholder: "Filter JSON",

        render: render,

        renderLazyElement: function(element) {
            renderer.renderLazyElementIfNeeded(element);
        },

        getEllipsis(path, count) {
            return renderer.getEllipsis(path, count);
        },

        onSafariExtensionMessageReceived: function(event) {
            switch (event.name) {
                case "commandCopyJSONPath":
                    copyJSONPath(event.message.jsonPath);
                    break;
                case "commandCopyJSONValue":
                    copyJSONValue(event.message.jsonPath);
                    break;
                case "commandRevealTree":
                    revealFullTree(event.message);
                    break;
                case "unsafeNumbersFixed":
                    fixUnsafeNumbers(event.message.value);
                    break;
                default:
                    break;
            }
        },

        contextMenuUserInfo: function(element, filter) {
            let jsonPathElement = getJSONPathElement(element);
            let userInfo = {
                "isValidJSONSource": !!jsonPathElement
            };
            if (jsonPathElement) {
                let jsonPath = jsonPathElement.getAttribute('data-path');
                let block = document.getElementById(jsonPath);
                if (!block) {
                    let parentPath = jsonPath.replace(/^(.*?)\[[0-9]+]$/, '$1');
                    block = document.getElementById(parentPath);
                    if (!block && jsonPathElement.parentElement) {
                        block = jsonPathElement.parentElement;
                    }
                }
                userInfo["jsonPath"] = jsonPath;
                if (block) {
                    userInfo["blockId"] = block.id;
                    userInfo["isCollapsed"] = block.classList.contains("bj-ext-collapsed");
                }
                if (filter) {
                    userInfo["filter"] = filter.raw;
                }
            }
            return userInfo;
        },

        customActionButtons: function() {
            return `
                <button id="bj-collapse-all">Collapse all</button> 
                <button id="bj-expand-all">Expand all</button>
            `;
        },

        customToolbarElements: function() {
            return `<li id="bj-ext-path">
                        <span>
                        JSONPath: 
                        <span id="bj-ext-path-value"></span>
                        </span>
                    </li>`;
        },

        customSettings: function() {
            return `
                <div class="bj-ext-checkbox-container"><input type="checkbox" value="1" id="bj-setting-sort-keys" data-setting="sortKeys"/><label for="bj-setting-sort-keys">Sort keys</label></div>
                <div class="bj-ext-checkbox-container"><input type="checkbox" value="1" id="bj-setting-copy-preserve-quotes" data-setting="copyPreserveQuotes"/><label for="bj-setting-copy-preserve-quotes">Preserve "quotes" when copying a value</label></div>
            `;
        },

        buildUI: function(elementCreator, isSecurityRestricted) {
            ui.sortKeys = document.getElementById('bj-setting-sort-keys');
            ui.copyPreserveQuotes = document.getElementById('bj-setting-copy-preserve-quotes');
            ui.jsonPath = document.getElementById('bj-ext-path');
            ui.jsonPathValue = document.getElementById('bj-ext-path-value');
            ui.expandAll = document.getElementById('bj-expand-all');

            ui.expandAll.onclick = expandAll;
            document.getElementById('bj-collapse-all').onclick = collapseAll;

            [ui.sortKeys, ui.copyPreserveQuotes].forEach(element => {
                element.addEventListener('change', e => {
                    let settings = {};
                    settings[element.getAttribute('data-setting')] = e.target.checked;
                    saveSettingsCallback(settings);
                });
            });

            if (!isSecurityRestricted) {
                sharedUI.prettified.addEventListener('mouseleave', () => ui.jsonPath.__bf__hide());

                sharedUI.prettified.addEventListener('mousemove', function (e) {
                    if (e.target === path.element) {
                        return;
                    }
                    path.element = e.target;

                    const jsonPathElement = getJSONPathElement(e.target);
                    if (!jsonPathElement) {
                        ui.jsonPath.__bf__hide();
                    } else {
                        const keyElement = jsonPathElement.firstElementChild;
                        if (!isLarge && !!keyElement && keyElement.classList.contains('bj-ext-key') && keyElement !== path.highlightedKeyElement) {
                            if (path.highlightedKeyElement) {
                                path.highlightedKeyElement.style.textDecoration = null;
                            }
                            path.highlightedKeyElement = keyElement;
                            keyElement.style.textDecoration = 'underline';
                        }

                        const jsonPath = jsonPathElement.getAttribute('data-path');
                        if (jsonPath === path.value || jsonPath === '') {
                            return;
                        }
                        ui.jsonPath.__bf__show('flex');
                        ui.jsonPathValue.textContent = jsonPath;
                        path.value = jsonPath;
                    }
                });
            }

            ui.jsonPath.__bf__hide();
        },

        settingsChanged(updatedSettings, previousSettings) {
            return (
                previousSettings.sortKeys !== updatedSettings.sortKeys
                || previousSettings.copyPreserveQuotes !== updatedSettings.copyPreserveQuotes
            );
        },

        applySettings: function(updatedSettings) {
            ui.sortKeys.checked = updatedSettings.sortKeys;
            ui.copyPreserveQuotes.checked = updatedSettings.copyPreserveQuotes;
        },

        start: function() {
            if (!document.body) {
                return false;
            }
            const preElements = document.body.querySelectorAll(':scope > pre');
            if (preElements.length !== 1) {
                return false;
            }

            const sourceElement = preElements[0];
            const source = sourceElement.textContent.trim();
            if (source.length === 0 || (source[0] !== '{' && source[0] !== '[' && source !== 'null')) {
                return false;
            }
            try {
                fileSize = source.length;
                root = JSON.parse(source);
            } catch(e) {
                console.warn('BetterJSON could not parse JSON content:')
                console.warn(e);
                return false;
            }

            successCallback(sourceElement);
        }
    }
}

export const Component = JSONComponent;
