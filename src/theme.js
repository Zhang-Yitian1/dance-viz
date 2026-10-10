// Apply the saved theme before the stylesheet loads to avoid a bright flash.
(() => {
  const key = 'dance-trace-theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try { saved = localStorage.getItem(key); } catch {}
  let manual = saved === 'light' || saved === 'dark';
  function apply(theme) {
    root.dataset.theme = theme;
    document.getElementById('theme-toggle')?.setAttribute('aria-pressed', String(theme === 'dark'));
    window.dispatchEvent(new CustomEvent('themechange', {detail: {theme}}));
  }
  apply(manual ? saved : system.matches ? 'dark' : 'light');
  document.addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      manual = true;
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(theme);
      try { localStorage.setItem(key, theme); } catch {}
    });
  });
  system.addEventListener('change', () => {
    if (!manual) apply(system.matches ? 'dark' : 'light');
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    const theme = event.key === null ? null : event.newValue;
    manual = theme === 'light' || theme === 'dark';
    apply(manual ? theme : system.matches ? 'dark' : 'light');
  });
})();
