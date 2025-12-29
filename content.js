// content.js
(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  const TOGGLE_STORAGE_KEY = 'moneyDollarEnabled';
  let isEnabled = true;

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

  function padHundredths(amountStr) {
    const m = amountStr.match(/^(\d+(?:,\d{3})*)(?:\.(\d+))?$/);
    if (!m) return amountStr;
    const intPart = m[1];
    const dec = m[2];
    if (dec && dec.length === 1) return `${intPart}.${dec}0`;
    return amountStr;
  }

  const SKIP_SELECTOR =
    'script,style,noscript,textarea,input,option,pre,code,kbd,samp,[contenteditable="true"]';

  const isInSkippedContext = (textNode) => {
    const el = textNode.parentElement;
    if (!el) return true;
    if (el.isContentEditable) return true;
    return !!el.closest(SKIP_SELECTOR);
  };

  const currencyWordList = Array.from(new Set(Object.values(currencyNames)))
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const NO_WORD_MARK = '\uE000';

  const NUM = '(\\d+(?:,\\d{3})*(?:\\.\\d+)?)';

  const patterns = [
    {
      re: new RegExp(`([${SYMBOLS}])\\s*${NUM}\\s+(million|billion|trillion|thousand)\\b`, 'gi'),
      fn: (_match, sym, amount) => `${sym}${padHundredths(amount)}`
    },

    {
      re: new RegExp(`([${SYMBOLS}])\\s*${NUM}\\s*bn\\b`, 'gi'),
      fn: (_match, sym, amount) => `${sym}${padHundredths(amount)}${NO_WORD_MARK}`
    },

    {
      re: new RegExp(`([${SYMBOLS}])\\s*${NUM}\\s*[kmbt]\\b`, 'gi'),
      fn: (_match, sym, amount) => `${sym}${padHundredths(amount)}${NO_WORD_MARK}`
    },

    {
      re: new RegExp(`([${SYMBOLS}])\\s*(\\d+),(\\d{3}(?:,\\d{3})*)(?:\\.\\d+)?\\b`, 'gi'),
      fn: (_match, sym, beforeComma) => `${sym}${beforeComma}`
    },

    {
      re: new RegExp(
        `([${SYMBOLS}])\\s*${NUM}\\b` +
        `(?![.,]\\d)` +
        `(?!\\s*(?:${currencyWordList})\\b)` +
        `(?!${NO_WORD_MARK})`,
        'giu'
      ),
      fn: (_match, sym, amount) => `${sym}${padHundredths(amount)}`
    }
  ];

  function shouldProcessTextNode(node) {
    if (!isEnabled) return false;
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;

    const txt = node.textContent || '';
    if (!txt.trim()) return false;
    if (!currencySymbolRe.test(txt)) return false;
    if (isInSkippedContext(node)) return false;

    return true;
  }

  function processTextNode(node) {
    if (!shouldProcessTextNode(node)) return;

    const original = node.textContent;
    let text = original;
    let changed = false;

    for (const { re, fn } of patterns) {
      text = text.replace(re, (...args) => {
        const match = args[0];
        const offset = args[args.length - 2];
        const fullString = args[args.length - 1];
        const groups = args.slice(1, -2);

        changed = true;
        return fn(match, ...groups);
      });
    }

    if (text.includes(NO_WORD_MARK)) {
      text = text.replaceAll(NO_WORD_MARK, '');
      changed = true;
    }

    if (changed && text !== original) node.textContent = text;
  }

  const processedNodes = new WeakMap();
  const queue = new Set();
  let flushScheduled = false;

  function enqueueTextNode(node) {
    if (!shouldProcessTextNode(node)) return;
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
        acceptNode: (n) => (shouldProcessTextNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
      }
    );

    let n;
    while ((n = walker.nextNode())) queue.add(n);

    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;

    requestAnimationFrame(() => {
      flushScheduled = false;

      for (const node of queue) {
        if (!node.isConnected) continue;

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
          for (const n of m.addedNodes) enqueueSubtree(n);
        }
      }
    });

    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true
    });

    return observer;
  }

  (function hookShadowDom() {
    const proto = Element.prototype;
    if (proto.__moneyDollarShadowHooked) return;
    Object.defineProperty(proto, '__moneyDollarShadowHooked', { value: true });

    const orig = proto.attachShadow;
    proto.attachShadow = function (init) {
      const shadow = orig.call(this, init);
      try {
        observeRoot(shadow);
        enqueueSubtree(shadow);
      } catch (_) { }
      return shadow;
    };
  })();

  async function checkState() {
    try {
      const result = await api.storage.local.get([TOGGLE_STORAGE_KEY]);
      isEnabled = result[TOGGLE_STORAGE_KEY] !== false;
    } catch (error) {
      console.error('Error checking toggle state:', error);
      isEnabled = false;
    }
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_STATE') {
      isEnabled = message.enabled;
      if (isEnabled && document.body) {
        enqueueSubtree(document.body);
      }
    }
    return true;
  });

  function init() {
    if (!document.body) {
      setTimeout(init, 100);
      return;
    }

    checkState().then(() => {
      if (isEnabled) {
        observeRoot(document.body);
        enqueueSubtree(document.body);
      } else {
        observeRoot(document.body);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
