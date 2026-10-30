// src/utils/shareApp.js
// Universal StudyHub sharing utility supporting native share sheet,
// WhatsApp one-click invite, and clipboard copy fallback.

export const SHARE_DATA = {
  title: 'StudyHub LUANAR',
  text: `🎓 Hey! I'm using StudyHub LUANAR for exam prep — past papers, AI tutor, notes & quizzes, all free.\n\nCheck it out 👉 https://studyhub-backend-opdd.onrender.com`,
  url: 'https://studyhub-backend-opdd.onrender.com',
};

export async function shareStudyHub(onToast) {
  // 1. Try Web Share API (native share dialog on mobile/tablet/supported desktops)
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share(SHARE_DATA);
      return { success: true, method: 'native' };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { success: false, method: 'cancelled' };
      }
      // If native sharing fails, fall through
    }
  }

  // 2. WhatsApp web/app fallback
  const msg = encodeURIComponent(SHARE_DATA.text);
  const whatsappUrl = `https://wa.me/?text=${msg}`;

  try {
    const opened = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    if (opened) {
      if (typeof onToast === 'function') onToast('Opening WhatsApp to share StudyHub...');
      return { success: true, method: 'whatsapp' };
    }
  } catch {}

  // 3. Clipboard copy fallback
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(SHARE_DATA.text);
      if (typeof onToast === 'function') onToast('Invite link copied to clipboard!');
      return { success: true, method: 'clipboard' };
    }
  } catch {}

  // Direct redirection fallback
  window.location.href = whatsappUrl;
  return { success: true, method: 'redirect' };
}
