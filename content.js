// content.js
(() => {
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

  const currencyWord = (symbol) => currencyNames[symbol] || 'money';

  // If the tail after a match contains ANY letter/number, treat that as "text after".
  // (So punctuation like "." or ")" doesn't count as "text after".)
  const hasMeaningfulTextAfter = (fullString, offset, matchLen) => {
    const tail = fullString.slice(offset + matchLen);
    return /[\p{L}\p{N}]/u.test(tail);
  };

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
      re: new RegExp(
        `([${SYMBOLS}])\\s*${NUM}\\s+(million|billion|trillion|thousand)\\b`,
        'gi'
      ),
      fn: (match, sym, amount, _mag, hasAfter) =>
        hasAfter ? `${sym}${amount} ${currencyWord(sym)}` : `${sym}${amount}`
    },

    {
      re: new RegExp(`([${SYMBOLS}])\\s*${NUM}\\s*bn\\b`, 'gi'),
      fn: (match, sym, amount) => `${sym}${amount}${NO_WORD_MARK}`
    },

    {
      re: new RegExp(`([${SYMBOLS}])\\s*${NUM}\\s*[kmbt]\\b`, 'gi'),
      fn: (match, sym, amount) => `${sym}${amount}${NO_WORD_MARK}`
    },

    {
      re: new RegExp(`([${SYMBOLS}])\\s*(\\d+),(\\d{3}(?:,\\d{3})*)(?:\\.\\d+)?\\b`, 'gi'),
      fn: (match, sym, beforeComma, _rest, hasAfter) =>
        hasAfter ? `${sym}${beforeComma} ${currencyWord(sym)}` : `${sym}${beforeComma}`
    },

    {
      re: new RegExp(
        `([${SYMBOLS}])\\s*${NUM}\\b` +
          `(?![.,]\\d)` +
          `(?!\\s*(?:${currencyWordList})\\b)` +
          `(?!${NO_WORD_MARK})`,
        'giu'
      ),
      fn: (match, sym, amount, hasAfter) =>
        hasAfter ? `${sym}${amount} ${currencyWord(sym)}` : `${sym}${amount}`
    }
  ];

  function shouldProcessTextNode(node) {
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
        // args = [match, ...groups, offset, fullString]
        const match = args[0];
        const offset = args[args.length - 2];
        const fullString = args[args.length - 1];
        const groups = args.slice(1, -2);

        const hasAfter = hasMeaningfulTextAfter(fullString, offset, match.length);
        changed = true;
        return fn(match, ...groups, hasAfter);
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

  // Shadow DOM hook (guarded)
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
      } catch (_) {}
      return shadow;
    };
  })();

  function init() {
    if (!document.body) {
      setTimeout(init, 100);
      return;
    }
    observeRoot(document.body);
    enqueueSubtree(document.body);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
