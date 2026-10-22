/**
 * notificationBannerService.js
 * Event dispatcher for displaying in-app notification banners.
 */

const EVENT_NAME = 'studyhub:notification_banner';

/**
 * Trigger an in-app notification banner from anywhere in the application.
 * @param {Object} options
 * @param {string} [options.title] - Banner title (defaults to "New Notes Uploaded" or upload type)
 * @param {string} [options.body] - Fallback message
 * @param {string} [options.type] - 'notes' | 'paper' | 'tutorial' | 'upload'
 * @param {string} [options.program] - Program name / code (e.g. "BSE")
 * @param {string} [options.course] - Course name (e.g. "Surveying")
 * @param {string|number} [options.semester] - Semester (e.g. "1")
 * @param {string} [options.filename] - Original file name (e.g. "Surveying_Lecture1.pdf")
 * @param {string} [options.imageUrl] - Image / thumbnail URL of the uploaded item
 * @param {string} [options.url] - Deep link URL to navigate on click
 * @param {number} [options.duration] - Auto dismiss duration in ms (default: 8500)
 */
export function showNotificationBanner(options) {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent(EVENT_NAME, { detail: options });
  window.dispatchEvent(event);
}

export function subscribeNotificationBanner(callback) {
  if (typeof window === 'undefined') return () => {};
  const handler = (e) => callback(e.detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
