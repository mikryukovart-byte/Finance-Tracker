import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#f0efed",
        muted: "#bcbab7",
        line: "#2a2a2a",
        paper: "#202020",
        canvas: "#191919",
        sidebar: "#202020",
        soft: "#2c2c2c",
        accent: "#d4d4d4",
        profit: "#8bc99a",
        loss: "#e68a8a",
        warning: "#d6b66d"
      },
      fontFamily: {
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans]
      },
      boxShadow: {
        soft: "0 1px 0 rgba(255, 255, 255, 0.03)"
      }
    }
  },
  plugins: []
};

export default config;
