(function () {
  'use strict';

  const SYMBOLS = '$€£¥₹₩₽₺₫₴₦฿₱';
  const currencySymbolRe = new RegExp(`[${SYMBOLS}]`);

  const currencyNames = {
    '$': 'dollars',
    '€': 'euros',
    '£': 'pounds',
    '¥': 'yen',
    '₹': 'rupees',
    '₩': 'won',
    '₽': 'rubles',
    '₺': 'lira',
    '฿': 'baht',
    '₱': 'pesos',
    '₦': 'naira',
    '₴': 'hryvnia',
    '₫': 'dong'
  };

  function currencyWord(symbol) {
    return currencyNames[symbol] || 'money';
  }

  const currencyWordList = Array.from(new Set(Object.values(currencyNames)))
    .sort((a, b) => b.length - a.length)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const patterns = [
    {
      regex: new RegExp(`([${SYMBOLS}])\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s+(million|billion|trillion|thousand)\\b`, 'gi'),
      replacement: (match, symbol, amount) => `${symbol}${amount} ${currencyWord(symbol)}`
    },
    
    {
      regex: new RegExp(`([${SYMBOLS}])\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*(bn|Bn|BN)\\b`, 'gi'),
      replacement: (match, symbol, amount) => `${symbol}${amount} ${currencyWord(symbol)}`
    },
    
    {
      regex: new RegExp(`([${SYMBOLS}])\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*([kmbt])\\b`, 'gi'),
      replacement: (match, symbol, amount) => `${symbol}${amount} ${currencyWord(symbol)}`
    },

    {
      regex: new RegExp(`([${SYMBOLS}])\\s*(\\d+),(\\d{3}(?:,\\d{3})*)(?:\\.\\d+)?\\b`, 'gi'),
      replacement: (match, symbol, beforeComma) => `${symbol}${beforeComma} ${currencyWord(symbol)}`
    },

    {
      regex: new RegExp(
        `([${SYMBOLS}])\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\b` +
          `(?![.,]\\d)` +
          `(?!\\s*(?:${currencyWordList})\\b)`,
        'g'
      ),
      replacement: (match, symbol, amount) => `${symbol}${amount} ${currencyWord(symbol)}`
    }
  ];

  function processTextNode(node) {
    if (node.nodeType !== Node.TEXT_NODE) return;

    const parent = node.parentNode;
    if (!parent) return;

    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'OPTION'].includes(parent.nodeName)) return;
    if (parent.isContentEditable) return;

    let text = node.textContent;
    if (!text || !text.trim()) return;

    if (!currencySymbolRe.test(text)) return;

    const originalText = text;
    let modified = false;

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      text = text.replace(pattern.regex, (match, ...args) => {
        modified = true;
        return typeof pattern.replacement === 'function'
          ? pattern.replacement(match, ...args)
          : pattern.replacement;
      });
    }

    if (modified && text !== originalText) {
      node.textContent = text;
    }
  }

  const processedNodes = new WeakMap();

  const queue = new Set();
  let flushScheduled = false;

  function shouldSkipTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return true;

    const p = node.parentNode;
    if (!p) return true;

    const tag = p.nodeName;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'OPTION'].includes(tag)) return true;
    if (p.isContentEditable) return true;

    const txt = node.textContent || '';
    if (!txt.trim()) return true;

    if (!currencySymbolRe.test(txt)) return true;

    return false;
  }

  function enqueueTextNode(node) {
    if (shouldSkipTextNode(node)) return;
    queue.add(node);
    scheduleFlush();
  }

  function enqueueSubtree(root) {
    if (!root) return;

    if (root.nodeType === Node.TEXT_NODE) {
      enqueueTextNode(root);
      return;
    }

    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (n) => (shouldSkipTextNode(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
      }
    );

    let n;
    while ((n = walker.nextNode())) {
      queue.add(n);
    }

    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;

    requestAnimationFrame(() => {
      flushScheduled = false;

      for (const node of queue) {
        const current = node.textContent || '';
        const last = processedNodes.get(node);

        if (last === current) continue;

        processTextNode(node);
        processedNodes.set(node, node.textContent || '');
      }

      queue.clear();
    });
  }

  function observeRoot(root) {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') {
          enqueueTextNode(m.target);
        } else if (m.type === 'childList') {
          m.addedNodes.forEach((n) => enqueueSubtree(n));
        } else if (m.type === 'attributes') {
          enqueueSubtree(m.target);
        }
      }
    });

    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden', 'open', 'data-state', 'role']
    });

    return observer;
  }

  (function hookShadowDom() {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const shadow = orig.call(this, init);
      try {
        observeRoot(shadow);
        enqueueSubtree(shadow);
      } catch (e) {}
      return shadow;
    };
  })();

  function startDynamicProcessing() {
    observeRoot(document.body);
    enqueueSubtree(document.body);
  }

  function init() {
    if (!document.body) {
      setTimeout(init, 100);
      return;
    }

    startDynamicProcessing();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
