// ============================================================
// App.jsx – Fully optimised with React Query + lazy loading
// ============================================================
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';

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

// ─── Components ────────────────────────────────────────────
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import InstallPrompt from './components/InstallPrompt';
import Viewer from './components/Viewer/Viewer';
// import { BottomNav } from './components/BottomNav'; // if you want to place it globally

// ─── React Query client ────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      cacheTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* 
          Suspense is still here – but with prefetch="intent" on every NavLink,
          the chunks are already loaded before you click, so you'll almost never 
          see the spinner.
        */}
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/papers" element={<ProtectedRoute><PastPapers /></ProtectedRoute>} />
            <Route path="/course" element={<ProtectedRoute><Course /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/Request" element={<ProtectedRoute><Request /></ProtectedRoute>} />
            <Route path="/programs" element={<ProtectedRoute><Programs /></ProtectedRoute>} />
            <Route path="/program-detail" element={<ProtectedRoute><ProgramDetail /></ProtectedRoute>} />
            <Route path="/program-detail/:program" element={<ProtectedRoute><ProgramDetail /></ProtectedRoute>} />
            <Route path="/upload" element={<ProtectedRoute><Upload /></ProtectedRoute>} />
            <Route path="/quiz" element={<ProtectedRoute><Quiz /></ProtectedRoute>} />
            <Route path="/viewer" element={<ProtectedRoute><Viewer /></ProtectedRoute>} />
            <Route path="/file-viewer" element={<ProtectedRoute><Viewer /></ProtectedRoute>} />
            <Route path="/admin/upload" element={<AdminRoute><AdminUpload /></AdminRoute>} />
            <Route path="/AiChat" element={<ProtectedRoute><AiChat /></ProtectedRoute>} />
          </Routes>
        </Suspense>
        <InstallPrompt />
        {/* Uncomment if you want the bottom nav visible on every page */}
        {/* <BottomNav /> */}
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;