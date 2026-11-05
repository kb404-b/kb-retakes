(function () {
  'use strict';

  const root = document.documentElement;
  const storageKey = 'retakes-appearance';
  const requested = new URLSearchParams(location.search).get('style');
  const normalize = value => value === 'blue-pink' ? 'light' : value;
  const valid = value => value === 'light' || value === 'dark';
  const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  let saved;
  try { saved = normalize(localStorage.getItem(storageKey)); } catch {}
  const initial = normalize(requested);
  root.dataset.theme = valid(initial) ? initial : requested !== 'classic' && valid(saved) ? saved : system;

  document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('[data-set-theme]');
    const updateButtons = () => {
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(button.dataset.setTheme === root.dataset.theme));
      }
    };

    updateButtons();
    for (const group of document.querySelectorAll('.theme-switch')) group.hidden = false;
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const theme = button.dataset.setTheme;
        root.dataset.theme = theme;
        updateButtons();
        try { localStorage.setItem(storageKey, theme); } catch {}
        const url = new URL(location.href);
        url.searchParams.set('style', theme);
        history.replaceState(history.state, '', url);
      });
    }
  });
})();
