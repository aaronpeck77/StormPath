import { registerPlugin } from "@capacitor/core";

const StormpathMapboxNavigation = registerPlugin("StormpathMapboxNavigation", {
  web: () => import("./web.js").then((m) => new m.StormpathMapboxNavigationWeb()),
});

export { StormpathMapboxNavigation };
