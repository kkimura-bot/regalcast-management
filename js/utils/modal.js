// ============================================================
// Modal helpers
// ============================================================

export function openModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.add('open');
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('open');
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
