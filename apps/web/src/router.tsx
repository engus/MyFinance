import {
  createContext,
  MouseEvent,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type NavigateOptions = { replace?: boolean };
type RouterValue = { pathname: string; navigate: (to: string, options?: NavigateOptions) => void };

const RouterContext = createContext<RouterValue | null>(null);

function normalizePath(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState(() => normalizePath(window.location.pathname));
  useEffect(() => {
    const onPopState = () => setPathname(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigate = useCallback((to: string, options?: NavigateOptions) => {
    const next = normalizePath(to);
    if (options?.replace) window.history.replaceState(null, '', next);
    else window.history.pushState(null, '', next);
    setPathname(next);
  }, []);
  const value = useMemo(() => ({ pathname, navigate }), [pathname, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function MemoryRouter({
  children,
  initialEntries = ['/'],
}: {
  children: ReactNode;
  initialEntries?: string[];
}) {
  const [pathname, setPathname] = useState(() => normalizePath(initialEntries[0] ?? '/'));
  const navigate = useCallback((to: string) => setPathname(normalizePath(to)), []);
  const value = useMemo(() => ({ pathname, navigate }), [pathname, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const router = useContext(RouterContext);
  if (!router) throw new Error('Router context is missing');
  return router;
}

export function useNavigate() {
  return useRouter().navigate;
}

export function usePathname() {
  return useRouter().pathname;
}

export function Link({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a href={to} className={className} onClick={follow}>
      {children}
    </a>
  );
}

export function NavLink({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string | ((state: { isActive: boolean }) => string);
}) {
  const pathname = usePathname();
  const active = pathname === normalizePath(to);
  const resolvedClassName =
    typeof className === 'function'
      ? className({ isActive: active })
      : (className ?? (active ? 'active' : undefined));
  return (
    <Link to={to} className={resolvedClassName}>
      {children}
    </Link>
  );
}

export function Redirect({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return null;
}
