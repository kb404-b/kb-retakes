(function () {
  'use strict';

  const root = document.documentElement;
  const storageKey = 'retakes-appearance';
  const alternate = 'blue-pink';
  const classic = 'classic';
  const requested = new URLSearchParams(location.search).get('style');
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch {}
  root.dataset.appearance = requested === alternate || requested === classic
    ? requested
    : saved === alternate ? alternate : classic;

  document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('[data-appearance-toggle]');

    function apply(appearance) {
      root.dataset.appearance = appearance;
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(appearance === alternate));
        button.hidden = false;
      }
    }

    apply(root.dataset.appearance);
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const appearance = root.dataset.appearance === alternate ? classic : alternate;
        apply(appearance);
        try { localStorage.setItem(storageKey, appearance); } catch {}
        const url = new URL(location.href);
        url.searchParams.set('style', appearance);
        history.replaceState(history.state, '', url);
      });
    }
  });
})();
