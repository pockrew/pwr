import { createRoot, createSignal } from "solid-js";

const readSidebarFromStorage = (): boolean => {
  try {
    const saved = localStorage.getItem("admin_sidebar");
    return saved === "collapsed";
  } catch {
    return false;
  }
};

export const sidebarStore = createRoot(() => {
  const [isCollapsed, setIsCollapsed] = createSignal(readSidebarFromStorage());
  const [isMobileOpen, setIsMobileOpen] = createSignal(false);

  return {
    get isCollapsed() {
      return isCollapsed();
    },
    get isMobileOpen() {
      return isMobileOpen();
    },
    toggleSidebar: () => {
      const next = !isCollapsed();
      setIsCollapsed(next);
      try {
        localStorage.setItem("admin_sidebar", next ? "collapsed" : "expanded");
      } catch (error) {
        console.error("[sidebar] Failed to save sidebar state to localStorage", error);
      }
    },
    setCollapsed: (collapsed: boolean) => {
      setIsCollapsed(collapsed);
      try {
        localStorage.setItem("admin_sidebar", collapsed ? "collapsed" : "expanded");
      } catch (error) {
        console.error("[sidebar] Failed to save sidebar state to localStorage", error);
      }
    },
    toggleMobile: () => {
      setIsMobileOpen((prev) => !prev);
    },
    closeMobile: () => {
      setIsMobileOpen(false);
    },
  };
});
