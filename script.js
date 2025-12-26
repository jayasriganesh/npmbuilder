/**
 * npm Command Builder
 * A focused developer utility for correct install commands
 */

(function () {
    'use strict';

    // ========================================
    // State
    // ========================================
    const state = {
        packageManager: 'npm',
        dependencyType: 'prod',
        currentPackage: null,
        history: [],
        isLoading: false,
        suggestions: [],
        selectedSuggestionIndex: -1
    };

    // ========================================
    // Constants
    // ========================================
    const NPM_REGISTRY = 'https://registry.npmjs.org';
    const NPM_SEARCH = 'https://registry.npmjs.org/-/v1/search';
    const SUGGESTION_DELAY = 400;
    const MAX_SUGGESTIONS = 8;
    const MAX_HISTORY = 10;
    const STORAGE_KEY = 'npmcmd_history';

    // ========================================
    // DOM Elements
    // ========================================
    const elements = {
        searchInput: document.getElementById('search'),
        searchLoader: document.querySelector('.search-loader'),
        managerButtons: document.querySelectorAll('[data-manager]'),
        depButtons: document.querySelectorAll('[data-dep]'),
        resultSection: document.querySelector('.result-section'),
        resultPlaceholder: document.querySelector('.result-placeholder'),
        resultContent: document.querySelector('.result-content'),
        errorContent: document.querySelector('.error-content'),
        packageName: document.querySelector('.package-name'),
        packageVersion: document.querySelector('.package-version'),
        packageDescription: document.querySelector('.package-description'),
        maintainer: document.querySelector('.maintainer'),
        updated: document.querySelector('.updated'),
        deprecationWarning: document.querySelector('.deprecation-warning'),
        commandText: document.querySelector('.command-text'),
        copyBtn: document.querySelector('.copy-btn'),
        historySection: document.querySelector('.history-section'),
        historyList: document.querySelector('.history-list'),
        historyClear: document.querySelector('.history-clear'),
        suggestionsList: document.querySelector('.suggestions-list'),
        generateBtn: document.getElementById('generateBtn')
    };

    // ========================================
    // Utilities
    // ========================================
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function formatTimeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'today';
        if (diffDays === 1) return 'yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        return `${Math.floor(diffDays / 365)} years ago`;
    }

    function truncate(str, maxLength = 120) {
        if (!str) return '';
        return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
    }

    // ========================================
    // Command Generation
    // ========================================
    function generateCommand(packageName, version) {
        const pkg = `${packageName}@${version}`;
        const isDev = state.dependencyType === 'dev';

        const commands = {
            npm: isDev ? `npm install ${pkg} --save-dev` : `npm install ${pkg}`,
            yarn: isDev ? `yarn add ${pkg} --dev` : `yarn add ${pkg}`,
            pnpm: isDev ? `pnpm add ${pkg} -D` : `pnpm add ${pkg}`,
            bun: isDev ? `bun add ${pkg} --dev` : `bun add ${pkg}`
        };

        return commands[state.packageManager];
    }

    // ========================================
    // API
    // ========================================
    async function fetchPackage(packageName) {
        const response = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(packageName)}`);

        if (!response.ok) {
            throw new Error('Package not found');
        }

        return response.json();
    }

    async function fetchSuggestions(query) {
        const response = await fetch(`${NPM_SEARCH}?text=${encodeURIComponent(query)}&size=${MAX_SUGGESTIONS}`);

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        return data.objects || [];
    }

    // ========================================
    // UI Updates
    // ========================================
    function setLoading(isLoading) {
        state.isLoading = isLoading;
        elements.searchLoader.classList.toggle('active', isLoading);
    }

    function showPlaceholder() {
        elements.resultPlaceholder.classList.remove('hidden');
        elements.resultContent.classList.add('hidden');
        elements.errorContent.classList.add('hidden');
    }

    function showResult(data) {
        const latestVersion = data['dist-tags']?.latest || 'latest';
        const maintainer = data.maintainers?.[0]?.name || 'Unknown';
        const lastUpdated = data.time?.modified || data.time?.[latestVersion];
        const deprecated = data.versions?.[latestVersion]?.deprecated;

        // Store current package data
        state.currentPackage = {
            name: data.name,
            version: latestVersion,
            description: data.description,
            maintainer,
            lastUpdated,
            deprecated
        };

        // Update UI
        elements.packageName.textContent = data.name;
        elements.packageVersion.textContent = `v${latestVersion}`;
        elements.packageDescription.textContent = truncate(data.description);
        elements.maintainer.textContent = `by ${maintainer}`;
        elements.updated.textContent = lastUpdated ? `updated ${formatTimeAgo(lastUpdated)}` : '';

        // Deprecation warning
        elements.deprecationWarning.classList.toggle('hidden', !deprecated);

        // Command
        updateCommand();

        // Show result
        elements.resultPlaceholder.classList.add('hidden');
        elements.resultContent.classList.remove('hidden');
        elements.errorContent.classList.add('hidden');

        // Add to history
        addToHistory(data.name);

        // Blur search so Ctrl+C works immediately
        elements.searchInput.blur();
    }

    function showError(message = 'Package not found') {
        elements.errorContent.querySelector('.error-text').textContent = message;
        elements.resultPlaceholder.classList.add('hidden');
        elements.resultContent.classList.add('hidden');
        elements.errorContent.classList.remove('hidden');
        state.currentPackage = null;
    }

    function updateCommand() {
        if (!state.currentPackage) return;

        const command = generateCommand(state.currentPackage.name, state.currentPackage.version);
        elements.commandText.textContent = command;
    }

    function updateToggleButtons(buttons, activeValue, dataAttr) {
        buttons.forEach(btn => {
            const isActive = btn.dataset[dataAttr] === activeValue;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', isActive);
        });
    }

    // ========================================
    // History Management
    // ========================================
    function loadHistory() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            state.history = stored ? JSON.parse(stored) : [];
        } catch (e) {
            state.history = [];
        }
        renderHistory();
    }

    function saveHistory() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history));
        } catch (e) {
            // Silently fail if localStorage is unavailable
        }
    }

    function addToHistory(packageName) {
        // Remove if exists
        state.history = state.history.filter(name => name !== packageName);
        // Add to front
        state.history.unshift(packageName);
        // Limit size
        state.history = state.history.slice(0, MAX_HISTORY);

        saveHistory();
        renderHistory();
    }

    function clearHistory() {
        state.history = [];
        saveHistory();
        renderHistory();
    }

    function renderHistory() {
        if (state.history.length === 0) {
            elements.historySection.classList.add('hidden');
            return;
        }

        elements.historySection.classList.remove('hidden');
        elements.historyList.innerHTML = state.history
            .map(name => `<li><button type="button" class="history-item" tabindex="0">${name}</button></li>`)
            .join('');
    }

    // ========================================
    // URL State
    // ========================================
    function parseURL() {
        const params = new URLSearchParams(window.location.search);

        const pkg = params.get('pkg');
        const mgr = params.get('mgr');
        const dep = params.get('dep');

        if (mgr && ['npm', 'yarn', 'pnpm', 'bun'].includes(mgr)) {
            state.packageManager = mgr;
            updateToggleButtons(elements.managerButtons, mgr, 'manager');
        }

        if (dep && ['prod', 'dev'].includes(dep)) {
            state.dependencyType = dep;
            updateToggleButtons(elements.depButtons, dep, 'dep');
        }

        if (pkg) {
            elements.searchInput.value = pkg;
            searchPackage(pkg);
        }
    }

    function updateURL() {
        const params = new URLSearchParams();

        if (state.currentPackage) {
            params.set('pkg', state.currentPackage.name);
        }

        if (state.packageManager !== 'npm') {
            params.set('mgr', state.packageManager);
        }

        if (state.dependencyType !== 'prod') {
            params.set('dep', state.dependencyType);
        }

        const newURL = params.toString()
            ? `${window.location.pathname}?${params.toString()}`
            : window.location.pathname;

        window.history.replaceState({}, '', newURL);
    }

    // ========================================
    // Clipboard
    // ========================================
    async function copyToClipboard() {
        if (!state.currentPackage) return;

        const command = elements.commandText.textContent;

        try {
            await navigator.clipboard.writeText(command);

            elements.copyBtn.classList.add('copied');

            setTimeout(() => {
                elements.copyBtn.classList.remove('copied');
            }, 2000);
        } catch (e) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = command;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);

            elements.copyBtn.classList.add('copied');
            setTimeout(() => {
                elements.copyBtn.classList.remove('copied');
            }, 2000);
        }
    }

    // ========================================
    // Search
    // ========================================
    async function searchPackage(query) {
        const trimmed = query.trim();

        if (!trimmed) {
            showPlaceholder();
            state.currentPackage = null;
            updateURL();
            return;
        }

        setLoading(true);

        try {
            const data = await fetchPackage(trimmed);
            showResult(data);
            updateURL();
        } catch (error) {
            showError();
        } finally {
            setLoading(false);
        }
    }

    // ========================================
    // Event Handlers
    // ========================================
    let suggestionTimeout = null;

    function handleSearchInput(e) {
        const query = e.target.value.trim();

        // Clear any pending suggestion fetch
        if (suggestionTimeout) {
            clearTimeout(suggestionTimeout);
            suggestionTimeout = null;
        }

        // Hide suggestions if input is empty
        if (!query) {
            hideSuggestions();
            return;
        }

        // Fetch suggestions after delay
        suggestionTimeout = setTimeout(async () => {
            try {
                const results = await fetchSuggestions(query);
                state.suggestions = results;
                state.selectedSuggestionIndex = -1;
                renderSuggestions(query);
            } catch (e) {
                hideSuggestions();
            }
        }, SUGGESTION_DELAY);
    }

    function handleSearchKeydown(e) {
        const suggestionsVisible = !elements.suggestionsList.classList.contains('hidden');

        if (suggestionsVisible) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.selectedSuggestionIndex = Math.min(
                    state.selectedSuggestionIndex + 1,
                    state.suggestions.length - 1
                );
                updateSuggestionSelection();
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.selectedSuggestionIndex = Math.max(
                    state.selectedSuggestionIndex - 1,
                    -1
                );
                updateSuggestionSelection();
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                hideSuggestions();
                return;
            }

            if (e.key === 'Enter' && state.selectedSuggestionIndex >= 0) {
                e.preventDefault();
                const selected = state.suggestions[state.selectedSuggestionIndex];
                if (selected) {
                    selectSuggestion(selected.package.name);
                }
                return;
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            hideSuggestions();
            searchPackage(e.target.value);
        }
    }

    function handleSuggestionClick(e) {
        const item = e.target.closest('.suggestion-item');
        if (!item) return;

        const packageName = item.dataset.name;
        if (packageName) {
            selectSuggestion(packageName);
        }
    }

    function handleSearchBlur(e) {
        // Delay hiding to allow click on suggestion
        setTimeout(() => {
            if (!elements.suggestionsList.contains(document.activeElement)) {
                hideSuggestions();
            }
        }, 150);
    }

    function selectSuggestion(packageName) {
        elements.searchInput.value = packageName;
        hideSuggestions();
        searchPackage(packageName);
    }

    function renderSuggestions(query) {
        if (state.suggestions.length === 0) {
            hideSuggestions();
            return;
        }

        const html = state.suggestions.map((item, index) => {
            const pkg = item.package;
            const name = highlightMatch(pkg.name, query);
            const desc = pkg.description ? truncate(pkg.description, 80) : '';
            const activeClass = index === state.selectedSuggestionIndex ? 'active' : '';

            return `
                <li class="suggestion-item ${activeClass}" data-name="${pkg.name}" data-index="${index}">
                    <span class="suggestion-name">${name}</span>
                    ${desc ? `<span class="suggestion-desc">${desc}</span>` : ''}
                </li>
            `;
        }).join('');

        elements.suggestionsList.innerHTML = html;
        elements.suggestionsList.classList.remove('hidden');
    }

    function updateSuggestionSelection() {
        const items = elements.suggestionsList.querySelectorAll('.suggestion-item');
        items.forEach((item, index) => {
            item.classList.toggle('active', index === state.selectedSuggestionIndex);
        });
    }

    function hideSuggestions() {
        elements.suggestionsList.classList.add('hidden');
        elements.suggestionsList.innerHTML = '';
        state.suggestions = [];
        state.selectedSuggestionIndex = -1;
    }

    function highlightMatch(text, query) {
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);

        if (index === -1) return text;

        const before = text.slice(0, index);
        const match = text.slice(index, index + query.length);
        const after = text.slice(index + query.length);

        return `${before}<mark>${match}</mark>${after}`;
    }

    function handleManagerClick(e) {
        const manager = e.target.dataset.manager;
        if (!manager) return;

        state.packageManager = manager;
        updateToggleButtons(elements.managerButtons, manager, 'manager');
        updateCommand();
        updateURL();
    }

    function handleDepClick(e) {
        const dep = e.target.dataset.dep;
        if (!dep) return;

        state.dependencyType = dep;
        updateToggleButtons(elements.depButtons, dep, 'dep');
        updateCommand();
        updateURL();
    }

    function handleHistoryClick(e) {
        const item = e.target.closest('.history-item');
        if (!item) return;

        const packageName = item.textContent;
        elements.searchInput.value = packageName;
        searchPackage(packageName);
    }

    function handleKeyboardShortcuts(e) {
        // Focus search with /
        if (e.key === '/' && document.activeElement !== elements.searchInput) {
            e.preventDefault();
            elements.searchInput.focus();
            return;
        }

        // Copy with Cmd/Ctrl + C when search is not focused
        if ((e.metaKey || e.ctrlKey) && e.key === 'c' && document.activeElement !== elements.searchInput) {
            if (state.currentPackage && window.getSelection().toString() === '') {
                e.preventDefault();
                copyToClipboard();
            }
        }
    }

    // ========================================
    // Initialization
    // ========================================
    function init() {
        // Load history
        loadHistory();

        // Parse URL params
        parseURL();

        // Auto-focus search
        elements.searchInput.focus();

        // Event listeners
        elements.searchInput.addEventListener('input', handleSearchInput);
        elements.searchInput.addEventListener('keydown', handleSearchKeydown);
        elements.searchInput.addEventListener('blur', handleSearchBlur);
        elements.suggestionsList.addEventListener('click', handleSuggestionClick);
        elements.generateBtn.addEventListener('click', function () {
            hideSuggestions();
            searchPackage(elements.searchInput.value);
        });

        elements.managerButtons.forEach(btn => {
            btn.addEventListener('click', handleManagerClick);
        });

        elements.depButtons.forEach(btn => {
            btn.addEventListener('click', handleDepClick);
        });

        elements.copyBtn.addEventListener('click', copyToClipboard);

        elements.historyList.addEventListener('click', handleHistoryClick);
        elements.historyClear.addEventListener('click', clearHistory);

        document.addEventListener('keydown', handleKeyboardShortcuts);
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
