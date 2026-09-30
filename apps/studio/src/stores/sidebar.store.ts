import { createRoot, createSignal } from "solid-js";

const readSidebarFromStorage = () => {
  try {
    const saved = localStorage.getItem("sidebar");
    if (saved === "collapsed" || saved === "expanded") return saved;
  } catch {}
  return "expanded";
};

const NAV_ITEMS = [
  { route: "/", title: "Requests" },
  { route: "/endpoints", title: "Endpoints" },
  { route: "/settings", title: "Settings" },
];

export const sidebarStore = createRoot(() => {
  const [isCollapsed, setIsCollapsed] = createSignal(readSidebarFromStorage() === "collapsed");
  const [activeRoute, setActiveRoute] = createSignal(NAV_ITEMS[0]);

  if (typeof window !== "undefined") {
    const updateRoute = () => {
      const pathname = window.location.pathname;
      const route = NAV_ITEMS.find((item) =>
        item.route === "/" ? pathname === "/" : pathname.startsWith(item.route),
      );
      setActiveRoute(route ?? NAV_ITEMS[0]);
    };

    window.addEventListener("popstate", updateRoute);

    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args) => {
      const result = originalPushState(...args);
      updateRoute();
      return result;
    };

    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = (...args) => {
      const result = originalReplaceState(...args);
      updateRoute();
      return result;
    };
  }

  return {
    get isCollapsed() {
      return isCollapsed();
    },
    get activeRoute() {
      return activeRoute();
    },
    get navItems() {
      return NAV_ITEMS;
    },
    toggleSidebar: () => {
      const newValue = !isCollapsed();
      setIsCollapsed(newValue);

      try {
        localStorage.setItem("sidebar", newValue ? "collapsed" : "expanded");
      } catch (error) {
        console.error("[sidebar] localStorage is not available", error);
      }
    },
  };
});
