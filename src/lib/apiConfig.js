import { Capacitor } from '@capacitor/core';

export const PRODUCTION_API_URL = 'https://studyhub-backend-opdd.onrender.com';

const rawUrl = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || '').trim();
const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform();

// In native Capacitor builds or in production builds with missing/localhost URLs, always use production backend
export const API_BASE_URL = (
  (isNative || !rawUrl || rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1')) && import.meta.env.PROD
    ? PRODUCTION_API_URL
    : (rawUrl || PRODUCTION_API_URL)
).replace(/\/+$/, '');

export default API_BASE_URL;
