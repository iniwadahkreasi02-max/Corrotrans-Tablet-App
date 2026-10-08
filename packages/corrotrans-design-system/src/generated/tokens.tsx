/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#edf2f7",
      "authBackground": "#fff7db",
      "foreground": "#172435",
      "border": "#d5dde6",
      "card": "#fffefa",
      "cardForeground": "#172435",
      "popover": "#fffefa",
      "popoverForeground": "#172435",
      "primary": "#0d5ace",
      "primaryForeground": "#fffbf0",
      "secondary": "#fad21e",
      "secondaryForeground": "#172435",
      "muted": "#e1e7ef",
      "mutedForeground": "#48596f",
      "accent": "#e0f3ff",
      "accentForeground": "#0b4eb1",
      "success": "#21845f",
      "successForeground": "#ffffff",
      "warning": "#a45513",
      "warningForeground": "#ffffff",
      "info": "#3971b9",
      "infoForeground": "#ffffff",
      "destructive": "#c13b30",
      "destructiveForeground": "#ffffff",
      "input": "#d5dde6",
      "ring": "#0e63e1",
      "overlay": "#0a17288f",
      "chart1": "#0d5ace",
      "chart2": "#21845f",
      "chart3": "#b96819",
      "chart4": "#7154ae",
      "chart5": "#e24a3c",
      "sidebar": "#123c76",
      "sidebarForeground": "#fffbf0",
      "sidebarBorder": "#0e356d",
      "sidebarPrimary": "#fad21e",
      "sidebarPrimaryForeground": "#172435",
      "sidebarAccent": "#1f4a80",
      "sidebarAccentForeground": "#ffffff",
      "sidebarRing": "#fad21e"
    },
    "dark": {
      "background": "#121a26",
      "authBackground": "#29261c",
      "foreground": "#fffbf0",
      "border": "#2c3849",
      "card": "#1a2432",
      "cardForeground": "#fffbf0",
      "popover": "#1a2432",
      "popoverForeground": "#fffbf0",
      "primary": "#3187f6",
      "primaryForeground": "#101a27",
      "secondary": "#fad21e",
      "secondaryForeground": "#172435",
      "muted": "#283343",
      "mutedForeground": "#a5b1c0",
      "accent": "#193458",
      "accentForeground": "#c7e9ff",
      "success": "#4eb486",
      "successForeground": "#07170f",
      "warning": "#e7a45c",
      "warningForeground": "#251507",
      "info": "#79aef4",
      "infoForeground": "#0d1724",
      "destructive": "#f06b5f",
      "destructiveForeground": "#121a26",
      "input": "#2c3849",
      "ring": "#3187f6",
      "overlay": "#020810b8",
      "chart1": "#5fa3ff",
      "chart2": "#57c695",
      "chart3": "#e7a45c",
      "chart4": "#b69aed",
      "chart5": "#f07068",
      "sidebar": "#0d1520",
      "sidebarForeground": "#fffbf0",
      "sidebarBorder": "#2c3849",
      "sidebarPrimary": "#3187f6",
      "sidebarPrimaryForeground": "#101a27",
      "sidebarAccent": "#283343",
      "sidebarAccentForeground": "#fffbf0",
      "sidebarRing": "#3187f6"
    }
  },
  "fontFamily": {
    "sans": [
      "DM Sans",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "Menlo",
      "monospace"
    ]
  },
  "radius": "1.15rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
