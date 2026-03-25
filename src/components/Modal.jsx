import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ui } from '../ui/visuals';

export default function Modal({ open, onClose, children, maxWidth = 'max-w-3xl', tone = 'default' }) {
  useEffect(() => {
    const handleEsc = e => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const toneClass = tone === 'workspace' ? 'modal-tone-workspace' : '';

  const modalNode = (
    <div
      className={`modal-overlay overlay-scrim ${toneClass} fixed inset-0 z-[120] p-4 sm:p-6 backdrop-blur-md flex items-center justify-center command-modal-overlay`}
      onClick={onClose}
    >
      <div
        className={`modal-panel frame-elevated-shadow command-modal-panel relative ${maxWidth} w-full max-h-[92vh] overflow-hidden rounded-[0.95rem] border border-border/90 ${ui.card.glass}`}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className={`${ui.button.base} ${ui.button.icon} ${ui.button.ghost} x-action-btn modal-close-btn`}
          aria-label="Close modal"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="overflow-y-auto max-h-[92vh] scroll-container p-1">{children}</div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modalNode;
  return createPortal(modalNode, document.body);
}
