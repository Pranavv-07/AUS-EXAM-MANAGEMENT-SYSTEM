import { useEffect, useState } from 'react';
import { LogOut, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { apiFetch, getAuthToken, setAuthToken } from './lib/api.ts';
import type { User } from './types/exam.ts';
import { UniversityCrest } from './components/UniversityCrest.tsx';
import { LoginView } from './components/LoginView.tsx';
import { PostLoginSplash } from './components/PostLoginSplash.tsx';
import { AdminPortal } from './components/AdminPortal.tsx';
import { ExaminerPortal } from './components/ExaminerPortal.tsx';
import {
  AboutPage,
  ContactPage,
  NotFoundPage,
  PrivacyPolicyPage,
} from './components/StaticPages.tsx';
import {
  CookieBanner,
  FloatingControls,
  ScrollProgressBar,
  SiteFooter,
} from './components/SiteChrome.tsx';

const KNOWN_ROUTES = ['/', '/login', '/about', '/privacy', '/contact'];

function getMetaForPath(pathname: string, user: User | null) {
  switch (pathname) {
    case '/about':
      return {
        title: 'About & FAQ — Aditya University Examination System',
        description:
          'Overview of Aditya University examination seating allocation rules, 54-seat classrooms, 72-seat labs, and FAQ.',
      };
    case '/privacy':
      return {
        title: 'Privacy Policy — Aditya University Examination System',
        description:
          'Institutional data privacy, audit trail governance, and security policy for Aditya University Examination Cell.',
      };
    case '/contact':
      return {
        title: 'Contact Support — Aditya University Examination System',
        description:
          'Reach the Aditya University Examination Cell helpdesk for seating discrepancies or portal support.',
      };
    case '/':
    case '/login':
      if (!user) {
        return {
          title: 'Sign In — Aditya University Examination Seating & Scheduling System',
          description:
            'Authenticate into Aditya University Admin Command Center or Examiner Workspace.',
        };
      }
      return {
        title:
          user.role === 'ADMIN'
            ? 'Admin Command Center — Aditya University Examination System'
            : 'Examiner Workspace — Aditya University Examination System',
        description:
          'Manage examination halls, student cohorts, seating allocations, attendance sheets, and PDF exports.',
      };
    default:
      return {
        title: '404 Page Not Found — Aditya University Examination System',
        description: 'The requested page could not be found.',
      };
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [welcomeUser, setWelcomeUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname || '/');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('au_theme') === 'dark';
  });

  // Sync Dark Mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('au_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('au_theme', 'light');
    }
  }, [darkMode]);

  // Capture UTM tracking params once per session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get('utm_source');
    const utmMedium = params.get('utm_medium');
    const utmCampaign = params.get('utm_campaign');
    if (utmSource) {
      sessionStorage.setItem(
        'au_utm_source',
        [utmSource, utmMedium, utmCampaign].filter(Boolean).join(' / ')
      );
    }
  }, []);

  // Browser back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(window.location.pathname || '/');
      setMobileMenuOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Update dynamic meta title and description
  useEffect(() => {
    const meta = getMetaForPath(currentPath, user);
    document.title = meta.title;
    const descEl = document.querySelector('meta[name="description"]');
    if (descEl) {
      descEl.setAttribute('content', meta.description);
    }
  }, [currentPath, user]);

  // Verify existing auth token
  useEffect(() => {
    async function verifySession() {
      const token = getAuthToken();
      if (!token) {
        setCheckingSession(false);
        return;
      }
      try {
        const res = await apiFetch<{ user: User }>('/api/auth/me');
        setUser(res.user);
      } catch {
        setAuthToken(null);
      } finally {
        setCheckingSession(false);
      }
    }
    void verifySession();
  }, []);

  function navigate(path: string) {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleLogout() {
    setAuthToken(null);
    setWelcomeUser(null);
    setUser(null);
    navigate('/');
  }

  const isKnown = KNOWN_ROUTES.includes(currentPath);

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f8f8] dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-x-hidden">
      <ScrollProgressBar />

      {/* Skip to content link for keyboard/screen-reader accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#0b5299] focus:text-white focus:text-xs"
      >
        Skip to content
      </a>

      {/* Sticky Top Institutional Bar */}
      <header className="no-print sticky top-0 z-40 h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 lg:px-6 flex items-center justify-between gap-4">
        {/* Zone 1: Clickable Official Brand Logo */}
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="Aditya University Examination Cell Home"
          className="flex items-center gap-3 shrink-0 cursor-pointer text-left"
        >
          <UniversityCrest height={34} />
          <span className="hidden sm:inline text-xs font-medium text-slate-600 dark:text-slate-300 border-l border-slate-300 dark:border-slate-700 pl-3 whitespace-nowrap shrink-0">
            Examination Cell
          </span>
        </button>

        {/* Zone 2: Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          <button
            type="button"
            onClick={() => navigate('/')}
            className={`hover:text-[#0b5299] dark:hover:text-sky-400 whitespace-nowrap shrink-0 cursor-pointer ${
              currentPath === '/' || currentPath === '/login'
                ? 'text-[#0b5299] dark:text-sky-400 underline underline-offset-4'
                : ''
            }`}
          >
            {user ? 'Workspace' : 'Portal'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/about')}
            className={`hover:text-[#0b5299] dark:hover:text-sky-400 whitespace-nowrap shrink-0 cursor-pointer ${
              currentPath === '/about'
                ? 'text-[#0b5299] dark:text-sky-400 underline underline-offset-4'
                : ''
            }`}
          >
            About
          </button>
          <button
            type="button"
            onClick={() => navigate('/privacy')}
            className={`hover:text-[#0b5299] dark:hover:text-sky-400 whitespace-nowrap shrink-0 cursor-pointer ${
              currentPath === '/privacy'
                ? 'text-[#0b5299] dark:text-sky-400 underline underline-offset-4'
                : ''
            }`}
          >
            Privacy
          </button>
          <button
            type="button"
            onClick={() => navigate('/contact')}
            className={`hover:text-[#0b5299] dark:hover:text-sky-400 whitespace-nowrap shrink-0 cursor-pointer ${
              currentPath === '/contact'
                ? 'text-[#0b5299] dark:text-sky-400 underline underline-offset-4'
                : ''
            }`}
          >
            Contact
          </button>
        </nav>

        {/* Zone 3: Site Search + Dark Mode + Profile & Logout + Mobile Hamburger */}
        <div className="flex items-center gap-3 shrink-0">
          {user && (currentPath === '/' || currentPath === '/login') && (
            <div className="hidden xl:block relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                aria-label="Quick site search"
                className="w-44 pl-8 pr-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-[#f8f8f8] dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-[#0b5299] cursor-pointer shrink-0"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {user && (
            <>
              <div className="hidden sm:block text-right leading-tight">
                <div className="text-xs font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                  {user.full_name}
                </div>
                <div className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {user.emp_id} · {user.role}
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                style={{ boxShadow: '0 5px 8px rgba(0,0,0,0.08)' }}
                className="flex items-center gap-1.5 px-4 py-1.5 min-h-[36px] text-xs font-semibold text-[#ff0000] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950 rounded-none transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="md:hidden p-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile Navigation"
          className="no-print md:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-col gap-2 text-sm font-medium"
        >
          <button
            type="button"
            onClick={() => navigate('/')}
            className="py-2 text-left text-slate-800 dark:text-slate-100 hover:text-[#0b5299] cursor-pointer"
          >
            {user ? 'Workspace' : 'Portal Login'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/about')}
            className="py-2 text-left text-slate-800 dark:text-slate-100 hover:text-[#0b5299] cursor-pointer"
          >
            About &amp; FAQ
          </button>
          <button
            type="button"
            onClick={() => navigate('/privacy')}
            className="py-2 text-left text-slate-800 dark:text-slate-100 hover:text-[#0b5299] cursor-pointer"
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => navigate('/contact')}
            className="py-2 text-left text-slate-800 dark:text-slate-100 hover:text-[#0b5299] cursor-pointer"
          >
            Contact Support
          </button>
        </nav>
      )}

      {/* Main Content Router */}
      <div className="flex-1 flex flex-col">
        {checkingSession ? (
          <div id="main-content" className="flex-1 flex items-center justify-center p-12">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Loading institutional portal...
            </p>
          </div>
        ) : !isKnown ? (
          <div id="main-content" className="flex-1">
            <NotFoundPage onNavigate={navigate} />
          </div>
        ) : currentPath === '/about' ? (
          <div id="main-content" className="flex-1">
            <AboutPage onNavigate={navigate} />
          </div>
        ) : currentPath === '/privacy' ? (
          <div id="main-content" className="flex-1">
            <PrivacyPolicyPage onNavigate={navigate} />
          </div>
        ) : currentPath === '/contact' ? (
          <div id="main-content" className="flex-1">
            <ContactPage onNavigate={navigate} />
          </div>
        ) : !user ? (
          <div id="main-content" className="flex-1 flex flex-col">
            <LoginView
              onLoginSuccess={(u) => {
                setWelcomeUser(u);
                setUser(u);
                navigate('/');
              }}
            />
          </div>
        ) : user.role === 'ADMIN' ? (
          <AdminPortal currentUser={user} globalSearch={globalSearch} />
        ) : (
          <ExaminerPortal globalSearch={globalSearch} />
        )}
      </div>

      {welcomeUser && (
        <PostLoginSplash user={welcomeUser} onComplete={() => setWelcomeUser(null)} />
      )}

      <SiteFooter onNavigate={navigate} />
      <FloatingControls onNavigateContact={() => navigate('/contact')} currentPath={currentPath} />
      <CookieBanner />
    </div>
  );
}
