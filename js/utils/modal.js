// ============================================================
// Modal helpers
// ============================================================

export function openModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.add('open');
  // iOS Safari: prevent background scroll so inputs inside modal get focus correctly
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
}

export function closeModalOuter(event) {
  if (event.target === document.getElementById('modal-overlay')) {
    closeModal();
  }
}

// Assign to window for inline onclick handlers
window.openModal       = openModal;
window.closeModal      = closeModal;
window.closeModalOuter = closeModalOuter;
