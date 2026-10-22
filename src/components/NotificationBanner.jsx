import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, X, ArrowRight, BookOpen, Layers } from 'lucide-react';
import { subscribeNotificationBanner } from '../utils/notificationBannerService';

export default function NotificationBanner() {
  const [notification, setNotification] = useState(null);
  const [isExiting, setIsExiting] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const remainingTimeRef = useRef(null);
  const navigate = useNavigate();

  const dismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      setNotification(null);
      setIsExiting(false);
      setImgError(false);
    }, 280);
  }, []);

  const handleBannerClick = useCallback((e) => {
    // If the close button was clicked, don't navigate
    if (e.target.closest('button[data-dismiss="true"]')) {
      return;
    }
    const targetUrl = notification?.url;
    dismiss();
    if (targetUrl) {
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        window.location.href = targetUrl;
      } else {
        navigate(targetUrl);
      }
    }
  }, [notification, navigate, dismiss]);

  useEffect(() => {
    const unsubscribe = subscribeNotificationBanner((data) => {
      if (!data) return;
      setImgError(false);
      setIsExiting(false);
      setNotification(data);
      const duration = data.duration || 8500;
      remainingTimeRef.current = duration;
      startTimeRef.current = Date.now();

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        dismiss();
      }, duration);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dismiss]);

  const handleMouseEnter = () => {
    setIsPaused(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      const elapsed = Date.now() - (startTimeRef.current || Date.now());
      remainingTimeRef.current = Math.max(1000, (remainingTimeRef.current || 8500) - elapsed);
    }
  };

  const handleMouseLeave = () => {
    setIsPaused(false);
    startTimeRef.current = Date.now();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dismiss();
    }, remainingTimeRef.current || 4000);
  };

  if (!notification) return null;

  const isNotes = notification.type === 'notes' || (notification.uploadType && notification.uploadType.toLowerCase() === 'notes') || (notification.title && notification.title.toLowerCase().includes('note'));
  const isPaper = notification.type === 'paper' || (notification.uploadType && notification.uploadType.toLowerCase().includes('paper')) || (notification.title && notification.title.toLowerCase().includes('paper'));
  const isTutorial = notification.type === 'tutorial' || (notification.uploadType && notification.uploadType.toLowerCase() === 'tutorial') || (notification.title && notification.title.toLowerCase().includes('tutorial'));

  const badgeText = isNotes ? 'New Notes' : isTutorial ? 'New Tutorial' : isPaper ? 'Past Paper' : 'Upload';
  const rawTitle = notification.title || (isNotes ? 'New Notes Uploaded' : 'New Upload');

  // Program, course, semester
  const program = notification.program || '';
  const course = notification.course || notification.courseName || '';
  const semester = notification.semester ? String(notification.semester) : '';
  const filename = notification.filename || notification.fileName || '';
  const imageUrl = notification.imageUrl || notification.image || null;

  return (
    <aside
      aria-label="Notification announcement"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleBannerClick}
      className={`fixed top-3 left-3 right-3 sm:left-auto sm:right-6 sm:w-[440px] z-[99999] cursor-pointer select-none transition-all duration-300 ease-out transform ${
        isExiting
          ? '-translate-y-6 opacity-0 scale-95 pointer-events-none'
          : 'translate-y-0 opacity-100 scale-100'
      }`}
    >
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-blue-500/30 text-white shadow-2xl shadow-blue-950/70 ring-1 ring-white/10 backdrop-blur-xl">
        {/* Top Accent Light Bar */}
        <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-400" />

        <div className="p-3.5 flex items-start gap-3.5">
          {/* Document Thumbnail / Image Preview Slot (Never the app logo) */}
          <div className="flex-shrink-0 w-16 h-20 sm:w-18 sm:h-22 rounded-xl overflow-hidden bg-slate-800 border border-slate-700/70 shadow-md relative flex items-center justify-center">
            {imageUrl && !imgError ? (
              <img
                src={imageUrl}
                alt="Uploaded document preview"
                className="w-full h-full object-cover object-top transition-transform duration-200 hover:scale-105"
                onError={() => setImgError(true)}
              />
            ) : (
              /* Fallback: Polished Document Graphic Mockup (NOT the app logo) */
              <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 p-2 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-extrabold uppercase px-1 py-0.2 rounded bg-blue-600/30 text-blue-400 border border-blue-500/40 font-mono">
                    {filename ? filename.split('.').pop()?.toUpperCase() : 'DOC'}
                  </span>
                  <BookOpen size={10} className="text-blue-400" />
                </div>
                {/* Visual document lines simulating paper text */}
                <div className="space-y-1 my-auto">
                  <div className="h-1 bg-slate-600/70 rounded w-full" />
                  <div className="h-1 bg-slate-700/70 rounded w-4/5" />
                  <div className="h-1 bg-slate-700/70 rounded w-3/5" />
                </div>
                <div className="text-[8px] text-slate-400 font-mono truncate">
                  {program || 'StudyHub'}
                </div>
              </div>
            )}
          </div>

          {/* Text and Metadata Body */}
          <div className="flex-1 min-w-0 pr-6">
            {/* Tag and Status Header */}
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30">
                {badgeText}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">Just now</span>
            </div>

            {/* Prompt exact specification: "new notes uploaded for : program, course, semester and show the file name" */}
            {isNotes ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-300 tracking-tight">
                  New notes uploaded for :
                </p>
                <div className="text-sm font-bold text-white flex flex-wrap items-center gap-1.5 leading-snug">
                  <span className="text-blue-400 font-semibold">{program || 'General'}</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-white truncate max-w-[150px]">{course || 'Course'}</span>
                  {semester && (
                    <>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-300 font-normal text-xs">Sem {semester}</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-300 tracking-tight">
                  {rawTitle}
                </p>
                <div className="text-sm font-bold text-white flex flex-wrap items-center gap-1.5 leading-snug">
                  {program && <span className="text-blue-400 font-semibold">{program}</span>}
                  {course && (
                    <>
                      {program && <span className="text-slate-500">•</span>}
                      <span className="text-white truncate max-w-[150px]">{course}</span>
                    </>
                  )}
                  {semester && (
                    <>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-300 font-normal text-xs">Sem {semester}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* File Name Pill */}
            {filename && (
              <div className="mt-1.5 flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/60 rounded-lg px-2 py-1 max-w-full">
                <FileText size={12} className="text-blue-400 flex-shrink-0" />
                <span className="text-xs font-mono text-slate-200 truncate" title={filename}>
                  {filename}
                </span>
              </div>
            )}

            {/* Quick Action Button */}
            <div className="mt-2.5 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 group transition-colors">
                <span>{isNotes ? 'Open Notes' : 'View Item'}</span>
                <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
              </span>
            </div>
          </div>

          {/* Dismiss '×' Button */}
          <button
            type="button"
            data-dismiss="true"
            onClick={(e) => {
              e.stopPropagation();
              dismiss();
            }}
            className="absolute top-2.5 right-2.5 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>

        {/* Animated Countdown Progress Bar */}
        <div className="h-0.5 bg-slate-800 w-full overflow-hidden">
          <div
            className={`h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all ${
              isPaused ? 'opacity-50' : 'opacity-100'
            }`}
            style={{
              animation: isPaused
                ? 'none'
                : `progressCountdown ${notification.duration || 8500}ms linear forwards`,
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes progressCountdown {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </aside>
  );
}
