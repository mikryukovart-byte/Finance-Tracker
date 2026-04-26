import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#e5e5e5",
        muted: "#9ca3af",
        line: "#2a2a2a",
        paper: "#202020",
        canvas: "#191919",
        sidebar: "#171717",
        soft: "#2a2a2a",
        accent: "#d4d4d4",
        profit: "#8bc99a",
        loss: "#e68a8a",
        warning: "#d6b66d"
      },
      boxShadow: {
        soft: "0 1px 0 rgba(255, 255, 255, 0.03)"
      }
    }
  },
  plugins: []
};

export default config;
