// ============================================================
// App.jsx – Fully optimised with React Query + lazy loading
// ============================================================
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'; // CHANGED
import { queryClient, idbPersister, PERSIST_MAX_AGE } from './lib/queryClient'; // CHANGED — single instance, now persisted to IndexedDB
import { lazy, Suspense } from 'react';
import Timetable from './pages/Timetable';
// ─── Lazy load all pages ──────────────────────────────────
const Home = lazy(() => import('./pages/Home'));
const PastPapers = lazy(() => import('./pages/PastPapers'));
const Profile = lazy(() => import('./pages/Profile'));
const Login = lazy(() => import('./pages/Login'));
const Programs = lazy(() => import('./pages/programs'));
const ProgramDetail = lazy(() => import('./pages/ProgramDetail'));
const Quiz = lazy(() => import('./pages/Quiz'));
const Upload = lazy(() => import('./pages/Upload'));
const Course = lazy(() => import('./pages/Course'));
const Settings = lazy(() => import('./pages/Settings'));
const Request = lazy(() => import('./pages/Request'));
const AiChat = lazy(() => import('./pages/AiChat'));
const AdminUpload = lazy(() => import('./pages/AdminUpload'));
const AdminLive = lazy(() => import('./pages/AdminLive'));
const Tutorials = lazy(() => import('./pages/Tutorials'));

// ─── Components ────────────────────────────────────────────
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import InstallPrompt from './components/InstallPrompt';
import FcmSetup from './components/FcmSetup';
import AnalyticsTracker from './components/AnalyticsTracker';
import UpdateChecker from './components/UpdateChecker';
import NotificationBanner from './components/NotificationBanner';

import Viewer from './components/Viewer/Viewer';
import { AppShell } from './components/AppShell';

// ─── React Query client ────────────────────────────────────
// REMOVED: queryClient is no longer created here. It now lives in
// ./lib/queryClient.js (single instance) so it can be imported by the
// IndexedDB persister setup without a circular dependency, and so any
// other file that ever needs direct access to it (e.g. manual
// queryClient.invalidateQueries calls) imports the same instance.

// ─── Loading fallback ─────────────────────────────────────
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  </div>
);

function App() {
  return (
    // CHANGED: QueryClientProvider -> PersistQueryClientProvider.
    // Same client, same children — this just adds save-to-IndexedDB /
    // restore-from-IndexedDB around it, so every useQuery() in every page
    // below (Home, PastPapers, Quiz, ...) survives a reload with no network.
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: idbPersister, maxAge: PERSIST_MAX_AGE }}
    >
      <BrowserRouter>
        {/* 
          Suspense is still here – but with prefetch="intent" on every NavLink,
          the chunks are already loaded before you click, so you'll almost never 
          see the spinner.
        */}
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* Standalone viewers and full-screen utilities */}
            <Route path="/viewer" element={<ProtectedRoute><Viewer /></ProtectedRoute>} />
            <Route path="/file-viewer" element={<ProtectedRoute><Viewer /></ProtectedRoute>} />

            {/* Admin routes */}
            <Route path="/admin/upload" element={<AdminRoute><AdminUpload /></AdminRoute>} />
            <Route path="/admin/live" element={<AdminRoute><AdminLive /></AdminRoute>} />
            <Route path="/admin/analytics" element={<AdminRoute><AdminLive /></AdminRoute>} />

            {/* Main Application Shell with persistent sidebar & navigation */}
            <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
              <Route path="/" element={<Home />} />
              <Route path="/papers" element={<PastPapers />} />
              <Route path="/programs" element={<Programs />} />
              <Route path="/course" element={<Course />} />
              <Route path="/program-detail" element={<ProgramDetail />} />
              <Route path="/program-detail/:program" element={<ProgramDetail />} />
              <Route path="/quiz" element={<Quiz />} />
              <Route path="/timetable" element={<Timetable />} />
              <Route path="/tutorials" element={<Tutorials />} />
              <Route path="/request" element={<Request />} />
              <Route path="/Request" element={<Request />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/AiChat" element={<AiChat />} />
            </Route>

          </Routes>
        </Suspense>
        <InstallPrompt />
        <FcmSetup />
        <AnalyticsTracker />
        <UpdateChecker />
        <NotificationBanner />
      </BrowserRouter>
    </PersistQueryClientProvider>
  );
}

export default App;